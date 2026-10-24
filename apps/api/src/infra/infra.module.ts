import { Inject, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import {
  createSecretCipher,
  DEFAULT_QUEUE_PREFIX,
  jobOptions,
  TRIAGE_QUEUE,
  type RetryPolicy,
} from '@nudge/core';
import { connectDb, type DbConnection } from '@nudge/database';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { SECRET_CIPHER, DB, TRIAGE_QUEUE_TOKEN } from './tokens.js';

export interface InfraOptions {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  /** Préfixe des clés BullMQ : isole plusieurs Instances (ou tests) sur un même Redis. */
  readonly queuePrefix?: string;
  /** Retry des jobs de triage ; les tests le raccourcissent. */
  readonly retryPolicy?: RetryPolicy;
  /** Clé d'Instance (`NUDGE_ENCRYPTION_KEY`, 32 octets en base64) : chiffre les secrets stockés. */
  readonly cleChiffrement: string;
}

const DB_CONNECTION = Symbol('DB_CONNECTION');
const REDIS = Symbol('REDIS');

@Module({})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB_CONNECTION) private readonly connexion: DbConnection,
    @Inject(TRIAGE_QUEUE_TOKEN) private readonly triageQueue: Queue,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  static forRoot(options: InfraOptions): DynamicModule {
    return {
      module: InfraModule,
      global: true,
      providers: [
        { provide: DB_CONNECTION, useFactory: () => connectDb(options.databaseUrl) },
        { provide: DB, useFactory: (c: DbConnection) => c.db, inject: [DB_CONNECTION] },
        { provide: SECRET_CIPHER, useFactory: () => createSecretCipher(options.cleChiffrement) },
        {
          provide: REDIS,
          useFactory: () => new Redis(options.redisUrl, { maxRetriesPerRequest: null }),
        },
        {
          provide: TRIAGE_QUEUE_TOKEN,
          useFactory: (redis: Redis) =>
            new Queue(TRIAGE_QUEUE, {
              connection: redis,
              prefix: options.queuePrefix ?? DEFAULT_QUEUE_PREFIX,
              defaultJobOptions: jobOptions(options.retryPolicy),
            }),
          inject: [REDIS],
        },
      ],
      exports: [DB, TRIAGE_QUEUE_TOKEN, SECRET_CIPHER],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.triageQueue.close();
    await this.redis.quit();
    await this.connexion.close();
  }
}
