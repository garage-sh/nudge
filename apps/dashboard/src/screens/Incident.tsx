import type { IncidentReport } from '@nudge/shared';
import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client.js';
import {
  useCloseIncident,
  useDeleteIncident,
  useIncident,
  useRedispatchIncident,
  useReplayIncidentDelivery,
} from '../api/incidents.js';
import { useI18n, useT } from '../i18n/index.js';
import {
  ConfirmAction,
  DetailSection,
  ErrorMessage,
  Loading,
  PageHeader,
  Properties,
} from '../layout/ui.js';
import { DeliveryList } from './DeliveryList.js';
import { HeldPill, IncidentStatePill, LevelPill } from './feedback-badges.js';

/** How long the detail is read often after an action, while the worker sends the Deliveries. */
const POLL_AFTER_ACTION_MS = 15_000;

/**
 * An Incident's detail: what it reported, and where it was sent. Everything its sender
 * reported (title, message, context) is rendered as text: never HTML, never a link.
 */
export function Incident() {
  const t = useT();
  const params = useParams();
  const projectId = params.id ?? '';
  const id = params.incidentId ?? '';
  const { search } = useLocation();
  const [pollUntil, setPollUntil] = useState(0);
  const poll = () => setPollUntil(Date.now() + POLL_AFTER_ACTION_MS);
  const incident = useIncident(id, { pollUntil });
  const replay = useReplayIncidentDelivery(id);
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
            {detail.held ? <HeldPill /> : null}
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
          <Section id="deliveries" title={t.incident.deliveries}>
            {detail.held ? (
              <p className="help">
                {detail.state === 'open' ? t.incident.heldHelp : t.incident.heldClosedHelp}
              </p>
            ) : null}
            <DeliveryList
              subject="incident"
              deliveries={detail.deliveries}
              replay={replay}
              afterReplay={poll}
            />
            {detail.state === 'open' ? (
              <Redispatch incidentId={detail.id} afterRedispatch={poll} />
            ) : null}
          </Section>
        </div>
        <aside className="feedback-side">
          <Section id="properties" title={t.incident.properties}>
            <Properties
              rows={[
                [
                  t.incident.state,
                  <span key="state" className="meta">
                    <IncidentStatePill state={detail.state} />
                    {detail.held ? <HeldPill /> : null}
                  </span>,
                ],
                [t.incident.level, <LevelPill key="level" level={detail.level} />],
                [t.incident.levelOrigin, t.labels.levelOrigin[detail.levelOrigin]],
                [t.incident.environment, detail.environment ?? t.incidents.noEnvironment],
                [t.incident.occurrences, <span className="number">{detail.occurrences}</span>],
                [t.incident.firstSeen, <Instant key="first" iso={detail.firstSeenAt} />],
                [t.incident.lastSeen, <Instant key="last" iso={detail.lastSeenAt} />],
                ...(detail.closeCause && detail.closedAt
                  ? [
                      [
                        t.incident.closed,
                        <span key="closed" className="closure">
                          {t.labels.closeCause[detail.closeCause]}
                          <Instant iso={detail.closedAt} />
                        </span>,
                      ] as const,
                    ]
                  : []),
                [t.incident.fingerprint, <code key="fingerprint">{detail.fingerprint}</code>],
              ]}
            />
            {detail.state === 'open' ? <Close incidentId={detail.id} afterClose={poll} /> : null}
          </Section>
          <Section id="deletion" title={t.incident.deletion.title}>
            <Deletion incidentId={detail.id} leaveTo={back.to} />
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

/**
 * Close the Open Incident by hand, once the Member knows the problem is over: its
 * Destinations receive the closing, as when its sender resolves it.
 */
function Close({ incidentId, afterClose }: { incidentId: string; afterClose: () => void }) {
  const t = useT();
  const close = useCloseIncident(incidentId);
  return (
    <>
      <p className="help">{t.incident.close.help}</p>
      <div className="actions">
        <ConfirmAction
          label={t.incident.close.action}
          question={t.incident.close.question}
          pending={close.isPending}
          onConfirm={() => close.mutate(undefined, { onSuccess: afterClose })}
        />
      </div>
      <ErrorMessage error={close.error} />
    </>
  );
}

/**
 * Erase the Incident, for example when personal data leaked into a report; the Member
 * goes back to the list. Objects already created in the Destinations remain.
 */
function Deletion({ incidentId, leaveTo }: { incidentId: string; leaveTo: string }) {
  const t = useT();
  const navigate = useNavigate();
  const deletion = useDeleteIncident(incidentId, () => void navigate(leaveTo));
  return (
    <>
      <p className="help">{t.incident.deletion.help}</p>
      <div className="actions">
        <ConfirmAction
          label={t.common.delete}
          question={t.incident.deletion.question}
          pending={deletion.isPending}
          onConfirm={() => deletion.mutate()}
        />
      </div>
      <ErrorMessage error={deletion.error} />
    </>
  );
}

/**
 * Redispatch the Open Incident at its current Level, after a Filter change or the addition
 * of a Destination: creates the missing Deliveries. Existing Deliveries are not touched.
 */
function Redispatch({
  incidentId,
  afterRedispatch,
}: {
  incidentId: string;
  afterRedispatch: () => void;
}) {
  const t = useT();
  const redispatch = useRedispatchIncident(incidentId);
  const created = redispatch.data?.deliveriesCreated;
  return (
    <>
      <p className="help">{t.incident.redispatch.help}</p>
      <div className="actions">
        <button
          type="button"
          className="secondary"
          disabled={redispatch.isPending}
          onClick={() => redispatch.mutate(undefined, { onSuccess: afterRedispatch })}
        >
          {t.incident.redispatch.action}
        </button>
      </div>
      {created === undefined ? null : (
        <p role="status">
          {created === 0
            ? t.incident.redispatch.noneCreated
            : t.incident.redispatch.created(created)}
        </p>
      )}
      <ErrorMessage error={redispatch.error} />
    </>
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
