import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { members, type Db } from '@nudge/database';
import type { MemberListItemView, MemberView } from '@nudge/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { DB } from '../../infra/tokens.js';
import { hashPassword, verifyPassword } from './password.js';

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Postgres unique violation, which drizzle surfaces as is or wraps. */
export const isUniqueViolation = (error: unknown): boolean => {
  const code = (e: unknown) => (e as { code?: string } | null)?.code;
  return code(error) === '23505' || code((error as { cause?: unknown })?.cause) === '23505';
};

@Injectable()
export class MembersService {
  /** Hash compared against when the email is unknown: the response takes the same time. */
  private decoyHash: Promise<string> | null = null;

  constructor(@Inject(DB) private readonly db: Db) {}

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

  async setupRequired(): Promise<boolean> {
    const [first] = await this.db.select({ id: members.id }).from(members).limit(1);
    return !first;
  }

  /**
   * Creates the first Member of the Instance. An advisory lock serializes concurrent
   * setups: only one wins, the others find the setup completed.
   */
  async setup(email: string, password: string): Promise<MemberView> {
    const hash = await hashPassword(password);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('nudge:setup'))`);
      const [existing] = await tx.select({ id: members.id }).from(members).limit(1);
      if (existing) throw new ConflictException({ error: 'setup_completed' });
      return this.insert(tx, email, hash);
    });
  }

  /** Creates a Member in a given transaction (invitation); 409 if the email is taken. */
  async create(tx: Transaction, email: string, password: string): Promise<MemberView> {
    return this.insert(tx, email, await hashPassword(password));
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
