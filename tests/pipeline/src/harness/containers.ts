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
 * testcontainers ne lit pas le contexte Docker courant (Colima, Docker Desktop…) :
 * sans `DOCKER_HOST`, on le prend au contexte actif. Le socket monté dans le
 * conteneur Ryuk est celui de la VM, pas celui du poste.
 */
function configureDocker(): void {
  if (process.env.DOCKER_HOST) return;
  try {
    const hote = execFileSync(
      'docker',
      ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
      { encoding: 'utf8' },
    ).trim();
    if (!hote || hote === 'unix:///var/run/docker.sock') return;
    process.env.DOCKER_HOST = hote;
    process.env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE ??= '/var/run/docker.sock';
  } catch {
    // Pas de CLI docker : testcontainers tentera ses stratégies par défaut.
  }
}

/**
 * Setup global : un Postgres et un Redis pour toute la suite. Chaque pipeline
 * démarré s'y isole (base dédiée, préfixe de queues dédié).
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
