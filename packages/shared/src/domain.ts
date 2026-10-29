/** Domain values shared by the API, the worker, the dashboard and the SDK (vocabulary from CONTEXT.md). */

export const FEEDBACK_TYPES = ['bug', 'suggestion', 'opinion', 'question'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

/** Ordered levels, from least to most severe. */
export const SEVERITIES = ['cosmetic', 'minor', 'major', 'blocking'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Display labels of a Type and a Severity: dashboard and Destination messages. */
export const FEEDBACK_TYPE_LABELS: Readonly<Record<FeedbackType, string>> = {
  bug: 'Bug',
  suggestion: 'Suggestion',
  opinion: 'Opinion',
  question: 'Question',
};

export const SEVERITY_LABELS: Readonly<Record<Severity, string>> = {
  cosmetic: 'Cosmetic',
  minor: 'Minor',
  major: 'Major',
  blocking: 'Blocking',
};

/**
 * How serious an Incident is, ordered from least to most serious. A scale of its own,
 * never mixed with Severity, which belongs to Feedback.
 */
export const LEVELS = ['info', 'warning', 'error', 'critical'] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABELS: Readonly<Record<Level, string>> = {
  info: 'Info',
  warning: 'Warning',
  error: 'Error',
  critical: 'Critical',
};

/** Where an Incident's Level came from: its sender, the Judge, or the Project's default Level. */
export const LEVEL_ORIGINS = ['declared', 'judge', 'default'] as const;
export type LevelOrigin = (typeof LEVEL_ORIGINS)[number];

/** The Level an undeclared Incident gets when its Project sets none. */
export const DEFAULT_LEVEL: Level = 'error';

/** An Open Incident absorbs Occurrences; a Closed one never reopens. */
export const INCIDENT_STATES = ['open', 'closed'] as const;
export type IncidentState = (typeof INCIDENT_STATES)[number];

/** `extension` is reserved for the future QA module. */
export const SOURCES = ['widget', 'api', 'extension'] as const;
export type Source = (typeof SOURCES)[number];

export const FEEDBACK_STATES = [
  'received',
  'triaged',
  'dispatched',
  'discarded',
  'in_review',
] as const;
export type FeedbackState = (typeof FEEDBACK_STATES)[number];

/**
 * Prefixes of a Project's keys: ingestion picks its path from them. The public key
 * (Widget) declares the Author's identity, the secret key (server) attests it.
 */
export const PUBLIC_KEY_PREFIX = 'nk_pub_';
export const SECRET_KEY_PREFIX = 'nk_sec_';

/** The Author's identity: declared by the browser, or attested by the secret key. */
export const AUTHOR_TRUST_LEVELS = ['declared', 'attested'] as const;
export type AuthorTrust = (typeof AUTHOR_TRUST_LEVELS)[number];

export const DESTINATION_STATES = ['active', 'suspended'] as const;
export type DestinationState = (typeof DESTINATION_STATES)[number];

export const DELIVERY_STATUSES = ['pending', 'delivered', 'failed', 'held'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * What a Delivery delivers: its subject, a Feedback or an Incident. Each new subject is
 * one more case here, in the database's subject columns and in the worker's subject
 * dispatchers.
 */
export const DELIVERY_SUBJECTS = ['feedback', 'incident'] as const;
export type DeliverySubjectKind = (typeof DELIVERY_SUBJECTS)[number];

/**
 * The Dispatch moment that created an Incident's Delivery: `opened` when the Incident
 * opened (or a Member redispatched it), `raised` when its Level rose and the Destination
 * newly accepted it. An Incident has at most one Delivery per Destination.
 */
export const INCIDENT_DISPATCH_MOMENTS = ['opened', 'raised'] as const;
export type IncidentDispatchMoment = (typeof INCIDENT_DISPATCH_MOMENTS)[number];

/**
 * Statuses from which a Member can replay a Delivery: finished, delivered or failed. A
 * pending Delivery already has a job running; a held Delivery waits for its Destination
 * to be active again, and the probe releases it.
 */
export const REPLAYABLE_DELIVERY_STATUSES = [
  'delivered',
  'failed',
] as const satisfies readonly DeliveryStatus[];

export const isDeliveryReplayable = (status: DeliveryStatus): boolean =>
  (REPLAYABLE_DELIVERY_STATUSES as readonly DeliveryStatus[]).includes(status);

/**
 * States from which a Member can redispatch a Feedback (D22): it has already been
 * through Dispatch. Received waits for its Triage; Discarded and In review are reviewed first.
 */
export const REDISPATCHABLE_FEEDBACK_STATES = [
  'triaged',
  'dispatched',
] as const satisfies readonly FeedbackState[];

export const isFeedbackRedispatchable = (state: FeedbackState): boolean =>
  (REDISPATCHABLE_FEEDBACK_STATES as readonly FeedbackState[]).includes(state);

/** The transitions a Member triggers on a Feedback held back by Triage. */
export const REVIEW_ACTIONS = ['approve', 'reject', 'reinstate'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/**
 * Required starting state and resulting state of each review transition. Approving and
 * reinstating make the Feedback Triaged: Dispatch then makes it Dispatched (or leaves it
 * Triaged if no Filter accepts it), like a freshly triaged Feedback. Reinstating only
 * applies to a Feedback Discarded as Junk, not to one rejected after review
 * (`requiresNoManipulation`: its Verdict must not be Manipulation).
 */
export const REVIEW_TRANSITIONS = {
  approve: { from: 'in_review', to: 'triaged', requiresNoManipulation: false },
  reject: { from: 'in_review', to: 'discarded', requiresNoManipulation: false },
  reinstate: { from: 'discarded', to: 'triaged', requiresNoManipulation: true },
} as const satisfies Record<
  ReviewAction,
  { from: FeedbackState; to: FeedbackState; requiresNoManipulation: boolean }
>;

/** The review actions a Member can trigger on a Feedback, given its state and its Verdict. */
export const allowedReviewActions = (
  state: FeedbackState,
  verdict: { readonly manipulation: boolean } | null,
): ReviewAction[] =>
  REVIEW_ACTIONS.filter((action) => {
    const { from, requiresNoManipulation } = REVIEW_TRANSITIONS[action];
    return state === from && (!requiresNoManipulation || verdict?.manipulation === false);
  });

/**
 * Class of a Delivery failure (literals from the spec):
 * - `transient`: 5xx, 429, timeout — retried, counts towards Suspension;
 * - `auth`: credentials refused — immediate Suspension, no retry;
 * - `permanent`: refused for this specific Feedback — failure with no retry and no Suspension.
 */
export const FAILURE_CLASSES = ['transient', 'auth', 'permanent'] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

/**
 * Judge providers an Instance can choose: Jev through the TypeSafe API, pplx-decider
 * through OpenRouter's Decisions API, or any self-hosted server of the Decisions API
 * (pplx-decider).
 */
export const JUDGE_PROVIDERS = ['typesafe', 'openrouter', 'self_hosted'] as const;
export type JudgeProvider = (typeof JUDGE_PROVIDERS)[number];

/**
 * Model requested when the Instance picks none: the alias of the latest Jev at TypeSafe,
 * a pinned pplx-decider at OpenRouter (Triage thresholds do not move with an alias), and
 * the model of Decider for Mac, the local server published by Perplexity.
 */
export const DEFAULT_JUDGE_MODELS: Readonly<Record<JudgeProvider, string>> = {
  typesafe: 'jev-latest',
  openrouter: 'perplexity/pplx-decider-v1.2',
  self_hosted: 'pplx-decider-flash-v1.2',
};

/** TypeSafe and OpenRouter require an API key; a self-hosted server can do without. */
export const requiresApiKey = (provider: JudgeProvider): boolean => provider !== 'self_hosted';

/** A self-hosted Judge has no default address. */
export const requiresBaseUrl = (provider: JudgeProvider): boolean => provider === 'self_hosted';
