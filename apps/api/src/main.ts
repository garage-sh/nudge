import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { createSecretCipher } from '@nudge/core';
import { connectDb, instanceSmtpReader } from '@nudge/database';
import { destinationAdapterResolver, guardedFetch, smtpMailer } from '@nudge/destinations';
import { createStorage } from '@nudge/storage';
import { workerConfigFromEnv, createWorker } from '@nudge/worker';
import { createApi } from './api.js';
import { apiConfigFromEnv } from './env.js';
import { rolesFromEnv } from './roles.js';

/**
 * A nudge process: the api, the worker, or both according to `NUDGE_ROLES`. The whole
 * configuration is read before starting anything, so that an invalid variable stops
 * the process before it listens or consumes a queue.
 */
async function main() {
  const roles = rolesFromEnv(process.env);
  const api = roles.has('api') ? apiConfigFromEnv(process.env) : null;
  const worker = roles.has('worker') ? workerConfigFromEnv(process.env) : null;
  // The api and the worker of the same process share the Capture storage.
  const captureStorage = createStorage((api ?? worker)!.storage);
  // Every call to a URL a Member configured (Destinations, Alert destination, Judge).
  const shared = (api ?? worker)!;
  const outboundFetch = guardedFetch(shared.outbound);
  // The SMTP server of the email Destinations, read again from the settings on every
  // email: a small pool of its own, since the adapters are built outside the Nest modules.
  const settings = connectDb(shared.databaseUrl, { max: 2 });
  const mailer = smtpMailer({
    settings: instanceSmtpReader(settings.db, createSecretCipher(shared.encryptionKey)),
    policy: shared.outbound,
  });
  const resolveDestinationAdapter = destinationAdapterResolver({ fetch: outboundFetch, mailer });

  // In shutdown order: the api stops accepting Feedbacks before the worker finishes
  // its running jobs.
  const started: INestApplicationContext[] = [];
  if (api) {
    const { port, storage: _storage, outbound: _outbound, ...config } = api;
    const app = await createApi({ ...config, resolveDestinationAdapter, mailer, captureStorage });
    await app.listen(port);
    started.push(app);
  }
  if (worker) {
    const { storage: _storage, outbound: _outbound, ...config } = worker;
    started.push(
      await createWorker({ ...config, resolveDestinationAdapter, captureStorage, outboundFetch }),
    );
  }

  // No `enableShutdownHooks`: each Nest context would kill the process as soon as it
  // closes itself, without waiting for the other.
  let stopping = false;
  const stop = async (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    try {
      for (const app of started) await app.close();
      await settings.close();
    } finally {
      // Re-raised for the usual exit code; as PID 1 of a container, where it would be
      // ignored, the process exits by itself.
      process.kill(process.pid, signal);
      setTimeout(() => process.exit(0), 1000).unref();
    }
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, (received) => void stop(received));
  }
}

void main();
