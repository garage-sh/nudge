/**
 * Réponses HTTP enregistrées de l'API Discord, pour le test de contrat de
 * l'adaptateur Discord.
 *
 * Chaque enregistrement dit d'où il vient :
 * - `documentation` : corps recopié de l'exemple de la documentation (URL dans `source`) ;
 * - `reconstituee` : écrit pour notre Envoi, ou pour une erreur dont le corps n'a pas
 *   d'exemple, en suivant la forme documentée (URL du schéma dans `source`).
 *
 * Aucune n'a été obtenue par un appel réel : le schéma documenté fait foi.
 * Documentation lue le 2026-10-24.
 */

export interface Enregistrement {
  readonly provenance: 'documentation' | 'reconstituee';
  readonly source: string;
  readonly status: number;
  /** Absent : réponse sans corps (204). */
  readonly corps?: unknown;
  readonly entetes?: Readonly<Record<string, string>>;
}

const WEBHOOK = 'https://docs.discord.com/developers/resources/webhook';
const MESSAGE = 'https://docs.discord.com/developers/resources/message';
const CODES = 'https://docs.discord.com/developers/topics/opcodes-and-status-codes';
const LIMITES = 'https://docs.discord.com/developers/topics/rate-limits';

/** Le webhook de salon des tests : `https://discord.com/api/webhooks/<id>/<jeton>`. */
export const WEBHOOK_ID = '223704706495545344';
export const WEBHOOK_JETON =
  '3d89bb7572e0fb30d8128367b3b1b44fecd1726de135cbe28a41f8b2f777c372ba2939e72279b94526ff5d1bd4358d65cf11';
export const SALON_ID = '199737254929760256';
export const SERVEUR_ID = '199737254929760256';
export const MESSAGE_ID = '334385199974967042';

export const DISCORD = {
  /**
   * Execute Webhook avec `?wait=true` : « returns the created message body ». Forme de
   * l'objet Message (champs obligatoires), ids de l'exemple de la documentation.
   */
  messageCree: {
    provenance: 'reconstituee',
    source: `${MESSAGE}#message-object`,
    status: 200,
    corps: {
      id: MESSAGE_ID,
      type: 0,
      content: '',
      channel_id: SALON_ID,
      author: { id: WEBHOOK_ID, username: 'nudge', avatar: null, discriminator: '0000', bot: true },
      attachments: [],
      embeds: [{ type: 'rich', title: 'Bug · Boutique' }],
      mentions: [],
      mention_roles: [],
      pinned: false,
      mention_everyone: false,
      tts: false,
      timestamp: '2026-10-24T09:30:00.299000+00:00',
      edited_timestamp: null,
      flags: 0,
      components: [],
      webhook_id: WEBHOOK_ID,
    },
  },
  /**
   * Get Webhook with Token : l'objet Webhook « sans user ». Exemple « Example Incoming
   * Webhook » de la documentation, `user` retiré.
   */
  webhook: {
    provenance: 'documentation',
    source: `${WEBHOOK}#get-webhook-with-token`,
    status: 200,
    corps: {
      name: 'test webhook',
      type: 1,
      channel_id: SALON_ID,
      token: WEBHOOK_JETON,
      avatar: null,
      guild_id: SERVEUR_ID,
      id: WEBHOOK_ID,
      application_id: null,
    },
  },
  /** 401 « Invalid webhook token provided » (code JSON 50027). */
  jetonInvalide: {
    provenance: 'reconstituee',
    source: CODES,
    status: 401,
    corps: { message: 'Invalid Webhook Token', code: 50027 },
  },
  /**
   * 404 « Unknown webhook » (code JSON 10015) : le webhook a été supprimé. « If a
   * webhook returns a 404 status you should not attempt to use it again » (rate-limits).
   */
  webhookInconnu: {
    provenance: 'reconstituee',
    source: CODES,
    status: 404,
    corps: { message: 'Unknown Webhook', code: 10015 },
  },
  /** 400 « Invalid form body » (code JSON 50035), avec le détail `errors`. */
  corpsInvalide: {
    provenance: 'reconstituee',
    source: CODES,
    status: 400,
    corps: {
      message: 'Invalid Form Body',
      code: 50035,
      errors: {
        embeds: {
          '0': {
            description: {
              _errors: [
                { code: 'BASE_TYPE_MAX_LENGTH', message: 'Must be 4096 or fewer in length.' },
              ],
            },
          },
        },
      },
    },
  },
  /** 429 : corps de l'exemple de la documentation, en-tête `Retry-After`. */
  limiteDeDebit: {
    provenance: 'documentation',
    source: LIMITES,
    status: 429,
    entetes: { 'retry-after': '65', 'x-ratelimit-scope': 'shared' },
    corps: { message: 'You are being rate limited.', retry_after: 64.57, global: false },
  },
  /** 502 « There was not a gateway available to process your request ». */
  passerelleIndisponible: {
    provenance: 'reconstituee',
    source: CODES,
    status: 502,
    corps: { message: '502: Bad Gateway', code: 0 },
  },
} as const satisfies Record<string, Enregistrement>;
