import {
  createParamDecorator,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { MemberView } from '@nudge/shared';
import type { Request } from 'express';
import { readSessionCookie } from './session-cookie.js';
import { SessionsService } from './sessions.service.js';

export type MemberRequest = Request & { member: MemberView };

/**
 * Requires a Member session (`nudge_session` cookie): 401 `session_required` otherwise.
 * Every dashboard controller except setup, sign in and invitation carries it.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<MemberRequest>();
    const token = readSessionCookie(request);
    const member = token ? await this.sessions.resolve(token) : null;
    if (!member) throw new UnauthorizedException({ error: 'session_required' });
    request.member = member;
    return true;
  }
}

/** The signed-in Member, set by `SessionGuard`. */
export const CurrentMember = createParamDecorator(
  (_: unknown, context: ExecutionContext): MemberView =>
    context.switchToHttp().getRequest<MemberRequest>().member,
);
