/** Jetons d'injection Nest de l'api. */
export const DB = Symbol('DB');
export const TRIAGE_QUEUE_TOKEN = Symbol('TRIAGE_QUEUE');
/** `SessionCookieOptions` du dashboard. */
export const SESSION_COOKIE_OPTIONS = Symbol('SESSION_COOKIE_OPTIONS');
/** `SecretCipher` des secrets stockés en base, par la clé d'Instance. */
export const SECRET_CIPHER = Symbol('SECRET_CIPHER');
/** `DestinationAdapterResolver` : le bouton « tester » d'une Destination passe par son adaptateur. */
export const DESTINATION_ADAPTER_RESOLVER = Symbol('DESTINATION_ADAPTER_RESOLVER');
