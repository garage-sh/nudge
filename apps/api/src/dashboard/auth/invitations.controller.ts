import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import {
  newMemberSchema,
  type CreatedInvitation,
  type InvitationView,
  type MemberView,
  type SessionView,
} from '@nudge/shared';
import type { Response } from 'express';
import { AuthThrottleGuard } from './auth-throttle.guard.js';
import { parseBody } from '../../validation.js';
import { InvitationsService } from './invitations.service.js';
import { CurrentMember, SessionGuard } from './session.guard.js';
import { SessionsService } from './sessions.service.js';

@Controller('api/invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly sessions: SessionsService,
  ) {}

  /** A Member generates an invitation link; the token is readable only here. */
  @Post()
  @UseGuards(SessionGuard)
  create(@CurrentMember() member: MemberView): Promise<CreatedInvitation> {
    return this.invitations.create(member);
  }

  /** Public: the invitation page checks the link before showing the form. */
  @Get(':token')
  read(@Param('token') token: string): Promise<InvitationView> {
    return this.invitations.read(token);
  }

  /** Public: the invited person creates their account and leaves signed in. */
  @Post(':token/accept')
  @UseGuards(AuthThrottleGuard)
  async accept(
    @Param('token') token: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionView> {
    const { email, password } = parseBody(newMemberSchema, body);
    const member = await this.invitations.accept(token, email, password);
    await this.sessions.start(response, member);
    return { member };
  }
}
