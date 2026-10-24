import type {
  ClasseEchec,
  DestinationAdapter,
  DestinationConfiguree,
  EnvoiASortir,
} from '@nudge/core';
import { LIBELLES_GRAVITE, LIBELLES_TYPE, lireWebhookDiscord, type Gravite } from '@nudge/shared';
import { classerStatut, messageEchec, messageErreur } from './http.js';

export interface OptionsDiscord {
  readonly fetch?: typeof globalThis.fetch;
  /** Délai de réponse de Discord, au-delà duquel l'appel est un échec transitoire. */
  readonly delaiMs?: number;
}

const DELAI_PAR_DEFAUT_MS = 10_000;

/** « User-Agent: DiscordBot ($url, $versionNumber) » (docs.discord.com/developers/reference). */
const USER_AGENT = 'DiscordBot (https://github.com/garage-sh/nudge, 1.0)';

/**
 * Discord : un webhook de salon (« Execute Webhook »,
 * https://docs.discord.com/developers/resources/webhook#execute-webhook).
 */
export function adaptateurDiscord(
  destination: DestinationConfiguree,
  options: OptionsDiscord = {},
): DestinationAdapter {
  const webhook = lireWebhookDiscord(destination.secrets.url ?? '');
  if (!webhook) throw new Error(`Discord ${destination.id} sans URL de webhook valide`);
  const fetch = options.fetch ?? globalThis.fetch;
  const delaiMs = options.delaiMs ?? DELAI_PAR_DEFAUT_MS;
  const pointDAppel = `https://discord.com/api/v10/webhooks/${webhook.id}/${webhook.jeton}`;

  const appeler = (url: string, init: RequestInit = {}) =>
    fetch(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(delaiMs),
      headers: { 'user-agent': USER_AGENT, ...init.headers },
    });

  /**
   * Le lien d'un message posté : `https://discord.com/channels/<serveur>/<salon>/<message>`.
   * L'objet Message ne porte pas le serveur ; le webhook, lu avec son jeton, si. Une
   * lecture qui échoue n'annule pas la livraison : le lien manque, c'est tout.
   */
  async function lienDuMessage({ id, channel_id }: MessageCree): Promise<string | null> {
    if (!id || !channel_id) return null;
    try {
      const reponse = await appeler(pointDAppel);
      if (!reponse.ok) {
        await reponse.body?.cancel();
        return null;
      }
      const { guild_id } = (await reponse.json()) as { guild_id?: unknown };
      return typeof guild_id === 'string'
        ? `https://discord.com/channels/${guild_id}/${channel_id}/${id}`
        : null;
    } catch {
      return null;
    }
  }

  return {
    async send(envoi) {
      let reponse: Response;
      try {
        reponse = await appeler(`${pointDAppel}?wait=true`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(message(envoi)),
        });
      } catch (erreur) {
        return { statut: 'echec', classe: 'transient', message: messageErreur(erreur) };
      }
      if (!reponse.ok) return { statut: 'echec', ...(await echec(reponse)) };
      const cree = (await reponse.json().catch(() => ({}))) as MessageCree;
      return { statut: 'livre', lienExterne: await lienDuMessage(cree) };
    },
    /** « Get Webhook with Token » : vérifie le jeton sans poster dans le salon. */
    async healthCheck() {
      let reponse: Response;
      try {
        reponse = await appeler(pointDAppel);
      } catch (erreur) {
        return { joignable: false, classe: 'transient', message: messageErreur(erreur) };
      }
      if (reponse.ok) {
        await reponse.body?.cancel();
        return { joignable: true };
      }
      return { joignable: false, ...(await echec(reponse)) };
    },
  };
}

interface MessageCree {
  readonly id?: string;
  readonly channel_id?: string;
}

/**
 * Classe d'un refus de Discord. Un 404 dit que le webhook n'existe plus : « If a
 * webhook returns a 404 status you should not attempt to use it again »
 * (docs.discord.com/developers/topics/rate-limits). Ce sont ses identifiants qui sont
 * refusés : la Destination est Suspendue, pas seulement cet Envoi en échec.
 */
async function echec(reponse: Response): Promise<{ classe: ClasseEchec; message: string }> {
  if (reponse.status >= 300 && reponse.status < 400) {
    await reponse.body?.cancel();
    return { classe: 'permanent', message: `HTTP ${reponse.status} : redirection refusée` };
  }
  const classe = reponse.status === 404 ? 'auth' : classerStatut(reponse.status);
  return { classe, message: await messageEchec(reponse) };
}

function message({ essai, projet, retour }: EnvoiASortir) {
  const type = LIBELLES_TYPE[retour.typeRetenu];
  const titre = `${essai ? 'Essai · ' : ''}${type} · ${echapperMarkdown(projet.nom)}`;
  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: tronquer(titre, TITRE_MAX),
        ...(retour.lienDashboard ? { url: retour.lienDashboard } : {}),
        description: blocDeCode(retour.texte),
        timestamp: retour.recuLe.toISOString(),
        color: COULEURS[retour.gravite ?? 'aucune'],
        fields: [
          { name: 'Type', value: type, inline: true },
          {
            name: 'Gravité',
            value: retour.gravite ? LIBELLES_GRAVITE[retour.gravite] : 'Non évaluée',
            inline: true,
          },
          {
            name: 'Projet',
            value: tronquer(echapperMarkdown(projet.nom), CHAMP_MAX),
            inline: true,
          },
        ],
        footer: { text: retour.incertain ? 'nudge · Verdict incertain' : 'nudge' },
      },
    ],
  };
}

/** Bandeau de l'embed, du gris (cosmétique) au rouge (bloquante). */
const COULEURS: Readonly<Record<Gravite | 'aucune', number>> = {
  aucune: 0x99aab5,
  cosmetique: 0x95a5a6,
  mineure: 0x3498db,
  majeure: 0xe67e22,
  bloquante: 0xe74c3c,
};

/** Limites d'un embed (docs.discord.com/developers/resources/message#embed-limits). */
const TITRE_MAX = 256;
const DESCRIPTION_MAX = 4096;
const CHAMP_MAX = 1024;

const SANS_CHASSE = '\u200b';
const OUVERTURE = '```\n';
const FERMETURE = '\n```';

/**
 * Le texte de l'Auteur dans un bloc de code : Discord n'y interprète ni markdown, ni
 * lien, ni mention. Une suite d'accents graves est coupée par un espace sans chasse,
 * pour que le texte ne referme jamais le bloc ; `@everyone` et `@here` le sont aussi,
 * au cas où le texte sortirait du bloc.
 */
function blocDeCode(texte: string): string {
  const encode = neutraliserMentionsGenerales(texte).replace(/`(?=`)/g, `\`${SANS_CHASSE}`);
  return `${OUVERTURE}${tronquer(encode, DESCRIPTION_MAX - OUVERTURE.length - FERMETURE.length)}${FERMETURE}`;
}

/** Un texte du Membre (nom du Projet) affiché tel quel dans un titre ou un champ markdown. */
function echapperMarkdown(texte: string): string {
  return neutraliserMentionsGenerales(texte).replace(/[\\`*_~|>[\]()<#-]/g, '\\$&');
}

const neutraliserMentionsGenerales = (texte: string) =>
  texte.replace(/@(everyone|here)/gi, `@${SANS_CHASSE}$1`);

/** Borné à `max` unités UTF-16, sans couper une paire de substitution, avec « … ». */
function tronquer(texte: string, max: number): string {
  if (texte.length <= max) return texte;
  let coupe = texte.slice(0, max - 1);
  if (/[\ud800-\udbff]$/.test(coupe)) coupe = coupe.slice(0, -1);
  return `${coupe}…`;
}
