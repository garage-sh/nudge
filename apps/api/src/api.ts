import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { LogLevel } from '@nestjs/common';
import { ApiModule } from './api.module.js';
import type { InfraOptions } from './infra/infra.module.js';

export interface ApiOptions extends InfraOptions {
  /** `false` coupe les logs Nest (tests). */
  readonly logger?: false | LogLevel[];
}

/** Construit l'api sans l'écouter : `main.ts` et le harnais de tests appellent `listen` eux-mêmes. */
export async function createApi(options: ApiOptions): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule.forRoot(options), {
    logger: options.logger ?? ['log', 'warn', 'error'],
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: '100kb' });
  return app;
}
