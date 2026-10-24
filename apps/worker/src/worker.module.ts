import {
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  createSecretCipher,
  jobOptions,
  ALERTES_QUEUE,
  BALAYAGE_RECUS_JOB,
  SONDE_SUSPENDUES_JOB,
  DISPATCH_QUEUE,
  MAINTENANCE_QUEUE,
  TRIAGE_QUEUE,
  DEFAULT_QUEUE_PREFIX,
  idJobAlerte,
  type AlerteJob,
  type DispatchJob,
  type TriageJob,
} from '@nudge/core';
import { connectDb, type DbConnection } from '@nudge/database';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { AlertesService } from './alertes.service.js';
import { BalayageProcessor } from './balayage.processor.js';
import { DispatchProcessor } from './dispatch.processor.js';
import {
  ALERTES_QUEUE_TOKEN,
  DB,
  OPTIONS,
  SECRET_CIPHER,
  DISPATCH_QUEUE_TOKEN,
  DESTINATION_ADAPTER_RESOLVER,
  TRIAGE_QUEUE_TOKEN,
  SUR_SUSPENSION,
} from './tokens.js';
import { JugeResolver } from './juge-resolver.js';
import {
  BALAYAGE_PAR_DEFAUT,
  SUSPENSION_PAR_DEFAUT,
  type SurSuspension,
  type WorkerOptions,
} from './options.js';
import { SuspensionService } from './suspension.service.js';
import { TriageProcessor } from './triage.processor.js';

const DB_CONNECTION = Symbol('DB_CONNECTION');
const REDIS = Symbol('REDIS');
const MAINTENANCE_QUEUE_TOKEN = Symbol('MAINTENANCE_QUEUE');

/** BullMQ ne relancera plus ce job s'il échoue. */
const derniereTentative = (job: Job): boolean => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

@Module({})
export class WorkerModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private workers: Worker[] = [];

  constructor(
    @Inject(OPTIONS) private readonly options: WorkerOptions,
    @Inject(DB_CONNECTION) private readonly connexion: DbConnection,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue,
    @Inject(TRIAGE_QUEUE_TOKEN) private readonly triageQueue: Queue,
    @Inject(MAINTENANCE_QUEUE_TOKEN) private readonly maintenanceQueue: Queue,
    @Inject(ALERTES_QUEUE_TOKEN) private readonly alertesQueue: Queue,
    private readonly triage: TriageProcessor,
    private readonly dispatch: DispatchProcessor,
    private readonly balayage: BalayageProcessor,
    private readonly suspension: SuspensionService,
    private readonly alertes: AlertesService,
  ) {}

  static forRoot(options: WorkerOptions): DynamicModule {
    const prefix = options.queuePrefix ?? DEFAULT_QUEUE_PREFIX;
    return {
      module: WorkerModule,
      providers: [
        { provide: OPTIONS, useValue: options },
        { provide: DESTINATION_ADAPTER_RESOLVER, useValue: options.resolveDestinationAdapter },
        {
          provide: SUR_SUSPENSION,
          // Chaque Suspension alerte les Membres, puis l'observateur des options (tests).
          useFactory:
            (alertes: AlertesService): SurSuspension =>
            async (suspension) => {
              try {
                await alertes.signaler({
                  evenement: 'destination_suspendue',
                  destinationId: suspension.destinationId,
                  classe: suspension.classe,
                  message: suspension.message,
                  suspendueLe: suspension.suspendueLe.toISOString(),
                });
              } finally {
                await options.surSuspension?.(suspension);
              }
            },
          inject: [AlertesService],
        },
        { provide: DB_CONNECTION, useFactory: () => connectDb(options.databaseUrl) },
        { provide: DB, useFactory: (c: DbConnection) => c.db, inject: [DB_CONNECTION] },
        { provide: SECRET_CIPHER, useFactory: () => createSecretCipher(options.cleChiffrement) },
        {
          provide: REDIS,
          useFactory: () => new Redis(options.redisUrl, { maxRetriesPerRequest: null }),
        },
        {
          provide: DISPATCH_QUEUE_TOKEN,
          useFactory: (redis: Redis) =>
            new Queue(DISPATCH_QUEUE, {
              connection: redis,
              prefix,
              defaultJobOptions: jobOptions(options.retryPolicy),
            }),
          inject: [REDIS],
        },
        {
          provide: TRIAGE_QUEUE_TOKEN,
          useFactory: (redis: Redis) =>
            new Queue(TRIAGE_QUEUE, {
              connection: redis,
              prefix,
              defaultJobOptions: jobOptions(options.retryPolicy),
            }),
          inject: [REDIS],
        },
        {
          provide: ALERTES_QUEUE_TOKEN,
          useFactory: (redis: Redis) =>
            new Queue(ALERTES_QUEUE, {
              connection: redis,
              prefix,
              defaultJobOptions: jobOptions(options.retryPolicy),
            }),
          inject: [REDIS],
        },
        {
          provide: MAINTENANCE_QUEUE_TOKEN,
          useFactory: (redis: Redis) =>
            new Queue(MAINTENANCE_QUEUE, {
              connection: redis,
              prefix,
              defaultJobOptions: { removeOnComplete: 100, removeOnFail: 1000 },
            }),
          inject: [REDIS],
        },
        JugeResolver,
        TriageProcessor,
        DispatchProcessor,
        BalayageProcessor,
        SuspensionService,
        AlertesService,
      ],
    };
  }

  async onApplicationBootstrap(): Promise<void> {
    const prefix = this.options.queuePrefix ?? DEFAULT_QUEUE_PREFIX;
    // Idempotent : plusieurs répliques du worker partagent un seul planificateur.
    const { intervalleMs } = this.options.balayage ?? BALAYAGE_PAR_DEFAUT;
    await this.maintenanceQueue.upsertJobScheduler(
      BALAYAGE_RECUS_JOB,
      { every: intervalleMs },
      { name: BALAYAGE_RECUS_JOB },
    );
    const { intervalleSondeMs } = this.options.suspension ?? SUSPENSION_PAR_DEFAUT;
    await this.maintenanceQueue.upsertJobScheduler(
      SONDE_SUSPENDUES_JOB,
      { every: intervalleSondeMs },
      { name: SONDE_SUSPENDUES_JOB },
    );
    this.workers = [
      new Worker<TriageJob>(TRIAGE_QUEUE, (job) => this.triage.handle(job.data), {
        connection: this.redis,
        prefix,
      }),
      new Worker<DispatchJob>(
        DISPATCH_QUEUE,
        (job) =>
          this.dispatch.handle(job.data, {
            derniereTentative: derniereTentative(job),
          }),
        { connection: this.redis, prefix },
      ),
      new Worker<AlerteJob>(
        ALERTES_QUEUE,
        (job) =>
          this.alertes.envoyer(job.data, {
            id: job.id ?? idJobAlerte(job.data),
            signaleLe: new Date(job.timestamp),
            derniereTentative: derniereTentative(job),
          }),
        { connection: this.redis, prefix },
      ),
      new Worker(
        MAINTENANCE_QUEUE,
        async (job) => {
          if (job.name === BALAYAGE_RECUS_JOB) await this.balayage.handle();
          if (job.name === SONDE_SUSPENDUES_JOB) await this.suspension.sonder();
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
      this.maintenanceQueue.close(),
      this.alertesQueue.close(),
    ]);
    await this.redis.quit();
    await this.connexion.close();
  }
}
