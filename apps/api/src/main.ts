import 'reflect-metadata';
import { resolveDestinationAdapter } from '@nudge/destinations';
import { createStockage } from '@nudge/stockage';
import { createApi } from './api.js';
import { configApiFromEnv } from './env.js';

async function main() {
  const { port, stockage, ...config } = configApiFromEnv(process.env);
  const app = await createApi({
    ...config,
    resolveDestinationAdapter,
    stockageCaptures: createStockage(stockage),
  });
  app.enableShutdownHooks();
  await app.listen(port);
}

void main();
