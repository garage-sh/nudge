import type { DestinationConfiguree, EnvoiASortir } from '@nudge/core';
import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { adaptateurGitHub } from './github.js';
import { resolveDestinationAdapter } from './index.js';
import {
  GITHUB,
  ISSUE_URL,
  JETON,
  NOM_DEPOT,
  PROPRIETAIRE,
  type Enregistrement,
} from './test/github-enregistrements.js';

const API_DEPOT = `https://api.github.com/repos/${PROPRIETAIRE}/${NOM_DEPOT}`;

const DESTINATION: DestinationConfiguree = {
  id: '6f1c2a40-0000-4000-8000-000000000041',
  projetId: '6f1c2a40-0000-4000-8000-000000000042',
  nom: 'Issues boutique-web',
  type: 'github',
  config: { depot: `${PROPRIETAIRE}/${NOM_DEPOT}` },
  secrets: { jeton: JETON },
};

const ENVOI: EnvoiASortir = {
  envoiId: '6f1c2a40-0000-4000-8000-000000000043',
  essai: false,
  projet: { id: DESTINATION.projetId, nom: 'Boutique' },
  retour: {
    id: '6f1c2a40-0000-4000-8000-000000000044',
    texte: 'Le panier se vide quand je change de page.\nDepuis ce matin.',
    source: 'widget',
    typeRetenu: 'bug',
    gravite: 'majeure',
    incertain: false,
    auteur: { id: 'u-42', email: 'ada@client.test', confiance: 'declaree' },
    contexte: { url: 'https://boutique.test/panier' },
    capture: null,
    recuLe: new Date('2026-10-24T09:29:58.000Z'),
    lienDashboard: 'https://nudge.exemple/retours/6f1c2a40-0000-4000-8000-000000000044',
  },
};

interface RequeteRecue {
  readonly url: string;
  readonly init: RequestInit;
  readonly entetes: Headers;
  readonly corps: string | null;
}

type Reponse = Enregistrement | Error | 'bloque';

/** GitHub enregistré : rend les réponses données, dans l'ordre, et garde les requêtes. */
function github(...reponses: Reponse[]) {
  const requetes: RequeteRecue[] = [];
  let suivante = 0;
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    requetes.push({
      url: String(url),
      init,
      entetes: new Headers(init.headers),
      corps: init.body === undefined ? null : String(init.body),
    });
    const reponse = reponses[Math.min(suivante++, reponses.length - 1)];
    if (!reponse) throw new Error('Aucune réponse enregistrée');
    if (reponse instanceof Error) throw reponse;
    if (reponse === 'bloque') {
      // Ne répond jamais : seul le délai de l'adaptateur (signal) l'interrompt.
      return new Promise<Response>((_, reject) =>
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
      );
    }
    const texte = typeof reponse.corps === 'string';
    return new Response(texte ? (reponse.corps as string) : JSON.stringify(reponse.corps), {
      status: reponse.status,
      headers: {
        'content-type': texte ? 'text/html' : 'application/json; charset=utf-8',
        ...reponse.entetes,
      },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requetes };
}

const adaptateur = (fetch: typeof globalThis.fetch, delaiMs?: number) =>
  adaptateurGitHub(DESTINATION, { fetch, delaiMs });

/** Ce que l'adaptateur poste à « Create an issue ». */
interface CorpsIssue {
  readonly title: string;
  readonly body: string;
}

const corpsJson = (requete: RequeteRecue | undefined) => JSON.parse(requete!.corps!) as CorpsIssue;

describe('Adaptateur GitHub Issues', () => {
  it('crée une issue dans le dépôt configuré et rend son lien', async () => {
    const { fetch, requetes } = github(GITHUB.issueCreee);

    expect(await adaptateur(fetch).send(ENVOI)).toEqual({
      statut: 'livre',
      lienExterne: ISSUE_URL,
    });

    expect(requetes).toHaveLength(1);
    const [requete] = requetes;
    expect(requete?.url).toBe(`${API_DEPOT}/issues`);
    expect(requete?.init.method).toBe('POST');
    expect(requete?.init.redirect).toBe('manual');
    expect(requete?.entetes.get('authorization')).toBe(`Bearer ${JETON}`);
    expect(requete?.entetes.get('accept')).toBe('application/vnd.github+json');
    expect(requete?.entetes.get('x-github-api-version')).toBe('2026-03-10');
    // « Requests without a valid User-Agent header will be rejected. »
    expect(requete?.entetes.get('user-agent')).toMatch(/^nudge/);
    expect(requete?.entetes.get('content-type')).toBe('application/json');
    const corps = corpsJson(requete);
    expect(Object.keys(corps).sort()).toEqual(['body', 'title']);
    expect(corps.title).toBe('Bug · Le panier se vide quand je change de page.');
    expect(corps.body).toContain('Le panier se vide quand je change de page.\nDepuis ce matin.');
    expect(corps.body).toContain('**Type** : Bug · **Gravité** : Majeure');
    expect(corps.body).toContain(`[Voir le Retour dans nudge](<${ENVOI.retour.lienDashboard}>)`);
  });

  it.each([
    ['401 identifiants invalides', 'auth', GITHUB.identifiantsInvalides],
    ['403 permission refusée', 'auth', GITHUB.permissionRefusee],
    // Dépôt inconnu ou hors de portée du jeton, issues désactivées : chaque Envoi
    // échouerait, la Destination est Suspendue (D21).
    ['404 dépôt introuvable', 'auth', GITHUB.introuvable],
    ['410 issues désactivées', 'auth', GITHUB.issuesDesactivees],
    ['400 requête invalide', 'permanent', GITHUB.requeteInvalide],
    ['422 validation échouée', 'permanent', GITHUB.validationEchouee],
    // Une limite de débit n'est pas un refus, même en 403.
    ['403 limite primaire', 'transient', GITHUB.limitePrimaire],
    ['403 limite secondaire', 'transient', GITHUB.limiteSecondaire],
    ['429 limite secondaire', 'transient', GITHUB.limite429],
    ['503 indisponible', 'transient', GITHUB.indisponible],
  ] as const)('classe une réponse %s : %s', async (_, classe, enregistrement) => {
    const { fetch, requetes } = github(enregistrement);

    expect(await adaptateur(fetch).send(ENVOI)).toEqual({
      statut: 'echec',
      classe,
      message: expect.stringContaining(String(enregistrement.status)),
    });
    expect(requetes).toHaveLength(1);
  });

  it('reprend le message de GitHub, sans jamais le jeton', async () => {
    const { fetch } = github(GITHUB.identifiantsInvalides);

    const resultat = await adaptateur(fetch).send(ENVOI);

    expect(resultat).toMatchObject({ message: expect.stringContaining('Bad credentials') });
    expect(JSON.stringify(resultat)).not.toContain(JETON);
  });

  it('un dépôt renommé ou transféré (3xx, non suivi) refuse la Destination', async () => {
    const { fetch, requetes } = github(GITHUB.deplace);

    expect(await adaptateur(fetch).send(ENVOI)).toEqual({
      statut: 'echec',
      classe: 'auth',
      message: expect.stringContaining('301'),
    });
    expect(requetes[0]?.init.redirect).toBe('manual');
  });

  it('une erreur réseau ou un délai dépassé est transitoire', async () => {
    expect(await adaptateur(github(new TypeError('fetch failed')).fetch).send(ENVOI)).toMatchObject(
      { statut: 'echec', classe: 'transient', message: 'fetch failed' },
    );
    expect(await adaptateur(github('bloque').fetch, 50).send(ENVOI)).toMatchObject({
      statut: 'echec',
      classe: 'transient',
    });
  });

  describe('healthCheck', () => {
    it('lit le dépôt avec le jeton, sans rien créer ; issues ouvertes : joignable', async () => {
      const { fetch, requetes } = github(GITHUB.depot);

      expect(await adaptateur(fetch).healthCheck()).toEqual({ joignable: true });

      expect(requetes).toHaveLength(1);
      expect(requetes[0]?.url).toBe(API_DEPOT);
      expect(requetes[0]?.init.method ?? 'GET').toBe('GET');
      expect(requetes[0]?.corps).toBeNull();
      expect(requetes[0]?.entetes.get('authorization')).toBe(`Bearer ${JETON}`);
    });

    it.each([
      ['aux issues désactivées', { has_issues: false }],
      ['archivé', { archived: true }],
    ])('un dépôt %s refuse la Destination (auth)', async (_, champs) => {
      const depot = { ...GITHUB.depot, corps: { ...GITHUB.depot.corps, ...champs } };

      expect(await adaptateur(github(depot).fetch).healthCheck()).toEqual({
        joignable: false,
        classe: 'auth',
        message: expect.stringContaining(`${PROPRIETAIRE}/${NOM_DEPOT}`),
      });
    });

    it.each([
      ['401 identifiants invalides', 'auth', GITHUB.identifiantsInvalides],
      ['404 dépôt introuvable', 'auth', GITHUB.introuvable],
      ['301 dépôt déplacé', 'auth', GITHUB.deplace],
      ['403 limite primaire', 'transient', GITHUB.limitePrimaire],
      ['503 indisponible', 'transient', GITHUB.indisponible],
    ] as const)('une réponse %s le rend injoignable (%s)', async (_, classe, enregistrement) => {
      expect(await adaptateur(github(enregistrement).fetch).healthCheck()).toEqual({
        joignable: false,
        classe,
        message: expect.stringContaining(String(enregistrement.status)),
      });
    });

    it('une erreur réseau le rend injoignable (transient)', async () => {
      expect(await adaptateur(github(new TypeError('fetch failed')).fetch).healthCheck()).toEqual({
        joignable: false,
        classe: 'transient',
        message: 'fetch failed',
      });
    });
  });

  it('marque le Retour d’essai et le Verdict incertain ; sans Gravité ni lien du dashboard', async () => {
    const { fetch, requetes } = github(GITHUB.issueCreee);
    const retour = { ...ENVOI.retour, gravite: null, incertain: true, lienDashboard: null };

    await adaptateur(fetch).send({ ...ENVOI, essai: true, retour });

    const corps = corpsJson(requetes[0]);
    expect(corps.title).toBe('Essai · Bug · Le panier se vide quand je change de page.');
    expect(corps.body).toContain('**Gravité** : Non évaluée');
    expect(corps.body).toContain('**Verdict incertain**');
    expect(corps.body).not.toContain('Voir le Retour');
  });

  describe('encodage du texte de l’Auteur', () => {
    const MALVEILLANT = [
      '@everyone merci @octocat et @garage-sh/maintainers',
      'Voir #1, garage-sh/nudge#2, GH-3 et a5c3785ed8d6a35868bc169f07e40e889087fd2e',
      '[cliquez](https://piege.test/connexion) ![pixel](https://piege.test/p.png) https://piege.test/direct',
      '<img src=x onerror=alert(1)> <details><summary>ouvrir</summary></details>',
      '# Titre',
      '```',
      'fin du bloc ?',
      '````js',
      '~~~',
      '    indenté',
      '- [ ] liste',
    ].join('\n');

    const md = new MarkdownIt({ html: true, linkify: true });

    async function issue(texte: string, projet = ENVOI.projet) {
      const { fetch, requetes } = github(GITHUB.issueCreee);
      await adaptateur(fetch).send({ ...ENVOI, projet, retour: { ...ENVOI.retour, texte } });
      return corpsJson(requetes[0]);
    }

    /** Les jetons markdown-it (CommonMark, HTML et liens nus reconnus) du corps. */
    const jetons = (corps: string) =>
      md.parse(corps, {}).flatMap((jeton) => [jeton, ...(jeton.children ?? [])]);

    it('rend le texte dans un bloc de code qu’il ne peut pas refermer, tel quel', async () => {
      const { body } = await issue(MALVEILLANT);

      const [premier] = md.parse(body, {});
      expect(premier?.type).toBe('fence');
      expect(premier?.content).toBe(`${MALVEILLANT}\n`);
      // Un bloc de code est littéral (spec GFM, « Fenced code blocks ») : ni mention, ni
      // référence d'issue, ni lien, ni image, ni HTML.
      expect(jetons(body).filter((j) => j.type === 'fence')).toHaveLength(1);
    });

    it('ne laisse ni lien, ni image, ni HTML hors du lien vers nudge', async () => {
      const { body } = await issue(MALVEILLANT);

      const types = jetons(body).map((j) => j.type);
      expect(types).not.toContain('image');
      expect(types).not.toContain('html_block');
      expect(types).not.toContain('html_inline');
      const liens = jetons(body).filter((j) => j.type === 'link_open');
      expect(liens.map((j) => j.attrGet('href'))).toEqual([ENVOI.retour.lienDashboard]);
    });

    it('garde les retours à la ligne et l’indentation ; normalise les fins de ligne', async () => {
      const { body } = await issue('a\r\n  b\rc');

      expect(md.parse(body, {})[0]?.content).toBe('a\n  b\nc\n');
    });

    it('tronque un texte trop long pour une issue, bloc de code compris', async () => {
      const { body } = await issue('a'.repeat(70_000));

      expect(body.length).toBeLessThanOrEqual(65_536);
      const [premier] = md.parse(body, {});
      expect(premier?.type).toBe('fence');
      expect(premier?.content.endsWith('…\n')).toBe(true);
    });

    it('reste sous la limite même quand la clôture s’allonge (longue suite d’accents graves)', async () => {
      const texte = `${'`'.repeat(40_000)}\n${'a'.repeat(40_000)}`;
      const { body } = await issue(texte);

      expect(body.length).toBeLessThanOrEqual(65_536);
      const [premier] = md.parse(body, {});
      expect(premier?.type).toBe('fence');
      expect(md.parse(body, {}).filter((j) => j.type === 'fence')).toHaveLength(1);
    });

    it('coupe les mentions du titre, qui reprend la première ligne', async () => {
      const { title } = await issue('@everyone @octocat le panier se vide');

      expect(title).not.toMatch(/@(everyone|octocat)/);
      expect(title.replaceAll('\u200b', '')).toBe('Bug · @everyone @octocat le panier se vide');
    });

    it('échappe le nom du Projet : ni lien, ni mention', async () => {
      const { body } = await issue('Bonjour', {
        ...ENVOI.projet,
        nom: '[Boutique](https://piege.test) @garage-sh/maintainers',
      });

      const liens = jetons(body).filter((j) => j.type === 'link_open');
      expect(liens.map((j) => j.attrGet('href'))).toEqual([ENVOI.retour.lienDashboard]);
      const texte = jetons(body)
        .filter((j) => j.type === 'text')
        .map((j) => j.content)
        .join('');
      expect(texte).toContain('[Boutique](https://piege.test)');
      expect(texte).not.toContain('@garage-sh');
    });
  });

  it('est enregistré pour le type « github » dans le registre des adaptateurs', () => {
    const resolu = resolveDestinationAdapter(DESTINATION);

    expect(typeof resolu.send).toBe('function');
    expect(typeof resolu.healthCheck).toBe('function');
  });
});
