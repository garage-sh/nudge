import type { TriageAnswers } from '@nudge/core';
import {
  AUTHOR_TRUST_LEVELS,
  DELIVERY_STATUSES,
  DESTINATION_STATES,
  FEEDBACK_STATES,
  FEEDBACK_TYPES,
  JUDGE_PROVIDERS,
  SEVERITIES,
  SOURCES,
  type Author,
  type SmtpSecurity,
  type CaptureType,
  type Context,
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
  uuid,
} from 'drizzle-orm/pg-core';

export const feedbackTypeEnum = pgEnum('feedback_type', FEEDBACK_TYPES);
export const severityEnum = pgEnum('severity', SEVERITIES);
export const sourceEnum = pgEnum('feedback_source', SOURCES);
export const feedbackStateEnum = pgEnum('feedback_state', FEEDBACK_STATES);
export const authorTrustEnum = pgEnum('author_trust', AUTHOR_TRUST_LEVELS);
export const destinationStateEnum = pgEnum('destination_state', DESTINATION_STATES);
export const deliveryStatusEnum = pgEnum('delivery_status', DELIVERY_STATUSES);
export const judgeProviderEnum = pgEnum('judge_provider', JUDGE_PROVIDERS);

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
  /** Filter: accepted Types… */
  filterTypes: feedbackTypeEnum('filter_types')
    .array()
    .notNull()
    .default([...FEEDBACK_TYPES]),
  /** … and optional minimum Severity (`null`: no requirement). */
  filterMinimumSeverity: severityEnum('filter_minimum_severity'),
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
    feedbackId: uuid('feedback_id')
      .notNull()
      .references(() => feedbacks.id, { onDelete: 'cascade' }),
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
    // Idempotence: one Delivery per (Feedback, Destination) pair.
    unique('deliveries_feedback_destination_uniq').on(t.feedbackId, t.destinationId),
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
  destinations: many(destinations),
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
  destination: one(destinations, {
    fields: [deliveries.destinationId],
    references: [destinations.id],
  }),
}));
