/** Échec transitoire : le job est relancé par BullMQ (backoff exponentiel et jitter). */
export class EchecTransitoire extends Error {
  override readonly name = 'EchecTransitoire';
}
