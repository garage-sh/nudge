import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { LogLevel } from '@nestjs/common';
import type { DestinationAdapterResolver } from '@nudge/core';
import { LONGUEUR_BASE64_CAPTURE_MAX } from '@nudge/shared';
import { json } from 'express';
import { ApiModule, type IngestionOptions } from './api.module.js';
import type { InfraOptions } from './infra/infra.module.js';

/** Réglage `trust proxy` d'Express : booléen, nombre de proxys, ou adresses de confiance. */
export type TrustProxy = boolean | number | string;

export interface ApiOptions extends InfraOptions, IngestionOptions {
  /** `false` coupe les logs Nest (tests). */
  readonly logger?: false | LogLevel[];
  /**
   * Cookie de session `Secure` (HTTPS seulement). Vrai par défaut ; à couper
   * seulement pour un dashboard servi en HTTP (développement local, tests).
   */
  readonly sessionCookieSecure?: boolean;
  /**
   * Réglage `trust proxy` d'Express : derrière un reverse proxy, l'IP du client (rate
   * limit du Widget, anti force brute de la connexion) se lit dans `X-Forwarded-For`.
   * Absent ou `false` : l'IP de la connexion, que le client ne peut pas falsifier.
   */
  readonly trustProxy?: TrustProxy;
  /** Adaptateurs de Destination (bouton « tester ») : ceux de `@nudge/destinations` en production. */
  readonly resolveDestinationAdapter: DestinationAdapterResolver;
}

/** Un Retour et sa Capture encodée en base64, plus le reste du corps. */
const LIMITE_CORPS_RETOUR = LONGUEUR_BASE64_CAPTURE_MAX + 200 * 1024;

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
  app.set('trust proxy', options.trustProxy ?? false);
  // Un Retour peut porter une Capture (base64) : sa route seule accepte un corps lourd.
  app.use('/v1/retours', json({ limit: LIMITE_CORPS_RETOUR }));
  app.useBodyParser('json', { limit: '100kb' });
  return app;
}
