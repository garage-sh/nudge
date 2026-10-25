import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { signInSchema, type MemberView, type SessionView } from '@nudge/shared';
import type { Request, Response } from 'express';
import { AuthThrottleGuard } from './auth-throttle.guard.js';
import { parseBody } from '../../validation.js';
import { MembersService } from './members.service.js';
import { CurrentMember, SessionGuard } from './session.guard.js';
import { SessionsService } from './sessions.service.js';

/** Sign in (POST), signed-in Member (GET), sign out (DELETE). */
@Controller('api/session')
export class SessionController {
  constructor(
    private readonly members: MembersService,
    private readonly sessions: SessionsService,
  ) {}

  @Get()
  @UseGuards(SessionGuard)
  current(@CurrentMember() member: MemberView): SessionView {
    return { member };
  }

  /** 401 `invalid_credentials` without telling whether the email or the password is wrong. */
  @Post()
  @UseGuards(AuthThrottleGuard)
  @HttpCode(200)
  async signIn(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionView> {
    const { email, password } = parseBody(signInSchema, body);
    const member = await this.members.authenticate(email, password);
    if (!member) throw new UnauthorizedException({ error: 'invalid_credentials' });
    await this.sessions.start(response, member);
    return { member };
  }

  /** Revokes the session in the database and clears the cookie; idempotent. */
  @Delete()
  @HttpCode(204)
  async signOut(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.end(request, response);
  }
}
