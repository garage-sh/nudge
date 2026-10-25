import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { invitations, type Db } from '@nudge/database';
import type { CreatedInvitation, InvitationView, MemberView } from '@nudge/shared';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DB } from '../../infra/tokens.js';
import { generateToken, hashToken } from './tokens.js';
import { MembersService } from './members.service.js';

/** Validity period of an invitation link. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const invalidInvitation = () => new NotFoundException({ error: 'invalid_invitation' });

/**
 * Invitation by link, without email (no SMTP in v1): the Member passes the link on
 * themselves. The link is single-use and expires.
 */
@Injectable()
export class InvitationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly members: MembersService,
  ) {}

  async create(createdBy: MemberView): Promise<CreatedInvitation> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    await this.db
      .insert(invitations)
      .values({ tokenHash: hashToken(token), createdBy: createdBy.id, expiresAt });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /** The invitation still usable; 404 `invalid_invitation` otherwise (unknown, expired, used). */
  async read(token: string): Promise<InvitationView> {
    const [invitation] = await this.db
      .select({ expiresAt: invitations.expiresAt })
      .from(invitations)
      .where(this.usable(token))
      .limit(1);
    if (!invitation) throw invalidInvitation();
    return { expiresAt: invitation.expiresAt.toISOString() };
  }

  /**
   * Consumes the invitation and creates the Member in the same transaction: an email
   * already taken cancels everything, and the link stays usable.
   */
  async accept(token: string, email: string, password: string): Promise<MemberView> {
    return this.db.transaction(async (tx) => {
      const [invitation] = await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(this.usable(token))
        .returning({ id: invitations.id });
      if (!invitation) throw invalidInvitation();
      const member = await this.members.create(tx, email, password);
      await tx
        .update(invitations)
        .set({ memberId: member.id })
        .where(eq(invitations.id, invitation.id));
      return member;
    });
  }

  private usable(token: string) {
    return and(
      eq(invitations.tokenHash, hashToken(token)),
      isNull(invitations.acceptedAt),
      gt(invitations.expiresAt, new Date()),
    );
  }
}
