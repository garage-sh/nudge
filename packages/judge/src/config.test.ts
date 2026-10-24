import { describe, expect, it } from 'vitest';
import { configJugeFromEnv, createJuge, type ConfigJuge } from './config.js';
import { noul } from './port.js';
import { TYPESAFE } from './test/enregistrements.js';

/** Un fetch qui note l'URL appelée et rend une réponse Noul valide. */
function fetchEspion() {
  const urls: string[] = [];
  const entetes: Headers[] = [];
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    urls.push(String(url));
    entetes.push(new Headers(init.headers));
    return new Response(JSON.stringify(TYPESAFE.noul.corps), { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, urls, entetes };
}

const requete = { state: { texte: 'Bonjour' }, questions: { billing: noul('Facturation ?') } };

describe('Juge choisi par configuration', () => {
  it.each([
    ['typesafe', 'https://api.typesafe.ai/v1/systemone'],
    ['openrouter', 'https://openrouter.ai/api/alpha/decisions'],
  ] as const)('%s : appelle l’API du fournisseur avec la clé', async (fournisseur, url) => {
    const espion = fetchEspion();
    const config: ConfigJuge = { fournisseur, cleApi: 'cle-factice', modele: null, urlBase: null };

    await createJuge(config, { fetch: espion.fetch }).juger(requete);

    expect(espion.urls).toEqual([url]);
    expect(espion.entetes[0]!.get('authorization')).toBe('Bearer cle-factice');
  });

  it('auto_heberge : appelle le serveur configuré, sans clé', async () => {
    const espion = fetchEspion();
    await createJuge(
      { fournisseur: 'auto_heberge', cleApi: null, modele: null, urlBase: 'http://decider:8080' },
      { fetch: espion.fetch },
    ).juger(requete);

    expect(espion.urls).toEqual(['http://decider:8080/v1/decisions']);
    expect(espion.entetes[0]!.has('authorization')).toBe(false);
  });

  it('refuse une configuration incomplète', () => {
    expect(() =>
      createJuge({ fournisseur: 'typesafe', cleApi: null, modele: null, urlBase: null }),
    ).toThrow(/clé/);
    expect(() =>
      createJuge({ fournisseur: 'auto_heberge', cleApi: null, modele: null, urlBase: null }),
    ).toThrow(/URL/);
  });
});

describe('Juge par variables d’environnement (repli)', () => {
  it('lit NUDGE_JUDGE_PROVIDER, _API_KEY, _MODEL et _BASE_URL', () => {
    expect(
      configJugeFromEnv({
        NUDGE_JUDGE_PROVIDER: 'openrouter',
        NUDGE_JUDGE_API_KEY: 'sk-or-factice',
        NUDGE_JUDGE_MODEL: 'typesafe/jev-1.14',
      }),
    ).toEqual({
      fournisseur: 'openrouter',
      cleApi: 'sk-or-factice',
      modele: 'typesafe/jev-1.14',
      urlBase: null,
    });
    expect(
      configJugeFromEnv({
        NUDGE_JUDGE_PROVIDER: 'auto_heberge',
        NUDGE_JUDGE_BASE_URL: 'http://decider:8080',
      }),
    ).toEqual({
      fournisseur: 'auto_heberge',
      cleApi: null,
      modele: null,
      urlBase: 'http://decider:8080',
    });
  });

  it('sans NUDGE_JUDGE_PROVIDER, pas de Juge (mode dégradé)', () => {
    expect(configJugeFromEnv({})).toBeNull();
    expect(configJugeFromEnv({ NUDGE_JUDGE_PROVIDER: '' })).toBeNull();
  });

  it('refuse au démarrage un fournisseur inconnu ou une configuration incomplète', () => {
    expect(() => configJugeFromEnv({ NUDGE_JUDGE_PROVIDER: 'gpt' })).toThrow(
      /NUDGE_JUDGE_PROVIDER/,
    );
    expect(() => configJugeFromEnv({ NUDGE_JUDGE_PROVIDER: 'typesafe' })).toThrow(
      /NUDGE_JUDGE_API_KEY/,
    );
    expect(() => configJugeFromEnv({ NUDGE_JUDGE_PROVIDER: 'auto_heberge' })).toThrow(
      /NUDGE_JUDGE_BASE_URL/,
    );
  });
});
