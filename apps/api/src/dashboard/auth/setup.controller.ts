import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { newMemberSchema, type SetupState, type SessionView } from '@nudge/shared';
import type { Response } from 'express';
import { AuthThrottleGuard } from './auth-throttle.guard.js';
import { parseBody } from '../../validation.js';
import { MembersService } from './members.service.js';
import { SessionsService } from './sessions.service.js';

/** First launch: the first Member creates their account, then the setup closes. */
@Controller('api/setup')
export class SetupController {
  constructor(
    private readonly members: MembersService,
    private readonly sessions: SessionsService,
  ) {}

  @Get()
  async state(): Promise<SetupState> {
    return { required: await this.members.setupRequired() };
  }

  /** 201 and session opened; 409 `setup_completed` as soon as a Member exists. */
  @Post()
  @UseGuards(AuthThrottleGuard)
  async setup(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionView> {
    const { email, password } = parseBody(newMemberSchema, body);
    const member = await this.members.setup(email, password);
    await this.sessions.start(response, member);
    return { member };
  }
}
