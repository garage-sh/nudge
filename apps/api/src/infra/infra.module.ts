import { Inject, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import {
  createSecretCipher,
  DEFAULT_QUEUE_PREFIX,
  DISPATCH_QUEUE,
  INCIDENT_LEVEL_QUEUE,
  jobOptions,
  TRIAGE_QUEUE,
  type RetryPolicy,
} from '@nudge/core';
import { connectDb, type DbConnection } from '@nudge/database';
import type { CaptureStorage } from '@nudge/storage';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import {
  SECRET_CIPHER,
  DB,
  DISPATCH_QUEUE_TOKEN,
  INCIDENT_LEVEL_QUEUE_TOKEN,
  CAPTURE_STORAGE,
  TRIAGE_QUEUE_TOKEN,
} from './tokens.js';

export interface InfraOptions {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  /** BullMQ key prefix: isolates several Instances (or tests) on the same Redis. */
  readonly queuePrefix?: string;
  /** Retry of the triage and dispatch jobs; tests shorten it. */
  readonly retryPolicy?: RetryPolicy;
  /** Instance key (`NUDGE_ENCRYPTION_KEY`, 32 bytes in base64): encrypts the stored secrets. */
  readonly encryptionKey: string;
  /** Capture storage (`@nudge/storage`), the same as the worker's. */
  readonly captureStorage: CaptureStorage;
}

const DB_CONNECTION = Symbol('DB_CONNECTION');
const REDIS = Symbol('REDIS');

@Module({})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB_CONNECTION) private readonly connection: DbConnection,
    @Inject(TRIAGE_QUEUE_TOKEN) private readonly triageQueue: Queue,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue,
    @Inject(INCIDENT_LEVEL_QUEUE_TOKEN) private readonly incidentLevelQueue: Queue,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  static forRoot(options: InfraOptions): DynamicModule {
    const queue = (name: string) => ({
      useFactory: (redis: Redis) =>
        new Queue(name, {
          connection: redis,
          prefix: options.queuePrefix ?? DEFAULT_QUEUE_PREFIX,
          // The same options as the worker's: a replayed job is retried the same way.
          defaultJobOptions: jobOptions(options.retryPolicy),
        }),
      inject: [REDIS],
    });
    return {
      module: InfraModule,
      global: true,
      providers: [
        { provide: DB_CONNECTION, useFactory: () => connectDb(options.databaseUrl) },
        { provide: DB, useFactory: (c: DbConnection) => c.db, inject: [DB_CONNECTION] },
        { provide: SECRET_CIPHER, useFactory: () => createSecretCipher(options.encryptionKey) },
        { provide: CAPTURE_STORAGE, useValue: options.captureStorage },
        {
          provide: REDIS,
          useFactory: () => new Redis(options.redisUrl, { maxRetriesPerRequest: null }),
        },
        { provide: TRIAGE_QUEUE_TOKEN, ...queue(TRIAGE_QUEUE) },
        { provide: DISPATCH_QUEUE_TOKEN, ...queue(DISPATCH_QUEUE) },
        { provide: INCIDENT_LEVEL_QUEUE_TOKEN, ...queue(INCIDENT_LEVEL_QUEUE) },
      ],
      exports: [
        DB,
        TRIAGE_QUEUE_TOKEN,
        DISPATCH_QUEUE_TOKEN,
        INCIDENT_LEVEL_QUEUE_TOKEN,
        SECRET_CIPHER,
        CAPTURE_STORAGE,
      ],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([
      this.triageQueue.close(),
      this.dispatchQueue.close(),
      this.incidentLevelQueue.close(),
    ]);
    await this.redis.quit();
    await this.connection.close();
  }
}
