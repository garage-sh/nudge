import type { ProjectView } from '@nudge/shared';
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
 * Destinations (where its Feedback goes) and Settings (keys, details, origins).
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
          {t.common.save}
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
          {t.common.save}
        </button>
      </div>
      <SaveStatus saved={update.isSuccess} />
    </form>
  );
}
