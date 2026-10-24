import 'reflect-metadata';
import { resolveDestinationAdapter } from '@nudge/destinations';
import { createStockage } from '@nudge/stockage';
import { configWorkerFromEnv } from './env.js';
import { createWorker } from './worker.js';

async function main() {
  const { stockage, ...config } = configWorkerFromEnv(process.env);
  const app = await createWorker({
    ...config,
    resolveDestinationAdapter,
    stockageCaptures: createStockage(stockage),
  });
  app.enableShutdownHooks();
}

void main();
