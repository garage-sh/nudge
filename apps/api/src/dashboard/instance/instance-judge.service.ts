import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { SecretCipher } from '@nudge/core';
import {
  NO_JUDGE,
  JUDGE_KEY_CONTEXT,
  readInstanceJudge,
  writeInstanceJudge,
  type Db,
  type StoredJudge,
} from '@nudge/database';
import {
  requiresApiKey,
  type ApiErrorBody,
  type InstanceJudgeView,
  type judgeChoiceSchema,
} from '@nudge/shared';
import type { z } from 'zod';
import { DB, SECRET_CIPHER } from '../../infra/tokens.js';

type JudgeChoice = z.output<typeof judgeChoiceSchema>;

const view = (judge: StoredJudge): InstanceJudgeView => ({
  provider: judge.provider,
  model: judge.model,
  baseUrl: judge.baseUrl,
  keyConfigured: judge.encryptedKey !== null,
});

/** The Instance's Judge: its API key only exists in clear long enough to encrypt it. */
@Injectable()
export class InstanceJudgeService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
  ) {}

  async read(): Promise<InstanceJudgeView> {
    return view(await readInstanceJudge(this.db));
  }

  async choose(choice: JudgeChoice): Promise<InstanceJudgeView> {
    const current = await readInstanceJudge(this.db);
    const judge: StoredJudge = choice.provider
      ? {
          provider: choice.provider,
          model: choice.model ?? null,
          baseUrl: choice.baseUrl ?? null,
          encryptedKey: this.keyAfter(choice, current),
        }
      : NO_JUDGE;

    if (judge.provider && requiresApiKey(judge.provider) && !judge.encryptedKey) {
      const refusal: ApiErrorBody = {
        error: 'invalid_request',
        details: [{ path: 'apiKey', message: `API key required for the ${judge.provider} Judge` }],
      };
      throw new BadRequestException(refusal);
    }
    await writeInstanceJudge(this.db, judge);
    return view(judge);
  }

  /**
   * A provided key is encrypted; `null` clears it. When absent, the stored key is only
   * kept for the same provider at the same address: it must never go to a host that
   * was just changed.
   */
  private keyAfter(choice: JudgeChoice, current: StoredJudge): string | null {
    if (choice.apiKey !== undefined) {
      return choice.apiKey === null ? null : this.cipher.encrypt(choice.apiKey, JUDGE_KEY_CONTEXT);
    }
    const sameServer =
      choice.provider === current.provider &&
      serverAddress(choice.baseUrl ?? null) === serverAddress(current.baseUrl);
    return sameServer ? current.encryptedKey : null;
  }
}

/**
 * A base URL as the Judge adapters call it: host case, default port and trailing
 * slashes do not change the server. An unparsable value stays as is (never equal to
 * another server's).
 */
function serverAddress(baseUrl: string | null): string | null {
  if (baseUrl === null) return null;
  const url = URL.parse(baseUrl);
  return url ? url.href.replace(/\/+$/, '') : baseUrl;
}
