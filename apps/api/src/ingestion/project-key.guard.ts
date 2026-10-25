import {
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
      request.project = await this.project(eq(projects.secretKeyHash, hashSecretKey(key)));
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

  private async project(condition: ReturnType<typeof eq>): Promise<Project> {
    const [project] = await this.db.select().from(projects).where(condition).limit(1);
    if (!project) throw new UnauthorizedException({ error: 'invalid_key' });
    return project;
  }
}
