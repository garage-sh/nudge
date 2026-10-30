import {
  Inject,
  Module,
  type DynamicModule,
  type FactoryProvider,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  createSecretCipher,
  jobOptions,
  ALERTS_QUEUE,
  SWEEP_CAPTURES_JOB,
  SWEEP_QUIET_INCIDENTS_JOB,
  SWEEP_DELIVERIES_JOB,
  SWEEP_RECEIVED_JOB,
  PURGE_RETENTION_JOB,
  PROBE_SUSPENDED_JOB,
  DISPATCH_QUEUE,
  HELD_SUMMARY_QUEUE,
  INCIDENT_LEVEL_QUEUE,
  MAINTENANCE_QUEUE,
  TRIAGE_QUEUE,
  DEFAULT_QUEUE_PREFIX,
  alertJobId,
  type AlertJob,
  type DispatchJob,
  type HeldSummaryJob,
  type IncidentLevelJob,
  type TriageJob,
} from '@nudge/core';
import { connectDb, type DbConnection } from '@nudge/database';
import { Queue, Worker, type DefaultJobOptions, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { AlertsService } from './alerts.service.js';
import { DispatchProcessor } from './dispatch.processor.js';
import { FeedbackDispatcher } from './feedback-dispatcher.js';
import { HeldSummaryService } from './held-summary.service.js';
import { IncidentDispatcher } from './incident-dispatcher.js';
import { IncidentLevelProcessor } from './incident-level.processor.js';
import { PurgeProcessor } from './purge.processor.js';
import { SweepProcessor } from './sweep.processor.js';
import {
  ALERTS_QUEUE_TOKEN,
  DB,
  OPTIONS,
  SECRET_CIPHER,
  DISPATCH_QUEUE_TOKEN,
  DESTINATION_ADAPTER_RESOLVER,
  HELD_SUMMARY_QUEUE_TOKEN,
  INCIDENT_LEVEL_QUEUE_TOKEN,
  TRIAGE_QUEUE_TOKEN,
  ON_SUSPENSION,
} from './tokens.js';
import { JudgeResolver } from './judge-resolver.js';
import {
  DEFAULT_CAPTURE_SWEEP,
  DEFAULT_CONCURRENCY,
  DEFAULT_SWEEP,
  DEFAULT_PURGE,
  DEFAULT_SUSPENSION,
  incidentOptionsOf,
  type OnSuspension,
  type WorkerOptions,
} from './options.js';
import { SuspensionService } from './suspension.service.js';
import { TriageProcessor } from './triage.processor.js';

const DB_CONNECTION = Symbol('DB_CONNECTION');
const REDIS = Symbol('REDIS');
const MAINTENANCE_QUEUE_TOKEN = Symbol('MAINTENANCE_QUEUE');

/** A BullMQ queue on the worker's Redis connection, with its default job options. */
const queueProvider = (
  provide: symbol,
  name: string,
  prefix: string,
  defaultJobOptions: DefaultJobOptions,
): FactoryProvider<Queue> => ({
  provide,
  useFactory: (redis: Redis) => new Queue(name, { connection: redis, prefix, defaultJobOptions }),
  inject: [REDIS],
});

/** Fails like the first of `results` that failed, once all of them have settled. */
const rethrowFirstRejection = (results: readonly PromiseSettledResult<unknown>[]): void => {
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
};

/** BullMQ will not run this job again if it fails. */
const isLastAttempt = (job: Job): boolean => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

@Module({})
export class WorkerModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private workers: Worker[] = [];

  constructor(
    @Inject(OPTIONS) private readonly options: WorkerOptions,
    @Inject(DB_CONNECTION) private readonly connection: DbConnection,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue,
    @Inject(TRIAGE_QUEUE_TOKEN) private readonly triageQueue: Queue,
    @Inject(INCIDENT_LEVEL_QUEUE_TOKEN) private readonly incidentLevelQueue: Queue,
    @Inject(MAINTENANCE_QUEUE_TOKEN) private readonly maintenanceQueue: Queue,
    @Inject(ALERTS_QUEUE_TOKEN) private readonly alertsQueue: Queue,
    @Inject(HELD_SUMMARY_QUEUE_TOKEN) private readonly heldSummaryQueue: Queue,
    private readonly triage: TriageProcessor,
    private readonly dispatch: DispatchProcessor,
    private readonly incidentLevel: IncidentLevelProcessor,
    private readonly sweep: SweepProcessor,
    private readonly purge: PurgeProcessor,
    private readonly suspension: SuspensionService,
    private readonly alerts: AlertsService,
    private readonly heldSummaries: HeldSummaryService,
  ) {}

  static forRoot(options: WorkerOptions): DynamicModule {
    const prefix = options.queuePrefix ?? DEFAULT_QUEUE_PREFIX;
    return {
      module: WorkerModule,
      providers: [
        { provide: OPTIONS, useValue: options },
        { provide: DESTINATION_ADAPTER_RESOLVER, useValue: options.resolveDestinationAdapter },
        {
          provide: ON_SUSPENSION,
          // Every Suspension alerts the Members, then the observer from the options (tests).
          useFactory:
            (alerts: AlertsService): OnSuspension =>
            async (suspension) => {
              try {
                await alerts.raise({
                  event: 'destination_suspended',
                  destinationId: suspension.destinationId,
                  failureClass: suspension.failureClass,
                  message: suspension.message,
                  suspendedAt: suspension.suspendedAt.toISOString(),
                });
              } finally {
                await options.onSuspension?.(suspension);
              }
            },
          inject: [AlertsService],
        },
        { provide: DB_CONNECTION, useFactory: () => connectDb(options.databaseUrl) },
        { provide: DB, useFactory: (c: DbConnection) => c.db, inject: [DB_CONNECTION] },
        { provide: SECRET_CIPHER, useFactory: () => createSecretCipher(options.encryptionKey) },
        {
          provide: REDIS,
          useFactory: () => new Redis(options.redisUrl, { maxRetriesPerRequest: null }),
        },
        queueProvider(
          DISPATCH_QUEUE_TOKEN,
          DISPATCH_QUEUE,
          prefix,
          jobOptions(options.retryPolicy),
        ),
        queueProvider(TRIAGE_QUEUE_TOKEN, TRIAGE_QUEUE, prefix, jobOptions(options.retryPolicy)),
        queueProvider(
          INCIDENT_LEVEL_QUEUE_TOKEN,
          INCIDENT_LEVEL_QUEUE,
          prefix,
          jobOptions(options.retryPolicy),
        ),
        queueProvider(ALERTS_QUEUE_TOKEN, ALERTS_QUEUE, prefix, jobOptions(options.retryPolicy)),
        queueProvider(
          HELD_SUMMARY_QUEUE_TOKEN,
          HELD_SUMMARY_QUEUE,
          prefix,
          jobOptions(options.retryPolicy),
        ),
        queueProvider(MAINTENANCE_QUEUE_TOKEN, MAINTENANCE_QUEUE, prefix, {
          removeOnComplete: 100,
          removeOnFail: 1000,
        }),
        JudgeResolver,
        TriageProcessor,
        DispatchProcessor,
        FeedbackDispatcher,
        IncidentDispatcher,
        IncidentLevelProcessor,
        SweepProcessor,
        PurgeProcessor,
        SuspensionService,
        AlertsService,
        HeldSummaryService,
      ],
    };
  }

  async onApplicationBootstrap(): Promise<void> {
    const prefix = this.options.queuePrefix ?? DEFAULT_QUEUE_PREFIX;
    // Idempotent: several worker replicas share a single scheduler.
    const { intervalMs } = this.options.sweep ?? DEFAULT_SWEEP;
    await this.maintenanceQueue.upsertJobScheduler(
      SWEEP_RECEIVED_JOB,
      { every: intervalMs },
      { name: SWEEP_RECEIVED_JOB },
    );
    await this.maintenanceQueue.upsertJobScheduler(
      SWEEP_DELIVERIES_JOB,
      { every: intervalMs },
      { name: SWEEP_DELIVERIES_JOB },
    );
    const { probeIntervalMs } = this.options.suspension ?? DEFAULT_SUSPENSION;
    await this.maintenanceQueue.upsertJobScheduler(
      PROBE_SUSPENDED_JOB,
      { every: probeIntervalMs },
      { name: PROBE_SUSPENDED_JOB },
    );
    const purge = this.options.purge ?? DEFAULT_PURGE;
    await this.maintenanceQueue.upsertJobScheduler(
      PURGE_RETENTION_JOB,
      { every: purge.intervalMs },
      { name: PURGE_RETENTION_JOB },
    );
    const captureSweep = this.options.captureSweep ?? DEFAULT_CAPTURE_SWEEP;
    await this.maintenanceQueue.upsertJobScheduler(
      SWEEP_CAPTURES_JOB,
      { every: captureSweep.intervalMs },
      { name: SWEEP_CAPTURES_JOB },
    );
    const incidents = incidentOptionsOf(this.options);
    await this.maintenanceQueue.upsertJobScheduler(
      SWEEP_QUIET_INCIDENTS_JOB,
      { every: incidents.sweepIntervalMs },
      { name: SWEEP_QUIET_INCIDENTS_JOB },
    );
    const concurrency = this.options.concurrency ?? DEFAULT_CONCURRENCY;
    this.workers = [
      new Worker<TriageJob>(TRIAGE_QUEUE, (job) => this.triage.handle(job.data), {
        connection: this.redis,
        prefix,
        concurrency: concurrency.triage,
      }),
      new Worker<DispatchJob>(
        DISPATCH_QUEUE,
        (job) =>
          this.dispatch.handle(job.data, {
            lastAttempt: isLastAttempt(job),
          }),
        { connection: this.redis, prefix, concurrency: concurrency.dispatch },
      ),
      new Worker<IncidentLevelJob>(
        INCIDENT_LEVEL_QUEUE,
        (job) => this.incidentLevel.handle(job.data),
        { connection: this.redis, prefix, concurrency: concurrency.incidentLevel },
      ),
      new Worker<AlertJob>(
        ALERTS_QUEUE,
        (job) =>
          this.alerts.send(job.data, {
            id: job.id ?? alertJobId(job.data),
            raisedAt: new Date(job.timestamp),
            lastAttempt: isLastAttempt(job),
          }),
        { connection: this.redis, prefix },
      ),
      new Worker<HeldSummaryJob>(
        HELD_SUMMARY_QUEUE,
        (job) => this.heldSummaries.send(job.data, { lastAttempt: isLastAttempt(job) }),
        { connection: this.redis, prefix },
      ),
      new Worker(
        MAINTENANCE_QUEUE,
        async (job) => {
          if (job.name === SWEEP_RECEIVED_JOB) await this.sweep.sweepReceived();
          if (job.name === SWEEP_DELIVERIES_JOB) await this.sweep.sweepDeliveries();
          if (job.name === PROBE_SUSPENDED_JOB) await this.suspension.probe();
          if (job.name === PURGE_RETENTION_JOB) await this.purge.handle();
          if (job.name === SWEEP_CAPTURES_JOB) await this.sweep.sweepCaptures();
          if (job.name === SWEEP_QUIET_INCIDENTS_JOB) {
            // Independent: a failure of the one does not hold the other's Incidents.
            await Promise.allSettled([
              this.sweep.sweepQuietIncidents(),
              this.sweep.sweepIncidentLevels(),
              this.sweep.sweepStorms(),
            ]).then(rethrowFirstRejection);
          }
        },
        { connection: this.redis, prefix },
      ),
    ];
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    await Promise.all([
      this.dispatchQueue.close(),
      this.triageQueue.close(),
      this.incidentLevelQueue.close(),
      this.maintenanceQueue.close(),
      this.alertsQueue.close(),
      this.heldSummaryQueue.close(),
    ]);
    await this.redis.quit();
    await this.connection.close();
  }
}
