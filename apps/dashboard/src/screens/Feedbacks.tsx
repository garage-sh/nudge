import {
  SEVERITIES,
  SOURCES,
  FEEDBACK_TYPES,
  type FeedbackState,
  type FeedbackSummaryView,
} from '@nudge/shared';
import { createContext, useEffect, useRef } from 'react';
import { Link, Outlet, useMatch, useNavigate, useSearchParams } from 'react-router';
import { useAlerts } from '../api/alerts.js';
import {
  FEEDBACK_FILTERS,
  useFeedbacks,
  type FeedbackFilters,
  type FilterName,
} from '../api/feedbacks.js';
import { useProjects } from '../api/projects.js';
import { useI18n, useT, type Messages } from '../i18n/index.js';
import type { Format } from '../i18n/format.js';
import { EmptyState, ErrorMessage, Loading, PageHeader, useMediaQuery } from '../layout/ui.js';
import { SeverityGauge, StatePill, UncertainBadge } from './feedback-badges.js';

/** The navigation state a Feedback opened from the list receives: the list, for Previous / Next. */
export interface ListState {
  readonly list?: { readonly ids: readonly string[] };
}

/**
 * Present when the Feedback shows in the Inbox's pane, beside the list: the detail
 * closes instead of going back to the list.
 */
export const FeedbackPane = createContext<{ readonly close: string } | null>(null);

/** The width from which a Feedback opens beside the list. */
const SPLIT_WIDTH = '(min-width: 1200px)';

/** The Inbox, and the open Feedback: beside the list if the screen allows. */
export function Feedbacks() {
  const wide = useMediaQuery(SPLIT_WIDTH);
  const open = useMatch('/feedbacks/:id')?.params.id;
  if (open && !wide) return <Outlet />;
  return <Inbox open={wide ? open : undefined} />;
}

/** The inbox's views: a shortcut to the State filter. */
const VIEWS: readonly (FeedbackState | null)[] = [
  null,
  'in_review',
  'received',
  'triaged',
  'dispatched',
  'discarded',
];

/**
 * The Inbox: the Feedback of every Project; the filters live in the URL.
 * `open`: the Feedback shown in the pane, beside the list.
 */
function Inbox({ open }: { open: string | undefined }) {
  const { t, format } = useI18n();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const filters: FeedbackFilters = Object.fromEntries(
    FEEDBACK_FILTERS.flatMap((name) => {
      const value = params.get(name);
      return value ? [[name, value]] : [];
    }),
  );
  const filter = (name: FilterName, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  };
  const clearFilters = () => {
    const next = new URLSearchParams();
    if (filters.state) next.set('state', filters.state);
    setParams(next, { replace: true });
  };
  const feedbacks = useFeedbacks(filters);
  const rows = feedbacks.data?.pages.flatMap((page) => page.feedbacks) ?? [];
  const filtersOutsideView = Object.keys(filters).filter((name) => name !== 'state');
  const list: ListState['list'] = { ids: rows.map((feedback) => feedback.id) };
  const search = params.toString() ? `?${params.toString()}` : '';
  const toFeedback = (id: string) => `/feedbacks/${id}${search}`;

  // Like a mail client: J / K move to the next / previous Feedback, Escape closes.
  useEffect(() => {
    if (!open) return;
    const keyboard = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || target.closest('input, textarea, select')) return;
      const position = list.ids.indexOf(open);
      const go = (id: string | undefined) => {
        if (id) void navigate(toFeedback(id), { state: { list } satisfies ListState });
      };
      if (e.key === 'j') go(list.ids[position + 1]);
      else if (e.key === 'k') go(position > 0 ? list.ids[position - 1] : undefined);
      else if (e.key === 'Escape') void navigate(`/feedbacks${search}`);
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  });

  const feedbackList = (
    <>
      <Views state={filters.state} params={params} />
      <Filters filters={filters} filter={filter} />
      {feedbacks.isFetchNextPageError ? null : (
        <ErrorMessage error={feedbacks.error} onRetry={() => void feedbacks.refetch()} />
      )}
      <p role="status" className="visually-hidden">
        {feedbacks.isSuccess ? t.inbox.shown(rows.length, feedbacks.hasNextPage) : ''}
      </p>
      {feedbacks.isPending ? (
        <div className="feedback-list">
          <Loading />
        </div>
      ) : null}
      {feedbacks.isSuccess && rows.length === 0 ? (
        filtersOutsideView.length > 0 || filters.state ? (
          <EmptyState
            title={t.inbox.noMatch}
            action={
              filtersOutsideView.length > 0 ? (
                <button type="button" className="secondary" onClick={clearFilters}>
                  {t.inbox.clearFilters}
                </button>
              ) : null
            }
          />
        ) : (
          <EmptyState title={t.inbox.emptyTitle}>{t.inbox.emptyHelp}</EmptyState>
        )
      ) : null}
      {rows.length > 0 ? (
        <div className="feedback-list">
          {groupByDay(rows, format).map(({ day, feedbacks: ofTheDay }) => (
            <section key={day} aria-label={day}>
              <h2 className="day-group">{day}</h2>
              <ul className="feedback-rows">
                {ofTheDay.map((feedback) => (
                  <FeedbackRow
                    key={feedback.id}
                    feedback={feedback}
                    list={list}
                    to={toFeedback(feedback.id)}
                    open={feedback.id === open}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
      {feedbacks.hasNextPage ? (
        <button
          type="button"
          className="secondary more"
          disabled={feedbacks.isFetchingNextPage}
          onClick={() => void feedbacks.fetchNextPage()}
        >
          {feedbacks.isFetchingNextPage ? t.common.loading : t.inbox.showMore}
        </button>
      ) : null}
      {feedbacks.isFetchNextPageError ? (
        <ErrorMessage error={feedbacks.error} onRetry={() => void feedbacks.fetchNextPage()} />
      ) : null}
      {open ? (
        <p className="shortcuts">
          <kbd>J</kbd> <kbd>K</kbd> {t.inbox.shortcutsNextPrevious}{' '}
          <kbd>{t.inbox.shortcutsEscape}</kbd> {t.inbox.shortcutsClose}
        </p>
      ) : null}
    </>
  );

  return (
    <section className="inbox" data-split={Boolean(open)}>
      <div className="inbox-list">
        <PageHeader title={t.inbox.title} />
        {feedbackList}
      </div>
      {open ? (
        <FeedbackPane.Provider value={{ close: `/feedbacks${search}` }}>
          <aside className="feedback-pane" aria-label={t.inbox.openFeedback}>
            <Outlet />
          </aside>
        </FeedbackPane.Provider>
      ) : null}
    </section>
  );
}

/** The Feedback, already newest to oldest, grouped by day received. */
function groupByDay(feedbacks: readonly FeedbackSummaryView[], format: Format) {
  const groups: { day: string; feedbacks: FeedbackSummaryView[] }[] = [];
  for (const feedback of feedbacks) {
    const day = format.day(feedback.createdAt);
    const last = groups.at(-1);
    if (last?.day === day) last.feedbacks.push(feedback);
    else groups.push({ day, feedbacks: [feedback] });
  }
  return groups;
}

function Views({ state, params }: { state: string | undefined; params: URLSearchParams }) {
  const t = useT();
  const inReview = useAlerts().data?.feedbacksInReview ?? 0;
  const to = (target: FeedbackState | null) => {
    const next = new URLSearchParams(params);
    if (target) next.set('state', target);
    else next.delete('state');
    const search = next.toString();
    return search ? `/feedbacks?${search}` : '/feedbacks';
  };
  return (
    <nav className="views" aria-label={t.inbox.views}>
      {VIEWS.map((target) => (
        <Link
          key={target ?? 'all'}
          to={to(target)}
          replace
          aria-current={(state ?? null) === target ? 'page' : undefined}
        >
          {t.inbox.view[target ?? 'all']}
          {target === 'in_review' && inReview > 0 ? (
            <span className="review-count">
              <span className="visually-hidden">, </span>
              {inReview}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

function Filters({
  filters,
  filter,
}: {
  filters: FeedbackFilters;
  filter: (name: FilterName, value: string) => void;
}) {
  const t = useT();
  const projects = useProjects();
  const options = (values: readonly string[], labels: Readonly<Record<string, string>>) =>
    values.map((value) => ({ value, label: labels[value] ?? value }));
  const selects: readonly {
    name: Exclude<FilterName, 'state'>;
    all: string;
    options: readonly { value: string; label: string }[];
  }[] = [
    {
      name: 'project',
      all: t.inbox.anyProject,
      options: (projects.data ?? []).map((p) => ({ value: p.id, label: p.name })),
    },
    { name: 'type', all: t.inbox.anyType, options: options(FEEDBACK_TYPES, t.labels.feedbackType) },
    {
      name: 'severity',
      all: t.inbox.anySeverity,
      options: options(SEVERITIES, t.labels.severity),
    },
    { name: 'source', all: t.inbox.anySource, options: options(SOURCES, t.labels.source) },
    {
      name: 'uncertain',
      all: t.inbox.anyVerdict,
      options: [
        { value: 'true', label: t.inbox.uncertainOnly },
        { value: 'false', label: t.inbox.withoutUncertain },
      ],
    },
  ];
  return (
    <div className="filters" role="group" aria-label={t.inbox.filters}>
      {selects.map(({ name, all, options: choices }) => (
        <div key={name} className="filter" data-active={Boolean(filters[name])}>
          <label htmlFor={`filter-${name}`}>{t.inbox.filter[name]}</label>
          <select
            id={`filter-${name}`}
            value={filters[name] ?? ''}
            onChange={(e) => filter(name, e.target.value)}
          >
            <option value="">{all}</option>
            {choices.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function FeedbackRow({
  feedback,
  list,
  to,
  open,
}: {
  feedback: FeedbackSummaryView;
  list: ListState['list'];
  to: string;
  open: boolean;
}) {
  const { t, format } = useI18n();
  const { verdict } = feedback;
  const state: ListState = { list };
  const link = useRef<HTMLAnchorElement>(null);
  // Opened by J / K: the row comes into view, and takes focus if it was in the list.
  useEffect(() => {
    const element = link.current;
    if (!open || !element) return;
    element.scrollIntoView?.({ block: 'nearest' });
    if (document.activeElement?.closest('.feedback-list')) element.focus();
  }, [open]);
  return (
    <li className="feedback-row" data-state={feedback.state} data-open={open}>
      <SeverityGauge severity={verdict?.severity} />
      <p className="summary">
        <strong className="type">{typeLabel(t, verdict?.resolvedType)}</strong>
        <Link
          ref={link}
          to={to}
          state={state}
          className="preview"
          aria-current={open ? 'true' : undefined}
        >
          {feedback.preview}
        </Link>
      </p>
      <span className="project">{feedback.project.name}</span>
      <span className="states">
        {verdict?.uncertain ? <UncertainBadge /> : null}
        <StatePill state={feedback.state} />
      </span>
      <time dateTime={feedback.createdAt} title={format.date(feedback.createdAt)}>
        {format.dateRelative(feedback.createdAt)}
      </time>
    </li>
  );
}

const typeLabel = (t: Messages, type: FeedbackSummaryView['declaredType'] | undefined) =>
  type ? t.labels.feedbackType[type] : t.inbox.notTriaged;
