import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { hashSecretKey } from '@nudge/core';
import { projects, type Db, type Project } from '@nudge/database';
import { eq } from 'drizzle-orm';
import type { Response } from 'express';
import { clientKey, RateLimiter } from '../infra/rate-limiter.js';
import { DB } from '../infra/tokens.js';

/**
 * Looks up the Project of a secret key (`nk_sec_…`), for every endpoint that accepts
 * one. A single instance serves them all, so the budget of unknown keys an IP may try
 * is shared across endpoints.
 */
@Injectable()
export class SecretKeys {
  /**
   * Unknown secret keys per IP: 20 per minute. Guessing a 256-bit key is hopeless, but
   * each attempt costs a Postgres lookup; past the limit, the IP is refused before it.
   */
  private readonly invalidSecretKeys = new RateLimiter({ limit: 20, windowMs: 60_000 });

  constructor(@Inject(DB) private readonly db: Db) {}

  /** The Project of `key`; 401 `invalid_key` if none, 429 `too_many_attempts` past the limit. */
  async project(key: string, ip: string | undefined, response: Response): Promise<Project> {
    const client = clientKey(ip);
    const wait = this.invalidSecretKeys.msUntilReset(client);
    if (wait > 0) {
      response.setHeader('Retry-After', String(Math.ceil(wait / 1000)));
      throw new HttpException({ error: 'too_many_attempts' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const project = await projectWhere(this.db, eq(projects.secretKeyHash, hashSecretKey(key)));
    if (!project) {
      this.invalidSecretKeys.consume(client);
      throw invalidKey();
    }
    return project;
  }
}

export async function projectWhere(
  db: Db,
  condition: ReturnType<typeof eq>,
): Promise<Project | undefined> {
  const [project] = await db.select().from(projects).where(condition).limit(1);
  return project;
}

export const invalidKey = () => new UnauthorizedException({ error: 'invalid_key' });

/** The key of `Authorization: Bearer <key>`; 401 `missing_key` without one. */
export function bearerKey(authorization: string | undefined): string {
  const [scheme, key] = (authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !key) throw new UnauthorizedException({ error: 'missing_key' });
  return key;
}
