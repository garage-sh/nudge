import { Body, Controller, Delete, HttpCode, Put, Req, UseGuards } from '@nestjs/common';
import { passwordChangeSchema, type MemberView, type RevokedSessions } from '@nudge/shared';
import type { Request } from 'express';
import { parseBody } from '../../validation.js';
import { AuthThrottleGuard } from './auth-throttle.guard.js';
import { MembersService } from './members.service.js';
import { CurrentMember, SessionGuard } from './session.guard.js';
import { SessionsService } from './sessions.service.js';

/** The signed-in Member's own account: password and sessions. */
@Controller('api/account')
@UseGuards(SessionGuard)
export class AccountController {
  constructor(
    private readonly members: MembersService,
    private readonly sessions: SessionsService,
  ) {}

  /**
   * 204; 403 `invalid_current_password`. The Member's other sessions are revoked, this
   * one stays open. Throttled like sign in: a stolen session does not allow guessing
   * the current password at will.
   */
  @Put('password')
  @UseGuards(AuthThrottleGuard)
  @HttpCode(204)
  async changePassword(
    @CurrentMember() member: MemberView,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<void> {
    const { currentPassword, newPassword } = parseBody(passwordChangeSchema, body);
    await this.members.changePassword(request, member, currentPassword, newPassword);
  }

  /**
   * "Sign out everywhere else": revokes every session of the Member except this one,
   * from which they keep acting (and can still sign out).
   */
  @Delete('other-sessions')
  async signOutOthers(
    @CurrentMember() member: MemberView,
    @Req() request: Request,
  ): Promise<RevokedSessions> {
    return { revoked: await this.sessions.revokeOthers(request, member) };
  }
}
