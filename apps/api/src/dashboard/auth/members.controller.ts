import { Controller, Get, UseGuards } from '@nestjs/common';
import type { MemberListItemView } from '@nudge/shared';
import { MembersService } from './members.service.js';
import { SessionGuard } from './session.guard.js';

/** The Members of the Instance: every Member sees them all (no roles in v1). */
@Controller('api/members')
@UseGuards(SessionGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(): Promise<MemberListItemView[]> {
    return this.members.list();
  }
}
