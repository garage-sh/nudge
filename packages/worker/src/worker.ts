import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { WorkerOptions } from './options.js';
import { WorkerModule } from './worker.module.js';

/** Starts the worker (standalone Nest context): it consumes the queues as soon as this returns. */
export async function createWorker(options: WorkerOptions): Promise<INestApplicationContext> {
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(options), {
    logger: options.logger ?? ['log', 'warn', 'error'],
  });
  await app.init();
  return app;
}
