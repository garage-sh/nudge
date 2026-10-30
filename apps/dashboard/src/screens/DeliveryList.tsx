import { isDeliveryReplayable, type DeliverySubjectKind, type DeliveryView } from '@nudge/shared';
import type { UseMutationResult } from '@tanstack/react-query';
import { useT } from '../i18n/index.js';
import { ErrorMessage, ExternalLink } from '../layout/ui.js';
import { DeliveryStatusPill, DestinationStatePill } from './feedback-badges.js';

/**
 * The Deliveries of a Feedback or an Incident (`subject`), with their status and the link
 * to the object created. A failed Delivery can be replayed (`replay`, which takes the
 * Delivery's id) to recover the failure; a delivered Feedback Delivery too, to pass on a
 * correction. A delivered Incident Delivery cannot: it would create its object again.
 */
export function DeliveryList({
  subject,
  deliveries,
  replay,
  afterReplay,
}: {
  subject: DeliverySubjectKind;
  deliveries: readonly DeliveryView[];
  replay: UseMutationResult<DeliveryView, Error, string>;
  afterReplay: () => void;
}) {
  const t = useT();
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
            {isDeliveryReplayable(subject, delivery.status) ? (
              <button
                type="button"
                className="secondary"
                aria-label={t.feedback.deliveries.replayLabel(delivery.destination.name)}
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
