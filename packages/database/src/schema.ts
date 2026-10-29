import type { IncidentCondition, TriageAnswers } from '@nudge/core';
import {
  AUTHOR_TRUST_LEVELS,
  DELIVERY_STATUSES,
  DELIVERY_SUBJECTS,
  DESTINATION_STATES,
  FEEDBACK_STATES,
  FEEDBACK_TYPES,
  DEFAULT_LEVEL,
  INCIDENT_CLOSE_CAUSES,
  INCIDENT_DISPATCH_MOMENTS,
  INCIDENT_STATES,
  JUDGE_PROVIDERS,
  LEVEL_ORIGINS,
  LEVELS,
  SEVERITIES,
  SOURCES,
  type Author,
  type SmtpSecurity,
  type CaptureType,
  type Context,
  type IncidentReport,
} from '@nudge/shared';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const feedbackTypeEnum = pgEnum('feedback_type', FEEDBACK_TYPES);
export const severityEnum = pgEnum('severity', SEVERITIES);
export const sourceEnum = pgEnum('feedback_source', SOURCES);
export const feedbackStateEnum = pgEnum('feedback_state', FEEDBACK_STATES);
export const authorTrustEnum = pgEnum('author_trust', AUTHOR_TRUST_LEVELS);
export const destinationStateEnum = pgEnum('destination_state', DESTINATION_STATES);
export const deliveryStatusEnum = pgEnum('delivery_status', DELIVERY_STATUSES);
export const deliverySubjectEnum = pgEnum('delivery_subject', DELIVERY_SUBJECTS);
export const judgeProviderEnum = pgEnum('judge_provider', JUDGE_PROVIDERS);
/** Declared in order, from least to most serious: Postgres compares the values that way. */
export const levelEnum = pgEnum('level', LEVELS);
export const levelOriginEnum = pgEnum('level_origin', LEVEL_ORIGINS);
export const incidentStateEnum = pgEnum('incident_state', INCIDENT_STATES);
export const incidentCloseCauseEnum = pgEnum('incident_close_cause', INCIDENT_CLOSE_CAUSES);
export const incidentDispatchMomentEnum = pgEnum(
  'incident_dispatch_moment',
  INCIDENT_DISPATCH_MOMENTS,
);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  publicKey: text('public_key').notNull().unique(),
  /** SHA-256 of the secret key: the key itself is never stored. */
  secretKeyHash: text('secret_key_hash').notNull().unique(),
  /** Origins (`https://example.com`) from which the public key is accepted, normalized. */
  allowedOrigins: text('allowed_origins').array().notNull().default([]),
  /** The Level of an Incident whose sender declared none. */
  defaultLevel: levelEnum('default_level').notNull().default(DEFAULT_LEVEL),
  /**
   * Seconds an Incident stays Open without a new Occurrence, unless the Occurrence sets
   * its own; `null`: the Instance default (`NUDGE_INCIDENT_QUIET_PERIOD_MS`).
   */
  quietPeriod: integer('quiet_period'),
  ...timestamps,
});

export const members = pgTable('members', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Lowercase: uniqueness does not depend on the case typed. */
  email: text('email').notNull().unique(),
  /** argon2id hash in PHC format; the password is never stored. */
  passwordHash: text('password_hash').notNull(),
  ...timestamps,
});

/** Dashboard session: the cookie carries the token, the database keeps only its SHA-256 hash. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_member_idx').on(t.memberId)],
);

/** Single-use invitation link; only the SHA-256 hash of the token is stored. */
export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(),
  createdBy: uuid('created_by').references(() => members.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  /** Set once the invitation has been used: it works only once. */
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  memberId: uuid('member_id').references(() => members.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const feedbacks = pgTable(
  'feedbacks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    state: feedbackStateEnum('state').notNull().default('received'),
    source: sourceEnum('source').notNull(),
    /** Raw text, stored as is (stripped of control characters). */
    text: text('text').notNull(),
    declaredType: feedbackTypeEnum('declared_type'),
    author: jsonb('author').$type<Author>(),
    authorTrust: authorTrustEnum('author_trust'),
    context: jsonb('context').$type<Context>().notNull().default({}),
    /** Times the sweep sent the Feedback, left Received, back to Triage (D18). */
    triageSweeps: integer('triage_sweeps').notNull().default(0),
    /**
     * When the sweep may look at the Feedback again if it is still Received; `null`: as
     * soon as it is past the sweep delay. Pushed back further at each re-Triage, so a
     * Feedback the Judge keeps refusing neither calls it without end nor takes the place
     * of the other Feedbacks left Received.
     */
    nextTriageSweepAt: timestamp('next_triage_sweep_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('feedbacks_project_created_at_idx').on(t.projectId, t.createdAt),
    // Inbox: across all Projects, newest first.
    index('feedbacks_created_at_id_idx').on(t.createdAt, t.id),
    // Sweep of the Feedbacks left Received, the ones due first.
    index('feedbacks_received_sweep_idx')
      .on(t.nextTriageSweepAt.asc().nullsFirst(), t.createdAt)
      .where(sql`${t.state} = 'received'`),
  ],
);

/**
 * An Incident: one row whatever the number of its Occurrences, which are not stored.
 * It keeps their counter, the first and last instants, and the first and last reports
 * in full, so the rows an Incident costs stay bounded whatever its sender does.
 */
export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    state: incidentStateEnum('state').notNull().default('open'),
    /** Declared by the sender, or derived from the Project, the title and the Environment. */
    fingerprint: text('fingerprint').notNull(),
    /** Title and Environment of the Occurrence that opened the Incident. */
    title: text('title').notNull(),
    environment: text('environment'),
    level: levelEnum('level').notNull(),
    levelOrigin: levelOriginEnum('level_origin').notNull(),
    /** Occurrences absorbed, the first one included. */
    occurrences: integer('occurrences').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    firstReport: jsonb('first_report').$type<IncidentReport>().notNull(),
    lastReport: jsonb('last_report').$type<IncidentReport>().notNull(),
    /**
     * The Quiet period the last Occurrence set, in seconds; `null`: the Project's
     * applies (failing that, the Instance default).
     */
    quietPeriod: integer('quiet_period'),
    /** Why and when it closed: set exactly when the Incident is Closed. */
    closeCause: incidentCloseCauseEnum('close_cause'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check(
      'incidents_closure',
      sql`(${t.state} = 'closed') = (${t.closedAt} is not null) and (${t.closedAt} is null) = (${t.closeCause} is null)`,
    ),
    // The sweep of the Open Incidents silent past their Quiet period.
    index('incidents_open_last_seen_at_idx')
      .on(t.lastSeenAt)
      .where(sql`${t.state} = 'open'`),
    // At most one Open Incident per (Project, Fingerprint): the Occurrence that matches it
    // is absorbed; one that matches only Closed Incidents opens a new one.
    uniqueIndex('incidents_open_fingerprint_uniq')
      .on(t.projectId, t.fingerprint)
      .where(sql`${t.state} = 'open'`),
    // A Project's Incident list, newest opened first.
    index('incidents_project_created_at_idx').on(t.projectId, t.createdAt, t.id),
  ],
);

/**
 * The Capture attached to a Feedback: the image lives in the Capture storage under
 * `key`, the database keeps only the reference. Deleting the Feedback deletes this row,
 * not the image: whoever deletes also deletes the image under `key` from the storage.
 */
export const captures = pgTable('captures', {
  feedbackId: uuid('feedback_id')
    .primaryKey()
    .references(() => feedbacks.id, { onDelete: 'cascade' }),
  key: text('key').notNull().unique(),
  contentType: text('content_type').$type<CaptureType>().notNull(),
  bytes: integer('bytes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const verdicts = pgTable('verdicts', {
  id: uuid('id').primaryKey().defaultRandom(),
  feedbackId: uuid('feedback_id')
    .notNull()
    .unique()
    .references(() => feedbacks.id, { onDelete: 'cascade' }),
  resolvedType: feedbackTypeEnum('resolved_type').notNull(),
  severity: severityEnum('severity'),
  junk: boolean('junk').notNull(),
  manipulation: boolean('manipulation').notNull(),
  uncertain: boolean('uncertain').notNull(),
  rawAnswers: jsonb('raw_answers').$type<TriageAnswers>(),
  ...timestamps,
});

export const destinations = pgTable('destinations', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Adapter key: `webhook`, `discord`, `linear`… */
  type: text('type').notNull(),
  /** Non-secret configuration of the adapter. */
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  /**
   * Secrets of the adapter (tokens, signing secret), as one JSON object encrypted with
   * the Instance key (`destinationSecretsContext`); `null`: no secret.
   */
  encryptedSecrets: text('encrypted_secrets'),
  /** Feedback Filter: on (`true`) or off, whatever the Types and Severity below… */
  filterEnabled: boolean('filter_enabled').notNull().default(true),
  /** … accepted Types… */
  filterTypes: feedbackTypeEnum('filter_types')
    .array()
    .notNull()
    .default([...FEEDBACK_TYPES]),
  /** … and optional minimum Severity (`null`: no requirement). */
  filterMinimumSeverity: severityEnum('filter_minimum_severity'),
  /**
   * Incident Filter: off by default, so a Destination receives no Incident until a
   * Member turns it on. Its minimum Level…
   */
  incidentFilterEnabled: boolean('incident_filter_enabled').notNull().default(false),
  incidentFilterMinimumLevel: levelEnum('incident_filter_minimum_level').notNull().default('info'),
  /** … accepted Environments (empty: every Environment, and none)… */
  incidentFilterEnvironments: text('incident_filter_environments').array().notNull().default([]),
  /** … and context conditions, all required. */
  incidentFilterConditions: jsonb('incident_filter_conditions')
    .$type<IncidentCondition[]>()
    .notNull()
    .default([]),
  state: destinationStateEnum('state').notNull().default('active'),
  /** Consecutive transient failures: reset by a delivery or a permanent failure. */
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  /** When it became Suspended; `null` while the Destination is active. */
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  /** What suspended it (`auth: HTTP 401…`); `null` while it is active. */
  suspensionReason: text('suspension_reason'),
  /** When the probe may test the Suspended Destination (end of the cooldown). */
  nextProbeAt: timestamp('next_probe_at', { withTimezone: true }),
  ...timestamps,
});

export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * What the Delivery delivers. Each subject has its own reference column, set exactly
     * when the Delivery is of that subject (`deliveries_subject_reference`); see
     * `subject.ts` for how a subject is written and matched.
     */
    subject: deliverySubjectEnum('subject').notNull(),
    /** The Feedback delivered, when `subject = 'feedback'`. */
    feedbackId: uuid('feedback_id').references(() => feedbacks.id, { onDelete: 'cascade' }),
    /** The Incident delivered, when `subject = 'incident'`… */
    incidentId: uuid('incident_id').references(() => incidents.id, { onDelete: 'cascade' }),
    /** … and the Dispatch moment that created the Delivery. */
    incidentMoment: incidentDispatchMomentEnum('incident_moment'),
    destinationId: uuid('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'cascade' }),
    status: deliveryStatusEnum('status').notNull().default('pending'),
    externalUrl: text('external_url'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    /**
     * Start of the current hold (`status = 'held'`), `null` otherwise: tells apart the
     * successive holds of the same Delivery, and so their release jobs.
     */
    heldAt: timestamp('held_at', { withTimezone: true }),
    /**
     * When a dispatch job took the pending Delivery to send it, `null` when none is
     * sending it: two jobs of the same Delivery (a sweep's and a late retry's) never
     * send it at the same time. A claim older than `DELIVERY_CLAIM_TTL_MS` belongs to a
     * job that died while sending; another job may take it over.
     */
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // A Delivery references its subject, and only its subject. Written with the `feedback`
    // value only: a migration cannot use an enum value it adds in the same transaction.
    check(
      'deliveries_subject_reference',
      sql`(${t.subject} = 'feedback') = (${t.feedbackId} is not null) and (${t.subject} = 'feedback') = (${t.incidentId} is null) and (${t.incidentId} is null) = (${t.incidentMoment} is null)`,
    ),
    // Idempotence: one Delivery per (subject, Destination) pair, one constraint per subject.
    unique('deliveries_feedback_destination_uniq').on(t.feedbackId, t.destinationId),
    unique('deliveries_incident_destination_uniq').on(t.incidentId, t.destinationId),
    // Release of the held Deliveries of a Destination that is active again.
    index('deliveries_held_idx')
      .on(t.destinationId)
      .where(sql`${t.status} = 'held'`),
  ],
);

/**
 * Instance settings (D6): a single row, `id = 1`, absent until something is
 * configured. The Judge chosen here takes precedence over the `NUDGE_JUDGE_*`
 * variables. Instance-level settings (Alert destination, retention period) are columns
 * of this same row.
 */
export const instanceSettings = pgTable(
  'instance_settings',
  {
    id: smallint('id').primaryKey().default(1),
    /** `null`: no Judge chosen for the Instance (falls back on the environment). */
    judgeProvider: judgeProviderEnum('judge_provider'),
    judgeModel: text('judge_model'),
    judgeBaseUrl: text('judge_base_url'),
    /** The Judge's API key, encrypted with the Instance key (`JUDGE_KEY_CONTEXT`). */
    judgeEncryptedKey: text('judge_encrypted_key'),
    /**
     * The Instance's Alert destination (`null`: none), served by the adapter of this
     * type, like a Project's Destination: non-secret configuration…
     */
    alertDestinationType: text('alert_destination_type'),
    alertDestinationConfig: jsonb('alert_destination_config').$type<Record<string, unknown>>(),
    /** … and secrets as one JSON object encrypted with the Instance key (`ALERT_DESTINATION_SECRETS_CONTEXT`). */
    alertDestinationEncryptedSecrets: text('alert_destination_encrypted_secrets'),
    /**
     * Retention period of Feedback, in days: the scheduled purge erases older Feedback
     * (and its Captures). `null`: unlimited retention.
     */
    retentionDays: integer('retention_days'),
    /**
     * The Instance's SMTP server (`null` host: none), used by the email Destinations;
     * the password is encrypted with the Instance key (`SMTP_PASSWORD_CONTEXT`).
     */
    smtpHost: text('smtp_host'),
    smtpPort: integer('smtp_port'),
    smtpSecurity: text('smtp_security').$type<SmtpSecurity>(),
    smtpUsername: text('smtp_username'),
    smtpEncryptedPassword: text('smtp_encrypted_password'),
    smtpFromAddress: text('smtp_from_address'),
    smtpFromName: text('smtp_from_name'),
    ...timestamps,
  },
  (t) => [
    check('instance_settings_single_row', sql`${t.id} = 1`),
    check('instance_settings_retention_positive', sql`${t.retentionDays} > 0`),
    check(
      'instance_settings_smtp_complete',
      sql`${t.smtpHost} is null or (${t.smtpPort} is not null and ${t.smtpSecurity} is not null and ${t.smtpFromAddress} is not null)`,
    ),
  ],
);

export const projectsRelations = relations(projects, ({ many }) => ({
  feedbacks: many(feedbacks),
  incidents: many(incidents),
  destinations: many(destinations),
}));

export const incidentsRelations = relations(incidents, ({ one, many }) => ({
  project: one(projects, { fields: [incidents.projectId], references: [projects.id] }),
  deliveries: many(deliveries),
}));

export const feedbacksRelations = relations(feedbacks, ({ one, many }) => ({
  project: one(projects, { fields: [feedbacks.projectId], references: [projects.id] }),
  verdict: one(verdicts),
  capture: one(captures),
  deliveries: many(deliveries),
}));

export const capturesRelations = relations(captures, ({ one }) => ({
  feedback: one(feedbacks, { fields: [captures.feedbackId], references: [feedbacks.id] }),
}));

export const verdictsRelations = relations(verdicts, ({ one }) => ({
  feedback: one(feedbacks, { fields: [verdicts.feedbackId], references: [feedbacks.id] }),
}));

export const destinationsRelations = relations(destinations, ({ one, many }) => ({
  project: one(projects, { fields: [destinations.projectId], references: [projects.id] }),
  deliveries: many(deliveries),
}));

export const deliveriesRelations = relations(deliveries, ({ one }) => ({
  feedback: one(feedbacks, { fields: [deliveries.feedbackId], references: [feedbacks.id] }),
  incident: one(incidents, { fields: [deliveries.incidentId], references: [incidents.id] }),
  destination: one(destinations, {
    fields: [deliveries.destinationId],
    references: [destinations.id],
  }),
}));
