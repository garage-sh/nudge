import type {
  JudgeChoice,
  AlertDestinationWithGeneratedSecrets,
  AlertDestinationInput,
  AlertDestinationView,
  InstanceJudgeView,
  DestinationTestResult,
  InstanceSmtpView,
  RetentionView,
  SmtpSettingsInput,
} from '@nudge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

const JUDGE_KEY = ['instance', 'judge'] as const;
const JUDGE_PATH = '/api/instance/judge';

export const useInstanceJudge = () =>
  useQuery({ queryKey: JUDGE_KEY, queryFn: () => api.get<InstanceJudgeView>(JUDGE_PATH) });

export function useChooseJudge() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (choice: JudgeChoice) => api.put<InstanceJudgeView>(JUDGE_PATH, choice),
    onSuccess: (judge) => client.setQueryData(JUDGE_KEY, judge),
  });
}

const ALERT_DESTINATION_KEY = ['instance', 'alert-destination'] as const;
const ALERT_DESTINATION_PATH = '/api/instance/alert-destination';

export const useAlertDestination = () =>
  useQuery({
    queryKey: ALERT_DESTINATION_KEY,
    queryFn: () => api.get<{ destination: AlertDestinationView | null }>(ALERT_DESTINATION_PATH),
  });

export function useSaveAlertDestination() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: AlertDestinationInput) =>
      api.put<AlertDestinationWithGeneratedSecrets>(ALERT_DESTINATION_PATH, input),
    onSuccess: ({ destination }) => client.setQueryData(ALERT_DESTINATION_KEY, { destination }),
  });
}

export function useRemoveAlertDestination() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>(ALERT_DESTINATION_PATH),
    onSuccess: () => client.setQueryData(ALERT_DESTINATION_KEY, { destination: null }),
  });
}

export const useTestAlertDestination = () =>
  useMutation({
    mutationFn: () => api.post<DestinationTestResult>(`${ALERT_DESTINATION_PATH}/test`),
  });

const RETENTION_KEY = ['instance', 'retention'] as const;
const RETENTION_PATH = '/api/instance/retention';

export const useRetention = () =>
  useQuery({ queryKey: RETENTION_KEY, queryFn: () => api.get<RetentionView>(RETENTION_PATH) });

export function useChangeRetention() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (retention: RetentionView) => api.put<RetentionView>(RETENTION_PATH, retention),
    onSuccess: (retention) => client.setQueryData(RETENTION_KEY, retention),
  });
}

const SMTP_KEY = ['instance', 'smtp'] as const;
const SMTP_PATH = '/api/instance/smtp';

/** `smtp: null`: no SMTP server, the email Destinations cannot send. */
export const useInstanceSmtp = () =>
  useQuery({
    queryKey: SMTP_KEY,
    queryFn: () => api.get<{ smtp: InstanceSmtpView | null }>(SMTP_PATH),
  });

export function useSaveSmtp() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (settings: SmtpSettingsInput) => api.put<InstanceSmtpView>(SMTP_PATH, settings),
    onSuccess: (smtp) => client.setQueryData(SMTP_KEY, { smtp }),
  });
}

export function useRemoveSmtp() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>(SMTP_PATH),
    onSuccess: () => client.setQueryData(SMTP_KEY, { smtp: null }),
  });
}

/** Sends a test email to the signed-in Member, through the saved server. */
export const useTestSmtp = () =>
  useMutation({ mutationFn: () => api.post<DestinationTestResult>(`${SMTP_PATH}/test`) });
