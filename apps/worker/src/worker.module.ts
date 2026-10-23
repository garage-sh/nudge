import {
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  jobOptions,
  DISPATCH_QUEUE,
  TRIAGE_QUEUE,
  DEFAULT_QUEUE_PREFIX,
  type DispatchJob,
  type TriageJob,
} from '@nudge/core';
import { connectDb, type DbConnection } from '@nudge/database';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { DispatchProcessor } from './dispatch.processor.js';
import { DB, JUGE, OPTIONS, DISPATCH_QUEUE_TOKEN, DESTINATION_ADAPTER_RESOLVER } from './tokens.js';
import type { WorkerOptions } from './options.js';
import { TriageProcessor } from './triage.processor.js';

const DB_CONNECTION = Symbol('DB_CONNECTION');
const REDIS = Symbol('REDIS');

@Module({})
export class WorkerModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private workers: Worker[] = [];

  constructor(
    @Inject(OPTIONS) private readonly options: WorkerOptions,
    @Inject(DB_CONNECTION) private readonly connexion: DbConnection,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue,
    private readonly triage: TriageProcessor,
    private readonly dispatch: DispatchProcessor,
  ) {}

  static forRoot(options: WorkerOptions): DynamicModule {
    const prefix = options.queuePrefix ?? DEFAULT_QUEUE_PREFIX;
    return {
      module: WorkerModule,
      providers: [
        { provide: OPTIONS, useValue: options },
        { provide: JUGE, useValue: options.juge },
        { provide: DESTINATION_ADAPTER_RESOLVER, useValue: options.resolveDestinationAdapter },
        { provide: DB_CONNECTION, useFactory: () => connectDb(options.databaseUrl) },
        { provide: DB, useFactory: (c: DbConnection) => c.db, inject: [DB_CONNECTION] },
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
        TriageProcessor,
        DispatchProcessor,
      ],
    };
  }

  onApplicationBootstrap(): void {
    const prefix = this.options.queuePrefix ?? DEFAULT_QUEUE_PREFIX;
    this.workers = [
      new Worker<TriageJob>(TRIAGE_QUEUE, (job) => this.triage.handle(job.data), {
        connection: this.redis,
        prefix,
      }),
      new Worker<DispatchJob>(DISPATCH_QUEUE, (job) => this.dispatch.handle(job.data), {
        connection: this.redis,
        prefix,
      }),
    ];
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    await this.dispatchQueue.close();
    await this.redis.quit();
    await this.connexion.close();
  }
}
