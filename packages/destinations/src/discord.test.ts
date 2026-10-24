import type { DestinationConfiguree, EnvoiASortir } from '@nudge/core';
import { describe, expect, it } from 'vitest';
import { adaptateurDiscord } from './discord.js';
import { resolveDestinationAdapter } from './index.js';
import {
  DISCORD,
  MESSAGE_ID,
  SALON_ID,
  SERVEUR_ID,
  WEBHOOK_ID,
  WEBHOOK_JETON,
  type Enregistrement,
} from './test/discord-enregistrements.js';

const URL_WEBHOOK = `https://discord.com/api/webhooks/${WEBHOOK_ID}/${WEBHOOK_JETON}`;
const POINT_D_APPEL = `https://discord.com/api/v10/webhooks/${WEBHOOK_ID}/${WEBHOOK_JETON}`;

const DESTINATION: DestinationConfiguree = {
  id: '6f1c2a40-0000-4000-8000-000000000011',
  projetId: '6f1c2a40-0000-4000-8000-000000000012',
  nom: 'Salon #bugs',
  type: 'discord',
  config: {},
  secrets: { url: URL_WEBHOOK },
};

const ENVOI: EnvoiASortir = {
  envoiId: '6f1c2a40-0000-4000-8000-000000000013',
  essai: false,
  projet: { id: DESTINATION.projetId, nom: 'Boutique' },
  retour: {
    id: '6f1c2a40-0000-4000-8000-000000000014',
    texte: 'Le panier se vide quand je change de page.',
    source: 'widget',
    typeRetenu: 'bug',
    gravite: 'majeure',
    incertain: false,
    auteur: { id: 'u-42', email: 'ada@client.test', confiance: 'declaree' },
    contexte: { url: 'https://boutique.test/panier' },
    capture: null,
    recuLe: new Date('2026-10-24T09:29:58.000Z'),
    lienDashboard: 'https://nudge.exemple/retours/6f1c2a40-0000-4000-8000-000000000014',
  },
};

interface RequeteRecue {
  readonly url: string;
  readonly init: RequestInit;
  readonly entetes: Headers;
  readonly corps: string | null;
}

type Reponse = Enregistrement | Error | 'bloque';

/** Discord enregistré : rend les réponses données, dans l'ordre, et garde les requêtes. */
function discord(...reponses: Reponse[]) {
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
    return new Response(reponse.corps === undefined ? null : JSON.stringify(reponse.corps), {
      status: reponse.status,
      headers: { 'content-type': 'application/json', ...reponse.entetes },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requetes };
}

/** Un adaptateur neuf, avec son propre cache des serveurs. */
const adaptateur = (fetch: typeof globalThis.fetch, delaiMs?: number) =>
  adaptateurDiscord(DESTINATION, { fetch, delaiMs, serveurs: new Map() });

/** Ce que l'adaptateur poste à « Execute Webhook ». */
interface CorpsExecution {
  readonly content?: string;
  readonly allowed_mentions?: unknown;
  /** Un seul embed : le premier test le vérifie. */
  readonly embeds: readonly [
    {
      readonly title: string;
      readonly url?: string;
      readonly description: string;
      readonly timestamp: string;
      readonly fields: readonly { name: string; value: string; inline: boolean }[];
      readonly footer?: { text: string };
    },
  ];
}

const corpsJson = (requete: RequeteRecue | undefined) =>
  JSON.parse(requete!.corps!) as CorpsExecution;

describe('Adaptateur Discord', () => {
  it('exécute le webhook de salon avec un embed du Retour, et rend le lien du message', async () => {
    const { fetch, requetes } = discord(DISCORD.messageCree, DISCORD.webhook);

    const resultat = await adaptateur(fetch).send(ENVOI);

    expect(resultat).toEqual({
      statut: 'livre',
      lienExterne: `https://discord.com/channels/${SERVEUR_ID}/${SALON_ID}/${MESSAGE_ID}`,
    });
    const [execution] = requetes;
    expect(execution?.url).toBe(`${POINT_D_APPEL}?wait=true`);
    expect(execution?.init.method).toBe('POST');
    expect(execution?.entetes.get('content-type')).toBe('application/json');
    expect(execution?.entetes.get('user-agent')).toMatch(/^DiscordBot \(https?:\/\/\S+, [\w.]+\)/);
    const corps = corpsJson(execution);
    expect(corps.allowed_mentions).toEqual({ parse: [] });
    expect(corps.content).toBeUndefined();
    expect(corps.embeds).toHaveLength(1);
    expect(corps.embeds[0]).toMatchObject({
      title: 'Bug · Boutique',
      url: ENVOI.retour.lienDashboard,
      timestamp: '2026-10-24T09:29:58.000Z',
      fields: [
        { name: 'Type', value: 'Bug', inline: true },
        { name: 'Gravité', value: 'Majeure', inline: true },
        { name: 'Projet', value: 'Boutique', inline: true },
      ],
    });
    expect(corps.embeds[0].description).toContain('Le panier se vide quand je change de page.');
  });

  it('lit le serveur du salon sur le webhook pour composer le lien ; sans lui, livré sans lien', async () => {
    const { fetch, requetes } = discord(DISCORD.messageCree, DISCORD.passerelleIndisponible);

    expect(await adaptateur(fetch).send(ENVOI)).toEqual({ statut: 'livre', lienExterne: null });

    const lecture = requetes[1];
    expect(lecture?.url).toBe(POINT_D_APPEL);
    expect(lecture?.init.method ?? 'GET').toBe('GET');
    expect(lecture?.corps).toBeNull();
  });

  it.each([
    ['401 jeton invalide', 'auth', DISCORD.jetonInvalide],
    // « If a webhook returns a 404 status you should not attempt to use it again. »
    ['404 webhook supprimé', 'auth', DISCORD.webhookInconnu],
    ['400 corps refusé', 'permanent', DISCORD.corpsInvalide],
    // Un salon forum refuse tout Envoi : c'est la Destination qui est mal configurée.
    ['400 salon forum', 'auth', DISCORD.salonForum],
    ['429 limite de débit', 'transient', DISCORD.limiteDeDebit],
    ['502 passerelle', 'transient', DISCORD.passerelleIndisponible],
  ] as const)('classe une réponse %s : %s', async (_, classe, enregistrement) => {
    const { fetch, requetes } = discord(enregistrement);

    expect(await adaptateur(fetch).send(ENVOI)).toEqual({
      statut: 'echec',
      classe,
      message: expect.stringContaining(String(enregistrement.status)),
    });
    expect(requetes).toHaveLength(1);
  });

  it('reprend le message d’erreur de Discord, sans jamais le jeton du webhook', async () => {
    const { fetch } = discord(DISCORD.jetonInvalide);

    const resultat = await adaptateur(fetch).send(ENVOI);

    expect(resultat).toMatchObject({ message: expect.stringContaining('Invalid Webhook Token') });
    expect(JSON.stringify(resultat)).not.toContain(WEBHOOK_JETON);
  });

  it('ne suit pas les redirections : un 3xx est un échec permanent', async () => {
    const { fetch, requetes } = discord({ provenance: 'reconstituee', source: '', status: 301 });

    expect(await adaptateur(fetch).send(ENVOI)).toMatchObject({
      statut: 'echec',
      classe: 'permanent',
    });
    expect(requetes[0]?.init.redirect).toBe('manual');
  });

  it('une erreur réseau ou un délai dépassé est transitoire', async () => {
    expect(
      await adaptateur(discord(new TypeError('fetch failed')).fetch).send(ENVOI),
    ).toMatchObject({ statut: 'echec', classe: 'transient', message: 'fetch failed' });
    expect(await adaptateur(discord('bloque').fetch, 50).send(ENVOI)).toMatchObject({
      statut: 'echec',
      classe: 'transient',
    });
  });

  it('ne relit le serveur d’un webhook qu’une fois : il ne change pas', async () => {
    const { fetch, requetes } = discord(DISCORD.messageCree, DISCORD.webhook, DISCORD.messageCree);
    const serveurs = new Map<string, string>();
    const lien = `https://discord.com/channels/${SERVEUR_ID}/${SALON_ID}/${MESSAGE_ID}`;

    expect(await adaptateurDiscord(DESTINATION, { fetch, serveurs }).send(ENVOI)).toEqual({
      statut: 'livre',
      lienExterne: lien,
    });
    expect(await adaptateurDiscord(DESTINATION, { fetch, serveurs }).send(ENVOI)).toEqual({
      statut: 'livre',
      lienExterne: lien,
    });

    expect(requetes.map((r) => r.init.method ?? 'GET')).toEqual(['POST', 'GET', 'POST']);
  });

  it('marque le Retour d’essai et le Verdict incertain ; sans Gravité ni lien du dashboard', async () => {
    const { fetch, requetes } = discord(DISCORD.messageCree, DISCORD.webhook);
    const retour = { ...ENVOI.retour, gravite: null, incertain: true, lienDashboard: null };

    await adaptateur(fetch).send({ ...ENVOI, essai: true, retour });

    const [embed] = corpsJson(requetes[0]).embeds;
    expect(embed.title).toBe('Essai · Bug · Boutique');
    expect(embed.url).toBeUndefined();
    expect(embed.fields).toContainEqual({ name: 'Gravité', value: 'Non évaluée', inline: true });
    expect(embed.footer).toEqual({ text: 'nudge · Verdict incertain' });
  });

  describe('healthCheck', () => {
    it('lit le webhook avec son jeton, sans rien poster ; une réponse 200 le rend joignable', async () => {
      const { fetch, requetes } = discord(DISCORD.webhook);

      expect(await adaptateur(fetch).healthCheck()).toEqual({ joignable: true });

      expect(requetes).toHaveLength(1);
      expect(requetes[0]?.url).toBe(POINT_D_APPEL);
      expect(requetes[0]?.init.method ?? 'GET').toBe('GET');
      expect(requetes[0]?.corps).toBeNull();
    });

    it.each([
      ['401 jeton invalide', 'auth', DISCORD.jetonInvalide],
      ['404 webhook supprimé', 'auth', DISCORD.webhookInconnu],
      ['429 limite de débit', 'transient', DISCORD.limiteDeDebit],
      ['502 passerelle', 'transient', DISCORD.passerelleIndisponible],
    ] as const)('une réponse %s le rend injoignable (%s)', async (_, classe, enregistrement) => {
      const { fetch } = discord(enregistrement);

      expect(await adaptateur(fetch).healthCheck()).toEqual({
        joignable: false,
        classe,
        message: expect.stringContaining(String(enregistrement.status)),
      });
    });

    it('une erreur réseau le rend injoignable (transient)', async () => {
      const { fetch } = discord(new TypeError('fetch failed'));

      expect(await adaptateur(fetch).healthCheck()).toEqual({
        joignable: false,
        classe: 'transient',
        message: 'fetch failed',
      });
    });
  });

  describe('encodage du texte de l’Auteur', () => {
    const MALVEILLANT = [
      '@everyone @here URGENT <@80351110224678912> <@&165511591545143296> <#103735883630395392>',
      '[cliquez ici](https://piege.test/connexion) ou https://piege.test/direct',
      '**gras** _penché_ </airhorn:816437322781949972> <t:1618953630>',
      '```',
      'fin du bloc ? @everyone',
      '````js',
    ].join('\n');

    async function description(texte: string) {
      const { fetch, requetes } = discord(DISCORD.messageCree, DISCORD.webhook);
      await adaptateur(fetch).send({ ...ENVOI, retour: { ...ENVOI.retour, texte } });
      const corps = corpsJson(requetes[0]);
      return { corps, description: corps.embeds[0].description };
    }

    it('ne laisse aucune mention se déclencher', async () => {
      const { corps, description: texte } = await description(MALVEILLANT);

      // « parse: [] » : aucune mention n'est interprétée (docs.discord.com, Allowed Mentions).
      expect(corps.allowed_mentions).toEqual({ parse: [] });
      expect(corps.content).toBeUndefined();
      expect(texte).not.toMatch(/@(everyone|here)/);
    });

    it('enferme le texte dans un bloc de code qu’il ne peut pas refermer : ni markdown, ni lien cliquable', async () => {
      const { description: texte } = await description(MALVEILLANT);

      expect(texte.startsWith('```\n')).toBe(true);
      expect(texte.endsWith('\n```')).toBe(true);
      const interieur = texte.slice(4, -4);
      // Aucune suite de deux accents graves : le bloc ne se referme qu'à la fin.
      expect(interieur).not.toContain('``');
      // À l'œil, c'est le texte de l'Auteur, à des espaces sans chasse près.
      expect(interieur.replaceAll('\u200b', '')).toBe(MALVEILLANT);
    });

    it('tronque un texte trop long pour un embed', async () => {
      const { description: texte } = await description('a'.repeat(5000));

      expect(texte.length).toBeLessThanOrEqual(4096);
      expect(texte.endsWith('…\n```')).toBe(true);
    });

    it('échappe le nom du Projet, qui s’affiche en markdown', async () => {
      const { fetch, requetes } = discord(DISCORD.messageCree, DISCORD.webhook);
      const projet = { ...ENVOI.projet, nom: '[Boutique](https://piege.test) @everyone' };

      await adaptateur(fetch).send({ ...ENVOI, projet });

      const [embed] = corpsJson(requetes[0]).embeds;
      const champProjet = embed.fields.find((f) => f.name === 'Projet');
      expect(champProjet?.value).not.toContain('](');
      expect(champProjet?.value).not.toMatch(/@(everyone|here)/);
      expect(embed.title).not.toContain('](');
    });
  });

  it('est enregistré pour le type « discord » dans le registre des adaptateurs', async () => {
    const adaptateur = resolveDestinationAdapter(DESTINATION);

    expect(typeof adaptateur.send).toBe('function');
    expect(typeof adaptateur.healthCheck).toBe('function');
  });
});
