import { FEEDBACK_TYPES, type DestinationView, type FeedbackType } from '@nudge/shared';
import { useId, useState } from 'react';
import { useT } from '../../i18n/index.js';
import { SeverityGauge } from '../feedback-badges.js';
import { formOf, TypeIcon } from './types/index.js';

/** Vertical step between two nodes, in px; the stylesheet gives nodes the same pitch. */
const PITCH = 60;

/** What the pointer rests on: its routes stand out, the others fade. */
type Focus = { readonly type: FeedbackType } | { readonly destination: string } | null;

const accepts = (destination: DestinationView, type: FeedbackType) =>
  destination.filter?.types.includes(type) ?? false;

/** The vertical center of node `index` in a column of `count`, centered in `height`. */
const center = (index: number, count: number, height: number) =>
  (height - count * PITCH) / 2 + index * PITCH + PITCH / 2;

/**
 * The Project's routing at a glance: the Feedback types on the left, the Destinations on
 * the right, a line wherever a Destination's Filter accepts a type. A type no Destination
 * accepts says it goes nowhere. The drawing is for the eye (`aria-hidden`); the same
 * routes are written as a list, which is also what a narrow screen shows.
 */
export function RoutingMap({ destinations }: { destinations: readonly DestinationView[] }) {
  const t = useT();
  const r = t.destinations.routing;
  const titleId = useId();
  const [focus, setFocus] = useState<Focus>(null);
  const height = Math.max(FEEDBACK_TYPES.length, destinations.length) * PITCH;
  const routes = FEEDBACK_TYPES.flatMap((type, typeIndex) =>
    destinations.flatMap((destination, destinationIndex) =>
      accepts(destination, type) ? [{ type, typeIndex, destination, destinationIndex }] : [],
    ),
  );
  // A route stands out with either of its ends; a node, with the routes it shares.
  const routeLit = (type: FeedbackType, destination: DestinationView) =>
    focus === null ||
    ('type' in focus ? focus.type === type : focus.destination === destination.id);
  const typeLit = (type: FeedbackType) =>
    destinations.some((destination) => accepts(destination, type) && routeLit(type, destination)) ||
    focus === null ||
    ('type' in focus && focus.type === type);
  const destinationLit = (destination: DestinationView) =>
    FEEDBACK_TYPES.some((type) => accepts(destination, type) && routeLit(type, destination)) ||
    focus === null ||
    ('destination' in focus && focus.destination === destination.id);

  return (
    <figure className="routing panel" aria-labelledby={titleId}>
      <figcaption>
        <h2 id={titleId}>{r.title}</h2>
        <p className="help">{r.help}</p>
      </figcaption>

      <div
        className="routing-map"
        aria-hidden="true"
        data-focused={focus !== null}
        onMouseLeave={() => setFocus(null)}
      >
        <p className="routing-heading">{r.types}</p>
        <p className="routing-heading">{r.destinations}</p>
        <ol className="routing-column" style={{ height }}>
          {FEEDBACK_TYPES.map((type) => {
            const count = destinations.filter((destination) => accepts(destination, type)).length;
            return (
              <li
                key={type}
                className="routing-node"
                data-lit={typeLit(type)}
                data-nowhere={count === 0}
                onMouseEnter={() => setFocus({ type })}
              >
                <strong>{t.labels.feedbackType[type]}</strong>
                <span>{count === 0 ? r.nowhere : r.destinationCount(count)}</span>
              </li>
            );
          })}
        </ol>
        <svg
          className="routing-lines"
          viewBox={`0 0 100 ${height}`}
          preserveAspectRatio="none"
          style={{ height }}
        >
          {routes.map(({ type, typeIndex, destination, destinationIndex }) => {
            const from = center(typeIndex, FEEDBACK_TYPES.length, height);
            const to = center(destinationIndex, destinations.length, height);
            return (
              <path
                key={`${type}-${destination.id}`}
                d={`M0 ${from} C50 ${from} 50 ${to} 100 ${to}`}
                vectorEffect="non-scaling-stroke"
                data-lit={routeLit(type, destination)}
                data-state={destination.state}
              />
            );
          })}
        </svg>
        <ol className="routing-column" style={{ height }}>
          {destinations.map((destination) => {
            const form = formOf(destination.type);
            const minimumSeverity = destination.filter?.minimumSeverity ?? null;
            return (
              <li
                key={destination.id}
                className="routing-node destination-node"
                data-lit={destinationLit(destination)}
                data-state={destination.state}
                onMouseEnter={() => setFocus({ destination: destination.id })}
              >
                <strong>
                  <TypeIcon icon={form?.icon} />
                  <span>{destination.name}</span>
                </strong>
                <span>
                  {destination.state === 'suspended' ? (
                    <span className="routing-suspended">{t.labels.destinationState.suspended}</span>
                  ) : null}
                  {!destination.filter ? (
                    t.destinations.noFeedback
                  ) : minimumSeverity ? (
                    <SeverityGauge
                      severity={minimumSeverity}
                      label={t.destinations.severityOrMore(t.labels.severity[minimumSeverity])}
                    />
                  ) : (
                    t.destinations.anySeverity
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <ul className="routing-list">
        {FEEDBACK_TYPES.map((type) => {
          const names = destinations
            .filter((destination) => accepts(destination, type))
            .map((destination) => destination.name);
          const label = t.labels.feedbackType[type];
          return (
            <li key={type} data-nowhere={names.length === 0}>
              {names.length === 0 ? r.routeNowhere(label) : r.route(label, names.join(', '))}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
