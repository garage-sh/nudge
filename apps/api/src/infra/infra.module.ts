import { Inject, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import {
  createSecretCipher,
  DEFAULT_QUEUE_PREFIX,
  DISPATCH_QUEUE,
  jobOptions,
  TRIAGE_QUEUE,
  type RetryPolicy,
} from '@nudge/core';
import { connectDb, type DbConnection } from '@nudge/database';
import type { StockageCaptures } from '@nudge/stockage';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import {
  SECRET_CIPHER,
  DB,
  DISPATCH_QUEUE_TOKEN,
  STOCKAGE_CAPTURES,
  TRIAGE_QUEUE_TOKEN,
} from './tokens.js';

export interface InfraOptions {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  /** Préfixe des clés BullMQ : isole plusieurs Instances (ou tests) sur un même Redis. */
  readonly queuePrefix?: string;
  /** Retry des jobs de triage et de dispatch ; les tests le raccourcissent. */
  readonly retryPolicy?: RetryPolicy;
  /** Clé d'Instance (`NUDGE_ENCRYPTION_KEY`, 32 octets en base64) : chiffre les secrets stockés. */
  readonly cleChiffrement: string;
  /** Stockage des Captures (`@nudge/stockage`), le même que celui du worker. */
  readonly stockageCaptures: StockageCaptures;
}

const DB_CONNECTION = Symbol('DB_CONNECTION');
const REDIS = Symbol('REDIS');

@Module({})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB_CONNECTION) private readonly connexion: DbConnection,
    @Inject(TRIAGE_QUEUE_TOKEN) private readonly triageQueue: Queue,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  static forRoot(options: InfraOptions): DynamicModule {
    const queue = (nom: string) => ({
      useFactory: (redis: Redis) =>
        new Queue(nom, {
          connection: redis,
          prefix: options.queuePrefix ?? DEFAULT_QUEUE_PREFIX,
          // Les mêmes options que celles du worker : un job rejoué y est retenté pareil.
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
        { provide: SECRET_CIPHER, useFactory: () => createSecretCipher(options.cleChiffrement) },
        { provide: STOCKAGE_CAPTURES, useValue: options.stockageCaptures },
        {
          provide: REDIS,
          useFactory: () => new Redis(options.redisUrl, { maxRetriesPerRequest: null }),
        },
        { provide: TRIAGE_QUEUE_TOKEN, ...queue(TRIAGE_QUEUE) },
        { provide: DISPATCH_QUEUE_TOKEN, ...queue(DISPATCH_QUEUE) },
      ],
      exports: [DB, TRIAGE_QUEUE_TOKEN, DISPATCH_QUEUE_TOKEN, SECRET_CIPHER, STOCKAGE_CAPTURES],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.triageQueue.close(), this.dispatchQueue.close()]);
    await this.redis.quit();
    await this.connexion.close();
  }
}
