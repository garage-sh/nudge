import type { DestinationConfiguree, EnvoiASortir } from '@nudge/core';
import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { resolveDestinationAdapter } from './index.js';
import { adaptateurLinear } from './linear.js';
import {
  CLE_API,
  EQUIPE_ID,
  ISSUE_URL,
  LABEL_BUG_ID,
  LABEL_URGENT_ID,
  LINEAR,
  type Enregistrement,
} from './test/linear-enregistrements.js';

const POINT_D_APPEL = 'https://api.linear.app/graphql';

const DESTINATION: DestinationConfiguree = {
  id: '6f1c2a40-0000-4000-8000-000000000021',
  projetId: '6f1c2a40-0000-4000-8000-000000000022',
  nom: 'Linear ENG',
  type: 'linear',
  config: {
    equipe: 'ENG',
    labels: { types: { bug: 'bug', suggestion: 'Idée' }, gravites: { bloquante: 'Urgent' } },
  },
  secrets: { cleApi: CLE_API },
};

const ENVOI: EnvoiASortir = {
  envoiId: '6f1c2a40-0000-4000-8000-000000000023',
  essai: false,
  projet: { id: DESTINATION.projetId, nom: 'Boutique' },
  retour: {
    id: '6f1c2a40-0000-4000-8000-000000000024',
    texte: 'Le panier se vide quand je change de page.\nDepuis ce matin.',
    source: 'widget',
    typeRetenu: 'bug',
    gravite: 'bloquante',
    incertain: false,
    auteur: { id: 'u-42', email: 'ada@client.test', confiance: 'declaree' },
    contexte: { url: 'https://boutique.test/panier' },
    recuLe: new Date('2026-10-24T09:29:58.000Z'),
    lienDashboard: 'https://nudge.exemple/retours/6f1c2a40-0000-4000-8000-000000000024',
  },
};

interface RequeteGraphQL {
  readonly url: string;
  readonly init: RequestInit;
  readonly entetes: Headers;
  readonly query: string;
  readonly variables: Record<string, unknown>;
}

type Reponse = Enregistrement | Error | 'bloque';

/** Linear enregistré : rend les réponses données, dans l'ordre, et garde les requêtes. */
function linear(...reponses: Reponse[]) {
  const requetes: RequeteGraphQL[] = [];
  let suivante = 0;
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    const { query, variables } = JSON.parse(String(init.body)) as {
      query: string;
      variables?: Record<string, unknown>;
    };
    requetes.push({
      url: String(url),
      init,
      entetes: new Headers(init.headers),
      query,
      variables: variables ?? {},
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

/** Un adaptateur neuf, avec son propre cache des équipes. */
const adaptateur = (
  fetch: typeof globalThis.fetch,
  {
    destination = DESTINATION,
    delaiMs,
  }: { destination?: DestinationConfiguree; delaiMs?: number } = {},
) => adaptateurLinear(destination, { fetch, delaiMs, equipes: new Map() });

/** L'entrée `issueCreate` d'une requête de création. */
const entreeCreation = (requete: RequeteGraphQL | undefined) =>
  requete!.variables.entree as {
    teamId: string;
    title: string;
    description: string;
    labelIds: string[];
  };

describe('Adaptateur Linear', () => {
  it('crée une issue dans l’équipe configurée, avec les labels du Type et de la Gravité, et rend son lien', async () => {
    const { fetch, requetes } = linear(LINEAR.equipe, LINEAR.issueCreee);

    const resultat = await adaptateur(fetch).send(ENVOI);

    expect(resultat).toEqual({ statut: 'livre', lienExterne: ISSUE_URL });
    expect(requetes).toHaveLength(2);
    for (const requete of requetes) {
      expect(requete.url).toBe(POINT_D_APPEL);
      expect(requete.init.method).toBe('POST');
      expect(requete.entetes.get('content-type')).toBe('application/json');
      // Clé d'API personnelle : « Authorization: <API_KEY> », sans « Bearer ».
      expect(requete.entetes.get('authorization')).toBe(CLE_API);
    }
    expect(requetes[0]?.variables).toEqual({ equipe: 'ENG' });
    expect(requetes[1]?.query).toMatch(/mutation[\s\S]*issueCreate\(input: \$entree\)/);
    const entree = entreeCreation(requetes[1]);
    expect(entree.teamId).toBe(EQUIPE_ID);
    expect(entree.labelIds).toEqual([LABEL_BUG_ID, LABEL_URGENT_ID]);
    expect(entree.title).toBe('Bug · Le panier se vide quand je change de page.');
    expect(entree.description).toContain('Le panier se vide quand je change de page');
  });

  it.each([
    ['400 clé refusée (authentication error)', 'auth', LINEAR.cleRefusee],
    ['401 sans corps GraphQL', 'auth', LINEAR.nonAutorise],
    ['forbidden', 'auth', LINEAR.accesRefuse],
    ['invalid input', 'permanent', LINEAR.entreeInvalide],
    ['400 RATELIMITED', 'transient', LINEAR.limiteDeDebit],
    ['internal error', 'transient', LINEAR.erreurInterne],
    ['503 sans JSON', 'transient', LINEAR.serviceIndisponible],
  ] as const)('classe un refus de la création « %s » : %s', async (_, classe, enregistrement) => {
    const { fetch, requetes } = linear(LINEAR.equipe, enregistrement);

    expect(await adaptateur(fetch).send(ENVOI)).toEqual({
      statut: 'echec',
      classe,
      message: expect.stringContaining(String(enregistrement.status)),
    });
    expect(requetes).toHaveLength(2);
  });

  it.each([
    ['clé refusée', 'auth', LINEAR.cleRefusee],
    ['limite de débit', 'transient', LINEAR.limiteDeDebit],
    ['503', 'transient', LINEAR.serviceIndisponible],
  ] as const)(
    'classe un refus de la lecture de l’équipe « %s » : %s, sans créer d’issue',
    async (_, classe, enregistrement) => {
      const { fetch, requetes } = linear(enregistrement);

      expect(await adaptateur(fetch).send(ENVOI)).toMatchObject({ statut: 'echec', classe });
      expect(requetes).toHaveLength(1);
    },
  );

  it('reprend le message d’erreur de Linear, sans jamais la clé d’API', async () => {
    const { fetch } = linear(LINEAR.equipe, LINEAR.cleRefusee);

    const resultat = await adaptateur(fetch).send(ENVOI);

    expect(resultat).toMatchObject({
      message: expect.stringContaining('Authentication required, not authenticated'),
    });
    expect(JSON.stringify(resultat)).not.toContain(CLE_API);
  });

  it('ne suit pas les redirections : un 3xx est un échec permanent', async () => {
    const { fetch, requetes } = linear({ provenance: 'reconstituee', source: '', status: 301 });

    expect(await adaptateur(fetch).send(ENVOI)).toMatchObject({
      statut: 'echec',
      classe: 'permanent',
    });
    expect(requetes[0]?.init.redirect).toBe('manual');
  });

  it('une erreur réseau ou un délai dépassé est transitoire', async () => {
    expect(await adaptateur(linear(new TypeError('fetch failed')).fetch).send(ENVOI)).toMatchObject(
      { statut: 'echec', classe: 'transient', message: 'fetch failed' },
    );
    expect(
      await adaptateur(linear(LINEAR.equipe, 'bloque').fetch, { delaiMs: 50 }).send(ENVOI),
    ).toMatchObject({ statut: 'echec', classe: 'transient' });
  });

  describe('équipe et labels', () => {
    const avecLabels = (labels: unknown): DestinationConfiguree => ({
      ...DESTINATION,
      config: { equipe: 'ENG', labels },
    });

    it('une équipe introuvable avec cette clé refuse la Destination (auth), sans créer d’issue', async () => {
      const { fetch, requetes } = linear(LINEAR.equipeInconnue);

      expect(await adaptateur(fetch).send(ENVOI)).toEqual({
        statut: 'echec',
        classe: 'auth',
        message: expect.stringContaining('ENG'),
      });
      expect(requetes).toHaveLength(1);
    });

    it('un label configuré introuvable dans Linear refuse la Destination (auth), en le nommant', async () => {
      const destination = avecLabels({ types: { bug: 'Défaut' }, gravites: {} });
      const { fetch, requetes } = linear(LINEAR.equipe);

      expect(await adaptateur(fetch, { destination }).send(ENVOI)).toEqual({
        statut: 'echec',
        classe: 'auth',
        message: expect.stringContaining('« Défaut »'),
      });
      expect(requetes).toHaveLength(1);
    });

    it('un groupe de labels, qu’une issue ne peut pas porter, compte comme introuvable', async () => {
      const destination = avecLabels({ types: { bug: 'Type' }, gravites: {} });
      const { fetch } = linear(LINEAR.equipe);

      expect(await adaptateur(fetch, { destination }).send(ENVOI)).toMatchObject({
        statut: 'echec',
        classe: 'auth',
      });
    });

    it('sans label mappé pour ce Type ni cette Gravité, crée l’issue sans label', async () => {
      const { fetch, requetes } = linear(LINEAR.equipe, LINEAR.issueCreee);
      const retour = { ...ENVOI.retour, typeRetenu: 'question' as const, gravite: null };

      expect(await adaptateur(fetch).send({ ...ENVOI, retour })).toMatchObject({ statut: 'livre' });
      expect(entreeCreation(requetes[1]).labelIds).toEqual([]);
    });

    it('ne relit l’équipe que si un label manque : une fois lue, une issue ne coûte qu’un appel', async () => {
      const equipes = new Map();
      const { fetch, requetes } = linear(LINEAR.equipe, LINEAR.issueCreee, LINEAR.issueCreee);

      for (let i = 0; i < 2; i++) {
        expect(await adaptateurLinear(DESTINATION, { fetch, equipes }).send(ENVOI)).toMatchObject({
          statut: 'livre',
        });
      }

      expect(requetes.map((r) => Object.keys(r.variables))).toEqual([
        ['equipe'],
        ['entree'],
        ['entree'],
      ]);
    });

    it('relit l’équipe quand un label configuré n’est pas encore connu (label créé depuis)', async () => {
      const equipes = new Map();
      const premier = linear(LINEAR.equipe, LINEAR.issueCreee);
      await adaptateurLinear(DESTINATION, { fetch: premier.fetch, equipes }).send(ENVOI);
      const suggestion = { ...ENVOI.retour, typeRetenu: 'suggestion' as const, gravite: null };
      const nouveau = avecLabels({ types: { suggestion: 'Nouveau' }, gravites: {} });
      const second = linear(LINEAR.equipe);

      expect(
        await adaptateurLinear(nouveau, { fetch: second.fetch, equipes }).send({
          ...ENVOI,
          retour: suggestion,
        }),
      ).toMatchObject({ statut: 'echec', classe: 'auth' });
      expect(Object.keys(second.requetes[0]!.variables)).toEqual(['equipe']);
    });
  });

  describe('healthCheck', () => {
    it('lit l’équipe et ses labels avec la clé, sans rien créer ; tout trouvé, la rend joignable', async () => {
      const { fetch, requetes } = linear(LINEAR.equipe);

      expect(await adaptateur(fetch).healthCheck()).toEqual({ joignable: true });

      expect(requetes).toHaveLength(1);
      expect(requetes[0]?.query).not.toMatch(/mutation/);
      expect(requetes[0]?.variables).toEqual({ equipe: 'ENG' });
    });

    it('vérifie chaque label configuré, pas seulement ceux d’un Envoi', async () => {
      const destination: DestinationConfiguree = {
        ...DESTINATION,
        config: { equipe: 'ENG', labels: { types: { bug: 'Bug' }, gravites: { mineure: 'Gêne' } } },
      };
      const { fetch } = linear(LINEAR.equipe);

      expect(await adaptateur(fetch, { destination }).healthCheck()).toEqual({
        joignable: false,
        classe: 'auth',
        message: expect.stringContaining('« Gêne »'),
      });
    });

    it.each([
      ['clé refusée', 'auth', LINEAR.cleRefusee],
      ['équipe introuvable', 'auth', LINEAR.equipeInconnue],
      ['limite de débit', 'transient', LINEAR.limiteDeDebit],
      ['503', 'transient', LINEAR.serviceIndisponible],
    ] as const)(
      'une réponse « %s » la rend injoignable (%s)',
      async (_, classe, enregistrement) => {
        const { fetch } = linear(enregistrement);

        expect(await adaptateur(fetch).healthCheck()).toEqual({
          joignable: false,
          classe,
          message: expect.any(String),
        });
      },
    );

    it('une erreur réseau la rend injoignable (transient)', async () => {
      expect(await adaptateur(linear(new TypeError('fetch failed')).fetch).healthCheck()).toEqual({
        joignable: false,
        classe: 'transient',
        message: 'fetch failed',
      });
    });
  });

  describe('issue créée', () => {
    async function entree(envoi: EnvoiASortir) {
      const { fetch, requetes } = linear(LINEAR.equipe, LINEAR.issueCreee);
      await adaptateur(fetch).send(envoi);
      return entreeCreation(requetes[1]);
    }

    it('titre : le Type et la première ligne du texte, bornée', async () => {
      const texte = `\n  ${'Très long '.repeat(30)}\nsuite`;

      const { title } = await entree({ ...ENVOI, retour: { ...ENVOI.retour, texte } });

      expect(title.startsWith('Bug · Très long Très long')).toBe(true);
      expect(title.length).toBeLessThanOrEqual(120);
      expect(title.endsWith('…')).toBe(true);
      expect(title).not.toContain('\n');
    });

    it('description : le texte, puis le Projet, le Type, la Gravité et le lien vers le Retour', async () => {
      const { description } = await entree(ENVOI);
      const html = new MarkdownIt().render(description);

      expect(html).toContain('Le panier se vide quand je change de page.<br>\nDepuis ce matin.');
      expect(html).toContain('<strong>Projet</strong> : Boutique');
      expect(html).toContain('<strong>Type</strong> : Bug');
      expect(html).toContain('<strong>Gravité</strong> : Bloquante');
      expect(html).toContain(
        `<a href="${ENVOI.retour.lienDashboard}">Voir le Retour dans nudge</a>`,
      );
      expect(html).not.toContain('incertain');
    });

    it('marque le Retour d’essai et le Verdict incertain ; sans Gravité ni lien du dashboard', async () => {
      const retour = { ...ENVOI.retour, gravite: null, incertain: true, lienDashboard: null };

      const { title, description } = await entree({ ...ENVOI, essai: true, retour });
      const html = new MarkdownIt().render(description);

      expect(title).toBe('Essai · Bug · Le panier se vide quand je change de page.');
      expect(html).toContain('<strong>Gravité</strong> : Non évaluée');
      expect(html).toContain('Verdict incertain');
      expect(html).not.toContain('<a ');
    });
  });

  describe('encodage du texte de l’Auteur', () => {
    const MALVEILLANT = [
      '# Titre piégé',
      '[cliquez ici](https://piege.test/connexion) ![pixel](https://piege.test/pixel.png)',
      '<https://piege.test/auto> https://piege.test/direct www.piege.test',
      '**gras** _penché_ ~~barré~~ `code` <img src=x onerror=alert(1)> &lt;b&gt;',
      '> citation',
      '- liste',
      '1. numérotée',
      '| a | b |',
      '```',
      'fin du bloc ? \\ @everyone :smile: $x$',
    ].join('\n');

    /** Les jetons markdown-it (CommonMark, liens nus reconnus) du texte de l'Auteur. */
    async function rendu(texte: string, projet = ENVOI.projet) {
      const { description } = await (async () => {
        const { fetch, requetes } = linear(LINEAR.equipe, LINEAR.issueCreee);
        const retour = { ...ENVOI.retour, texte, lienDashboard: null };
        await adaptateur(fetch).send({ ...ENVOI, projet, retour });
        return entreeCreation(requetes[1]);
      })();
      const md = new MarkdownIt({ html: true, linkify: true });
      const jetons = md
        .parse(description, {})
        .flatMap((jeton) => [jeton, ...(jeton.children ?? [])]);
      return { description, jetons };
    }

    it('aucun lien, image, HTML ni mise en forme ne sort du texte de l’Auteur', async () => {
      const { jetons } = await rendu(MALVEILLANT);

      const interdits = jetons.filter((jeton) =>
        /^(link_open|image|html_inline|html_block|heading_open|em_open|s_open|code_inline|fence|code_block|blockquote_open|bullet_list_open|ordered_list_open|table_open|hr)$/.test(
          jeton.type,
        ),
      );
      // Le pied de la description, écrit par nudge, est seul à porter du gras et un filet.
      expect(interdits.map((jeton) => jeton.type)).toEqual(['hr']);
    });

    it('le texte s’affiche tel que l’Auteur l’a écrit, ligne pour ligne', async () => {
      const { jetons } = await rendu(MALVEILLANT);

      const paragraphe = jetons.find((jeton) => jeton.type === 'inline')!;
      const affiche = (paragraphe.children ?? [])
        .map((jeton) =>
          jeton.type === 'hardbreak' || jeton.type === 'softbreak' ? '\n' : jeton.content,
        )
        .join('');
      expect(affiche).toBe(MALVEILLANT);
    });

    it('échappe aussi le nom du Projet', async () => {
      const { jetons } = await rendu('Rien à signaler', {
        ...ENVOI.projet,
        nom: '[Boutique](https://piege.test) <b>',
      });

      expect(jetons.some((jeton) => /^(link_open|html_inline)$/.test(jeton.type))).toBe(false);
    });
  });

  it('une création sans issue (success faux) est un échec permanent', async () => {
    const { fetch } = linear(LINEAR.equipe, LINEAR.creationRefusee);

    expect(await adaptateur(fetch).send(ENVOI)).toMatchObject({
      statut: 'echec',
      classe: 'permanent',
    });
  });

  it('après un refus de la création, relit l’équipe : un label supprimé depuis se révèle', async () => {
    const equipes = new Map();
    const { fetch, requetes } = linear(
      LINEAR.equipe,
      LINEAR.entreeInvalide,
      LINEAR.equipe,
      LINEAR.issueCreee,
    );

    await adaptateurLinear(DESTINATION, { fetch, equipes }).send(ENVOI);
    await adaptateurLinear(DESTINATION, { fetch, equipes }).send(ENVOI);

    expect(requetes.map((r) => Object.keys(r.variables)[0])).toEqual([
      'equipe',
      'entree',
      'equipe',
      'entree',
    ]);
  });

  it('est enregistré pour le type « linear » dans le registre des adaptateurs', () => {
    const adaptateur = resolveDestinationAdapter(DESTINATION);

    expect(typeof adaptateur.send).toBe('function');
    expect(typeof adaptateur.healthCheck).toBe('function');
  });
});
