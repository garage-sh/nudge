import { Link } from 'react-router';
import { useAlerts } from '../api/alerts.js';
import { useT } from '../i18n/index.js';

/**
 * Badges of what awaits a Member: the Feedback In review and each Suspended
 * Destination, with a link to act. Nothing when nothing awaits, nor when the read
 * fails (screens report their own errors).
 */
export function Alerts() {
  const t = useT();
  const { data } = useAlerts();
  if (!data || (data.feedbacksInReview === 0 && data.suspendedDestinations.length === 0)) {
    return null;
  }
  const { feedbacksInReview, suspendedDestinations } = data;
  return (
    <section className="sidebar-alerts" aria-label={t.alerts.region}>
      {feedbacksInReview > 0 ? (
        <Link className="alert-review" to="/feedbacks?state=in_review">
          {t.alerts.inReview(feedbacksInReview)}
        </Link>
      ) : null}
      {suspendedDestinations.map(({ id, name, project }) => (
        <Link
          key={id}
          className="alert-suspended"
          to={`/projects/${encodeURIComponent(project.id)}/destinations`}
        >
          {t.alerts.suspended(name, project.name)}
        </Link>
      ))}
    </section>
  );
}
