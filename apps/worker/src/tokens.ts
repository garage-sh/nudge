/** Jetons d'injection Nest du worker. */
export const DB = Symbol('DB');
export const DESTINATION_ADAPTER_RESOLVER = Symbol('DESTINATION_ADAPTER_RESOLVER');
export const DISPATCH_QUEUE_TOKEN = Symbol('DISPATCH_QUEUE');
export const TRIAGE_QUEUE_TOKEN = Symbol('TRIAGE_QUEUE');
/** Queue des alertes des Membres (`AlertesService`). */
export const ALERTES_QUEUE_TOKEN = Symbol('ALERTES_QUEUE');
export const OPTIONS = Symbol('OPTIONS');
/** `SecretCipher` des secrets stockés en base, par la clé d'Instance. */
export const SECRET_CIPHER = Symbol('SECRET_CIPHER');
/**
 * `SurSuspension` : appelé à chaque passage d'une Destination en Suspendue, par
 * `SuspensionService` seul : alerte des Membres, puis `WorkerOptions.surSuspension`.
 */
export const SUR_SUSPENSION = Symbol('SUR_SUSPENSION');
