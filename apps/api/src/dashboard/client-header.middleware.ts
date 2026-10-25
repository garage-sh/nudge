import { ForbiddenException, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** Header the dashboard sets on each of its requests. */
export const CLIENT_HEADER = 'x-nudge-client';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense on top of SameSite=Lax: a write must carry the dashboard header. A
 * third-party form cannot set it, and a script from another origin (even a "same-site"
 * subdomain) triggers a CORS preflight that the api does not approve.
 */
@Injectable()
export class ClientHeaderMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction): void {
    if (!READ_METHODS.has(request.method) && request.headers[CLIENT_HEADER] !== 'dashboard') {
      throw new ForbiddenException({ error: 'missing_header' });
    }
    next();
  }
}
