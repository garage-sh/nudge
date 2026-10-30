import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi, deriveSetupToken, type WidgetLimits, type TrustProxy } from '@nudge/api';
import {
  createSecretCipher,
  DISPATCH_QUEUE,
  INCIDENT_LEVEL_QUEUE,
  jobOptions,
  TRIAGE_QUEUE,
  type ReviewAction,
  type DestinationAdapterResolver,
  type Filter,
  type IncidentFilter,
  type ReviewResult,
  type TriageThresholds,
} from '@nudge/core';
import {
  encryptDestinationSecrets,
  connectDb,
  createDestination,
  ALERT_DESTINATION_ID,
  createProject,
  destinations,
  deliveries,
  instanceSettings,
  readFeedback,
  feedbacks,
  incidents,
  runMigrations,
  undoReview,
  type Db,
  type DestinationRow,
  type Project,
  type LoadedFeedback,
  type OpeningCap,
} from '@nudge/database';
import type { JudgeConfig } from '@nudge/judge';
import { destinationAdapterResolver, guardedFetch } from '@nudge/destinations';
import type { FeedbackState, FeedbackInput, IncidentInput } from '@nudge/shared';
import { diskStorage, type CaptureStorage } from '@nudge/storage';
import {
  createWorker,
  type CaptureSweepOptions,
  type ConcurrencyOptions,
  type IncidentOptions,
  type SweepOptions,
  type PurgeOptions,
  type SuspensionOptions,
  type Suspension,
} from '@nudge/worker';
import { Queue, QueueEvents } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { Client } from 'pg';
import { inject } from 'vitest';
import { DashboardClient } from './dashboard-client.js';
import { FakeDestination } from './fake-destination.js';
import { FakeJudge } from './fake-judge.js';
import { FakeMailer } from './fake-mailer.js';

export interface PipelineOptions {
  /**
   * `null`: worker in degraded mode, without a Judge. `'instance'`: the Judge chosen for
   * the Instance (settings in the database, then `defaultJudge`), as in production.
   * By default, a `FakeJudge`.
   */
  readonly judge?: FakeJudge | null | 'instance';
  /** With `judge: 'instance'`: the Judge of the `NUDGE_JUDGE_*` variables. */
  readonly defaultJudge?: JudgeConfig;
  /** Thresholds of the worker's Verdict policy; the default ones otherwise. */
  readonly triageThresholds?: TriageThresholds;
  /** How long the Judge may take to answer before abort and retry; the worker's otherwise. */
  readonly judgeTimeoutMs?: number;
  /** Sweep of Feedback left Received; the worker's (5 min) otherwise. */
  readonly sweep?: SweepOptions;
  /**
   * `'real'`: the adapters of `@nudge/destinations` (webhook…), against real
   * receivers. By default, each Destination is served by its `FakeDestination`.
   */
  readonly destinations?: 'fakes' | 'real';
  /**
   * With `destinations: 'real'`: the HTTP client of the adapters, in place of the guarded
   * one — a recorded target (Discord, Slack) whose fixed host a test cannot reach.
   */
  readonly adapterFetch?: typeof globalThis.fetch;
  /**
   * Internal hosts the real adapters and the Instance's Judge may reach
   * (`NUDGE_OUTBOUND_ALLOWED_HOSTS`): by default `127.0.0.1`, where the test receivers
   * and servers listen.
   */
  readonly outboundAllowedHosts?: readonly string[];
  /** Suspension threshold, cooldown and probe; the worker's otherwise. */
  readonly suspension?: SuspensionOptions;
  /** Public URL of the dashboard (`NUDGE_DASHBOARD_URL`): links in Deliveries and alerts. */
  readonly dashboardUrl?: string;
  /** Worker replicas on the same queues and the same database (1 by default). */
  readonly workerReplicas?: number;
  /** Ingestion rate limit per public key; the api's otherwise. */
  readonly widgetLimits?: WidgetLimits;
  /** The api's `trust proxy` setting (`NUDGE_TRUST_PROXY`); no proxy otherwise. */
  readonly trustProxy?: TrustProxy;
  /**
   * Capture storage, shared by the api and the worker; by default, a local disk
   * in a temporary dir owned by the pipeline, removed on stop.
   */
  readonly storage?: CaptureStorage;
  /** Period of the retention purge; the worker's otherwise. */
  readonly purge?: PurgeOptions;
  /**
   * The api's `NUDGE_SETUP_TOKEN`; by default none, the api derives the token from the
   * Instance key, as in production.
   */
  readonly setupToken?: string;
  /** Sweep of the orphaned Captures; the worker's (hourly) otherwise. */
  readonly captureSweep?: CaptureSweepOptions;
  /** Jobs each worker runs at the same time; the worker's otherwise. */
  readonly concurrency?: ConcurrencyOptions;
  /** Instance default Quiet period and its sweep; the worker's (1 h, every minute) otherwise. */
  readonly incidents?: IncidentOptions;
  /**
   * The api's Instance Opening cap and its window; the api's (20 per minute) otherwise.
   * Pass the same window to `incidents.openingWindowMs`, which ends the storms.
   */
  readonly openingCap?: OpeningCap;
}

export interface Pipeline {
  /** Base URL of the started api. */
  readonly url: string;
  /** The token `POST /api/setup` requires, as the api prints it in its logs. */
  readonly setupToken: string;
  /** The Judge plugged into the worker (throws if the pipeline runs without a Judge). */
  readonly judge: FakeJudge;
  /**
   * The `FakeDestination` that serves the Instance's Alert destination, whatever
   * type the dashboard configured (`PUT /api/instance/alert-destination`).
   */
  readonly fakeAlert: FakeDestination;
  /** Every switch of a Destination to Suspended reported by the worker, in order. */
  readonly suspensions: readonly Suspension[];
  /** The Instance's SMTP server: the emails sent, by the email Destinations and the api. */
  readonly mailer: FakeMailer;
  /** The pipeline's database, for a test that orders transactions of the data layer itself. */
  readonly db: Db;
  /** The Project is created directly in the database (seed); its keys are returned in clear. */
  createProject(data: {
    name: string;
    description?: string | null;
    allowedOrigins?: readonly string[];
  }): Promise<{ project: Project; publicKey: string; secretKey: string }>;
  /**
   * A Destination of the Project created directly in the database (seed), served by
   * its own `FakeDestination`. Without a Filter, it accepts every Triaged Feedback;
   * without an Incident Filter, it receives no Incident (`null`: the Filter is off).
   */
  createDestination(
    projectId: string,
    data?: {
      name?: string;
      config?: Record<string, unknown>;
      filter?: Filter | null;
      incidentFilter?: IncidentFilter | null;
    },
  ): Promise<{ destination: DestinationRow; fake: FakeDestination }>;
  /** The `FakeDestination` that serves this Destination (created by the dashboard, for example). */
  fakeDestination(destinationId: string): FakeDestination;
  /** A Destination's row as stored (encrypted secrets), or `null`. */
  destinationRow(destinationId: string): Promise<DestinationRow | null>;
  /**
   * Encrypts a Destination's secrets with another Instance key: they no longer
   * decrypt, as after a change of `NUDGE_ENCRYPTION_KEY`.
   */
  makeSecretsUndecryptable(destinationId: string): Promise<void>;
  /**
   * Suspends a Destination as after its credentials were refused, without any
   * outgoing call; the probe does not test it for an hour.
   */
  suspend(destinationId: string): Promise<void>;
  /**
   * Sets a Suspended Destination back to active without releasing its held Deliveries,
   * like a worker stopped between the reactivation and the re-enqueue.
   */
  reactivateWithoutReleasing(destinationId: string): Promise<void>;
  /** An anonymous browser on the dashboard API (it keeps its session cookie). */
  dashboard(): DashboardClient;
  /**
   * A signed-in browser: the first call creates the first Member through the
   * setup, the next ones sign in with its credentials (`DEFAULT_MEMBER`).
   */
  signIn(): Promise<DashboardClient>;
  /**
   * Records a Received Feedback without enqueuing it, as if the enqueue had failed
   * after the insert. Returns its id.
   */
  insertFeedbackWithoutTriage(projectId: string, data: { text: string }): Promise<string>;
  /**
   * Records a pending Delivery of the Feedback to the Destination without enqueuing it,
   * as if Redis had gone down between the commit and the enqueue. Returns its id.
   */
  insertDeliveryWithoutDispatch(feedbackId: string, destinationId: string): Promise<string>;
  /** Moves a Feedback's creation date back by `days` days, as if it were old. */
  ageFeedback(feedbackId: string, days: number): Promise<void>;
  /**
   * Moves every instant of an Incident (opened, first and last seen, closed) back by
   * `days` days, as if its Occurrences were that old.
   */
  ageIncident(incidentId: string, days: number): Promise<void>;
  /** POST /v1/feedbacks with the Project's secret key. */
  postFeedback(secretKey: string, body: FeedbackInput | Record<string, unknown>): Promise<Response>;
  /** POST /v1/incidents with the Project's secret key: one Occurrence. */
  postIncident(secretKey: string, body: IncidentInput | Record<string, unknown>): Promise<Response>;
  /**
   * POST /v1/feedbacks with the Project's public key, like the Widget from a page
   * of origin `origin` (`null`: without an Origin header).
   */
  postWidgetFeedback(
    publicKey: string,
    origin: string | null,
    body: FeedbackInput | Record<string, unknown>,
  ): Promise<Response>;
  /**
   * Review transition (approve, reject, reinstate) as the dashboard triggers it:
   * `POST /api/feedbacks/:id/review`, by the Member of `signIn()`.
   */
  review(feedbackId: string, action: ReviewAction): Promise<ReviewResult>;
  /** Undoes a review transition, as the api does when queueing its job fails. */
  undoReview(feedbackId: string, action: ReviewAction): Promise<void>;
  /**
   * Re-enqueues a Feedback's Triage job (new job id, like a replayed job) and
   * waits until it is processed.
   */
  replayTriage(feedbackId: string): Promise<void>;
  /** Re-enqueues a Delivery's Dispatch job and waits until it is processed. */
  replayDispatch(deliveryId: string): Promise<void>;
  /** Enqueues one more Dispatch job of a Delivery (new job id), without waiting for it. */
  enqueueDispatch(deliveryId: string): Promise<void>;
  /**
   * Makes every enqueue into queue `name` fail (the api's as well as the worker's), like
   * a Redis that refuses writes. Returns the function that repairs it.
   */
  breakEnqueue(
    name: typeof TRIAGE_QUEUE | typeof DISPATCH_QUEUE | typeof INCIDENT_LEVEL_QUEUE,
  ): Promise<() => Promise<void>>;
  /** The instance settings row as stored (encrypted secrets), or `null`. */
  instanceSettings(): Promise<typeof instanceSettings.$inferSelect | null>;
  /** The Feedback as a Member reads it (state, Verdict, Deliveries), or `null`. */
  readFeedback(id: string): Promise<LoadedFeedback | null>;
  /** Waits until the Feedback satisfies `condition` (5 s by default) and returns it. */
  waitForFeedback(
    id: string,
    condition: (feedback: LoadedFeedback) => boolean,
    timeoutMs?: number,
  ): Promise<LoadedFeedback>;
  stop(): Promise<void>;
}

/** Credentials of the Member that `signIn()` creates at setup. */
export const DEFAULT_MEMBER = {
  email: 'first@nudge.test',
  password: 'first-member-password',
} as const;

/**
 * `pool.end()` returns before the sockets are closed: an immediate
 * `DROP … WITH (FORCE)` would cut connections being closed (uncaught error
 * on the `pg` side). A plain DROP is retried while the database is still
 * "in use" (55006).
 */
async function dropDatabase(admin: Client, dbName: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== '55006') throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Database ${dbName} still in use after the pipeline stopped`);
}

/**
 * Starts a real, isolated pipeline: a fresh migrated Postgres database, its own
 * queue prefix, the api (listening on a free port) and the worker.
 */
export async function startPipeline(options: PipelineOptions = {}): Promise<Pipeline> {
  const suffix = randomUUID().replaceAll('-', '');
  const dbName = `nudge_${suffix}`;
  const adminUrl = inject('postgresUrl');
  const redisUrl = inject('redisUrl');

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${dbName}`;
  await runMigrations(databaseUrl.toString());

  const judge = options.judge === undefined ? new FakeJudge() : options.judge;
  const fakeJudge = judge === 'instance' ? null : judge;
  const fakes = new Map<string, FakeDestination>();
  const fakeFor = (destinationId: string) => {
    let fake = fakes.get(destinationId);
    if (!fake) {
      fake = new FakeDestination();
      fakes.set(destinationId, fake);
    }
    return fake;
  };

  const capturesDir = await mkdtemp(join(tmpdir(), 'nudge-captures-'));
  const captureStorage = options.storage ?? diskStorage(capturesDir);
  const suspensions: Suspension[] = [];
  const encryptionKey = randomBytes(32).toString('base64');
  const cipher = createSecretCipher(encryptionKey);
  const outboundFetch = guardedFetch({
    allowedHosts: options.outboundAllowedHosts ?? ['127.0.0.1'],
  });
  const mailer = new FakeMailer();
  const resolveDestinationAdapter: DestinationAdapterResolver =
    options.destinations === 'real'
      ? destinationAdapterResolver({ fetch: options.adapterFetch ?? outboundFetch, mailer })
      : (destination) => fakeFor(destination.id);
  const infra = {
    databaseUrl: databaseUrl.toString(),
    redisUrl,
    queuePrefix: `nudge-test-${suffix}`,
    encryptionKey,
    // Fast retries: transient-failure tests stay short.
    retryPolicy: { attempts: 8, backoffDelayMs: 10 },
    logger: ['error', 'warn'] as ('error' | 'warn')[],
    captureStorage,
  };
  const workerOptions = {
    ...infra,
    ...(judge === 'instance'
      ? { defaultJudge: options.defaultJudge ?? null, outboundFetch }
      : { judge }),
    ...(options.triageThresholds ? { triageThresholds: options.triageThresholds } : {}),
    ...(options.judgeTimeoutMs ? { judgeTimeoutMs: options.judgeTimeoutMs } : {}),
    ...(options.sweep ? { sweep: options.sweep } : {}),
    ...(options.suspension ? { suspension: options.suspension } : {}),
    ...(options.purge ? { purge: options.purge } : {}),
    ...(options.captureSweep ? { captureSweep: options.captureSweep } : {}),
    ...(options.concurrency ? { concurrency: options.concurrency } : {}),
    ...(options.incidents ? { incidents: options.incidents } : {}),
    ...(options.dashboardUrl ? { dashboardUrl: options.dashboardUrl } : {}),
    onSuspension: (suspension) => {
      suspensions.push(suspension);
    },
    resolveDestinationAdapter,
  } satisfies Parameters<typeof createWorker>[0];
  const workers = await Promise.all(
    Array.from({ length: options.workerReplicas ?? 1 }, () => createWorker(workerOptions)),
  );
  const api = await createApi({
    ...infra,
    sessionCookieSecure: false,
    resolveDestinationAdapter,
    mailer,
    ...(options.widgetLimits ? { widgetLimits: options.widgetLimits } : {}),
    ...(options.openingCap ? { openingCap: options.openingCap } : {}),
    ...(options.trustProxy !== undefined ? { trustProxy: options.trustProxy } : {}),
    ...(options.setupToken ? { setupToken: options.setupToken } : {}),
  });
  await api.listen(0, '127.0.0.1');
  const url = await api.getUrl();
  const { db, close } = connectDb(databaseUrl.toString());
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queues = {
    [TRIAGE_QUEUE]: new Queue(TRIAGE_QUEUE, { connection: redis, prefix: infra.queuePrefix }),
    [DISPATCH_QUEUE]: new Queue(DISPATCH_QUEUE, { connection: redis, prefix: infra.queuePrefix }),
  };
  const replay = async (name: typeof TRIAGE_QUEUE | typeof DISPATCH_QUEUE, data: object) => {
    const events = new QueueEvents(name, {
      connection: { host: redis.options.host, port: redis.options.port },
      prefix: infra.queuePrefix,
    });
    try {
      await events.waitUntilReady();
      const job = await queues[name].add(name, data, { jobId: `replay-${randomUUID()}` });
      await job.waitUntilFinished(events, 10_000);
    } finally {
      await events.close();
    }
  };

  let member: DashboardClient | undefined;
  const setupToken = options.setupToken ?? deriveSetupToken(encryptionKey);
  const pipeline: Pipeline = {
    url,
    setupToken,
    get judge() {
      if (!fakeJudge) throw new Error('This pipeline runs without a FakeJudge');
      return fakeJudge;
    },
    fakeAlert: fakeFor(ALERT_DESTINATION_ID),
    suspensions,
    mailer,
    db,
    createProject: (data) => createProject(db, data),
    async createDestination(projectId, data = {}) {
      const destination = await createDestination(db, cipher, {
        projectId,
        name: data.name ?? 'Test destination',
        type: 'fake',
        config: data.config ?? {},
        ...(data.filter !== undefined ? { filter: data.filter } : {}),
        incidentFilter: data.incidentFilter ?? null,
      });
      return { destination, fake: fakeFor(destination.id) };
    },
    fakeDestination: fakeFor,
    async destinationRow(destinationId) {
      const [row] = await db.select().from(destinations).where(eq(destinations.id, destinationId));
      return row ?? null;
    },
    async makeSecretsUndecryptable(destinationId) {
      const otherKey = createSecretCipher(randomBytes(32).toString('base64'));
      await db
        .update(destinations)
        .set({
          encryptedSecrets: encryptDestinationSecrets(otherKey, destinationId, { lost: 'x' }),
        })
        .where(eq(destinations.id, destinationId));
    },
    async suspend(destinationId) {
      await db
        .update(destinations)
        .set({
          state: 'suspended',
          suspendedAt: sql`now()`,
          suspensionReason: 'auth: suspended by the test',
          nextProbeAt: sql`now() + interval '1 hour'`,
        })
        .where(eq(destinations.id, destinationId));
    },
    async reactivateWithoutReleasing(destinationId) {
      await db
        .update(destinations)
        .set({ state: 'active', suspendedAt: null, suspensionReason: null, nextProbeAt: null })
        .where(eq(destinations.id, destinationId));
    },
    dashboard: () => new DashboardClient(url),
    async signIn() {
      const client = new DashboardClient(url);
      const setup = await client.post('/api/setup', { ...DEFAULT_MEMBER, setupToken });
      if (setup.status === 201) return client;
      const session = await client.post('/api/session', DEFAULT_MEMBER);
      if (session.status !== 200) {
        throw new Error(`signIn: sign-in refused (${session.status})`);
      }
      return client;
    },
    async insertFeedbackWithoutTriage(projectId, { text }) {
      const [feedback] = await db
        .insert(feedbacks)
        .values({ projectId, source: 'api', text })
        .returning({ id: feedbacks.id });
      if (!feedback) throw new Error('Feedback not recorded');
      return feedback.id;
    },
    async insertDeliveryWithoutDispatch(feedbackId, destinationId) {
      const [delivery] = await db
        .insert(deliveries)
        .values({ subject: 'feedback', feedbackId, destinationId })
        .returning({ id: deliveries.id });
      if (!delivery) throw new Error('Delivery not recorded');
      return delivery.id;
    },
    async ageFeedback(feedbackId, days) {
      await db
        .update(feedbacks)
        .set({ createdAt: sql`${feedbacks.createdAt} - make_interval(days => ${days})` })
        .where(eq(feedbacks.id, feedbackId));
    },
    async ageIncident(incidentId, days) {
      const back = sql`make_interval(days => ${days})`;
      await db
        .update(incidents)
        .set({
          createdAt: sql`${incidents.createdAt} - ${back}`,
          updatedAt: sql`${incidents.updatedAt} - ${back}`,
          firstSeenAt: sql`${incidents.firstSeenAt} - ${back}`,
          lastSeenAt: sql`${incidents.lastSeenAt} - ${back}`,
          closedAt: sql`${incidents.closedAt} - ${back}`,
        })
        .where(eq(incidents.id, incidentId));
    },
    postFeedback: (secretKey, body) =>
      fetch(`${url}/v1/feedbacks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secretKey}` },
        body: JSON.stringify(body),
      }),
    postIncident: (secretKey, body) =>
      fetch(`${url}/v1/incidents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secretKey}` },
        body: JSON.stringify(body),
      }),
    postWidgetFeedback: (publicKey, origin, body) =>
      fetch(`${url}/v1/feedbacks`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${publicKey}`,
          ...(origin ? { origin } : {}),
        },
        body: JSON.stringify(body),
      }),
    async review(feedbackId, action) {
      member ??= await pipeline.signIn();
      const { status, body } = await member.post<{ state: FeedbackState }>(
        `/api/feedbacks/${feedbackId}/review`,
        { action },
      );
      if (status === 200) return { status: 'applied', state: body.state };
      if (status === 409) return { status: 'refused', state: body.state };
      if (status === 404) return { status: 'not_found' };
      throw new Error(`review: unexpected response ${status} ${JSON.stringify(body)}`);
    },
    undoReview: (feedbackId, action) => undoReview(db, feedbackId, action),
    replayTriage: (feedbackId) => replay(TRIAGE_QUEUE, { feedbackId }),
    replayDispatch: (deliveryId) => replay(DISPATCH_QUEUE, { deliveryId }),
    async enqueueDispatch(deliveryId) {
      await queues[DISPATCH_QUEUE].add(
        DISPATCH_QUEUE,
        { deliveryId },
        { jobId: `extra-${randomUUID()}`, ...jobOptions(infra.retryPolicy) },
      );
    },
    async breakEnqueue(name) {
      // Each job add increments the queue's `id` counter: when it is not numeric, the
      // add fails before any write.
      const counter = `${infra.queuePrefix}:${name}:id`;
      await redis.set(counter, 'broken');
      return async () => {
        await redis.del(counter);
      };
    },
    async instanceSettings() {
      const [row] = await db.select().from(instanceSettings);
      return row ?? null;
    },
    readFeedback: (id) => readFeedback(db, id),
    async waitForFeedback(id, condition, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      let last: LoadedFeedback | null = null;
      while (Date.now() < deadline) {
        last = await readFeedback(db, id);
        if (last && condition(last)) return last;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(
        `Feedback ${id}: condition not met within ${timeoutMs} ms. Last state read: ${JSON.stringify(last, null, 2)}`,
      );
    },
    async stop() {
      await api.close();
      await Promise.all(workers.map((worker) => worker.close()));
      await Promise.all(Object.values(queues).map((queue) => queue.close()));
      await redis.quit();
      await close();
      await dropDatabase(admin, dbName);
      await admin.end();
      await rm(capturesDir, { recursive: true, force: true });
    },
  };
  return pipeline;
}
