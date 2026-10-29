import {
  SEVERITIES,
  type DestinationState,
  type FeedbackState,
  type IncidentState,
  type Level,
  type Severity,
  type DeliveryStatus,
} from '@nudge/shared';
import { useT } from '../i18n/index.js';
import { Pill, type Tone } from '../layout/ui.js';

/** Marks a Verdict the Judge hesitated on: a Member should check it. */
export function UncertainBadge() {
  const t = useT();
  return (
    <Pill tone="review" title={t.badges.uncertainTitle}>
      {t.badges.uncertain}
    </Pill>
  );
}

/**
 * Severity as a four-bar gauge: as many filled bars as the level, dotted when the
 * Feedback has no Severity. Readable without color; the level is also written for
 * screen readers (`visible` shows it beside the gauge).
 */
export function SeverityGauge({
  severity,
  large = false,
  visible = false,
  label: visibleLabel,
}: {
  severity: Severity | null | undefined;
  large?: boolean;
  visible?: boolean;
  /** The text shown beside the gauge, instead of the Severity's name. */
  label?: string;
}) {
  const t = useT();
  const level = severity ? SEVERITIES.indexOf(severity) + 1 : 0;
  const label = visibleLabel ?? (severity ? t.labels.severity[severity] : t.badges.noSeverity);
  return (
    <span className="gauge-holder">
      <span className={large ? 'gauge large' : 'gauge'} data-level={level} aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      {visible || visibleLabel ? (
        <span>{label}</span>
      ) : (
        <span className="visually-hidden">{severity ? t.badges.severity(label) : label}</span>
      )}
    </span>
  );
}

const STATE_TONES: Record<FeedbackState, Tone> = {
  received: 'neutral',
  triaged: 'neutral',
  dispatched: 'success',
  in_review: 'review',
  discarded: 'off',
};

export function StatePill({ state }: { state: FeedbackState }) {
  const t = useT();
  return <Pill tone={STATE_TONES[state]}>{t.labels.feedbackState[state]}</Pill>;
}

const DELIVERY_STATUS_TONES: Record<DeliveryStatus, Tone> = {
  pending: 'neutral',
  delivered: 'success',
  failed: 'danger',
  held: 'held',
};

export function DeliveryStatusPill({ status }: { status: DeliveryStatus }) {
  const t = useT();
  return <Pill tone={DELIVERY_STATUS_TONES[status]}>{t.labels.deliveryStatus[status]}</Pill>;
}

export function DestinationStatePill({ state }: { state: DestinationState }) {
  const t = useT();
  return (
    <Pill tone={state === 'active' ? 'success' : 'held'}>{t.labels.destinationState[state]}</Pill>
  );
}

const LEVEL_TONES: Record<Level, Tone> = {
  info: 'neutral',
  warning: 'held',
  error: 'danger',
  critical: 'danger',
};

/** An Incident's Level. Critical is solid, so it stands out from Error without color. */
export function LevelPill({ level }: { level: Level }) {
  const t = useT();
  return (
    <span className="level" data-level={level}>
      <Pill tone={LEVEL_TONES[level]}>{t.labels.level[level]}</Pill>
    </span>
  );
}

export function IncidentStatePill({ state }: { state: IncidentState }) {
  const t = useT();
  return <Pill tone={state === 'open' ? 'neutral' : 'off'}>{t.labels.incidentState[state]}</Pill>;
}
