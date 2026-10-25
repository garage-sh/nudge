import type { DeliveryView, DeliveryStatus } from '@nudge/shared';

/** A Delivery as the dashboard reads it, with its Destination. */
export const toDeliveryView = (delivery: {
  id: string;
  destination: DeliveryView['destination'];
  status: DeliveryStatus;
  externalUrl: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}): DeliveryView => ({
  id: delivery.id,
  destination: delivery.destination,
  status: delivery.status,
  externalUrl: delivery.externalUrl,
  attempts: delivery.attempts,
  lastError: delivery.lastError,
  createdAt: delivery.createdAt.toISOString(),
  updatedAt: delivery.updatedAt.toISOString(),
});

/** The Destination columns included in a `DeliveryView`. */
export const DELIVERY_DESTINATION_COLUMNS = {
  id: true,
  name: true,
  type: true,
  state: true,
} as const;
