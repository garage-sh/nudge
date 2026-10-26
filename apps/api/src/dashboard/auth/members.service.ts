import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { invitations, members, type Db } from '@nudge/database';
import type { MemberListItemView, MemberView } from '@nudge/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { DB } from '../../infra/tokens.js';
import { isUuid } from '../../validation.js';
import { hashPassword, verifyPassword } from './password.js';
import { SessionsService } from './sessions.service.js';

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Postgres unique violation, which drizzle surfaces as is or wraps. */
export const isUniqueViolation = (error: unknown): boolean => {
  const code = (e: unknown) => (e as { code?: string } | null)?.code;
  return code(error) === '23505' || code((error as { cause?: unknown })?.cause) === '23505';
};

const setupCompleted = () => new ConflictException({ error: 'setup_completed' });
const memberNotFound = () => new NotFoundException({ error: 'member_not_found' });
const invalidCurrentPassword = () => new ForbiddenException({ error: 'invalid_current_password' });

@Injectable()
export class MembersService {
  /** Hash compared against when the email is unknown: the response takes the same time. */
  private decoyHash: Promise<string> | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly sessions: SessionsService,
  ) {}

  /** All the Members of the Instance, oldest to newest; never a hash. */
  async list(): Promise<MemberListItemView[]> {
    const rows = await this.db
      .select({ id: members.id, email: members.email, createdAt: members.createdAt })
      .from(members)
      .orderBy(asc(members.createdAt), asc(members.id));
    return rows.map(({ createdAt, ...member }) => ({
      ...member,
      since: createdAt.toISOString(),
    }));
  }

  /**
   * Another Member removes `id`: their sessions go with them (cascade), so the removal
   * takes effect on their next request, and the invitation links they generated that
   * nobody used yet stop working. A Member does not remove themselves (409
   * `cannot_remove_self`): someone else does it, so the Member who removes always stays
   * and the Instance never ends up without anyone. An advisory lock serializes removals:
   * two Members removing each other at the same time cannot both succeed.
   */
  async remove(actor: MemberView, id: string): Promise<void> {
    if (!isUuid(id)) throw memberNotFound();
    if (id === actor.id) throw new ConflictException({ error: 'cannot_remove_self' });
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('nudge:members'))`);
      const [stillMember] = await tx
        .select({ id: members.id })
        .from(members)
        .where(eq(members.id, actor.id));
      // Removed in the meantime by someone else: their session is gone with them.
      if (!stillMember) throw new UnauthorizedException({ error: 'session_required' });
      await tx
        .delete(invitations)
        .where(and(eq(invitations.createdBy, id), isNull(invitations.acceptedAt)));
      const removed = await tx
        .delete(members)
        .where(eq(members.id, id))
        .returning({ id: members.id });
      if (removed.length === 0) throw memberNotFound();
    });
  }

  /**
   * The Member changes their own password; the current one is required (403
   * `invalid_current_password`). Every other session of the Member is revoked in the
   * same transaction: whoever knew the old password is signed out, while the request's
   * session stays open.
   */
  async changePassword(
    request: Request,
    member: MemberView,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const [row] = await this.db
      .select({ passwordHash: members.passwordHash })
      .from(members)
      .where(eq(members.id, member.id));
    if (!row) throw new UnauthorizedException({ error: 'session_required' });
    if (!(await verifyPassword(currentPassword, row.passwordHash))) throw invalidCurrentPassword();
    const hash = await hashPassword(newPassword);
    await this.db.transaction(async (tx) => {
      // Against the hash just verified: if a concurrent change won, this one is refused.
      const updated = await tx
        .update(members)
        .set({ passwordHash: hash })
        .where(and(eq(members.id, member.id), eq(members.passwordHash, row.passwordHash)))
        .returning({ id: members.id });
      if (updated.length === 0) throw invalidCurrentPassword();
      await this.sessions.revokeOthers(request, member, tx);
    });
  }

  async setupRequired(): Promise<boolean> {
    const [first] = await this.db.select({ id: members.id }).from(members).limit(1);
    return !first;
  }

  /**
   * Creates the first Member of the Instance. An advisory lock serializes concurrent
   * setups: only one wins, the others find the setup completed. The route stays public
   * once the Instance is claimed: it refuses before hashing, which costs a libuv thread.
   */
  async setup(email: string, password: string): Promise<MemberView> {
    if (!(await this.setupRequired())) throw setupCompleted();
    const hash = await hashPassword(password);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('nudge:setup'))`);
      const [existing] = await tx.select({ id: members.id }).from(members).limit(1);
      if (existing) throw setupCompleted();
      return this.insert(tx, email, hash);
    });
  }

  /**
   * Creates a Member in a given transaction (invitation), from a password already
   * hashed (`hashPassword`) so that the transaction is not held open while it hashes;
   * 409 if the email is taken.
   */
  async create(tx: Transaction, email: string, passwordHash: string): Promise<MemberView> {
    return this.insert(tx, email, passwordHash);
  }

  /** The Member whose credentials match, or `null`. */
  async authenticate(email: string, password: string): Promise<MemberView | null> {
    const [member] = await this.db.select().from(members).where(eq(members.email, email)).limit(1);
    if (!member) {
      this.decoyHash ??= hashPassword('decoy');
      await verifyPassword(password, await this.decoyHash);
      return null;
    }
    const valid = await verifyPassword(password, member.passwordHash);
    return valid ? { id: member.id, email: member.email } : null;
  }

  private async insert(tx: Transaction, email: string, hash: string): Promise<MemberView> {
    try {
      const [member] = await tx
        .insert(members)
        .values({ email, passwordHash: hash })
        .returning({ id: members.id, email: members.email });
      if (!member) throw new Error('Member not created');
      return member;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException({ error: 'email_already_used' });
      throw error;
    }
  }
}
