/** Nest injection tokens of the worker. */
export const DB = Symbol('DB');
export const DESTINATION_ADAPTER_RESOLVER = Symbol('DESTINATION_ADAPTER_RESOLVER');
export const DISPATCH_QUEUE_TOKEN = Symbol('DISPATCH_QUEUE');
export const TRIAGE_QUEUE_TOKEN = Symbol('TRIAGE_QUEUE');
/** Queue of the Member alerts (`AlertsService`). */
export const ALERTS_QUEUE_TOKEN = Symbol('ALERTS_QUEUE');
export const OPTIONS = Symbol('OPTIONS');
/** `SecretCipher` for the secrets stored in the database, using the Instance key. */
export const SECRET_CIPHER = Symbol('SECRET_CIPHER');
/**
 * `OnSuspension`: called on every transition of a Destination to Suspended, by
 * `SuspensionService` only: Member alert, then `WorkerOptions.onSuspension`.
 */
export const ON_SUSPENSION = Symbol('ON_SUSPENSION');
