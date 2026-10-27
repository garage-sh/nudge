import { Inject, Injectable } from '@nestjs/common';
import type { SecretCipher } from '@nudge/core';
import { JUDGE_KEY_CONTEXT, readInstanceJudge, type Db } from '@nudge/database';
import { guardedFetch, STRICT_OUTBOUND_POLICY } from '@nudge/destinations';
import { createJudge, type JudgeConfig, type Judge } from '@nudge/judge';
import type { WorkerOptions } from './options.js';
import { DB, OPTIONS, SECRET_CIPHER } from './tokens.js';

/**
 * The Triage Judge. Unless the options pin a Judge (tests), it is the one the Instance
 * chose, read again from the database on every Triage: a change made in the dashboard
 * applies to the next Feedback, without restarting the worker. Failing that, the one
 * from the `NUDGE_JUDGE_*` variables; failing that, none (degraded mode).
 *
 * The Instance's Judge calls out through `outboundFetch`: its base URL was typed by a
 * Member, it reaches no internal host the Self-hoster did not allow.
 */
@Injectable()
export class JudgeResolver {
  private readonly outboundFetch: typeof globalThis.fetch;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
  ) {
    this.outboundFetch = options.outboundFetch ?? guardedFetch(STRICT_OUTBOUND_POLICY);
  }

  /** Throws if the stored key no longer decrypts (Instance key changed): the Triage is retried. */
  async current(): Promise<Judge | null> {
    if (this.options.judge !== undefined) return this.options.judge;
    const instance = await this.instanceConfig();
    if (instance) return createJudge(instance, { fetch: this.outboundFetch });
    return this.options.defaultJudge ? createJudge(this.options.defaultJudge) : null;
  }

  private async instanceConfig(): Promise<JudgeConfig | null> {
    const judge = await readInstanceJudge(this.db);
    if (!judge.provider) return null;
    return {
      provider: judge.provider,
      model: judge.model,
      baseUrl: judge.baseUrl,
      apiKey: judge.encryptedKey
        ? this.cipher.decrypt(judge.encryptedKey, JUDGE_KEY_CONTEXT)
        : null,
    };
  }
}
