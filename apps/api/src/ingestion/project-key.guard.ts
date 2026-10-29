import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { projects, type Db, type Project } from '@nudge/database';
import { PUBLIC_KEY_PREFIX, type Source } from '@nudge/shared';
import { eq } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { DB } from '../infra/tokens.js';
import { bearerKey, invalidKey, projectWhere, SecretKeys } from './secret-keys.js';
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
    private readonly secretKeys: SecretKeys,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const key = bearerKey(request.headers.authorization);
    if (!key.startsWith(PUBLIC_KEY_PREFIX)) {
      request.project = await this.secretKeys.project(
        key,
        request.ip,
        http.getResponse<Response>(),
      );
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
    const project = await projectWhere(this.db, condition);
    if (!project) throw invalidKey();
    return project;
  }
}
