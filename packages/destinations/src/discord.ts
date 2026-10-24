import type {
  ClasseEchec,
  DestinationAdapter,
  DestinationConfiguree,
  EnvoiASortir,
} from '@nudge/core';
import {
  LIBELLES_GRAVITE,
  LIBELLES_TYPE,
  lireWebhookDiscord,
  type Gravite,
  type SecretsDiscord,
} from '@nudge/shared';
import { DELAI_HTTP_PAR_DEFAUT_MS, classerStatut, echecHttp, messageErreur } from './http.js';

export interface OptionsDiscord {
  readonly fetch?: typeof globalThis.fetch;
  /** Délai de réponse de Discord, au-delà duquel l'appel est un échec transitoire. */
  readonly delaiMs?: number;
  /** Serveur de chaque webhook déjà lu, par id de webhook (tests : un cache neuf). */
  readonly serveurs?: Map<string, string>;
}

/**
 * Le serveur d'un webhook ne change pas : lu une fois par processus, il n'ajoute pas
 * un appel à chaque Envoi sur la limite de débit du webhook.
 */
const SERVEURS_PAR_WEBHOOK = new Map<string, string>();

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
  const webhook = lireWebhookDiscord((destination.secrets as Partial<SecretsDiscord>).url ?? '');
  if (!webhook) throw new Error(`Discord ${destination.id} sans URL de webhook valide`);
  const fetch = options.fetch ?? globalThis.fetch;
  const delaiMs = options.delaiMs ?? DELAI_HTTP_PAR_DEFAUT_MS;
  const serveurs = options.serveurs ?? SERVEURS_PAR_WEBHOOK;
  const { id: idWebhook, jeton } = webhook;
  const pointDAppel = `https://discord.com/api/v10/webhooks/${idWebhook}/${jeton}`;

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
    const serveur = serveurs.get(idWebhook) ?? (await lireServeur());
    return serveur ? `https://discord.com/channels/${serveur}/${channel_id}/${id}` : null;
  }

  async function lireServeur(): Promise<string | null> {
    try {
      const reponse = await appeler(pointDAppel);
      if (!reponse.ok) {
        await reponse.body?.cancel();
        return null;
      }
      const { guild_id } = (await reponse.json()) as { guild_id?: unknown };
      if (typeof guild_id !== 'string') return null;
      serveurs.set(idWebhook, guild_id);
      return guild_id;
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
          body: JSON.stringify(corpsDiscord(envoi)),
        });
      } catch (erreur) {
        return { statut: 'echec', classe: 'transient', message: messageErreur(erreur) };
      }
      if (!reponse.ok) return { statut: 'echec', ...(await echecDiscord(reponse)) };
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
      return { joignable: false, ...(await echecDiscord(reponse)) };
    },
  };
}

interface MessageCree {
  readonly id?: string;
  readonly channel_id?: string;
}

/**
 * Codes JSON d'un webhook de salon forum, qui refuse tout message sans fil
 * (docs.discord.com/developers/topics/opcodes-and-status-codes) : 220001 « must have a
 * thread_name or thread_id », 220004 « Webhook services cannot be used in forum
 * channels », 40058 « Cannot send a message in a forum channel ».
 */
const CODES_SALON_FORUM = new Set([220001, 220004, 40058]);

/**
 * Classe d'un refus de Discord. Le webhook lui-même est refusé, et la Destination
 * Suspendue plutôt que chaque Envoi en échec, quand :
 * - il n'existe plus (404) : « If a webhook returns a 404 status you should not attempt
 *   to use it again » (docs.discord.com/developers/topics/rate-limits) ;
 * - il est celui d'un salon forum, qui refusera tous les Envois.
 */
async function echecDiscord(reponse: Response): Promise<{ classe: ClasseEchec; message: string }> {
  const code = reponse.status >= 400 && reponse.status < 500 ? await codeJson(reponse) : null;
  const webhookRefuse = (status: number) =>
    status === 404 || (code !== null && CODES_SALON_FORUM.has(code));
  return echecHttp(reponse, (status) => (webhookRefuse(status) ? 'auth' : classerStatut(status)));
}

/** Le `code` d'un corps d'erreur JSON de Discord, lu sur une copie de la réponse. */
async function codeJson(reponse: Response): Promise<number | null> {
  try {
    const { code } = (await reponse.clone().json()) as { code?: unknown };
    return typeof code === 'number' ? code : null;
  } catch {
    return null;
  }
}

function corpsDiscord({ essai, projet, retour }: EnvoiASortir) {
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
