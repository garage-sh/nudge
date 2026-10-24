/**
 * Réponses HTTP enregistrées d'un webhook entrant Slack, pour le test de contrat de
 * l'adaptateur Slack.
 *
 * Chaque enregistrement dit d'où il vient :
 * - `documentation` : statut et corps décrits par la documentation (URL dans `source`) ;
 * - `reconstituee` : statut que la documentation n'associe pas au code d'erreur, choisi
 *   d'après les exemples qu'elle donne (400, 403, 404), ou réponse d'un intermédiaire.
 *
 * Un webhook entrant répond en texte brut : `ok`, ou le code de l'erreur. Aucune réponse
 * n'a été obtenue par un appel réel : la documentation fait foi. Lue le 2026-10-24 :
 * - https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks (« HTTP 200
 *   response with a plain text `ok` », liste des codes d'erreur) ;
 * - https://docs.slack.dev/changelog/2016-05-17-changes-to-errors-for-incoming-webhooks
 *   (invalid_payload et user_not_found : 400, action_prohibited : 403,
 *   channel_not_found : 404, channel_is_archived : 410, rollup_error : 500) ;
 * - https://docs.slack.dev/apis/web-api/rate-limits (webhooks entrants : 1 message par
 *   seconde, « HTTP 429 Too Many Requests » avec `Retry-After`).
 */

export interface Enregistrement {
  readonly provenance: 'documentation' | 'reconstituee';
  readonly source: string;
  readonly status: number;
  /** Corps en texte brut. */
  readonly corps: string;
  readonly entetes?: Readonly<Record<string, string>>;
}

const WEBHOOKS = 'https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks';
const CHANGELOG =
  'https://docs.slack.dev/changelog/2016-05-17-changes-to-errors-for-incoming-webhooks';
const LIMITES = 'https://docs.slack.dev/apis/web-api/rate-limits';

/** Le webhook des tests, sous la forme de l'exemple de la documentation. */
export const EQUIPE_ID = 'T00000000';
export const SERVICE_ID = 'B00000000';
export const WEBHOOK_JETON = 'XXXXXXXXXXXXXXXXXXXXXXXX';

const erreur = (
  status: number,
  code: string,
  provenance: Enregistrement['provenance'],
  source: string,
): Enregistrement => ({ provenance, source, status, corps: code });

export const SLACK = {
  /** « In most cases you'll receive a "HTTP 200" response with a plain text `ok`. » */
  ok: { provenance: 'documentation', source: WEBHOOKS, status: 200, corps: 'ok' },
  /** Corps mal formé ; c'est aussi la réponse que la sonde attend d'un webhook vivant. */
  invalidPayload: erreur(400, 'invalid_payload', 'documentation', CHANGELOG),
  /** « `no_text` means the `text` attribute was missing from the payload. » */
  noText: erreur(400, 'no_text', 'reconstituee', WEBHOOKS),
  tooManyAttachments: erreur(400, 'too_many_attachments', 'reconstituee', WEBHOOKS),
  userNotFound: erreur(400, 'user_not_found', 'documentation', CHANGELOG),
  actionProhibited: erreur(403, 'action_prohibited', 'documentation', CHANGELOG),
  invalidToken: erreur(403, 'invalid_token', 'reconstituee', WEBHOOKS),
  postingToGeneralChannelDenied: erreur(
    403,
    'posting_to_general_channel_denied',
    'reconstituee',
    WEBHOOKS,
  ),
  channelNotFound: erreur(404, 'channel_not_found', 'documentation', CHANGELOG),
  /** « `no_service` means the incoming webhook is either disabled, removed, or invalid. » */
  noService: erreur(404, 'no_service', 'reconstituee', WEBHOOKS),
  channelIsArchived: erreur(410, 'channel_is_archived', 'documentation', CHANGELOG),
  rollupError: erreur(500, 'rollup_error', 'documentation', CHANGELOG),
  /** Statut et en-tête documentés ; le corps ne l'est pas. */
  limiteDeDebit: {
    provenance: 'reconstituee',
    source: LIMITES,
    status: 429,
    corps: 'rate_limited',
    entetes: { 'retry-after': '30' },
  },
  /** Page d'erreur d'un intermédiaire, sans code Slack. */
  passerelleIndisponible: {
    provenance: 'reconstituee',
    source: WEBHOOKS,
    status: 502,
    corps: '<html><body>502 Bad Gateway</body></html>',
  },
} as const satisfies Record<string, Enregistrement>;
