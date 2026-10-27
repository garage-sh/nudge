import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { MembersService } from './members.service.js';

/** Nest injection token of the `SetupTokenConfig`. */
export const SETUP_TOKEN_CONFIG = Symbol('SETUP_TOKEN_CONFIG');

export interface SetupTokenConfig {
  /** The token required by `POST /api/setup`. */
  readonly token: string;
  /** `environment`: the Self-hoster chose it (`NUDGE_SETUP_TOKEN`), it is never logged. */
  readonly source: 'environment' | 'derived';
}

/**
 * The setup token derived from the Instance key: every api replica computes the same
 * one without storing anything, and it never changes. It only opens the setup, which
 * closes for good with the first Member; the HMAC does not reveal the key.
 */
export function deriveSetupToken(encryptionKey: string): string {
  return createHmac('sha256', encryptionKey).update('nudge:setup-token').digest('base64url');
}

/** The setup token: `NUDGE_SETUP_TOKEN` if set, derived from the Instance key otherwise. */
export function setupTokenConfig(
  setupToken: string | null | undefined,
  encryptionKey: string,
): SetupTokenConfig {
  return setupToken
    ? { token: setupToken, source: 'environment' }
    : { token: deriveSetupToken(encryptionKey), source: 'derived' };
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Closes the window between deployment and first setup: `POST /api/setup` requires a
 * token that only someone with access to the server knows (api logs, environment).
 * While no Member exists, the api prints it at startup.
 */
@Injectable()
export class SetupTokenService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Setup');

  constructor(
    @Inject(SETUP_TOKEN_CONFIG) private readonly config: SetupTokenConfig,
    private readonly members: MembersService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    let required: boolean;
    try {
      required = await this.members.setupRequired();
    } catch {
      // Database not reachable or not migrated yet: the token is printed just in case.
      required = true;
    }
    if (!required) return;
    this.logger.log(
      this.config.source === 'environment'
        ? 'No Member yet: create the first account on the dashboard with the setup token set in NUDGE_SETUP_TOKEN.'
        : `No Member yet: create the first account on the dashboard with the setup token ${this.config.token}`,
    );
  }

  /** 403 `invalid_setup_token` unless `candidate` is the token; compared in constant time. */
  verify(candidate: string): void {
    if (!timingSafeEqual(digest(candidate), digest(this.config.token))) {
      throw new ForbiddenException({ error: 'invalid_setup_token' });
    }
  }
}
