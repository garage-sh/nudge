import {
  requiresApiKey,
  requiresBaseUrl,
  JUDGE_PROVIDERS,
  DEFAULT_JUDGE_MODELS,
  isDestinationType,
  FILTER_ALL,
  DESTINATION_TYPES,
  type JudgeProvider,
  type JudgeChoice,
  type AlertDestinationView,
  type InstanceJudgeView,
  DASHBOARD_LIMITS,
  type RetentionView,
} from '@nudge/shared';
import { useState, type FormEvent } from 'react';
import {
  useAlertDestination,
  useChangeRetention,
  useChooseJudge,
  useInstanceJudge,
  useRemoveAlertDestination,
  useRetention,
  useSaveAlertDestination,
  useTestAlertDestination,
} from '../api/instance.js';
import { useT } from '../i18n/index.js';
import {
  ConfirmAction,
  Confirmation,
  ErrorMessage,
  Field,
  Loading,
  PageHeader,
  SaveStatus,
} from '../layout/ui.js';
import { GeneratedSecrets, TestResult, type ShownSecrets } from './destinations/Destinations.js';
import { DestinationForm } from './destinations/DestinationForm.js';
import { DESTINATION_FORMS } from './destinations/types/index.js';

/**
 * The Instance's settings. Each setting is a `panel`: Judge, Alert destination,
 * retention period.
 */
export function Settings() {
  const t = useT();
  const judge = useInstanceJudge();
  const alertDestination = useAlertDestination();
  const retention = useRetention();
  return (
    <section>
      <PageHeader title={t.settings.title} description={t.settings.description} />
      <div className="settings">
        {judge.isPending || alertDestination.isPending || retention.isPending ? <Loading /> : null}
        <ErrorMessage
          error={judge.error ?? alertDestination.error ?? retention.error}
          onRetry={() => {
            void judge.refetch();
            void alertDestination.refetch();
            void retention.refetch();
          }}
        />
        {judge.data ? <Judge judge={judge.data} /> : null}
        {alertDestination.data ? (
          <AlertDestination destination={alertDestination.data.destination} />
        ) : null}
        {retention.data ? <Retention retention={retention.data} /> : null}
      </div>
    </section>
  );
}

/**
 * Feedback retention period: a scheduled task erases older Feedback, with its
 * Captures. Empty field: unlimited retention.
 */
function Retention({ retention }: { retention: RetentionView }) {
  const t = useT();
  const [days, setDays] = useState(retention.days === null ? '' : String(retention.days));
  // A shorter period erases Feedback: it waits for the Member's confirmation.
  const [toConfirm, setToConfirm] = useState<number | null>(null);
  const change = useChangeRetention();
  const save = (value: number | null) => change.mutate({ days: value });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = days === '' ? null : Number(days);
    const erases = value !== null && (retention.days === null || value < retention.days);
    if (erases) setToConfirm(value);
    else save(value);
  };
  return (
    <section className="panel" aria-labelledby="settings-retention">
      <h2 id="settings-retention">{t.settings.retention.title}</h2>
      <form onSubmit={submit} onChange={() => change.reset()} className="form">
        <p className="help">
          {retention.days === null
            ? t.settings.retention.unlimited
            : t.settings.retention.limited(retention.days)}
        </p>
        <Field
          label={t.settings.retention.label}
          id="retention-days"
          type="number"
          inputMode="numeric"
          min={1}
          max={DASHBOARD_LIMITS.retentionDaysMax}
          step={1}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          help={t.settings.retention.help}
        />
        <ErrorMessage error={change.error} />
        {toConfirm === null ? (
          <div className="actions">
            <button type="submit" disabled={change.isPending}>
              {t.settings.retention.save}
            </button>
          </div>
        ) : (
          <Confirmation
            question={t.settings.retention.confirm(toConfirm)}
            pending={change.isPending}
            onCancel={() => setToConfirm(null)}
            onConfirm={() => {
              save(toConfirm);
              setToConfirm(null);
            }}
          />
        )}
        <SaveStatus saved={change.isSuccess} />
      </form>
    </section>
  );
}

/**
 * The Alert destination: a Destination type, with neither name nor Filter, that
 * receives an alert when a Feedback goes In review or a Destination is Suspended.
 */
function AlertDestination({ destination }: { destination: AlertDestinationView | null }) {
  const t = useT();
  const a = t.settings.alertDestination;
  const save = useSaveAlertDestination();
  const removal = useRemoveAlertDestination();
  const test = useTestAlertDestination();
  const [shownSecrets, setShownSecrets] = useState<ShownSecrets | null>(null);
  const type =
    destination && isDestinationType(destination.type) ? destination.type : DESTINATION_TYPES[0];
  const config =
    destination && destination.type === type
      ? destination.config
      : DESTINATION_FORMS[type].initialConfig;

  return (
    <>
      <DestinationForm
        // A fresh form when the Alert destination changes type or is removed.
        key={destination?.type ?? 'none'}
        title={a.title}
        initial={{ type, name: '', config, filter: FILTER_ALL }}
        typeEditable
        withoutNameOrFilter
        savedSecrets={destination?.secrets ?? []}
        submitLabel={a.save}
        pending={save.isPending}
        error={save.error ?? removal.error ?? test.error}
        onSubmit={({ type: chosen, config: input, secrets }) =>
          save.mutate(
            { type: chosen, config: input, ...(secrets ? { secrets } : {}) },
            {
              onSuccess: (result) =>
                setShownSecrets(
                  Object.keys(result.generatedSecrets).length > 0
                    ? { type: chosen, name: a.secretName, secrets: result.generatedSecrets }
                    : null,
                ),
            },
          )
        }
        actions={
          destination ? (
            <>
              <button
                type="button"
                className="secondary"
                disabled={test.isPending}
                onClick={() => test.mutate()}
              >
                {t.common.test}
              </button>
              <ConfirmAction
                label={a.remove}
                question={a.removeQuestion}
                pending={removal.isPending}
                onConfirm={() => removal.mutate()}
              />
            </>
          ) : null
        }
      >
        <p className="help">{a.help}</p>
        <p className="muted">{destination ? a.saved(DESTINATION_FORMS[type].label) : a.none}</p>
        {test.data ? <TestResult result={test.data} delivered={a.testDelivered} /> : null}
        <SaveStatus saved={save.isSuccess} />
      </DestinationForm>
      {shownSecrets ? <GeneratedSecrets {...shownSecrets} /> : null}
    </>
  );
}

function Judge({ judge }: { judge: InstanceJudgeView }) {
  const t = useT();
  const j = t.settings.judge;
  const [provider, setProvider] = useState<JudgeProvider | ''>(judge.provider ?? '');
  const [model, setModel] = useState(judge.model ?? '');
  const [baseUrl, setBaseUrl] = useState(judge.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const choice = useChooseJudge();
  // The saved key is valid only for its provider.
  const keyKept = judge.keyConfigured && provider === judge.provider;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body: JudgeChoice = provider
      ? {
          provider,
          model: model || null,
          baseUrl: baseUrl || null,
          // Empty field: the saved key is kept (the api never returns it).
          ...(apiKey ? { apiKey } : {}),
        }
      : { provider: null };
    choice.mutate(body, { onSuccess: () => setApiKey('') });
  };

  return (
    <form onSubmit={submit} onChange={() => choice.reset()} className="form panel">
      <h2>{j.title}</h2>
      <p className="help">{j.help}</p>
      <div className="field">
        <label htmlFor="judge-provider">{j.provider}</label>
        <select
          id="judge-provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value as JudgeProvider | '')}
        >
          <option value="">{j.none}</option>
          {JUDGE_PROVIDERS.map((value) => (
            <option key={value} value={value}>
              {t.labels.judgeProvider[value]}
            </option>
          ))}
        </select>
        {provider ? <p className="help">{t.labels.judgeProviderDescription[provider]}</p> : null}
      </div>
      {provider ? (
        <>
          <Field
            label={j.model}
            value={model}
            placeholder={DEFAULT_JUDGE_MODELS[provider]}
            onChange={(e) => setModel(e.target.value)}
            help={j.modelHelp(DEFAULT_JUDGE_MODELS[provider])}
          />
          <Field
            label={requiresBaseUrl(provider) ? j.serverUrl : j.baseUrl}
            id="judge-url"
            type="url"
            required={requiresBaseUrl(provider)}
            value={baseUrl}
            placeholder={requiresBaseUrl(provider) ? 'http://judge:8080' : ''}
            onChange={(e) => setBaseUrl(e.target.value)}
            help={requiresBaseUrl(provider) ? j.serverUrlHelp : j.baseUrlHelp}
          />
          <Field
            label={j.apiKey}
            type="password"
            autoComplete="off"
            required={requiresApiKey(provider) && !keyKept}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            help={keyKept ? j.keySaved : j.keyHelp}
          />
        </>
      ) : null}
      <ErrorMessage error={choice.error} />
      <div className="actions">
        <button type="submit" disabled={choice.isPending}>
          {t.common.save}
        </button>
      </div>
      <SaveStatus saved={choice.isSuccess} />
    </form>
  );
}
