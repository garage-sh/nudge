import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Project } from '@nudge/database';
import { RateLimiter, type RateLimit } from '../infra/rate-limiter.js';

/** Rate limit of the public-key ingestion (D8: in memory, per api replica). */
export interface WidgetLimits {
  readonly perIp: RateLimit;
  readonly perProject: RateLimit;
}

/**
 * By default: 20 Feedbacks per minute for an IP (all Projects together), 600 per
 * minute for a Project. An Author does not write twenty Feedbacks a minute; a Project
 * that receives ten a second is flooded.
 */
export const DEFAULT_WIDGET_LIMITS: WidgetLimits = {
  perIp: { limit: 20, windowMs: 60_000 },
  perProject: { limit: 600, windowMs: 60_000 },
};

export const WIDGET_LIMITS = Symbol('WIDGET_LIMITS');

/**
 * Safeguards of the Widget path: the page's origin must be among the Project's Allowed
 * origins, and the rate is bounded per IP and per Project.
 *
 * The Origin header only protects against another site in a browser: a client outside
 * a browser forges it. The rate limit bounds what it can send.
 */
@Injectable()
export class WidgetAccess {
  private readonly perIp: RateLimiter;
  private readonly perProject: RateLimiter;

  constructor(@Inject(WIDGET_LIMITS) limits: WidgetLimits) {
    this.perIp = new RateLimiter(limits.perIp);
    this.perProject = new RateLimiter(limits.perProject);
  }

  /** Counts an attempt from the IP, before even looking up the key. */
  limitIp(ip: string | undefined): void {
    limit(this.perIp, ip ?? 'unknown');
  }

  /** The exact origin (scheme, host, port) must be allowed; a request without an origin is not. */
  checkOrigin(project: Project, origin: string | undefined): void {
    if (!origin || !project.allowedOrigins.includes(origin)) {
      throw new ForbiddenException({ error: 'origin_refused' });
    }
  }

  /** Counts a Feedback of the Project, once the key and the origin are accepted. */
  limitProject(projectId: string): void {
    limit(this.perProject, projectId);
  }
}

function limit(limiter: RateLimiter, key: string): void {
  if (limiter.consume(key)) return;
  const seconds = Math.max(1, Math.ceil(limiter.msUntilReset(key) / 1000));
  throw new TooManyFeedbacks(seconds);
}

/** 429 with `Retry-After`: the Widget can tell the Author when to try again. */
export class TooManyFeedbacks extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super({ error: 'too_many_feedbacks' }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
