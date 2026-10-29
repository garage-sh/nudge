import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Mailer, SecretCipher } from '@nudge/core';
import {
  SMTP_PASSWORD_CONTEXT,
  readInstanceSmtp,
  writeInstanceSmtp,
  type Db,
  type StoredSmtp,
} from '@nudge/database';
import { smtpTestEmail } from '@nudge/destinations';
import type { DestinationTestResult, InstanceSmtpView, smtpSettingsSchema } from '@nudge/shared';
import type { z } from 'zod';
import { DB, MAILER, SECRET_CIPHER } from '../../infra/tokens.js';

type SmtpSettingsInput = z.output<typeof smtpSettingsSchema>;

const view = ({ encryptedPassword, ...smtp }: StoredSmtp): InstanceSmtpView => ({
  ...smtp,
  passwordConfigured: encryptedPassword !== null,
});

/**
 * The Instance's SMTP server, through which the email Destinations send: its password
 * only exists in clear long enough to encrypt it.
 */
@Injectable()
export class InstanceSmtpService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  async read(): Promise<InstanceSmtpView | null> {
    const smtp = await readInstanceSmtp(this.db);
    return smtp ? view(smtp) : null;
  }

  async configure(input: SmtpSettingsInput): Promise<InstanceSmtpView> {
    const current = await readInstanceSmtp(this.db);
    const smtp: StoredSmtp = {
      host: input.host,
      port: input.port,
      security: input.security,
      username: input.username ?? null,
      encryptedPassword: this.passwordAfter(input, current),
      fromAddress: input.fromAddress,
      fromName: input.fromName ?? null,
    };
    await writeInstanceSmtp(this.db, smtp);
    return view(smtp);
  }

  async remove(): Promise<void> {
    await writeInstanceSmtp(this.db, null);
  }

  /** "Send a test email": through the saved server, to the Member who asks. */
  async test(to: string): Promise<DestinationTestResult> {
    if (!(await readInstanceSmtp(this.db))) throw new NotFoundException({ error: 'smtp_missing' });
    return this.mailer.send(smtpTestEmail(to));
  }

  /**
   * A typed password is encrypted; `null` clears it. When absent, the stored password is
   * only kept for the same host and username: it must never go to a server that was
   * just changed.
   */
  private passwordAfter(input: SmtpSettingsInput, current: StoredSmtp | null): string | null {
    if (input.password !== undefined) {
      return input.password === null
        ? null
        : this.cipher.encrypt(input.password, SMTP_PASSWORD_CONTEXT);
    }
    const sameAccount =
      current !== null &&
      current.host.toLowerCase() === input.host.toLowerCase() &&
      current.username === (input.username ?? null);
    return sameAccount ? current.encryptedPassword : null;
  }
}
