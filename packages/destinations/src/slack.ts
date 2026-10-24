import type {
  ClasseEchec,
  DestinationAdapter,
  DestinationConfiguree,
  EnvoiASortir,
} from '@nudge/core';
import {
  LIBELLES_GRAVITE,
  LIBELLES_TYPE,
  lireWebhookSlack,
  type SecretsSlack,
} from '@nudge/shared';
import { DELAI_HTTP_PAR_DEFAUT_MS, classerStatut, echecHttp, messageErreur } from './http.js';

export interface OptionsSlack {
  readonly fetch?: typeof globalThis.fetch;
  /** Délai de réponse de Slack, au-delà duquel l'appel est un échec transitoire. */
  readonly delaiMs?: number;
}

/**
 * Slack : un webhook entrant, lié à un canal
 * (https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks).
 */
export function adaptateurSlack(
  destination: DestinationConfiguree,
  options: OptionsSlack = {},
): DestinationAdapter {
  const url = lireWebhookSlack((destination.secrets as Partial<SecretsSlack>).url ?? '');
  if (!url) throw new Error(`Slack ${destination.id} sans URL de webhook valide`);
  const fetch = options.fetch ?? globalThis.fetch;
  const delaiMs = options.delaiMs ?? DELAI_HTTP_PAR_DEFAUT_MS;

  const poster = (corps: unknown) =>
    fetch(url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(delaiMs),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
    });

  return {
    async send(envoi) {
      let reponse: Response;
      try {
        reponse = await poster(corpsSlack(envoi));
      } catch (erreur) {
        return { statut: 'echec', classe: 'transient', message: messageErreur(erreur) };
      }
      if (!reponse.ok) return { statut: 'echec', ...(await echecSlack(reponse)) };
      await reponse.body?.cancel();
      return { statut: 'livre', lienExterne: null };
    },
    /**
     * Un webhook entrant ne se lit pas : la sonde lui poste un message vide, qu'il refuse
     * sans rien publier. `no_text` (« the `text` attribute was missing from the
     * payload ») ou `invalid_payload` prouvent que le webhook existe et accepte de
     * poster ; un webhook supprimé répond `no_service`, un jeton refusé `invalid_token`.
     */
    async healthCheck() {
      let reponse: Response;
      try {
        reponse = await poster({});
      } catch (erreur) {
        return { joignable: false, classe: 'transient', message: messageErreur(erreur) };
      }
      const code = (
        await reponse
          .clone()
          .text()
          .catch(() => '')
      ).trim();
      if (reponse.ok || (reponse.status === 400 && CODES_MESSAGE_VIDE.has(code))) {
        await reponse.body?.cancel();
        return { joignable: true };
      }
      return { joignable: false, ...(await echecSlack(reponse)) };
    },
  };
}

/**
 * Codes d'erreur d'un webhook entrant qui refusent tout Envoi, et non ce seul message :
 * webhook supprimé ou désactivé, jeton invalide, espace de travail inactif, canal ou
 * utilisateur introuvable, canal archivé, publication interdite par un administrateur
 * (https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks). La
 * Destination est alors Suspendue plutôt que chaque Envoi en échec (D21).
 */
const CODES_WEBHOOK_REFUSE = new Set([
  'action_prohibited',
  'channel_is_archived',
  'channel_not_found',
  'invalid_token',
  'no_active_hooks',
  'no_service',
  'no_service_id',
  'no_team',
  'posting_to_general_channel_denied',
  'team_disabled',
  'user_not_found',
]);

/** Réponses d'un webhook vivant au message vide de la sonde. */
const CODES_MESSAGE_VIDE = new Set(['no_text', 'invalid_payload']);

/**
 * Classe d'un refus de Slack, qui répond en texte brut par un code d'erreur. 404 et 410
 * (webhook ou canal disparus) refusent la Destination comme 401 et 403 ; les autres
 * 4xx (`invalid_payload`, `no_text`…) visent ce message.
 */
async function echecSlack(reponse: Response): Promise<{ classe: ClasseEchec; message: string }> {
  const code = (
    await reponse
      .clone()
      .text()
      .catch(() => '')
  ).trim();
  return echecHttp(reponse, (status) =>
    CODES_WEBHOOK_REFUSE.has(code) || status === 404 || status === 410
      ? 'auth'
      : classerStatut(status),
  );
}

function corpsSlack({ essai, projet, retour }: EnvoiASortir) {
  const type = LIBELLES_TYPE[retour.typeRetenu];
  const gravite = retour.gravite ? LIBELLES_GRAVITE[retour.gravite] : 'Non évaluée';
  const nomProjet = echapper(projet.nom);
  const titre = `${essai ? 'Essai · ' : ''}${type} · ${nomProjet}`;
  const pied = [
    retour.incertain ? 'nudge · Verdict incertain' : 'nudge',
    ...(lienSur(retour.lienDashboard)
      ? [`<${retour.lienDashboard}|Voir le Retour dans nudge>`]
      : []),
  ];
  return {
    // Texte de repli des notifications : jamais le texte de l'Auteur.
    text: titre,
    blocks: [
      { type: 'section', text: mrkdwn(`*${titre}*`) },
      { type: 'section', text: mrkdwn(blocDeCode(retour.texte)) },
      {
        type: 'section',
        fields: [
          mrkdwn(`*Type*\n${type}`),
          mrkdwn(`*Gravité*\n${gravite}`),
          mrkdwn(`*Projet*\n${nomProjet}`),
        ],
      },
      { type: 'context', elements: [mrkdwn(pied.join(' · '))] },
    ],
  };
}

/**
 * Un objet texte mrkdwn `verbatim` : Slack ne transforme pas son texte brut (« URLs
 * will [not] be auto-converted into links, conversation names will [not] be
 * link-ified », https://docs.slack.dev/reference/block-kit/composition-objects/text-object).
 */
const mrkdwn = (text: string) => ({ type: 'mrkdwn', text, verbatim: true });

/** Un lien du dashboard qu'on peut écrire tel quel dans `<url|texte>`. */
const lienSur = (lien: string | null): lien is string =>
  lien !== null && /^https?:\/\/[^\s<>|]+$/.test(lien);

/** Longueur maximale du texte d'une section (docs.slack.dev, Section block). */
const SECTION_MAX = 3000;

const SANS_CHASSE = '\u200b';
const OUVERTURE = '```\n';
const FERMETURE = '\n```';

/**
 * Le texte de l'Auteur dans un bloc de code : Slack n'y applique aucune mise en forme.
 * `&`, `<` et `>`, « control characters » de Slack, sont échappés : ni mention
 * (`<!channel>`, `<@U…>`), ni lien, ni date ne s'interprètent. Une suite d'accents
 * graves est coupée par un espace sans chasse, pour que le texte ne referme jamais le
 * bloc ; `@channel`, `@here` et `@everyone` le sont aussi, au cas où le texte en
 * sortirait. Borné à la longueur d'une section, sans couper une entité.
 */
function blocDeCode(texte: string): string {
  const max = SECTION_MAX - OUVERTURE.length - FERMETURE.length;
  const encode = neutraliser(texte).replace(/`(?=`)/g, `\`${SANS_CHASSE}`);
  let borne = '';
  for (const caractere of encode) {
    const morceau = echapper(caractere);
    if (borne.length + morceau.length > max - 1) {
      borne += '…';
      break;
    }
    borne += morceau;
  }
  return `${OUVERTURE}${borne}${FERMETURE}`;
}

/** Échappement des caractères de contrôle de Slack (docs.slack.dev, Formatting message text). */
const echapper = (texte: string) =>
  texte.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const neutraliser = (texte: string) =>
  texte.replace(/@(channel|here|everyone)/gi, `@${SANS_CHASSE}$1`);
