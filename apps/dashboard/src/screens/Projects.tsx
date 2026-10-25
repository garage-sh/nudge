import type { ProjectActivityView } from '@nudge/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCreateProject, useProjects, useProjectsActivity } from '../api/projects.js';
import { useT } from '../i18n/index.js';
import { EmptyState, ErrorMessage, Field, Loading, PageHeader, Pill } from '../layout/ui.js';
import type { SecretKeyState } from './Project.js';

export function Projects() {
  const t = useT();
  const projects = useProjects();
  const activity = useProjectsActivity();
  const [adding, setAdding] = useState(false);
  const none = projects.data?.length === 0;
  // Without a Project, creating one is the only thing to do: the form is open.
  const formOpen = adding || none;
  return (
    <section>
      <PageHeader
        title={t.projects.title}
        description={t.projects.description}
        actions={
          formOpen || !projects.data ? null : (
            <button type="button" onClick={() => setAdding(true)}>
              {t.projects.new}
            </button>
          )
        }
      />
      {projects.isPending ? <Loading /> : null}
      <ErrorMessage error={projects.error} onRetry={() => void projects.refetch()} />
      {formOpen ? <NewProject onCancel={none ? undefined : () => setAdding(false)} /> : null}
      {none ? <EmptyState title={t.projects.emptyTitle}>{t.projects.emptyHelp}</EmptyState> : null}
      {projects.data && projects.data.length > 0 ? (
        <ul className="list projects" aria-label={t.projects.list}>
          {projects.data.map((project) => (
            <li key={project.id}>
              <div>
                <Link to={`/projects/${project.id}/destinations`} className="project-link">
                  {project.name}
                </Link>
                {project.description ? <p className="muted">{project.description}</p> : null}
              </div>
              <Activity activity={activity.data?.get(project.id)} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** What is happening in a Project; nothing until the activity is read. */
function Activity({ activity }: { activity: ProjectActivityView | undefined }) {
  const t = useT();
  if (!activity) return null;
  const { feedbacksThisWeek, feedbacksInReview, destinations, suspendedDestinations } = activity;
  return (
    <p className="project-activity">
      <span>{t.projects.thisWeek(feedbacksThisWeek)}</span>
      {feedbacksInReview > 0 ? (
        <Pill tone="review">{t.projects.inReview(feedbacksInReview)}</Pill>
      ) : null}
      {destinations === 0 ? (
        <Pill tone="held">{t.projects.noDestination}</Pill>
      ) : suspendedDestinations > 0 ? (
        <Pill tone="held">
          {t.projects.destinationsSuspended(destinations, suspendedDestinations)}
        </Pill>
      ) : (
        <span>{t.projects.destinations(destinations)}</span>
      )}
    </p>
  );
}

function NewProject({ onCancel }: { onCancel?: () => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const creation = useCreateProject();
  const navigate = useNavigate();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    creation.mutate(
      { name },
      {
        // The secret key is read only once: it travels in the navigation state, never in the URL.
        onSuccess: ({ project, secretKey }) => {
          const state: SecretKeyState = { secretKey };
          void navigate(`/projects/${project.id}`, { state });
        },
      },
    );
  };
  return (
    <form onSubmit={submit} className="form panel">
      <h2>{t.projects.new}</h2>
      <Field
        label={t.projects.name}
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <ErrorMessage error={creation.error} />
      <div className="actions">
        <button type="submit" disabled={creation.isPending}>
          {t.projects.create}
        </button>
        {onCancel ? (
          <button type="button" className="ghost" onClick={onCancel}>
            {t.common.cancel}
          </button>
        ) : null}
      </div>
    </form>
  );
}
