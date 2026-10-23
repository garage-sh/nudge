import type { LogLevel } from '@nestjs/common';
import type { DestinationAdapterResolver, RetryPolicy } from '@nudge/core';
import type { Juge } from '@nudge/judge';

export interface WorkerOptions {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  /** Préfixe des clés BullMQ, identique à celui de l'api. */
  readonly queuePrefix?: string;
  /** Retry des jobs de dispatch ; les tests le raccourcissent. */
  readonly retryPolicy?: RetryPolicy;
  /** `null` : mode dégradé sans Juge. */
  readonly juge: Juge | null;
  readonly resolveDestinationAdapter: DestinationAdapterResolver;
  readonly logger?: false | LogLevel[];
}
