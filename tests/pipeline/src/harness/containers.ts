import { execFileSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    postgresUrl: string;
    redisUrl: string;
  }
}

/**
 * testcontainers does not read the current Docker context (Colima, Docker Desktop…):
 * without `DOCKER_HOST`, it is taken from the active context. The socket mounted in
 * the Ryuk container is the VM's, not the host's.
 */
function configureDocker(): void {
  if (process.env.DOCKER_HOST) return;
  try {
    const host = execFileSync(
      'docker',
      ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
      { encoding: 'utf8' },
    ).trim();
    if (!host || host === 'unix:///var/run/docker.sock') return;
    process.env.DOCKER_HOST = host;
    process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE ??= '/var/run/docker.sock';
  } catch {
    // No docker CLI: testcontainers will try its default strategies.
  }
}

/**
 * Global setup: one Postgres and one Redis for the whole suite. Each pipeline
 * started isolates itself in them (dedicated database, dedicated queue prefix).
 */
export default async function setup(project: TestProject) {
  configureDocker();
  const [postgres, redis]: [StartedPostgreSqlContainer, StartedRedisContainer] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);
  project.provide('postgresUrl', postgres.getConnectionUri());
  project.provide('redisUrl', redis.getConnectionUrl());

  return async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}
