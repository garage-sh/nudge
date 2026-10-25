/** Transient failure: BullMQ retries the job (exponential backoff and jitter). */
export class TransientFailure extends Error {
  override readonly name = 'TransientFailure';
}
