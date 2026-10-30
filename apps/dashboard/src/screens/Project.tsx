import {
  LEVELS,
  OPENING_CAP_BOUNDS,
  QUIET_PERIOD_BOUNDS,
  type Level,
  type ProjectView,
} from '@nudge/shared';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate, useParams } from 'react-router';
import {
  useProject,
  useRegeneratePublicKey,
  useRegenerateSecretKey,
  useUpdateProject,
} from '../api/projects.js';
import { useT } from '../i18n/index.js';
import {
  ConfirmAction,
  CopyableValue,
  ErrorMessage,
  Field,
  Loading,
  PageHeader,
  SaveStatus,
  useScrollToHash,
} from '../layout/ui.js';

/** Navigation state: the secret key of a Project just created. */
export interface SecretKeyState {
  readonly secretKey?: string;
}

/**
 * The secret key received at creation, removed at once from the browser's history
 * (which survives a reload): it lives only in this screen.
 */
function useReceivedSecretKey(): [string | null, (key: string) => void] {
  const location = useLocation();
  const navigate = useNavigate();
  const [key, setKey] = useState(
    () => (location.state as SecretKeyState | null)?.secretKey ?? null,
  );
  const toPurge = Boolean((location.state as SecretKeyState | null)?.secretKey);
  useEffect(() => {
    if (toPurge) void navigate(location.pathname, { replace: true, state: null });
  }, [toPurge, location.pathname, navigate]);
  return [key, setKey];
}

export function Project() {
  const id = useParams().id ?? '';
  const project = useProject(id);
  useScrollToHash(project.isSuccess);
  if (project.isPending) return <Loading />;
  if (project.isError) {
    return <ProjectNotFound error={project.error} onRetry={() => void project.refetch()} />;
  }
  return (
    <section>
      <ProjectHeader project={project.data} />
      <div className="settings">
        <Keys project={project.data} />
        <Details project={project.data} />
        <AllowedOrigins project={project.data} />
        <IncidentSettings project={project.data} />
      </div>
    </section>
  );
}

/** The Project could not be read: the frame stays, with the way back to the Project list. */
export function ProjectNotFound({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  return (
    <section>
      <PageHeader
        title={t.project.fallbackTitle}
        back={{ to: '/projects', label: t.layout.projects }}
      />
      <ErrorMessage error={error} onRetry={onRetry} />
    </section>
  );
}

/**
 * The header shared by a Project's pages: its name, its description and the tabs
 * Destinations (where its Feedback goes), Incidents (what its applications report) and
 * Settings (keys, details, origins, Incidents).
 */
export function ProjectHeader({ project, actions }: { project: ProjectView; actions?: ReactNode }) {
  const t = useT();
  const base = `/projects/${encodeURIComponent(project.id)}`;
  return (
    <>
      <PageHeader
        title={project.name}
        back={{ to: '/projects', label: t.layout.projects }}
        description={project.description}
        actions={actions}
      />
      <nav className="tabs" aria-label={t.project.sections}>
        <NavLink to={`${base}/destinations`} end>
          {t.project.destinationsTab}
        </NavLink>
        <NavLink to={`${base}/incidents`}>{t.project.incidentsTab}</NavLink>
        <NavLink to={base} end>
          {t.project.settingsTab}
        </NavLink>
      </nav>
    </>
  );
}

function Keys({ project }: { project: ProjectView }) {
  const t = useT();
  const [secretKey, setSecretKey] = useReceivedSecretKey();
  const publicKey = useRegeneratePublicKey(project.id);
  const secret = useRegenerateSecretKey(project.id);
  return (
    <div className="panel">
      <h2>{t.project.keys}</h2>
      <h3>{t.project.publicKey}</h3>
      <p className="help">{t.project.publicKeyHelp}</p>
      <CopyableValue label={t.project.publicKey} value={project.publicKey} />
      <ConfirmAction
        label={t.project.regeneratePublicKey}
        question={t.project.regeneratePublicKeyQuestion}
        pending={publicKey.isPending}
        onConfirm={() => publicKey.mutate()}
      />
      <ErrorMessage error={publicKey.error} />

      <h3>{t.project.secretKey}</h3>
      <p className="help">{t.project.secretKeyHelp}</p>
      {secretKey ? (
        <div className="warning" role="status">
          <p>{t.project.copySecretKeyNow}</p>
          <CopyableValue label={t.project.secretKey} value={secretKey} />
        </div>
      ) : (
        <p className="muted">{t.project.secretKeyShownOnce}</p>
      )}
      <ConfirmAction
        label={t.project.regenerateSecretKey}
        question={t.project.regenerateSecretKeyQuestion}
        pending={secret.isPending}
        onConfirm={() =>
          secret.mutate(undefined, { onSuccess: (result) => setSecretKey(result.secretKey) })
        }
      />
      <ErrorMessage error={secret.error} />
    </div>
  );
}

function Details({ project }: { project: ProjectView }) {
  const t = useT();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const update = useUpdateProject(project.id);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({ name, description });
  };
  return (
    <form onSubmit={submit} onChange={() => update.reset()} className="form panel">
      <h2>{t.project.details}</h2>
      <Field
        label={t.projects.name}
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="field">
        <label htmlFor="project-description">{t.project.description}</label>
        <textarea
          id="project-description"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="help">{t.project.descriptionHelp}</p>
      </div>
      <ErrorMessage error={update.error} />
      <div className="actions">
        <button type="submit" disabled={update.isPending}>
          {t.project.saveDetails}
        </button>
      </div>
      <SaveStatus saved={update.isSuccess} />
    </form>
  );
}

function AllowedOrigins({ project }: { project: ProjectView }) {
  const t = useT();
  const [text, setText] = useState(project.allowedOrigins.join('\n'));
  const update = useUpdateProject(project.id);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const allowedOrigins = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    update.mutate(
      { allowedOrigins },
      { onSuccess: (saved) => setText(saved.allowedOrigins.join('\n')) },
    );
  };
  return (
    <form onSubmit={submit} onChange={() => update.reset()} className="form panel">
      <h2>{t.project.allowedOrigins}</h2>
      <div className="field">
        <label htmlFor="project-origins">{t.project.originsLabel}</label>
        <textarea
          id="project-origins"
          rows={4}
          placeholder="https://app.example.com"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="help">{t.project.originsHelp}</p>
      </div>
      <ErrorMessage error={update.error} />
      <div className="actions">
        <button type="submit" disabled={update.isPending}>
          {t.project.saveOrigins}
        </button>
      </div>
      <SaveStatus saved={update.isSuccess} />
    </form>
  );
}

/** Where the Project's settings explain how to report an Incident: `/projects/:id#…`. */
export const INCIDENT_SETTINGS_ANCHOR = 'project-incidents';

/** The request a server sends to report an Incident, with the secret key from its environment. */
const incidentExample = (origin: string) =>
  [
    `curl -X POST ${origin}/v1/incidents \\`,
    '  -H "Authorization: Bearer $NUDGE_SECRET_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    `  -d '{"title": "Payment provider timed out", "level": "error", "environment": "production"}'`,
  ].join('\n');

/** Seconds as the minutes the field shows; `null` (the Instance default) as an empty field. */
const toMinutes = (seconds: number | null) =>
  seconds === null ? '' : String(Math.max(1, Math.round(seconds / 60)));

/**
 * How the Project's Incidents are reported, closed and held: the default Level, the Quiet
 * period, the Opening cap, and an example request.
 */
function IncidentSettings({ project }: { project: ProjectView }) {
  const t = useT();
  const i = t.project.incidents;
  const [defaultLevel, setDefaultLevel] = useState<Level>(project.defaultLevel);
  const [quietMinutes, setQuietMinutes] = useState(toMinutes(project.quietPeriod));
  const [openingCap, setOpeningCap] = useState(
    project.openingCap === null ? '' : String(project.openingCap),
  );
  const update = useUpdateProject(project.id);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const minutes = quietMinutes.trim();
    const cap = openingCap.trim();
    update.mutate({
      defaultLevel,
      quietPeriod: minutes === '' ? null : Number(minutes) * 60,
      openingCap: cap === '' ? null : Number(cap),
    });
  };
  return (
    <form
      id={INCIDENT_SETTINGS_ANCHOR}
      onSubmit={submit}
      onChange={() => update.reset()}
      className="form panel"
    >
      <h2>{i.title}</h2>
      <p className="help">{i.help}</p>
      <div className="field">
        <label htmlFor="project-default-level">{i.defaultLevel}</label>
        <select
          id="project-default-level"
          value={defaultLevel}
          onChange={(e) => setDefaultLevel(e.target.value as Level)}
        >
          {LEVELS.map((level) => (
            <option key={level} value={level}>
              {t.labels.level[level]}
            </option>
          ))}
        </select>
        <p className="help">{i.defaultLevelHelp}</p>
      </div>
      <div className="field">
        <label htmlFor="project-quiet-period">{i.quietPeriod}</label>
        <input
          id="project-quiet-period"
          type="number"
          inputMode="numeric"
          min={1}
          max={QUIET_PERIOD_BOUNDS.max / 60}
          step={1}
          value={quietMinutes}
          aria-describedby="project-quiet-period-help"
          onChange={(e) => setQuietMinutes(e.target.value)}
        />
        <p className="help" id="project-quiet-period-help">
          {i.quietPeriodHelp}
        </p>
      </div>
      <div className="field">
        <label htmlFor="project-opening-cap">{i.openingCap}</label>
        <input
          id="project-opening-cap"
          type="number"
          inputMode="numeric"
          min={OPENING_CAP_BOUNDS.min}
          max={OPENING_CAP_BOUNDS.max}
          step={1}
          value={openingCap}
          aria-describedby="project-opening-cap-help"
          onChange={(e) => setOpeningCap(e.target.value)}
        />
        <p className="help" id="project-opening-cap-help">
          {i.openingCapHelp}
        </p>
      </div>
      <ErrorMessage error={update.error} />
      <div className="actions">
        <button type="submit" disabled={update.isPending}>
          {i.save}
        </button>
      </div>
      <SaveStatus saved={update.isSuccess} />
      <h3>{i.example}</h3>
      <p className="help">{i.exampleHelp}</p>
      <CopyableValue label={i.example} value={incidentExample(window.location.origin)} multiline />
    </form>
  );
}
