import { z } from 'zod';
import {
  REVIEW_ACTIONS,
  FEEDBACK_STATES,
  requiresBaseUrl,
  JUDGE_PROVIDERS,
  SEVERITIES,
  SOURCES,
  FEEDBACK_TYPES,
  INCIDENT_STATES,
  QUIET_PERIOD_BOUNDS,
  LEVELS,
  type AuthorTrust,
  type IncidentCloseCause,
  type IncidentState,
  type Level,
  type LevelOrigin,
  type DestinationState,
  type FeedbackState,
  type JudgeProvider,
  type Severity,
  type Source,
  type DeliveryStatus,
  type FeedbackType,
} from './domain.js';
import type { Context, CaptureType } from './feedback-input.js';
import { INCIDENT_LIMITS, type IncidentReport } from './incident-input.js';

/**
 * Contract of the dashboard API (`/api/…`): accepted bodies (zod schemas, validated
 * by the api) and responses (types, read by the dashboard).
 */

export const DASHBOARD_LIMITS = {
  email: 320,
  passwordMin: 12,
  /** Upper bound: hashing an oversized password with argon2id would cost for nothing. */
  passwordMax: 256,
  /** Upper bound of the setup token typed at first launch. */
  setupToken: 256,
  projectName: 100,
  projectDescription: 2000,
  origins: 50,
  origin: 2048,
  feedbacksPerPage: 50,
  feedbacksPerPageMax: 100,
  /** Characters of a Feedback's text shown in the inbox. */
  feedbackPreview: 280,
  incidentsPerPage: 50,
  incidentsPerPageMax: 100,
  judgeModel: 200,
  judgeUrl: 2048,
  judgeKey: 1000,
  /** Longest retention period short of unlimited: 100 years. */
  retentionDaysMax: 36_500,
  /** A host name: 253 characters (RFC 1035). */
  smtpHost: 253,
  smtpUsername: 320,
  smtpPassword: 1000,
  smtpFromName: 100,
} as const;

const email = z.string().trim().toLowerCase().pipe(z.email().max(DASHBOARD_LIMITS.email));

/** A password being chosen: the policy applies (account creation, password change). */
const newPassword = z
  .string()
  .min(DASHBOARD_LIMITS.passwordMin, {
    message: `At least ${DASHBOARD_LIMITS.passwordMin} characters`,
  })
  .max(DASHBOARD_LIMITS.passwordMax);

/** Creation of a Member account (setup, invitation). */
export const newMemberSchema = z.strictObject({ email, password: newPassword });
export type NewMember = z.input<typeof newMemberSchema>;

/**
 * First account of the Instance: the setup token, printed in the api logs (or set by
 * `NUDGE_SETUP_TOKEN`), proves that whoever claims the Instance has access to the server.
 */
export const setupSchema = z.strictObject({
  email,
  password: newPassword,
  setupToken: z.string().trim().min(1).max(DASHBOARD_LIMITS.setupToken),
});
export type SetupRequest = z.input<typeof setupSchema>;

/** A Member changes their own password: the current one is required. */
export const passwordChangeSchema = z.strictObject({
  currentPassword: z.string().min(1).max(DASHBOARD_LIMITS.passwordMax),
  newPassword,
});
export type PasswordChange = z.input<typeof passwordChangeSchema>;

/** Sign-in: the password policy is not restated to someone who gets it wrong. */
export const signInSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(DASHBOARD_LIMITS.email),
  password: z.string().min(1).max(DASHBOARD_LIMITS.passwordMax),
});
export type SignInCredentials = z.input<typeof signInSchema>;

/**
 * An allowed origin, normalized (`https://Example.com/` → `https://example.com`).
 * A path, a query or credentials betray a URL pasted by mistake: refused.
 */
export const originSchema = z
  .string()
  .trim()
  .max(DASHBOARD_LIMITS.origin)
  .transform((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: `Invalid origin: ${value}` });
      return z.NEVER;
    }
    const bare =
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password;
    if (!bare) {
      ctx.addIssue({
        code: 'custom',
        message: `An origin is written scheme://host[:port], with no path: ${value}`,
      });
      return z.NEVER;
    }
    return url.origin;
  });

const allowedOrigins = z
  .array(originSchema)
  .max(DASHBOARD_LIMITS.origins)
  .transform((origins) => [...new Set(origins)]);

const projectName = z.string().trim().min(1).max(DASHBOARD_LIMITS.projectName);

/** Project description: optional; an empty string clears it. */
const projectDescription = z
  .string()
  .trim()
  .max(DASHBOARD_LIMITS.projectDescription)
  .nullable()
  .transform((value) => (value ? value : null));

export const newProjectSchema = z.strictObject({
  name: projectName,
  description: projectDescription.optional(),
  allowedOrigins: allowedOrigins.optional(),
});
export type NewProject = z.input<typeof newProjectSchema>;

export const projectUpdateSchema = z.strictObject({
  name: projectName.optional(),
  description: projectDescription.optional(),
  allowedOrigins: allowedOrigins.optional(),
  /** The Level of an Incident whose sender declared none. */
  defaultLevel: z.enum(LEVELS).optional(),
  /** The Quiet period of the Project's Incidents, in seconds; `null`: the Instance default. */
  quietPeriod: z
    .number()
    .int()
    .min(QUIET_PERIOD_BOUNDS.min)
    .max(QUIET_PERIOD_BOUNDS.max)
    .nullable()
    .optional(),
});
export type ProjectUpdate = z.input<typeof projectUpdateSchema>;

/** Optional text: an empty string means "no value". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value ? value : null));

/** Base URL of a Judge: http(s), with no query and no credentials. */
const judgeUrl = optionalText(DASHBOARD_LIMITS.judgeUrl).refine(
  (value) => {
    if (value === null) return true;
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  },
  { message: 'Expected an http(s) URL, with no parameters and no credentials' },
);

/**
 * The Instance's choice of Judge. `provider: null`: no Judge chosen (falls back on the
 * `NUDGE_JUDGE_*` variables, otherwise degraded mode). `apiKey` absent: the stored key
 * is kept if the provider does not change; `null` clears it.
 */
export const judgeChoiceSchema = z
  .strictObject({
    provider: z.enum(JUDGE_PROVIDERS).nullable(),
    model: optionalText(DASHBOARD_LIMITS.judgeModel).optional(),
    baseUrl: judgeUrl.optional(),
    apiKey: optionalText(DASHBOARD_LIMITS.judgeKey).optional(),
  })
  .superRefine((judge, ctx) => {
    if (judge.provider && requiresBaseUrl(judge.provider) && !judge.baseUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['urlBase'],
        message: 'Server URL required for a self-hosted Judge',
      });
    }
  });
export type JudgeChoice = z.input<typeof judgeChoiceSchema>;

/** The Instance's Judge as the dashboard reads it: the key is never returned. */
export interface InstanceJudgeView {
  readonly provider: JudgeProvider | null;
  readonly model: string | null;
  readonly baseUrl: string | null;
  readonly keyConfigured: boolean;
}

/**
 * Retention period of the Instance's Feedback, in whole days; `null`: unlimited.
 * The scheduled purge erases older Feedback, and its Captures.
 */
export const retentionSchema = z.strictObject({
  days: z.number().int().min(1).max(DASHBOARD_LIMITS.retentionDaysMax).nullable(),
});
export type RetentionView = z.output<typeof retentionSchema>;

/**
 * How nudge secures its connection to the SMTP server: STARTTLS upgrade (port 587),
 * implicit TLS (port 465), or none — for a relay on a trusted network only.
 */
export const SMTP_SECURITIES = ['starttls', 'tls', 'none'] as const;
export type SmtpSecurity = (typeof SMTP_SECURITIES)[number];

/** The usual port of each security mode, offered by the dashboard. */
export const SMTP_DEFAULT_PORTS: Readonly<Record<SmtpSecurity, number>> = {
  starttls: 587,
  tls: 465,
  none: 25,
};

/** A host name or an IP address, without scheme or port. */
const smtpHost = z
  .string()
  .trim()
  .min(1)
  .max(DASHBOARD_LIMITS.smtpHost)
  .regex(/^[A-Za-z0-9.:_-]+$/, { message: 'Expected a host name or an IP address' });

/** A display name ends up in a header: no line break or other control character. */
const headerText = (max: number) =>
  optionalText(max).refine((value) => value === null || !/\p{Cc}/u.test(value), {
    message: 'No line breaks or control characters',
  });

/**
 * The Instance's SMTP server, through which the email Destinations send. The password
 * follows the Judge key's rule: absent, the stored one is kept (for the same host and
 * username only); `null` clears it.
 */
export const smtpSettingsSchema = z.strictObject({
  host: smtpHost,
  port: z.number().int().min(1).max(65_535),
  security: z.enum(SMTP_SECURITIES),
  username: optionalText(DASHBOARD_LIMITS.smtpUsername).optional(),
  password: optionalText(DASHBOARD_LIMITS.smtpPassword).optional(),
  fromAddress: email,
  fromName: headerText(DASHBOARD_LIMITS.smtpFromName).optional(),
});
export type SmtpSettingsInput = z.input<typeof smtpSettingsSchema>;

/** The Instance's SMTP server as the dashboard reads it: the password is never returned. */
export interface InstanceSmtpView {
  readonly host: string;
  readonly port: number;
  readonly security: SmtpSecurity;
  readonly username: string | null;
  readonly passwordConfigured: boolean;
  readonly fromAddress: string;
  readonly fromName: string | null;
}

/** What awaits a Member, for the dashboard's badges. */
export interface AlertsView {
  /** Feedback In review (suspected Manipulation), across all Projects. */
  readonly feedbacksInReview: number;
  /** Suspended Destinations, oldest first. */
  readonly suspendedDestinations: readonly {
    readonly id: string;
    readonly name: string;
    readonly project: { readonly id: string; readonly name: string };
  }[];
}

/** Error body of the api: a stable code, and the details of refused fields where relevant. */
export interface ApiErrorBody {
  readonly error: string;
  readonly details?: readonly { readonly path: string; readonly message: string }[];
}

export interface MemberView {
  readonly id: string;
  readonly email: string;
}

/** A Member in the list of Members: since when they have had an account. */
export interface MemberListItemView extends MemberView {
  /** Account creation (ISO 8601). */
  readonly since: string;
}

export interface SessionView {
  readonly member: MemberView;
}

/** Result of "sign out everywhere else": how many sessions were revoked. */
export interface RevokedSessions {
  readonly revoked: number;
}

export interface SetupState {
  /** `true` as long as no Member exists: setup is open. */
  readonly required: boolean;
}

export interface CreatedInvitation {
  /** Goes into the invitation link; it is readable only here. */
  readonly token: string;
  readonly expiresAt: string;
}

export interface InvitationView {
  readonly expiresAt: string;
}

export interface ProjectView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly publicKey: string;
  readonly allowedOrigins: readonly string[];
  /** The Level of an Incident whose sender declared none. */
  readonly defaultLevel: Level;
  /**
   * Seconds an Incident of the Project stays Open without a new Occurrence, unless the
   * Occurrence sets its own; `null`: the Instance default.
   */
  readonly quietPeriod: number | null;
  readonly createdAt: string;
}

/**
 * A Project's activity, for the list of Projects and the sidebar: enough to spot the
 * Project that receives Feedback or that needs a Member's attention.
 */
export interface ProjectActivityView {
  readonly projectId: string;
  /** Feedback received over the last seven days. */
  readonly feedbacksThisWeek: number;
  readonly feedbacksInReview: number;
  readonly destinations: number;
  readonly suspendedDestinations: number;
}

/** Response to a Project creation or a secret key regeneration. */
export interface ProjectWithSecretKey {
  readonly project: ProjectView;
  /** Readable only once: the Instance keeps only its hash. */
  readonly secretKey: string;
}

/**
 * Filters and pagination of the inbox (`GET /api/feedbacks?…`).
 * Type, Severity and Uncertain apply to the Verdict: a Feedback not yet triaged never matches them.
 */
export const feedbackFiltersSchema = z.strictObject({
  project: z.uuid().optional(),
  type: z.enum(FEEDBACK_TYPES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  state: z.enum(FEEDBACK_STATES).optional(),
  source: z.enum(SOURCES).optional(),
  /** `true`: only Uncertain Verdicts, to check first. */
  uncertain: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  /** The `next` of the previous page. */
  cursor: z.string().max(200).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(DASHBOARD_LIMITS.feedbacksPerPageMax)
    .default(DASHBOARD_LIMITS.feedbacksPerPage),
});
export interface ProjectRefView {
  readonly id: string;
  readonly name: string;
}

export interface VerdictView {
  readonly resolvedType: FeedbackType;
  /** `null` in degraded mode, without a Judge. */
  readonly severity: Severity | null;
  readonly junk: boolean;
  readonly manipulation: boolean;
  readonly uncertain: boolean;
}

/** A row of the inbox. */
export interface FeedbackSummaryView {
  readonly id: string;
  readonly project: ProjectRefView;
  readonly state: FeedbackState;
  readonly source: Source;
  /** Start of the text, raw: to display as text, never as HTML. */
  readonly preview: string;
  readonly declaredType: FeedbackType | null;
  /** `null` until the Feedback is triaged. */
  readonly verdict: VerdictView | null;
  readonly createdAt: string;
}

/** A page of the inbox, newest first. */
export interface FeedbackPage {
  readonly feedbacks: readonly FeedbackSummaryView[];
  /** Cursor of the next page, `null` on the last one. */
  readonly next: string | null;
}

export interface AuthorView {
  readonly id: string | null;
  readonly email: string | null;
  readonly name: string | null;
  /** Declared by the browser, or attested by the secret key. */
  readonly trust: AuthorTrust;
}

export interface DestinationRefView {
  readonly id: string;
  readonly name: string;
  /** Adapter key: `webhook`, `discord`, `linear`… */
  readonly type: string;
  readonly state: DestinationState;
}

export interface DeliveryView {
  readonly id: string;
  readonly destination: DestinationRefView;
  readonly status: DeliveryStatus;
  /** Link to the object created at the Destination (issue, message), once delivered. */
  readonly externalUrl: string | null;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * The Capture attached to a Feedback: the image itself is read from
 * `GET /api/feedbacks/:id/capture` (`captureUrl`).
 */
export interface CaptureView {
  readonly contentType: CaptureType;
  readonly bytes: number;
}

/** Path of a Capture's image in the dashboard API. */
export const captureUrl = (feedbackId: string): string =>
  `/api/feedbacks/${encodeURIComponent(feedbackId)}/capture`;

/** The details of a Feedback (`GET /api/feedbacks/:id`). */
export interface FeedbackDetailView {
  readonly id: string;
  readonly project: ProjectRefView;
  readonly state: FeedbackState;
  readonly source: Source;
  /** The Author's raw text: to display as text, never as HTML. */
  readonly text: string;
  readonly declaredType: FeedbackType | null;
  /** `null`: anonymous Author. */
  readonly author: AuthorView | null;
  readonly context: Context;
  /** `null`: the Author attached no Capture. */
  readonly capture: CaptureView | null;
  readonly verdict: VerdictView | null;
  readonly deliveries: readonly DeliveryView[];
  readonly createdAt: string;
}

/**
 * Redispatch of a Feedback by a Member (`POST /api/feedbacks/:id/redispatch`): the
 * Deliveries created to the Destinations whose Filter now accepts the Feedback, and the
 * updated Feedback. `deliveriesCreated` is 0 when no further Destination accepts it.
 */
export interface RedispatchView {
  readonly deliveriesCreated: number;
  readonly feedback: FeedbackDetailView;
}

/** Review of a Feedback by a Member (`POST /api/feedbacks/:id/review`). */
export const reviewSchema = z.strictObject({ action: z.enum(REVIEW_ACTIONS) });
export type Review = z.input<typeof reviewSchema>;

/**
 * Correction of the Verdict by a Member (`PATCH /api/feedbacks/:id/verdict`): the
 * resolved type, the Severity, or both. No effect on the Destinations already served.
 */
export const verdictCorrectionSchema = z
  .strictObject({
    resolvedType: z.enum(FEEDBACK_TYPES).optional(),
    severity: z.enum(SEVERITIES).optional(),
  })
  .refine(
    (correction) => correction.resolvedType !== undefined || correction.severity !== undefined,
    {
      message: 'Expected a resolved type or a Severity',
    },
  );
export type VerdictCorrection = z.input<typeof verdictCorrectionSchema>;

/**
 * Filters and pagination of a Project's Incidents (`GET /api/incidents?…`), newest
 * opened first. `environment` is matched exactly.
 */
export const incidentFiltersSchema = z.strictObject({
  project: z.uuid(),
  state: z.enum(INCIDENT_STATES).optional(),
  level: z.enum(LEVELS).optional(),
  environment: z.string().max(INCIDENT_LIMITS.environment).optional(),
  /** The `next` of the previous page. */
  cursor: z.string().max(200).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(DASHBOARD_LIMITS.incidentsPerPageMax)
    .default(DASHBOARD_LIMITS.incidentsPerPage),
});

/** The Project whose Environments are listed (`GET /api/incidents/environments?project=…`). */
export const incidentEnvironmentsSchema = z.strictObject({ project: z.uuid() });

/** A row of a Project's Incident list. Every text comes from the sender: render it as text. */
export interface IncidentSummaryView {
  readonly id: string;
  readonly project: ProjectRefView;
  readonly state: IncidentState;
  /** The title of the Occurrence that opened the Incident. */
  readonly title: string;
  readonly level: Level;
  readonly levelOrigin: LevelOrigin;
  /** The Environment of the Occurrence that opened it; `null`: none. */
  readonly environment: string | null;
  /** Occurrences absorbed, the first one included. */
  readonly occurrences: number;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  /** Why and when the Incident closed; `null` while it is Open. */
  readonly closeCause: IncidentCloseCause | null;
  readonly closedAt: string | null;
}

/** A page of a Project's Incidents, newest opened first. */
export interface IncidentPage {
  readonly incidents: readonly IncidentSummaryView[];
  /** Cursor of the next page, `null` on the last one. */
  readonly next: string | null;
}

/** The details of an Incident (`GET /api/incidents/:id`). */
export interface IncidentDetailView extends IncidentSummaryView {
  /** Declared by the sender, or derived by nudge (a digest). */
  readonly fingerprint: string;
  readonly firstReport: IncidentReport;
  readonly lastReport: IncidentReport;
  /** At most one per Destination, oldest first. */
  readonly deliveries: readonly DeliveryView[];
}

/**
 * Redispatch of an Open Incident by a Member (`POST /api/incidents/:id/redispatch`): the
 * Deliveries created to the Destinations whose Incident Filter now accepts it, and the
 * updated Incident. `deliveriesCreated` is 0 when no further Destination accepts it.
 */
export interface IncidentRedispatchView {
  readonly deliveriesCreated: number;
  readonly incident: IncidentDetailView;
}
