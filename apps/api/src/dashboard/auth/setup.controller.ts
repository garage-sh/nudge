import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { setupSchema, type SetupState, type SessionView } from '@nudge/shared';
import type { Request, Response } from 'express';
import { AuthThrottleGuard } from './auth-throttle.guard.js';
import { parseBody } from '../../validation.js';
import { MembersService } from './members.service.js';
import { SessionsService } from './sessions.service.js';
import { SetupTokenService } from './setup-token.js';

/** First launch: the first Member creates their account, then the setup closes. */
@Controller('api/setup')
export class SetupController {
  constructor(
    private readonly members: MembersService,
    private readonly sessions: SessionsService,
    private readonly setupToken: SetupTokenService,
  ) {}

  @Get()
  async state(): Promise<SetupState> {
    return { required: await this.members.setupRequired() };
  }

  /**
   * 201 and session opened; 403 `invalid_setup_token` without the token printed in the
   * api logs; 409 `setup_completed` as soon as a Member exists.
   */
  @Post()
  @UseGuards(AuthThrottleGuard)
  async setup(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionView> {
    const { email, password, setupToken } = parseBody(setupSchema, body);
    this.setupToken.verify(setupToken);
    const member = await this.members.setup(email, password);
    await this.sessions.start(request, response, member);
    return { member };
  }
}
