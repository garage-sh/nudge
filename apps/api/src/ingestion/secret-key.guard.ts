import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Project } from '@nudge/database';
import { PUBLIC_KEY_PREFIX } from '@nudge/shared';
import type { Request, Response } from 'express';
import { bearerKey, SecretKeys } from './secret-keys.js';

export type SecretKeyRequest = Request & { project: Project };

/**
 * Authenticates a server-only call by the Project's secret key. The public key is
 * refused (403 `secret_key_required`): it ships in browsers, and what it would report
 * could come from anyone.
 */
@Injectable()
export class SecretKeyGuard implements CanActivate {
  constructor(private readonly secretKeys: SecretKeys) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<SecretKeyRequest>();
    const key = bearerKey(request.headers.authorization);
    if (key.startsWith(PUBLIC_KEY_PREFIX)) {
      throw new ForbiddenException({ error: 'secret_key_required' });
    }
    request.project = await this.secretKeys.project(key, request.ip, http.getResponse<Response>());
    return true;
  }
}
