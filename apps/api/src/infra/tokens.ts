/** Nest injection tokens of the api. */
export const DB = Symbol('DB');
export const TRIAGE_QUEUE_TOKEN = Symbol('TRIAGE_QUEUE');
/** Dispatch queue: the manual replay of a Delivery puts its job back there. */
export const DISPATCH_QUEUE_TOKEN = Symbol('DISPATCH_QUEUE');
/** The dashboard's `SessionCookieOptions`. */
export const SESSION_COOKIE_OPTIONS = Symbol('SESSION_COOKIE_OPTIONS');
/** `SecretCipher` for the secrets stored in the database, using the Instance key. */
export const SECRET_CIPHER = Symbol('SECRET_CIPHER');
/** `DestinationAdapterResolver`: a Destination's "test" button goes through its adapter. */
export const DESTINATION_ADAPTER_RESOLVER = Symbol('DESTINATION_ADAPTER_RESOLVER');
/** `CaptureStorage`: the Capture images, shared with the worker. */
export const CAPTURE_STORAGE = Symbol('CAPTURE_STORAGE');
