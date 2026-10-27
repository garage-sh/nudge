import { describe, expect, it, vi } from 'vitest';
import type { MembersService } from './members.service.js';
import { deriveSetupToken, setupTokenConfig, SetupTokenService } from './setup-token.js';

const KEY = 'ZHVtbXktdGVzdC1rZXktZXhhY3RseS0zMi1ieXRlcyE='; // gitleaks:allow (dummy key)
const OTHER_KEY = 'b3RoZXItdGVzdC1rZXktZXhhY3RseS0zMi1ieXRlcyE='; // gitleaks:allow (dummy key)

const service = (token: string, required: () => Promise<boolean>) =>
  new SetupTokenService({ token, source: 'derived' }, {
    setupRequired: required,
  } as unknown as MembersService);

describe('Setup token', () => {
  it('is derived from the Instance key: the same on every replica, different per Instance', () => {
    expect(deriveSetupToken(KEY)).toBe(deriveSetupToken(KEY));
    expect(deriveSetupToken(KEY)).not.toBe(deriveSetupToken(OTHER_KEY));
    expect(deriveSetupToken(KEY)).toMatch(/^[\w-]{43}$/);
  });

  it('is the one of NUDGE_SETUP_TOKEN when the Self-hoster sets it', () => {
    expect(setupTokenConfig('chosen by the self-hoster', KEY)).toEqual({
      token: 'chosen by the self-hoster',
      source: 'environment',
    });
    expect(setupTokenConfig(null, KEY)).toEqual({
      token: deriveSetupToken(KEY),
      source: 'derived',
    });
  });

  it('accepts only the exact token', () => {
    const setup = service('the-right-token', async () => true);

    expect(() => setup.verify('the-right-token')).not.toThrow();
    for (const wrong of ['the-right-toke', 'the-right-token ', '', 'THE-RIGHT-TOKEN']) {
      expect(() => setup.verify(wrong)).toThrow(
        expect.objectContaining({ response: { error: 'invalid_setup_token' } }),
      );
    }
  });

  it('prints the derived token at startup only while no Member exists', async () => {
    const logged = vi.fn();
    const open = service('printed-token', async () => true);
    const closed = service('hidden-token', async () => false);
    // Nest's Logger, replaced to read what the api prints.
    Object.assign(open, { logger: { log: logged } });
    Object.assign(closed, { logger: { log: logged } });

    await open.onApplicationBootstrap();
    await closed.onApplicationBootstrap();

    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('printed-token'));
  });
});
