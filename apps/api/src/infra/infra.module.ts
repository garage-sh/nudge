import { Inject, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { OPTIONS_JOB_PAR_DEFAUT, QUEUE_TRIAGE as NOM_QUEUE_TRIAGE } from '@nudge/core';
import { connecterDb, type ConnexionDb } from '@nudge/database';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { DB, QUEUE_TRIAGE } from './jetons.js';

export interface OptionsInfra {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  /** Préfixe des clés BullMQ : isole plusieurs Instances (ou tests) sur un même Redis. */
  readonly prefixeQueues?: string;
}

const CONNEXION_DB = Symbol('CONNEXION_DB');
const REDIS = Symbol('REDIS');

@Module({})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(CONNEXION_DB) private readonly connexion: ConnexionDb,
    @Inject(QUEUE_TRIAGE) private readonly queueTriage: Queue,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  static forRoot(options: OptionsInfra): DynamicModule {
    return {
      module: InfraModule,
      global: true,
      providers: [
        { provide: CONNEXION_DB, useFactory: () => connecterDb(options.databaseUrl) },
        { provide: DB, useFactory: (c: ConnexionDb) => c.db, inject: [CONNEXION_DB] },
        {
          provide: REDIS,
          useFactory: () => new Redis(options.redisUrl, { maxRetriesPerRequest: null }),
        },
        {
          provide: QUEUE_TRIAGE,
          useFactory: (redis: Redis) =>
            new Queue(NOM_QUEUE_TRIAGE, {
              connection: redis,
              prefix: options.prefixeQueues ?? 'nudge',
              defaultJobOptions: OPTIONS_JOB_PAR_DEFAUT,
            }),
          inject: [REDIS],
        },
      ],
      exports: [DB, QUEUE_TRIAGE],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queueTriage.close();
    await this.redis.quit();
    await this.connexion.fermer();
  }
}
