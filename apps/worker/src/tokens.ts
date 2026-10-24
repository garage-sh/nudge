/** Jetons d'injection Nest du worker. */
export const DB = Symbol('DB');
export const DESTINATION_ADAPTER_RESOLVER = Symbol('DESTINATION_ADAPTER_RESOLVER');
export const DISPATCH_QUEUE_TOKEN = Symbol('DISPATCH_QUEUE');
export const TRIAGE_QUEUE_TOKEN = Symbol('TRIAGE_QUEUE');
export const OPTIONS = Symbol('OPTIONS');
/** `SecretCipher` des secrets stockés en base, par la clé d'Instance. */
export const SECRET_CIPHER = Symbol('SECRET_CIPHER');
