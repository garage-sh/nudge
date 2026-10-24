import { describe, expect, it, vi } from 'vitest';
import { creerClient } from './index.js';

describe('creerClient', () => {
  it.each([
    ['la clé publique du Projet', 'nk_pub_AbCdEf', /clé publique/i],
    ['une chaîne qui n’est pas une clé nudge', 'sk_live_123', /nk_sec_/],
  ])('refuse %s avant tout appel réseau', (_cas, cle, message) => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    expect(() => creerClient({ url: 'https://nudge.exemple', cleSecrete: cle, fetch })).toThrow(
      message,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
