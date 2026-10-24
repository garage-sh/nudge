import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { LogLevel } from '@nestjs/common';
import type { DestinationAdapterResolver } from '@nudge/core';
import { OCTETS_CAPTURE_MAX } from '@nudge/shared';
import { json } from 'express';
import { ApiModule, type IngestionOptions } from './api.module.js';
import type { InfraOptions } from './infra/infra.module.js';

export interface ApiOptions extends InfraOptions, IngestionOptions {
  /** `false` coupe les logs Nest (tests). */
  readonly logger?: false | LogLevel[];
  /**
   * Cookie de session `Secure` (HTTPS seulement). Vrai par défaut ; à couper
   * seulement pour un dashboard servi en HTTP (développement local, tests).
   */
  readonly sessionCookieSecure?: boolean;
  /** Adaptateurs de Destination (bouton « tester ») : ceux de `@nudge/destinations` en production. */
  readonly resolveDestinationAdapter: DestinationAdapterResolver;
}

/** Un Retour et sa Capture encodée en base64 (4 octets pour 3), plus le reste du corps. */
const LIMITE_CORPS_RETOUR = Math.ceil(OCTETS_CAPTURE_MAX / 3) * 4 + 200 * 1024;

/** Construit l'api sans l'écouter : `main.ts` et le harnais de tests appellent `listen` eux-mêmes. */
export async function createApi(options: ApiOptions): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    ApiModule.forRoot({
      ...options,
      sessionCookie: { secure: options.sessionCookieSecure ?? true },
    }),
    {
      logger: options.logger ?? ['log', 'warn', 'error'],
      bodyParser: false,
    },
  );
  // Un Retour peut porter une Capture (base64) : sa route seule accepte un corps lourd.
  app.use('/v1/retours', json({ limit: LIMITE_CORPS_RETOUR }));
  app.useBodyParser('json', { limit: '100kb' });
  return app;
}
