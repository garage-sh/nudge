import { Controller, Delete, Get, HttpCode, Param, UseGuards } from '@nestjs/common';
import type { MemberListItemView, MemberView } from '@nudge/shared';
import { MembersService } from './members.service.js';
import { CurrentMember, SessionGuard } from './session.guard.js';

/** The Members of the Instance: every Member sees them all (no roles in v1). */
@Controller('api/members')
@UseGuards(SessionGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(): Promise<MemberListItemView[]> {
    return this.members.list();
  }

  /**
   * Any Member removes another one, whose sessions are revoked at once; 404
   * `member_not_found`, 409 `cannot_remove_self`.
   */
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentMember() member: MemberView, @Param('id') id: string): Promise<void> {
    return this.members.remove(member, id);
  }
}
