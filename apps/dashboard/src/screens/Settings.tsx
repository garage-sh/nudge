import {
  requiresApiKey,
  requiresBaseUrl,
  JUDGE_PROVIDERS,
  DEFAULT_JUDGE_MODELS,
  isDestinationType,
  FILTER_ALL,
  DESTINATION_TYPES,
  SMTP_DEFAULT_PORTS,
  SMTP_SECURITIES,
  type JudgeProvider,
  type JudgeChoice,
  type AlertDestinationView,
  type InstanceJudgeView,
  type InstanceSmtpView,
  DASHBOARD_LIMITS,
  type RetentionView,
  type SmtpSecurity,
} from '@nudge/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router';
import {
  useAlertDestination,
  useChangeRetention,
  useChooseJudge,
  useInstanceJudge,
  useInstanceSmtp,
  useRemoveAlertDestination,
  useRemoveSmtp,
  useRetention,
  useSaveAlertDestination,
  useSaveSmtp,
  useTestAlertDestination,
  useTestSmtp,
} from '../api/instance.js';
import { useSession } from '../api/session.js';
import { useT } from '../i18n/index.js';
import {
  ConfirmAction,
  Confirmation,
  ErrorMessage,
  Field,
  Loading,
  PageHeader,
  PanelHeader,
  Pill,
  SaveStatus,
} from '../layout/ui.js';
import { GeneratedSecrets, TestResult, type ShownSecrets } from './destinations/Destinations.js';
import { DestinationForm } from './destinations/DestinationForm.js';
import { DESTINATION_FORMS } from './destinations/types/index.js';

/** The panels, in screen order: their heading `id` is the anchor of the section nav. */
const SECTIONS = ['judge', 'smtp', 'alert', 'retention'] as const;
type Section = (typeof SECTIONS)[number];
const headingId = (section: Section) => `settings-${section}`;

/**
 * The Instance's settings. Each setting is a `panel` with its saved state in its
 * header: Judge, SMTP server, Alert destination, retention period. A section nav
 * leads to each one.
 */
export function Settings() {
  const t = useT();
  const judge = useInstanceJudge();
  const smtp = useInstanceSmtp();
  const alertDestination = useAlertDestination();
  const retention = useRetention();
  const queries = [judge, smtp, alertDestination, retention];
  const ready = queries.every((query) => query.data);
  useScrollToHash(ready);
  return (
    <section>
      <PageHeader title={t.settings.title} description={t.settings.description} />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t.settings.sections}>
          <ul>
            {SECTIONS.map((section) => (
              <li key={section}>
                <a href={`#${headingId(section)}`}>{t.settings.section[section]}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="settings">
          {queries.some((query) => query.isPending) ? <Loading /> : null}
          <ErrorMessage
            error={queries.find((query) => query.error)?.error}
            onRetry={() => queries.forEach((query) => void query.refetch())}
          />
          {judge.data ? <Judge judge={judge.data} /> : null}
          {smtp.data ? <Smtp smtp={smtp.data.smtp} /> : null}
          {alertDestination.data ? (
            <AlertDestination destination={alertDestination.data.destination} />
          ) : null}
          {retention.data ? <Retention retention={retention.data} /> : null}
        </div>
      </div>
    </section>
  );
}

/**
 * A link to `/settings#settings-smtp` (from an email Destination's form) lands on its
 * panel once the panels are drawn: the router does not scroll to a hash by itself.
 */
function useScrollToHash(ready: boolean) {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || !hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [ready, hash]);
}

/**
 * Feedback retention period: a scheduled task erases older Feedback, with its
 * Captures. Empty field: unlimited retention.
 */
function Retention({ retention }: { retention: RetentionView }) {
  const t = useT();
  const r = t.settings.retention;
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
    <section className="panel" aria-labelledby={headingId('retention')}>
      <PanelHeader
        id={headingId('retention')}
        title={r.title}
        status={
          <Pill tone="neutral">
            {retention.days === null ? r.status.unlimited : r.status.days(retention.days)}
          </Pill>
        }
      />
      <form onSubmit={submit} onChange={() => change.reset()} className="form">
        <p className="help">{retention.days === null ? r.unlimited : r.limited(retention.days)}</p>
        <Field
          label={r.label}
          id="retention-days"
          type="number"
          inputMode="numeric"
          min={1}
          max={DASHBOARD_LIMITS.retentionDaysMax}
          step={1}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          help={r.help}
        />
        <ErrorMessage error={change.error} />
        {toConfirm === null ? (
          <div className="actions">
            <button type="submit" disabled={change.isPending}>
              {r.save}
            </button>
          </div>
        ) : (
          <Confirmation
            question={r.confirm(toConfirm)}
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
 * The Instance's SMTP server, through which the email Destinations send. The password
 * is never returned: an empty field keeps the saved one.
 */
function Smtp({ smtp }: { smtp: InstanceSmtpView | null }) {
  const t = useT();
  const s = t.settings.smtp;
  const member = useSession().data;
  const save = useSaveSmtp();
  const removal = useRemoveSmtp();
  const test = useTestSmtp();
  const [host, setHost] = useState(smtp?.host ?? '');
  const [security, setSecurity] = useState<SmtpSecurity>(smtp?.security ?? 'starttls');
  const [port, setPort] = useState(String(smtp?.port ?? SMTP_DEFAULT_PORTS.starttls));
  const [username, setUsername] = useState(smtp?.username ?? '');
  const [password, setPassword] = useState('');
  const [fromAddress, setFromAddress] = useState(smtp?.fromAddress ?? '');
  const [fromName, setFromName] = useState(smtp?.fromName ?? '');
  // The saved password goes only to the same account: the api drops it otherwise.
  const passwordKept =
    smtp !== null &&
    smtp.passwordConfigured &&
    host.trim().toLowerCase() === smtp.host.toLowerCase() &&
    username.trim() === (smtp.username ?? '');

  const changeSecurity = (next: SmtpSecurity) => {
    // The port follows the mode while it is still the previous mode's usual one.
    if (port === String(SMTP_DEFAULT_PORTS[security])) setPort(String(SMTP_DEFAULT_PORTS[next]));
    setSecurity(next);
  };
  const reset = () => {
    save.reset();
    test.reset();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(
      {
        host,
        port: Number(port),
        security,
        username: username || null,
        fromAddress,
        fromName: fromName || null,
        // Empty field: the saved password is kept (the api never returns it).
        ...(password ? { password } : {}),
      },
      { onSuccess: () => setPassword('') },
    );
  };

  return (
    <form
      onSubmit={submit}
      onChange={reset}
      className="form panel"
      aria-labelledby={headingId('smtp')}
    >
      <PanelHeader
        id={headingId('smtp')}
        title={s.title}
        status={
          smtp ? (
            <Pill tone="success">{s.status.configured}</Pill>
          ) : (
            <Pill tone="off">{s.status.none}</Pill>
          )
        }
      />
      <p className="help">{s.help}</p>
      <div className="field-row short-end">
        <Field
          label={s.host}
          id="smtp-host"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="smtp.example.com"
          maxLength={DASHBOARD_LIMITS.smtpHost}
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        <Field
          label={s.port}
          id="smtp-port"
          type="number"
          inputMode="numeric"
          required
          min={1}
          max={65_535}
          step={1}
          value={port}
          onChange={(e) => setPort(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="smtp-security">{s.security}</label>
        <select
          id="smtp-security"
          value={security}
          onChange={(e) => changeSecurity(e.target.value as SmtpSecurity)}
          aria-describedby="smtp-security-help"
        >
          {SMTP_SECURITIES.map((value) => (
            <option key={value} value={value}>
              {s.securities[value]}
            </option>
          ))}
        </select>
        <p id="smtp-security-help" className="help">
          {s.securityHelp[security]}
        </p>
      </div>
      <div className="field-row">
        <Field
          label={s.username}
          id="smtp-username"
          autoComplete="off"
          spellCheck={false}
          maxLength={DASHBOARD_LIMITS.smtpUsername}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          help={s.usernameHelp}
        />
        <Field
          label={s.password}
          id="smtp-password"
          type="password"
          autoComplete="new-password"
          maxLength={DASHBOARD_LIMITS.smtpPassword}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          help={passwordKept ? s.passwordSaved : s.passwordHelp}
        />
      </div>
      <div className="field-row">
        <Field
          label={s.fromAddress}
          id="smtp-from-address"
          type="email"
          required
          autoComplete="off"
          placeholder="nudge@example.com"
          maxLength={DASHBOARD_LIMITS.email}
          value={fromAddress}
          onChange={(e) => setFromAddress(e.target.value)}
          help={s.fromAddressHelp}
        />
        <Field
          label={s.fromName}
          id="smtp-from-name"
          autoComplete="off"
          placeholder="nudge"
          maxLength={DASHBOARD_LIMITS.smtpFromName}
          value={fromName}
          onChange={(e) => setFromName(e.target.value)}
        />
      </div>
      <ErrorMessage error={save.error ?? removal.error ?? test.error} />
      <div className="actions">
        <button type="submit" disabled={save.isPending}>
          {s.save}
        </button>
        {smtp ? (
          <>
            <button
              type="button"
              className="secondary"
              disabled={test.isPending}
              onClick={() => test.mutate()}
            >
              {test.isPending ? s.testing : s.test}
            </button>
            <ConfirmAction
              label={s.remove}
              question={s.removeQuestion}
              pending={removal.isPending}
              onConfirm={() =>
                removal.mutate(undefined, {
                  onSuccess: () => {
                    test.reset();
                    setPassword('');
                  },
                })
              }
            />
          </>
        ) : null}
      </div>
      {test.data ? (
        <TestResult result={test.data} delivered={s.testDelivered(member?.email ?? '')} />
      ) : null}
      <SaveStatus saved={save.isSuccess} />
    </form>
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
        headingId={headingId('alert')}
        status={
          destination ? (
            <Pill tone="success">{DESTINATION_FORMS[type].label}</Pill>
          ) : (
            <Pill tone="off">{a.status.none}</Pill>
          )
        }
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
        <p className="help">{destination ? a.help : `${a.help} ${a.none}`}</p>
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
    <form
      onSubmit={submit}
      onChange={() => choice.reset()}
      className="form panel"
      aria-labelledby={headingId('judge')}
    >
      <PanelHeader
        id={headingId('judge')}
        title={j.title}
        status={
          judge.provider ? (
            <Pill tone="success">{t.labels.judgeProvider[judge.provider]}</Pill>
          ) : (
            <Pill tone="held">{j.status.degraded}</Pill>
          )
        }
      />
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
          {j.save}
        </button>
      </div>
      <SaveStatus saved={choice.isSuccess} />
    </form>
  );
}
