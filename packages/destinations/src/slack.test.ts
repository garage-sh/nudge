import type { DestinationConfiguree, EnvoiASortir } from '@nudge/core';
import { describe, expect, it } from 'vitest';
import { resolveDestinationAdapter } from './index.js';
import { adaptateurSlack } from './slack.js';
import {
  EQUIPE_ID,
  SERVICE_ID,
  SLACK,
  WEBHOOK_JETON,
  type Enregistrement,
} from './test/slack-enregistrements.js';

const URL_WEBHOOK = `https://hooks.slack.com/services/${EQUIPE_ID}/${SERVICE_ID}/${WEBHOOK_JETON}`;

const DESTINATION: DestinationConfiguree = {
  id: '6f1c2a40-0000-4000-8000-000000000031',
  projetId: '6f1c2a40-0000-4000-8000-000000000032',
  nom: 'Canal #bugs',
  type: 'slack',
  config: {},
  secrets: { url: URL_WEBHOOK },
};

const ENVOI: EnvoiASortir = {
  envoiId: '6f1c2a40-0000-4000-8000-000000000033',
  essai: false,
  projet: { id: DESTINATION.projetId, nom: 'Boutique' },
  retour: {
    id: '6f1c2a40-0000-4000-8000-000000000034',
    texte: 'Le panier se vide quand je change de page.',
    source: 'widget',
    typeRetenu: 'bug',
    gravite: 'majeure',
    incertain: false,
    auteur: { id: 'u-42', email: 'ada@client.test', confiance: 'declaree' },
    contexte: { url: 'https://boutique.test/panier' },
    capture: null,
    recuLe: new Date('2026-10-24T09:29:58.000Z'),
    lienDashboard: 'https://nudge.exemple/retours/6f1c2a40-0000-4000-8000-000000000034',
  },
};

interface RequeteRecue {
  readonly url: string;
  readonly init: RequestInit;
  readonly entetes: Headers;
  readonly corps: string | null;
}

type Reponse = Enregistrement | Error | 'bloque';

/** Slack enregistré : rend les réponses données, dans l'ordre, et garde les requêtes. */
function slack(...reponses: Reponse[]) {
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
    return new Response(reponse.corps, {
      status: reponse.status,
      headers: { 'content-type': 'text/plain', ...reponse.entetes },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requetes };
}

const adaptateur = (fetch: typeof globalThis.fetch, delaiMs?: number) =>
  adaptateurSlack(DESTINATION, { fetch, delaiMs });

interface ObjetTexte {
  readonly type: string;
  readonly text: string;
  readonly verbatim?: boolean;
}

interface Bloc {
  readonly type: string;
  readonly text?: ObjetTexte;
  readonly fields?: readonly ObjetTexte[];
  readonly elements?: readonly ObjetTexte[];
}

/** Ce que l'adaptateur poste au webhook entrant. */
interface CorpsMessage {
  readonly text: string;
  readonly blocks: readonly Bloc[];
}

const corpsJson = (requete: RequeteRecue | undefined) =>
  JSON.parse(requete!.corps!) as CorpsMessage;

/** Tous les textes du message, blocs compris. */
const textes = (corps: CorpsMessage): ObjetTexte[] =>
  corps.blocks.flatMap((bloc) => [
    ...(bloc.text ? [bloc.text] : []),
    ...(bloc.fields ?? []),
    ...(bloc.elements ?? []),
  ]);

describe('Adaptateur Slack', () => {
  it('poste le Retour au webhook entrant en blocs ; livré, sans lien (le webhook n’en rend pas)', async () => {
    const { fetch, requetes } = slack(SLACK.ok);

    expect(await adaptateur(fetch).send(ENVOI)).toEqual({ statut: 'livre', lienExterne: null });

    expect(requetes).toHaveLength(1);
    const [requete] = requetes;
    expect(requete?.url).toBe(URL_WEBHOOK);
    expect(requete?.init.method).toBe('POST');
    expect(requete?.init.redirect).toBe('manual');
    expect(requete?.entetes.get('content-type')).toBe('application/json');
    const corps = corpsJson(requete);
    // Texte de repli (notifications) : jamais le texte de l'Auteur.
    expect(corps.text).toBe('Bug · Boutique');
    const contenu = textes(corps).map((t) => t.text);
    expect(contenu.join('\n')).toContain('Le panier se vide quand je change de page.');
    expect(contenu).toContainEqual('*Type*\nBug');
    expect(contenu).toContainEqual('*Gravité*\nMajeure');
    expect(contenu).toContainEqual('*Projet*\nBoutique');
    expect(contenu.join('\n')).toContain(
      `<${ENVOI.retour.lienDashboard}|Voir le Retour dans nudge>`,
    );
  });

  it.each([
    // Le message de ce Retour est refusé : les suivants peuvent passer.
    ['400 invalid_payload', 'permanent', SLACK.invalidPayload],
    ['400 no_text', 'permanent', SLACK.noText],
    ['400 too_many_attachments', 'permanent', SLACK.tooManyAttachments],
    // Le webhook, son canal ou l'espace de travail refusent tout Envoi (D21).
    ['400 user_not_found', 'auth', SLACK.userNotFound],
    ['403 action_prohibited', 'auth', SLACK.actionProhibited],
    ['403 invalid_token', 'auth', SLACK.invalidToken],
    ['403 posting_to_general_channel_denied', 'auth', SLACK.postingToGeneralChannelDenied],
    ['404 channel_not_found', 'auth', SLACK.channelNotFound],
    ['404 no_service', 'auth', SLACK.noService],
    ['410 channel_is_archived', 'auth', SLACK.channelIsArchived],
    ['429 limite de débit', 'transient', SLACK.limiteDeDebit],
    ['500 rollup_error', 'transient', SLACK.rollupError],
    ['502 passerelle', 'transient', SLACK.passerelleIndisponible],
  ] as const)('classe une réponse %s : %s', async (_, classe, enregistrement) => {
    const { fetch, requetes } = slack(enregistrement);

    expect(await adaptateur(fetch).send(ENVOI)).toEqual({
      statut: 'echec',
      classe,
      message: expect.stringContaining(String(enregistrement.status)),
    });
    expect(requetes).toHaveLength(1);
  });

  it('reprend le code d’erreur de Slack, sans jamais le jeton du webhook', async () => {
    const { fetch } = slack(SLACK.noService);

    const resultat = await adaptateur(fetch).send(ENVOI);

    expect(resultat).toMatchObject({ message: 'HTTP 404 : no_service' });
    expect(JSON.stringify(resultat)).not.toContain(WEBHOOK_JETON);
  });

  it('ne suit pas les redirections : un 3xx est un échec permanent', async () => {
    const { fetch, requetes } = slack({
      provenance: 'reconstituee',
      source: '',
      status: 302,
      corps: '',
    });

    expect(await adaptateur(fetch).send(ENVOI)).toMatchObject({
      statut: 'echec',
      classe: 'permanent',
    });
    expect(requetes[0]?.init.redirect).toBe('manual');
  });

  it('une erreur réseau ou un délai dépassé est transitoire', async () => {
    expect(await adaptateur(slack(new TypeError('fetch failed')).fetch).send(ENVOI)).toMatchObject({
      statut: 'echec',
      classe: 'transient',
      message: 'fetch failed',
    });
    expect(await adaptateur(slack('bloque').fetch, 50).send(ENVOI)).toMatchObject({
      statut: 'echec',
      classe: 'transient',
    });
  });

  describe('healthCheck', () => {
    it('poste un message sans texte, que Slack refuse sans rien publier : no_text prouve un webhook vivant', async () => {
      const { fetch, requetes } = slack(SLACK.noText);

      expect(await adaptateur(fetch).healthCheck()).toEqual({ joignable: true });

      expect(requetes).toHaveLength(1);
      expect(requetes[0]?.url).toBe(URL_WEBHOOK);
      expect(requetes[0]?.init.method).toBe('POST');
      expect(JSON.parse(requetes[0]!.corps!)).toEqual({});
    });

    it('invalid_payload prouve aussi un webhook vivant', async () => {
      expect(await adaptateur(slack(SLACK.invalidPayload).fetch).healthCheck()).toEqual({
        joignable: true,
      });
    });

    it.each([
      ['403 invalid_token', 'auth', SLACK.invalidToken],
      ['404 no_service', 'auth', SLACK.noService],
      ['410 channel_is_archived', 'auth', SLACK.channelIsArchived],
      ['429 limite de débit', 'transient', SLACK.limiteDeDebit],
      ['502 passerelle', 'transient', SLACK.passerelleIndisponible],
    ] as const)('une réponse %s le rend injoignable (%s)', async (_, classe, enregistrement) => {
      expect(await adaptateur(slack(enregistrement).fetch).healthCheck()).toEqual({
        joignable: false,
        classe,
        message: expect.stringContaining(String(enregistrement.status)),
      });
    });

    it('une erreur réseau le rend injoignable (transient)', async () => {
      expect(await adaptateur(slack(new TypeError('fetch failed')).fetch).healthCheck()).toEqual({
        joignable: false,
        classe: 'transient',
        message: 'fetch failed',
      });
    });
  });

  it('marque le Retour d’essai et le Verdict incertain ; sans Gravité ni lien du dashboard', async () => {
    const { fetch, requetes } = slack(SLACK.ok);
    const retour = { ...ENVOI.retour, gravite: null, incertain: true, lienDashboard: null };

    await adaptateur(fetch).send({ ...ENVOI, essai: true, retour });

    const corps = corpsJson(requetes[0]);
    expect(corps.text).toBe('Essai · Bug · Boutique');
    const contenu = textes(corps).map((t) => t.text);
    expect(contenu[0]).toBe('*Essai · Bug · Boutique*');
    expect(contenu).toContainEqual('*Gravité*\nNon évaluée');
    expect(contenu.join('\n')).toContain('Verdict incertain');
    expect(contenu.join('\n')).not.toContain('Voir le Retour');
  });

  describe('encodage du texte de l’Auteur', () => {
    const MALVEILLANT = [
      '<!channel> <!here> <!everyone> @channel @here URGENT <@U012AB3CD> <#C123ABC456>',
      '<https://piege.test/connexion|cliquez ici> ou https://piege.test/direct',
      '*gras* _penché_ ~barré~ <!date^1392734382^{date}|demain> & &amp; &lt;',
      '```',
      'fin du bloc ? <!channel>',
      '````js',
    ].join('\n');

    async function message(texte: string, projet = ENVOI.projet) {
      const { fetch, requetes } = slack(SLACK.ok);
      await adaptateur(fetch).send({ ...ENVOI, projet, retour: { ...ENVOI.retour, texte } });
      return corpsJson(requetes[0]);
    }

    /** Le texte de l'Auteur : le seul bloc de code du message. */
    const blocDeCode = (corps: CorpsMessage) =>
      textes(corps).find((t) => t.text.startsWith('```'))!.text;

    /** Ce que Slack affiche d'un texte échappé (`&amp;`, `&lt;`, `&gt;`). */
    const affiche = (texte: string) =>
      texte.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

    it('échappe &, < et > : aucune mention, aucun lien, aucune date ne s’interprète', async () => {
      const corps = await message(MALVEILLANT);

      const texte = blocDeCode(corps);
      expect(texte).not.toMatch(/[<>]/);
      expect(texte).not.toMatch(/&(?!amp;|lt;|gt;)/);
      expect(texte).toContain('&lt;!channel&gt;');
      expect(texte).not.toMatch(/@(channel|here|everyone)\b/);
      // Slack ne modifie pas le texte d'un objet `verbatim` : ni lien nu, ni canal.
      expect(textes(corps).every((t) => t.type === 'mrkdwn' && t.verbatim === true)).toBe(true);
      expect(corps.text).not.toContain(MALVEILLANT.slice(0, 10));
    });

    it('enferme le texte dans un bloc de code qu’il ne peut pas refermer', async () => {
      const texte = blocDeCode(await message(MALVEILLANT));

      expect(texte.startsWith('```\n')).toBe(true);
      expect(texte.endsWith('\n```')).toBe(true);
      const interieur = texte.slice(4, -4);
      expect(interieur).not.toContain('``');
      // À l'œil, c'est le texte de l'Auteur, à des espaces sans chasse près.
      expect(affiche(interieur).replaceAll('​', '')).toBe(MALVEILLANT);
    });

    it.each([
      ['a', 'a'],
      ['&', '&amp;'],
    ])(
      'tronque un texte trop long pour une section (« %s »), sans couper une entité',
      async (caractere, encode) => {
        const texte = blocDeCode(await message(caractere.repeat(5000)));

        expect(texte.length).toBeLessThanOrEqual(3000);
        expect(texte.endsWith('…\n```')).toBe(true);
        expect(texte.slice(4, -5).replaceAll(encode, '')).toBe('');
      },
    );

    it('échappe le nom du Projet partout où il s’affiche', async () => {
      const corps = await message('Bonjour', {
        ...ENVOI.projet,
        nom: '<!channel> <https://piege.test|Boutique> & co',
      });

      expect(corps.text).toBe(
        'Bug · &lt;!channel&gt; &lt;https://piege.test|Boutique&gt; &amp; co',
      );
      for (const { text } of textes(corps)) {
        expect(text).not.toContain('<!channel>');
        expect(text).not.toContain('<https://piege.test');
      }
    });
  });

  it('est enregistré pour le type « slack » dans le registre des adaptateurs', () => {
    const resolu = resolveDestinationAdapter(DESTINATION);

    expect(typeof resolu.send).toBe('function');
    expect(typeof resolu.healthCheck).toBe('function');
  });
});
