import type { DeliveryResult } from '@nudge/core';

/**
 * What an adapter that does not deliver Incidents yet answers: a permanent failure, so
 * the Delivery fails visibly (and can be replayed once the adapter serves Incidents)
 * without counting toward the Destination's Suspension.
 */
export const incidentsNotDelivered = (adapter: string): Promise<DeliveryResult> =>
  Promise.resolve({
    status: 'failed',
    failureClass: 'permanent',
    message: `${adapter} Destinations do not receive Incidents yet`,
  });
