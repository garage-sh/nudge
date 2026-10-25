import { Inject, Injectable } from '@nestjs/common';
import type { SecretCipher } from '@nudge/core';
import { JUDGE_KEY_CONTEXT, readInstanceJudge, type Db } from '@nudge/database';
import { createJudge, type JudgeConfig, type Judge } from '@nudge/judge';
import type { WorkerOptions } from './options.js';
import { DB, OPTIONS, SECRET_CIPHER } from './tokens.js';

/**
 * The Triage Judge. Unless the options pin a Judge (tests), it is the one the Instance
 * chose, read again from the database on every Triage: a change made in the dashboard
 * applies to the next Feedback, without restarting the worker. Failing that, the one
 * from the `NUDGE_JUDGE_*` variables; failing that, none (degraded mode).
 */
@Injectable()
export class JudgeResolver {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
  ) {}

  /** Throws if the stored key no longer decrypts (Instance key changed): the Triage is retried. */
  async current(): Promise<Judge | null> {
    if (this.options.judge !== undefined) return this.options.judge;
    const config = (await this.instanceConfig()) ?? this.options.defaultJudge ?? null;
    return config ? createJudge(config) : null;
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
