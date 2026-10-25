import {
  allowedReviewActions,
  isDeliveryReplayable,
  isFeedbackRedispatchable,
  SEVERITIES,
  FEEDBACK_TYPES,
  captureUrl,
  type ReviewAction,
  type AuthorView,
  type CaptureView,
  type Context,
  type DeliveryView,
  type Severity,
  type FeedbackDetailView,
  type FeedbackType,
  type VerdictView,
} from '@nudge/shared';
import { useContext, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import {
  useCorrectVerdict,
  useDeleteFeedback,
  useFeedback,
  useRedispatch,
  useReplay,
  useReview,
} from '../api/feedbacks.js';
import { useI18n, useT } from '../i18n/index.js';
import {
  ConfirmAction,
  ErrorMessage,
  ExternalLink,
  Loading,
  Pill,
  useReturnFocus,
} from '../layout/ui.js';
import {
  DeliveryStatusPill,
  DestinationStatePill,
  SeverityGauge,
  StatePill,
  UncertainBadge,
} from './feedback-badges.js';
import { FeedbackPane, type ListState } from './Feedbacks.js';

/**
 * A Feedback's detail. Everything the Author provided (text, identity, context) is
 * rendered as text: never HTML, never a link outside http(s).
 * Each part (review, Verdict, Capture, Deliveries, deletion…) is a section.
 */
export function Feedback() {
  const { t, format } = useI18n();
  const id = useParams().id ?? '';
  // After an action, the Feedback is read again while the worker follows it up.
  const [pollUntil, setPollUntil] = useState(0);
  const poll = () => setPollUntil(Date.now() + POLL_AFTER_ACTION_MS);
  const feedback = useFeedback(id, { pollUntil });
  const location = useLocation();
  const list = (location.state as ListState | null)?.list;
  const pane = useContext(FeedbackPane);
  const toList = pane?.close ?? `/feedbacks${location.search}`;
  if (feedback.isPending) return <Loading />;
  if (feedback.isError) {
    return (
      <>
        <Trail toList={toList} inPane={Boolean(pane)} />
        <ErrorMessage error={feedback.error} onRetry={() => void feedback.refetch()} />
      </>
    );
  }
  const detail = feedback.data;
  const { verdict } = detail;
  const s = t.feedback.sections;
  return (
    <article className="feedback">
      <Trail toList={toList} id={detail.id} list={list} inPane={Boolean(pane)} />
      <Title level={pane ? 2 : 1} className="visually-hidden">
        {t.feedback.heading(detail.text.length > 80 ? `${detail.text.slice(0, 80)}…` : detail.text)}
      </Title>
      <div className="feedback-grid">
        <div className="feedback-main">
          <header className="feedback-title">
            <SeverityGauge severity={verdict?.severity} large />
            <div>
              <p className="feedback-text" aria-label={t.feedback.text}>
                {detail.text}
              </p>
              <p className="meta">
                <StatePill state={detail.state} />
                <Link to={`/projects/${detail.project.id}`}>{detail.project.name}</Link>
                <span>{t.labels.source[detail.source]}</span>
                <time dateTime={detail.createdAt} title={format.date(detail.createdAt)}>
                  {format.dateRelative(detail.createdAt)}
                </time>
                {detail.declaredType ? (
                  <span>{t.feedback.declaredType(t.labels.feedbackType[detail.declaredType])}</span>
                ) : null}
              </p>
            </div>
          </header>
          {allowedReviewActions(detail.state, detail.verdict).length > 0 ? (
            <section className="review-banner" aria-labelledby="feedback-review">
              <h2 id="feedback-review">{s.review}</h2>
              <Review feedback={detail} afterAction={poll} />
            </section>
          ) : null}
          {detail.capture ? (
            <Section id="capture" title={s.capture}>
              <Capture feedbackId={detail.id} capture={detail.capture} />
            </Section>
          ) : null}
          <Section id="deliveries" title={s.deliveries}>
            <Deliveries feedbackId={detail.id} deliveries={detail.deliveries} afterReplay={poll} />
            {isFeedbackRedispatchable(detail.state) ? (
              <Redispatch feedbackId={detail.id} afterRedispatch={poll} />
            ) : null}
          </Section>
        </div>
        <aside className="feedback-side" aria-label={t.feedback.properties}>
          <Section id="verdict" title={s.verdict}>
            <Verdict feedbackId={detail.id} verdict={detail.verdict} />
          </Section>
          <Section id="author" title={s.author}>
            <Author author={detail.author} />
          </Section>
          <Section id="context" title={s.context}>
            <FeedbackContext context={detail.context} />
          </Section>
          <Section id="deletion" title={s.deletion}>
            <Deletion feedback={detail} />
          </Section>
        </aside>
      </div>
    </article>
  );
}

/**
 * The trail above the Feedback: back to the list it was opened from (filters
 * included), and the previous / next Feedback in that list.
 */
function Trail({
  toList,
  id,
  list,
  inPane,
}: {
  toList: string;
  id?: string;
  list?: ListState['list'];
  inPane: boolean;
}) {
  const t = useT();
  const { search } = useLocation();
  const position = id && list ? list.ids.indexOf(id) : -1;
  const previous = position > 0 ? list?.ids[position - 1] : undefined;
  const next = position >= 0 ? list?.ids[position + 1] : undefined;
  const state: ListState = { list };
  return (
    <nav className="trail" aria-label={t.feedback.trail}>
      <Link to={toList} className="back-link">
        {inPane ? t.common.close : t.feedback.backToInbox}
      </Link>
      {position >= 0 && list ? (
        <span className="prev-next">
          <span className="muted">{t.feedback.position(position + 1, list.ids.length)}</span>
          {previous ? (
            <Link to={`/feedbacks/${previous}${search}`} state={state}>
              {t.feedback.previous}
            </Link>
          ) : (
            <span aria-disabled="true">{t.feedback.previous}</span>
          )}
          {next ? (
            <Link to={`/feedbacks/${next}${search}`} state={state}>
              {t.feedback.next}
            </Link>
          ) : (
            <span aria-disabled="true">{t.feedback.next}</span>
          )}
        </span>
      ) : null}
    </nav>
  );
}

/** The Feedback's title: `h1` as a full page, `h2` in the pane (the Inbox has its `h1`). */
function Title({
  level,
  className,
  children,
}: {
  level: 1 | 2;
  className: string;
  children: ReactNode;
}) {
  return level === 1 ? (
    <h1 className={className}>{children}</h1>
  ) : (
    <h2 className={className}>{children}</h2>
  );
}

/** How long the Feedback is read again after a Member's action. */
const POLL_AFTER_ACTION_MS = 15_000;

function Review({
  feedback,
  afterAction,
}: {
  feedback: FeedbackDetailView;
  afterAction: () => void;
}) {
  const t = useT();
  const review = useReview(feedback.id);
  const act = (action: ReviewAction) => review.mutate(action, { onSuccess: afterAction });
  // The api is authoritative, and refuses the other actions.
  const actions = allowedReviewActions(feedback.state, feedback.verdict);
  return (
    <>
      <p>{feedback.state === 'in_review' ? t.feedback.review.inReview : t.feedback.review.junk}</p>
      <div className="actions">
        {actions.includes('approve') ? (
          <button type="button" disabled={review.isPending} onClick={() => act('approve')}>
            {t.feedback.review.approve}
          </button>
        ) : null}
        {actions.includes('reject') ? (
          <ConfirmAction
            label={t.feedback.review.reject}
            question={t.feedback.review.rejectQuestion}
            pending={review.isPending}
            onConfirm={() => act('reject')}
          />
        ) : null}
        {actions.includes('reinstate') ? (
          <button type="button" disabled={review.isPending} onClick={() => act('reinstate')}>
            {t.feedback.review.reinstate}
          </button>
        ) : null}
      </div>
      <ErrorMessage error={review.error} />
    </>
  );
}

/**
 * Erase the Feedback, to answer an erasure request: its Capture is erased from
 * storage with it. Objects already created in the Destinations remain.
 */
function Deletion({ feedback }: { feedback: FeedbackDetailView }) {
  const t = useT();
  const navigate = useNavigate();
  const pane = useContext(FeedbackPane);
  const { search } = useLocation();
  const deletion = useDeleteFeedback(
    feedback.id,
    () => void navigate(pane?.close ?? `/feedbacks${search}`),
  );
  return (
    <>
      <p className="help">{t.feedback.deletion.help(Boolean(feedback.capture))}</p>
      <div className="actions">
        <ConfirmAction
          label={t.common.delete}
          question={t.feedback.deletion.question}
          pending={deletion.isPending}
          onConfirm={() => deletion.mutate()}
        />
      </div>
      <ErrorMessage error={deletion.error} />
    </>
  );
}

/**
 * The Capture attached by the Author, already masked and blurred in their browser.
 * The image is served by the api with the Member's session.
 */
function Capture({ feedbackId, capture }: { feedbackId: string; capture: CaptureView }) {
  const { t, format } = useI18n();
  const url = captureUrl(feedbackId);
  return (
    <figure className="capture">
      <a href={url} target="_blank" rel="noopener noreferrer">
        <img src={url} alt={t.feedback.capture.alt} loading="lazy" />
      </a>
      <figcaption className="muted">
        {CAPTURE_FORMATS[capture.contentType]} · {format.bytes(capture.bytes)} ·{' '}
        <a href={url} target="_blank" rel="noopener noreferrer">
          {t.feedback.capture.open}
        </a>
      </figcaption>
    </figure>
  );
}

const CAPTURE_FORMATS: Record<CaptureView['contentType'], string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
};

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="panel" aria-labelledby={`feedback-${id}`}>
      <h2 id={`feedback-${id}`}>{title}</h2>
      {children}
    </section>
  );
}

/** A list of label / value pairs, values rendered as text. */
function Properties({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="properties">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Verdict({ feedbackId, verdict }: { feedbackId: string; verdict: VerdictView | null }) {
  const t = useT();
  const [correcting, setCorrecting] = useState(false);
  // Once the form is closed, focus returns to "Correct".
  const correct = useReturnFocus(correcting);
  if (!verdict) return <p className="muted">{t.feedback.verdict.notTriaged}</p>;
  if (correcting) {
    return (
      <CorrectionForm
        feedbackId={feedbackId}
        verdict={verdict}
        close={() => setCorrecting(false)}
      />
    );
  }
  return (
    <>
      <Properties
        rows={[
          [t.feedback.verdict.resolvedType, t.labels.feedbackType[verdict.resolvedType]],
          [
            t.feedback.verdict.severity,
            verdict.severity ? (
              <SeverityGauge severity={verdict.severity} visible />
            ) : (
              t.feedback.verdict.notAssessed
            ),
          ],
        ]}
      />
      {verdict.uncertain || verdict.junk || verdict.manipulation ? (
        <p className="meta">
          {verdict.uncertain ? <UncertainBadge /> : null}
          {verdict.junk ? <Pill tone="off">{t.feedback.verdict.junk}</Pill> : null}
          {verdict.manipulation ? (
            <Pill tone="review">{t.feedback.verdict.manipulation}</Pill>
          ) : null}
        </p>
      ) : null}
      <div className="actions">
        <button
          ref={correct}
          type="button"
          className="secondary"
          onClick={() => setCorrecting(true)}
        >
          {t.feedback.verdict.correct}
        </button>
      </div>
    </>
  );
}

/**
 * The Member corrects the resolved type and the Severity. Destinations already served
 * do not see the correction: replaying a Delivery passes it on to them.
 */
function CorrectionForm({
  feedbackId,
  verdict,
  close,
}: {
  feedbackId: string;
  verdict: VerdictView;
  close: () => void;
}) {
  const t = useT();
  const correction = useCorrectVerdict(feedbackId);
  const [resolvedType, setResolvedType] = useState<FeedbackType>(verdict.resolvedType);
  const [severity, setSeverity] = useState<Severity | ''>(verdict.severity ?? '');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    correction.mutate(
      { resolvedType, ...(severity ? { severity } : {}) },
      { onSuccess: () => close() },
    );
  };
  return (
    <form onSubmit={submit} className="form">
      <p className="help">{t.feedback.verdict.correctionHelp}</p>
      <div className="field">
        <label htmlFor="correction-type">{t.feedback.verdict.resolvedType}</label>
        <select
          id="correction-type"
          value={resolvedType}
          onChange={(e) => setResolvedType(e.target.value as FeedbackType)}
        >
          {FEEDBACK_TYPES.map((value) => (
            <option key={value} value={value}>
              {t.labels.feedbackType[value]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="correction-severity">{t.feedback.verdict.severity}</label>
        <select
          id="correction-severity"
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Severity | '')}
        >
          {/* A Severity not assessed (degraded mode) can be set, but not cleared. */}
          {verdict.severity ? null : <option value="">{t.feedback.verdict.notAssessed}</option>}
          {SEVERITIES.map((value) => (
            <option key={value} value={value}>
              {t.labels.severity[value]}
            </option>
          ))}
        </select>
      </div>
      <ErrorMessage error={correction.error} />
      <div className="actions">
        <button type="submit" disabled={correction.isPending}>
          {t.common.save}
        </button>
        <button type="button" className="secondary" onClick={close}>
          {t.common.cancel}
        </button>
      </div>
    </form>
  );
}

function Author({ author }: { author: AuthorView | null }) {
  const t = useT();
  if (!author) return <p className="muted">{t.feedback.author.anonymous}</p>;
  const rows: [string, ReactNode][] = [];
  if (author.name) rows.push([t.feedback.author.name, author.name]);
  if (author.email) rows.push([t.feedback.author.email, author.email]);
  if (author.id) rows.push([t.feedback.author.id, author.id]);
  rows.push([t.feedback.author.trust, t.labels.authorTrust[author.trust]]);
  return <Properties rows={rows} />;
}

function FeedbackContext({ context }: { context: Context }) {
  const t = useT();
  const rows: [string, ReactNode][] = [];
  if (context.url)
    rows.push([t.feedback.context.page, <ExternalLink key="url" href={context.url} />]);
  if (context.userAgent) rows.push([t.feedback.context.browser, context.userAgent]);
  if (context.viewport) {
    rows.push([
      t.feedback.context.screen,
      `${context.viewport.width} × ${context.viewport.height}`,
    ]);
  }
  const metadata = Object.entries(context.metadata ?? {});
  if (rows.length === 0 && metadata.length === 0) {
    return <p className="muted">{t.feedback.context.none}</p>;
  }
  return (
    <>
      {rows.length > 0 ? <Properties rows={rows} /> : null}
      {metadata.length > 0 ? (
        <>
          <h3>{t.feedback.context.metadata}</h3>
          <Properties rows={metadata.map(([key, value]) => [key, String(value)])} />
        </>
      ) : null}
    </>
  );
}

/**
 * The Deliveries, with their status and the link to the object created. A delivered or
 * failed Delivery can be replayed, with the current Verdict: to recover a failure or
 * pass on a correction.
 */
function Deliveries({
  feedbackId,
  deliveries,
  afterReplay,
}: {
  feedbackId: string;
  deliveries: readonly DeliveryView[];
  afterReplay: () => void;
}) {
  const t = useT();
  const replay = useReplay(feedbackId);
  if (deliveries.length === 0) {
    return <p className="muted">{t.feedback.deliveries.none}</p>;
  }
  return (
    <ul className="list deliveries">
      {deliveries.map((delivery) => (
        <li key={delivery.id}>
          <div className="delivery">
            <div className="delivery-destination">
              <strong>{delivery.destination.name}</strong>
              <span className="muted">
                {delivery.destination.type}
                {delivery.destination.state !== 'active' ? (
                  <>
                    {' '}
                    <DestinationStatePill state={delivery.destination.state} />
                  </>
                ) : null}
              </span>
            </div>
            <DeliveryStatusPill status={delivery.status} />
            <span className="muted delivery-attempts">
              {t.feedback.deliveries.attempts(delivery.attempts)}
            </span>
            {isDeliveryReplayable(delivery.status) ? (
              <button
                type="button"
                className="secondary"
                disabled={replay.isPending}
                onClick={() => replay.mutate(delivery.id, { onSuccess: afterReplay })}
              >
                {t.feedback.deliveries.replay}
              </button>
            ) : (
              <span />
            )}
          </div>
          {delivery.externalUrl ? (
            <p className="delivery-link">
              <ExternalLink href={delivery.externalUrl} />
            </p>
          ) : null}
          {delivery.lastError ? (
            <p className="alert">{t.feedback.deliveries.lastError(delivery.lastError)}</p>
          ) : null}
          {replay.variables === delivery.id ? <ErrorMessage error={replay.error} /> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Redispatch the Feedback according to its current Verdict, after a correction or the
 * addition of a Destination: creates the missing Deliveries to the Destinations whose
 * Filter now accepts it. Existing Deliveries are not touched.
 */
function Redispatch({
  feedbackId,
  afterRedispatch,
}: {
  feedbackId: string;
  afterRedispatch: () => void;
}) {
  const t = useT();
  const redispatch = useRedispatch(feedbackId);
  const created = redispatch.data?.deliveriesCreated;
  return (
    <>
      <p className="help">{t.feedback.redispatch.help}</p>
      <div className="actions">
        <button
          type="button"
          className="secondary"
          disabled={redispatch.isPending}
          onClick={() => redispatch.mutate(undefined, { onSuccess: afterRedispatch })}
        >
          {t.feedback.redispatch.action}
        </button>
      </div>
      {created === undefined ? null : (
        <p role="status">
          {created === 0
            ? t.feedback.redispatch.noneCreated
            : t.feedback.redispatch.created(created)}
        </p>
      )}
      <ErrorMessage error={redispatch.error} />
    </>
  );
}
