import type { IncidentReport } from '@nudge/shared';
import type { ReactNode } from 'react';
import { useLocation, useParams } from 'react-router';
import { ApiError } from '../api/client.js';
import { useIncident } from '../api/incidents.js';
import { useI18n, useT } from '../i18n/index.js';
import { DetailSection, ErrorMessage, Loading, PageHeader, Properties } from '../layout/ui.js';
import { IncidentStatePill, LevelPill } from './feedback-badges.js';

/**
 * An Incident's detail, read-only. Everything its sender reported (title, message,
 * context) is rendered as text: never HTML, never a link.
 */
export function Incident() {
  const t = useT();
  const params = useParams();
  const projectId = params.id ?? '';
  const id = params.incidentId ?? '';
  const { search } = useLocation();
  const incident = useIncident(id);
  const back = {
    to: `/projects/${encodeURIComponent(projectId)}/incidents${search}`,
    label: t.incident.backToList,
  };
  if (incident.isPending) return <Loading />;
  // An Incident of another Project does not exist under this one's URL.
  const elsewhere = incident.isSuccess && incident.data.project.id !== projectId;
  if (incident.isError || elsewhere) {
    return (
      <section>
        <PageHeader title={t.incident.properties} back={back} />
        {elsewhere ? (
          <ErrorMessage error={new ApiError(404, { error: 'incident_not_found' })} />
        ) : (
          <ErrorMessage error={incident.error} onRetry={() => void incident.refetch()} />
        )}
      </section>
    );
  }
  const detail = incident.data;
  const single = detail.occurrences === 1;
  return (
    <article className="feedback incident">
      <PageHeader
        title={detail.title}
        back={back}
        description={
          // What matters during an outage, before anything else, at every width.
          <span className="meta">
            <LevelPill level={detail.level} />
            <IncidentStatePill state={detail.state} />
            <span>{detail.environment ?? t.incidents.noEnvironment}</span>
            <span>{t.incidents.occurrences(detail.occurrences)}</span>
          </span>
        }
      />
      <div className="feedback-grid">
        <div className="feedback-main">
          <Report
            id="first"
            title={single ? t.incident.onlyReport : t.incident.firstReport}
            report={detail.firstReport}
          />
          {single ? null : (
            <Report id="last" title={t.incident.lastReport} report={detail.lastReport} />
          )}
        </div>
        <aside className="feedback-side">
          <Section id="properties" title={t.incident.properties}>
            <Properties
              rows={[
                [t.incident.state, <IncidentStatePill key="state" state={detail.state} />],
                [t.incident.level, <LevelPill key="level" level={detail.level} />],
                [t.incident.levelOrigin, t.labels.levelOrigin[detail.levelOrigin]],
                [t.incident.environment, detail.environment ?? t.incidents.noEnvironment],
                [t.incident.occurrences, <span className="number">{detail.occurrences}</span>],
                [t.incident.firstSeen, <Instant key="first" iso={detail.firstSeenAt} />],
                [t.incident.lastSeen, <Instant key="last" iso={detail.lastSeenAt} />],
                [t.incident.fingerprint, <code key="fingerprint">{detail.fingerprint}</code>],
              ]}
            />
          </Section>
        </aside>
      </div>
    </article>
  );
}

function Report({ id, title, report }: { id: string; title: string; report: IncidentReport }) {
  const t = useT();
  const context = Object.entries(report.context);
  return (
    <Section id={id} title={title}>
      <Properties
        rows={[
          [t.incident.title, <span className="report-text">{report.title}</span>],
          [
            t.incident.message,
            report.message ? (
              <span className="report-text">{report.message}</span>
            ) : (
              <span className="muted">{t.incident.noMessage}</span>
            ),
          ],
          [
            t.incident.declaredLevel,
            report.level ? <LevelPill level={report.level} /> : t.incident.notDeclared,
          ],
          [t.incident.environment, report.environment ?? t.incidents.noEnvironment],
          [t.incident.receivedAt, <Instant key="received" iso={report.receivedAt} />],
        ]}
      />
      <h3>{t.incident.context}</h3>
      {context.length === 0 ? (
        <p className="muted">{t.incident.noContext}</p>
      ) : (
        <Properties rows={context.map(([key, value]) => [key, String(value)])} />
      )}
    </Section>
  );
}

function Instant({ iso }: { iso: string }) {
  const { format } = useI18n();
  return (
    <time dateTime={iso} title={format.date(iso)}>
      {format.longDateTime(iso)}
    </time>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <DetailSection headingId={`incident-${id}`} title={title}>
      {children}
    </DetailSection>
  );
}
