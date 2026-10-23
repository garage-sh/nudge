import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { LogLevel } from '@nestjs/common';
import { ApiModule } from './api.module.js';
import type { OptionsInfra } from './infra/infra.module.js';

export interface OptionsApi extends OptionsInfra {
  /** `false` coupe les logs Nest (tests). */
  readonly logger?: false | LogLevel[];
}

/** Construit l'api sans l'écouter : `main.ts` et le harnais de tests appellent `listen` eux-mêmes. */
export async function creerApi(options: OptionsApi): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule.forRoot(options), {
    logger: options.logger ?? ['log', 'warn', 'error'],
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: '100kb' });
  return app;
}
