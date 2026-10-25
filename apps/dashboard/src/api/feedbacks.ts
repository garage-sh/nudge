import type {
  ReviewAction,
  VerdictCorrection,
  DeliveryView,
  FeedbackPage,
  RedispatchView,
  FeedbackDetailView,
} from '@nudge/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ALERTS_KEY } from './alerts.js';
import { api } from './client.js';

/** The inbox's filters, in the order they are written in the URL. */
export const FEEDBACK_FILTERS = [
  'project',
  'type',
  'severity',
  'state',
  'source',
  'uncertain',
] as const;
export type FilterName = (typeof FEEDBACK_FILTERS)[number];
/** Values read as is from the URL: the api validates them (400 otherwise). */
export type FeedbackFilters = Partial<Record<FilterName, string>>;

/** Prefix of every inbox page, whatever the filters. */
const LISTS_KEY = ['feedbacks', 'list'] as const;
const listKey = (filters: FeedbackFilters) => [...LISTS_KEY, filters] as const;
const feedbackKey = (id: string) => ['feedbacks', 'detail', id] as const;

function feedbacksPath(filters: FeedbackFilters, cursor: string | null): string {
  const params = new URLSearchParams();
  for (const name of FEEDBACK_FILTERS) {
    const value = filters[name];
    if (value) params.set(name, value);
  }
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  return query ? `/api/feedbacks?${query}` : '/api/feedbacks';
}

/** The inbox, page by page (newest to oldest). */
export const useFeedbacks = (filters: FeedbackFilters) =>
  useInfiniteQuery({
    queryKey: listKey(filters),
    queryFn: ({ pageParam }) => api.get<FeedbackPage>(feedbacksPath(filters, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next,
  });

const feedbackPath = (id: string) => `/api/feedbacks/${encodeURIComponent(id)}`;

/** Refresh interval of a Feedback whose processing is under way. */
const POLL_MS = 2000;

/** Triage or a Delivery is in progress: the state read will change with no action from the Member. */
const inProgress = (feedback: FeedbackDetailView): boolean =>
  feedback.state === 'received' ||
  feedback.deliveries.some((delivery) => delivery.status === 'pending');

/**
 * A Feedback's detail, refreshed while its processing is under way, and until
 * `pollUntil` (an instant, in ms): after a review, the Dispatch that follows has not
 * created a Delivery yet.
 */
export const useFeedback = (id: string, { pollUntil = 0 } = {}) =>
  useQuery({
    queryKey: feedbackKey(id),
    queryFn: () => api.get<FeedbackDetailView>(feedbackPath(id)),
    refetchInterval: (query) => {
      const feedback = query.state.data;
      if (!feedback) return false;
      return inProgress(feedback) || Date.now() < pollUntil ? POLL_MS : false;
    },
  });

/**
 * After an action on a Feedback: stores the updated Feedback if returned (otherwise
 * reads it again, for example after a refusal because it changed in the meantime), and
 * refreshes the inbox.
 */
function useAfterAction(id: string) {
  const client = useQueryClient();
  return (feedback?: FeedbackDetailView) => {
    if (feedback) client.setQueryData(feedbackKey(id), feedback);
    else void client.invalidateQueries({ queryKey: feedbackKey(id) });
    void client.invalidateQueries({ queryKey: LISTS_KEY });
    // A reviewed Feedback leaves the "in review" badges.
    void client.invalidateQueries({ queryKey: ALERTS_KEY });
  };
}

/** Approve or reject a Feedback In review, reinstate a Junk Feedback. */
export function useReview(id: string) {
  const after = useAfterAction(id);
  return useMutation({
    mutationFn: (action: ReviewAction) =>
      api.post<FeedbackDetailView>(`${feedbackPath(id)}/review`, { action }),
    onSettled: (feedback) => after(feedback),
  });
}

/** Correct the Verdict's resolved type and / or Severity. */
export function useCorrectVerdict(id: string) {
  const after = useAfterAction(id);
  return useMutation({
    mutationFn: (correction: VerdictCorrection) =>
      api.patch<FeedbackDetailView>(`${feedbackPath(id)}/verdict`, correction),
    onSettled: (feedback) => after(feedback),
  });
}

/** Replay one of the Feedback's Deliveries; the Feedback is read again to follow the new attempt. */
export function useReplay(feedbackId: string) {
  const after = useAfterAction(feedbackId);
  return useMutation({
    mutationFn: (deliveryId: string) =>
      api.post<DeliveryView>(`/api/deliveries/${encodeURIComponent(deliveryId)}/replay`),
    onSettled: () => after(),
  });
}

/**
 * Redispatch the Feedback: the missing Deliveries to the Destinations whose Filter
 * accepts it according to its current Verdict; the updated Feedback is stored.
 */
export function useRedispatch(id: string) {
  const after = useAfterAction(id);
  return useMutation({
    mutationFn: () => api.post<RedispatchView>(`${feedbackPath(id)}/redispatch`),
    onSettled: (result) => after(result?.feedback),
  });
}

/**
 * Delete a Feedback and its Capture (erasure request). `leave` takes the Member off the
 * Feedback's screen before it leaves the cache (the screen would read it again: 404);
 * the inbox and the badges are read again.
 */
export function useDeleteFeedback(id: string, leave: () => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>(feedbackPath(id)),
    onSuccess: () => {
      leave();
      client.removeQueries({ queryKey: feedbackKey(id) });
      void client.invalidateQueries({ queryKey: LISTS_KEY });
      void client.invalidateQueries({ queryKey: ALERTS_KEY });
    },
  });
}
