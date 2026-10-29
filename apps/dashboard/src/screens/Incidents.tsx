import {
  INCIDENT_STATES,
  LEVELS,
  type IncidentState,
  type IncidentSummaryView,
} from '@nudge/shared';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  INCIDENT_FILTERS,
  useIncidentEnvironments,
  useIncidents,
  type IncidentFilterName,
  type IncidentFilters,
} from '../api/incidents.js';
import { useProject } from '../api/projects.js';
import { useI18n, useT } from '../i18n/index.js';
import { EmptyState, ErrorMessage, Loading } from '../layout/ui.js';
import { IncidentStatePill, LevelPill } from './feedback-badges.js';
import { ProjectHeader, ProjectNotFound, INCIDENT_SETTINGS_ANCHOR } from './Project.js';

/** The list's views: a shortcut to the state filter. */
const VIEWS: readonly (IncidentState | null)[] = [null, ...INCIDENT_STATES];

/** A Project's Incidents, newest opened first; the filters live in the URL. */
export function Incidents() {
  const { t } = useI18n();
  const projectId = useParams().id ?? '';
  const project = useProject(projectId);
  const [params, setParams] = useSearchParams();
  const filters: IncidentFilters = Object.fromEntries(
    INCIDENT_FILTERS.flatMap((name) => {
      const value = params.get(name);
      return value ? [[name, value]] : [];
    }),
  );
  const incidents = useIncidents(projectId, filters);
  if (project.isPending) return <Loading />;
  if (project.isError) {
    return <ProjectNotFound error={project.error} onRetry={() => void project.refetch()} />;
  }
  const filter = (name: IncidentFilterName, value: string) => {
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
  const rows = incidents.data?.pages.flatMap((page) => page.incidents) ?? [];
  const filtered = Boolean(filters.level || filters.environment);
  const search = params.toString() ? `?${params.toString()}` : '';
  const base = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <section>
      <ProjectHeader project={project.data} />
      <Views projectId={projectId} state={filters.state} params={params} />
      <Filters projectId={projectId} filters={filters} filter={filter} />
      {incidents.isFetchNextPageError ? null : (
        <ErrorMessage error={incidents.error} onRetry={() => void incidents.refetch()} />
      )}
      <p role="status" className="visually-hidden">
        {incidents.isSuccess ? t.incidents.shown(rows.length, incidents.hasNextPage) : ''}
      </p>
      {incidents.isPending ? (
        <div className="feedback-list">
          <Loading />
        </div>
      ) : null}
      {incidents.isSuccess && rows.length === 0 ? (
        filtered || filters.state ? (
          <EmptyState
            title={t.incidents.noMatch}
            action={
              filtered ? (
                <button type="button" className="secondary" onClick={clearFilters}>
                  {t.incidents.clearFilters}
                </button>
              ) : null
            }
          />
        ) : (
          <EmptyState
            title={t.incidents.emptyTitle}
            action={
              <Link to={`${base}#${INCIDENT_SETTINGS_ANCHOR}`}>{t.incidents.emptyAction}</Link>
            }
          >
            {t.incidents.emptyHelp}
          </EmptyState>
        )
      ) : null}
      {rows.length > 0 ? (
        <div className="feedback-list">
          <ul className="feedback-rows">
            {rows.map((incident) => (
              <IncidentRow
                key={incident.id}
                incident={incident}
                to={`${base}/incidents/${encodeURIComponent(incident.id)}${search}`}
              />
            ))}
          </ul>
        </div>
      ) : null}
      {incidents.hasNextPage ? (
        <button
          type="button"
          className="secondary more"
          disabled={incidents.isFetchingNextPage}
          onClick={() => void incidents.fetchNextPage()}
        >
          {incidents.isFetchingNextPage ? t.common.loading : t.incidents.showMore}
        </button>
      ) : null}
      {incidents.isFetchNextPageError ? (
        <ErrorMessage error={incidents.error} onRetry={() => void incidents.fetchNextPage()} />
      ) : null}
    </section>
  );
}

function Views({
  projectId,
  state,
  params,
}: {
  projectId: string;
  state: string | undefined;
  params: URLSearchParams;
}) {
  const t = useT();
  const to = (target: IncidentState | null) => {
    const next = new URLSearchParams(params);
    if (target) next.set('state', target);
    else next.delete('state');
    const search = next.toString();
    return `/projects/${encodeURIComponent(projectId)}/incidents${search ? `?${search}` : ''}`;
  };
  return (
    <nav className="views" aria-label={t.incidents.views}>
      {VIEWS.map((target) => (
        <Link
          key={target ?? 'all'}
          to={to(target)}
          replace
          aria-current={(state ?? null) === target ? 'page' : undefined}
        >
          {t.incidents.view[target ?? 'all']}
        </Link>
      ))}
    </nav>
  );
}

function Filters({
  projectId,
  filters,
  filter,
}: {
  projectId: string;
  filters: IncidentFilters;
  filter: (name: IncidentFilterName, value: string) => void;
}) {
  const t = useT();
  const known = useIncidentEnvironments(projectId).data ?? [];
  // An Environment read from the URL stays selectable, even before (or without) any Incident in it.
  const environments =
    filters.environment && !known.includes(filters.environment)
      ? [...known, filters.environment]
      : known;
  const selects: readonly {
    name: Exclude<IncidentFilterName, 'state'>;
    all: string;
    options: readonly { value: string; label: string }[];
  }[] = [
    {
      name: 'level',
      all: t.incidents.anyLevel,
      options: LEVELS.map((value) => ({ value, label: t.labels.level[value] })),
    },
    {
      name: 'environment',
      all: t.incidents.anyEnvironment,
      options: environments.map((value) => ({ value, label: value })),
    },
  ];
  return (
    <div className="filters" role="group" aria-label={t.incidents.filters}>
      {selects.map(({ name, all, options }) => (
        <div key={name} className="filter" data-active={Boolean(filters[name])}>
          <label htmlFor={`incident-filter-${name}`}>{t.incidents.filter[name]}</label>
          <select
            id={`incident-filter-${name}`}
            value={filters[name] ?? ''}
            onChange={(e) => filter(name, e.target.value)}
          >
            <option value="">{all}</option>
            {options.map(({ value, label }) => (
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

function IncidentRow({ incident, to }: { incident: IncidentSummaryView; to: string }) {
  const { t, format } = useI18n();
  return (
    <li className="incident-row linked-row" data-state={incident.state}>
      <LevelPill level={incident.level} />
      <p className="summary">
        <Link to={to} className="row-link" title={incident.title}>
          {incident.title}
        </Link>
      </p>
      <span className={incident.environment ? 'environment' : 'environment muted'}>
        {incident.environment ?? t.incidents.noEnvironment}
      </span>
      <span className="occurrences">{t.incidents.occurrences(incident.occurrences)}</span>
      <span className="states">
        <IncidentStatePill state={incident.state} />
      </span>
      <time
        dateTime={incident.lastSeenAt}
        title={`${t.incidents.lastSeen}: ${format.date(incident.lastSeenAt)}`}
      >
        {format.dateRelative(incident.lastSeenAt)}
      </time>
    </li>
  );
}
