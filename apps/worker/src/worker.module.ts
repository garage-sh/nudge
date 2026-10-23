import {
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  OPTIONS_JOB_PAR_DEFAUT,
  QUEUE_DISPATCH as NOM_QUEUE_DISPATCH,
  QUEUE_TRIAGE as NOM_QUEUE_TRIAGE,
  type JobDispatch,
  type JobTriage,
} from '@nudge/core';
import { connecterDb, type ConnexionDb } from '@nudge/database';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { DispatchProcessor } from './dispatch.processor.js';
import { DB, JUGE, OPTIONS, QUEUE_DISPATCH, RESOUDRE_ADAPTATEUR } from './jetons.js';
import type { OptionsWorker } from './options.js';
import { TriageProcessor } from './triage.processor.js';

const CONNEXION_DB = Symbol('CONNEXION_DB');
const REDIS = Symbol('REDIS');

@Module({})
export class WorkerModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private workers: Worker[] = [];

  constructor(
    @Inject(OPTIONS) private readonly options: OptionsWorker,
    @Inject(CONNEXION_DB) private readonly connexion: ConnexionDb,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(QUEUE_DISPATCH) private readonly queueDispatch: Queue,
    private readonly triage: TriageProcessor,
    private readonly dispatch: DispatchProcessor,
  ) {}

  static forRoot(options: OptionsWorker): DynamicModule {
    const prefix = options.prefixeQueues ?? 'nudge';
    return {
      module: WorkerModule,
      providers: [
        { provide: OPTIONS, useValue: options },
        { provide: JUGE, useValue: options.juge },
        { provide: RESOUDRE_ADAPTATEUR, useValue: options.resoudreAdaptateur },
        { provide: CONNEXION_DB, useFactory: () => connecterDb(options.databaseUrl) },
        { provide: DB, useFactory: (c: ConnexionDb) => c.db, inject: [CONNEXION_DB] },
        {
          provide: REDIS,
          useFactory: () => new Redis(options.redisUrl, { maxRetriesPerRequest: null }),
        },
        {
          provide: QUEUE_DISPATCH,
          useFactory: (redis: Redis) =>
            new Queue(NOM_QUEUE_DISPATCH, {
              connection: redis,
              prefix,
              defaultJobOptions: OPTIONS_JOB_PAR_DEFAUT,
            }),
          inject: [REDIS],
        },
        TriageProcessor,
        DispatchProcessor,
      ],
    };
  }

  onApplicationBootstrap(): void {
    const prefix = this.options.prefixeQueues ?? 'nudge';
    this.workers = [
      new Worker<JobTriage>(NOM_QUEUE_TRIAGE, (job) => this.triage.traiter(job.data), {
        connection: this.redis,
        prefix,
      }),
      new Worker<JobDispatch>(NOM_QUEUE_DISPATCH, (job) => this.dispatch.traiter(job.data), {
        connection: this.redis,
        prefix,
      }),
    ];
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    await this.queueDispatch.close();
    await this.redis.quit();
    await this.connexion.fermer();
  }
}
