import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { hashSecretKey } from '@nudge/core';
import { projects, type Db, type Project } from '@nudge/database';
import { PUBLIC_KEY_PREFIX, type Source } from '@nudge/shared';
import { eq } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { RateLimiter } from '../infra/rate-limiter.js';
import { DB } from '../infra/tokens.js';
import { WidgetAccess, TooManyFeedbacks } from './widget-access.js';

export type AuthenticatedRequest = Request & { project: Project; source: Source };

/**
 * Authenticates the call by a Project key (`Authorization: Bearer <key>`) and derives
 * the Source from it:
 * - public key (`nk_pub_…`): the Widget, from an Allowed origin, rate bounded;
 * - secret key (`nk_sec_…`): the server API.
 */
@Injectable()
export class ProjectKeyGuard implements CanActivate {
  /**
   * Unknown secret keys per IP: 20 per minute. Guessing a 256-bit key is hopeless, but
   * each attempt costs a Postgres lookup; past the limit, the IP is refused before it.
   */
  private readonly invalidSecretKeys = new RateLimiter({ limit: 20, windowMs: 60_000 });

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly widgetAccess: WidgetAccess,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const [scheme, key] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !key) throw new UnauthorizedException({ error: 'missing_key' });
    if (!key.startsWith(PUBLIC_KEY_PREFIX)) {
      request.project = await this.secretKeyProject(key, request.ip, http.getResponse<Response>());
      request.source = 'api';
      return true;
    }
    try {
      this.widgetAccess.limitIp(request.ip);
      const project = await this.project(eq(projects.publicKey, key));
      this.widgetAccess.checkOrigin(project, request.headers.origin);
      this.widgetAccess.limitProject(project.id);
      request.project = project;
      request.source = 'widget';
      return true;
    } catch (error) {
      if (error instanceof TooManyFeedbacks) {
        http.getResponse<Response>().setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }

  private async secretKeyProject(
    key: string,
    ip: string | undefined,
    response: Response,
  ): Promise<Project> {
    const client = ip ?? 'unknown';
    const wait = this.invalidSecretKeys.msUntilReset(client);
    if (wait > 0) {
      response.setHeader('Retry-After', String(Math.ceil(wait / 1000)));
      throw new HttpException({ error: 'too_many_attempts' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    try {
      return await this.project(eq(projects.secretKeyHash, hashSecretKey(key)));
    } catch (error) {
      if (error instanceof UnauthorizedException) this.invalidSecretKeys.consume(client);
      throw error;
    }
  }

  private async project(condition: ReturnType<typeof eq>): Promise<Project> {
    const [project] = await this.db.select().from(projects).where(condition).limit(1);
    if (!project) throw new UnauthorizedException({ error: 'invalid_key' });
    return project;
  }
}
