import {
  HttpException,
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { RateLimiter } from '../../infra/rate-limiter.js';

/**
 * Slows down brute force on the public routes that hash a password (setup, sign in,
 * invitation): 10 attempts per minute, per route and per IP. Behind a proxy, the IP is
 * only the right one if `trust proxy` is set.
 */
@Injectable()
export class AuthThrottleGuard implements CanActivate {
  private readonly limiter = new RateLimiter({ limit: 10, windowMs: 60_000 });

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    if (this.limiter.consume(`${route}:${request.ip ?? 'unknown'}`)) return true;
    throw new HttpException({ error: 'too_many_attempts' }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
