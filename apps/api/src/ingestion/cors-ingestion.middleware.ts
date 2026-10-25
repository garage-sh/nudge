import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * CORS of the public API, for the Widget served from a Project's page.
 *
 * The origin is echoed as is: reading the response is not what protects the ingestion.
 * It is the write that is refused (403 `origin_refused`) when the origin is not allowed
 * for the public key, and the Widget can then read why. No cookie (`credentials`): the
 * key is in the Authorization header. A preflight does not carry the key: it cannot be
 * checked against the Project.
 */
@Injectable()
export class CorsIngestionMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const origin = request.headers.origin;
    response.vary('Origin');
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    // The Widget tells the Author when to try again after a 429.
    response.setHeader('Access-Control-Expose-Headers', 'Retry-After');
    if (request.method !== 'OPTIONS') return next();
    response.setHeader('Access-Control-Allow-Methods', 'POST');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Access-Control-Max-Age', '600');
    response.status(204).end();
  }
}
