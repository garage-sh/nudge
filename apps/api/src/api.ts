import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { LogLevel } from '@nestjs/common';
import type { DestinationAdapterResolver } from '@nudge/core';
import { CAPTURE_MAX_BASE64_LENGTH } from '@nudge/shared';
import { json } from 'express';
import { ApiModule, type IngestionOptions } from './api.module.js';
import { setupTokenConfig } from './dashboard/auth/setup-token.js';
import type { InfraOptions } from './infra/infra.module.js';

/** Express `trust proxy` setting: boolean, number of proxies, or trusted addresses. */
export type TrustProxy = boolean | number | string;

export interface ApiOptions extends InfraOptions, IngestionOptions {
  /** `false` turns off Nest logs (tests). */
  readonly logger?: false | LogLevel[];
  /**
   * `Secure` session cookie (HTTPS only). True by default; turn off only for a
   * dashboard served over HTTP (local development, tests).
   */
  readonly sessionCookieSecure?: boolean;
  /**
   * Token required to create the first Member (`NUDGE_SETUP_TOKEN`). Absent: derived
   * from the Instance key, the same on every replica, and printed in the logs at
   * startup while no Member exists.
   */
  readonly setupToken?: string | null;
  /**
   * Express `trust proxy` setting: behind a reverse proxy, the client IP (Widget rate
   * limit, sign-in brute-force protection) is read from `X-Forwarded-For`.
   * Absent or `false`: the IP of the connection, which the client cannot forge.
   */
  readonly trustProxy?: TrustProxy;
  /** Destination adapters ("test" button): those of `@nudge/destinations` in production. */
  readonly resolveDestinationAdapter: DestinationAdapterResolver;
}

/** A Feedback and its base64-encoded Capture, plus the rest of the body. */
const FEEDBACK_BODY_LIMIT = CAPTURE_MAX_BASE64_LENGTH + 200 * 1024;

/** Builds the api without listening: `main.ts` and the test harness call `listen` themselves. */
export async function createApi(options: ApiOptions): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    ApiModule.forRoot({
      ...options,
      sessionCookie: { secure: options.sessionCookieSecure ?? true },
      setupToken: setupTokenConfig(options.setupToken, options.encryptionKey),
    }),
    {
      logger: options.logger ?? ['log', 'warn', 'error'],
      bodyParser: false,
    },
  );
  app.set('trust proxy', options.trustProxy ?? false);
  // A Feedback can carry a Capture (base64): its route alone accepts a heavy body.
  app.use('/v1/feedbacks', json({ limit: FEEDBACK_BODY_LIMIT }));
  app.useBodyParser('json', { limit: '100kb' });
  return app;
}
