import type { LogLevel } from '@nestjs/common';
import type { ResoudreAdaptateur } from '@nudge/core';
import type { Juge } from '@nudge/judge';

export interface OptionsWorker {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  /** Préfixe des clés BullMQ, identique à celui de l'api. */
  readonly prefixeQueues?: string;
  /** `null` : mode dégradé sans Juge. */
  readonly juge: Juge | null;
  readonly resoudreAdaptateur: ResoudreAdaptateur;
  readonly logger?: false | LogLevel[];
}
