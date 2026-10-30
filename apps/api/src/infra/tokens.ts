/** Nest injection tokens of the api. */
export const DB = Symbol('DB');
export const TRIAGE_QUEUE_TOKEN = Symbol('TRIAGE_QUEUE');
/** Dispatch queue: the manual replay of a Delivery puts its job back there. */
export const DISPATCH_QUEUE_TOKEN = Symbol('DISPATCH_QUEUE');
/** Queue of the Judge's assessments of an undeclared Incident Level. */
export const INCIDENT_LEVEL_QUEUE_TOKEN = Symbol('INCIDENT_LEVEL_QUEUE');
/** Member alerts queue: an Incident storm starting is reported from the ingestion. */
export const ALERTS_QUEUE_TOKEN = Symbol('ALERTS_QUEUE');
/** `OpeningCapOptions`: the Instance's Opening cap of the Incidents. */
export const OPENING_CAP = Symbol('OPENING_CAP');
/** The dashboard's `SessionCookieOptions`. */
export const SESSION_COOKIE_OPTIONS = Symbol('SESSION_COOKIE_OPTIONS');
/** `SecretCipher` for the secrets stored in the database, using the Instance key. */
export const SECRET_CIPHER = Symbol('SECRET_CIPHER');
/** `DestinationAdapterResolver`: a Destination's "test" button goes through its adapter. */
export const DESTINATION_ADAPTER_RESOLVER = Symbol('DESTINATION_ADAPTER_RESOLVER');
/** `CaptureStorage`: the Capture images, shared with the worker. */
export const CAPTURE_STORAGE = Symbol('CAPTURE_STORAGE');
/** `Mailer`: the Instance's SMTP server, for the "send a test email" button. */
export const MAILER = Symbol('MAILER');
