/**
 * Réponses HTTP enregistrées de l'API REST de GitHub, pour le test de contrat de
 * l'adaptateur GitHub Issues.
 *
 * Chaque enregistrement dit d'où il vient :
 * - `documentation` : forme reprise telle quelle de la documentation (URL dans `source`) ;
 * - `reconstituee` : écrit pour nos requêtes en suivant le schéma documenté, ou réponse
 *   d'erreur dont le statut et les en-têtes sont documentés mais dont la documentation
 *   ne donne aucun corps en exemple : le corps suit la forme `message` /
 *   `documentation_url` des erreurs de l'API REST, le message est vraisemblable.
 *
 * Aucune n'a été obtenue par un appel réel : la documentation fait foi. Lue le 2026-10-24 :
 * - https://docs.github.com/en/rest/issues/issues#create-an-issue (201, 400, 403, 404,
 *   « 410 Gone » quand les issues sont désactivées, « 422 Validation failed, or the
 *   endpoint has been spammed », 503 ; schéma de l'issue : `html_url`, `number`…) ;
 * - https://docs.github.com/en/rest/repos/repos#get-a-repository (200, 301, 403, 404 ;
 *   `has_issues`, `archived`) ;
 * - https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api
 *   (identifiants invalides : 401 ; permissions insuffisantes : 404 ou 403) ;
 * - https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
 *   (limite primaire : 403 ou 429 avec `x-ratelimit-remaining: 0` ; secondaire : 403
 *   ou 429, `retry-after` éventuel) ;
 * - https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api
 *   (422 : propriété `errors`, chaque erreur avec un `code`).
 */

export interface Enregistrement {
  readonly provenance: 'documentation' | 'reconstituee';
  readonly source: string;
  readonly status: number;
  /** Corps JSON ; une chaîne est rendue telle quelle (page d'erreur d'un proxy). */
  readonly corps?: unknown;
  readonly entetes?: Readonly<Record<string, string>>;
}

const ISSUES = 'https://docs.github.com/en/rest/issues/issues#create-an-issue';
const DEPOT = 'https://docs.github.com/en/rest/repos/repos#get-a-repository';
const AUTH = 'https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api';
const LIMITES = 'https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api';
const DEPANNAGE = 'https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api';

export const PROPRIETAIRE = 'boutique-sa';
export const NOM_DEPOT = 'boutique-web';
export const JETON =
  'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ';
export const ISSUE_NUMERO = 1347;
export const ISSUE_URL = `https://github.com/${PROPRIETAIRE}/${NOM_DEPOT}/issues/${ISSUE_NUMERO}`;

/** Corps d'erreur de l'API REST : un `message`, un lien vers la documentation. */
const erreur = (message: string, extra: Record<string, unknown> = {}) => ({
  message,
  documentation_url: 'https://docs.github.com/rest',
  ...extra,
});

const API = `https://api.github.com/repos/${PROPRIETAIRE}/${NOM_DEPOT}`;

export const GITHUB = {
  /** L'issue créée : champs obligatoires du schéma de réponse 201. */
  issueCreee: {
    provenance: 'reconstituee',
    source: `${ISSUES} (Response schema, Status: 201)`,
    status: 201,
    corps: {
      id: 1296269,
      node_id: 'I_kwDOABCD5M5MXc0N',
      url: `${API}/issues/${ISSUE_NUMERO}`,
      repository_url: API,
      labels_url: `${API}/issues/${ISSUE_NUMERO}/labels{/name}`,
      comments_url: `${API}/issues/${ISSUE_NUMERO}/comments`,
      events_url: `${API}/issues/${ISSUE_NUMERO}/events`,
      html_url: ISSUE_URL,
      number: ISSUE_NUMERO,
      state: 'open',
      title: 'Bug · Le panier se vide quand je change de page.',
      body: '…',
      labels: [],
      milestone: null,
      locked: false,
      comments: 0,
      closed_at: null,
      created_at: '2026-10-24T09:30:00Z',
      updated_at: '2026-10-24T09:30:00Z',
      author_association: 'OWNER',
    },
  },
  /** Le dépôt, issues activées. */
  depot: {
    provenance: 'reconstituee',
    source: `${DEPOT} (Response schema, Status: 200)`,
    status: 200,
    corps: {
      id: 1296269,
      name: NOM_DEPOT,
      full_name: `${PROPRIETAIRE}/${NOM_DEPOT}`,
      private: true,
      html_url: `https://github.com/${PROPRIETAIRE}/${NOM_DEPOT}`,
      has_issues: true,
      archived: false,
      disabled: false,
      permissions: { admin: false, push: false, pull: true },
    },
  },
  identifiantsInvalides: {
    provenance: 'reconstituee',
    source: AUTH,
    status: 401,
    corps: erreur('Bad credentials', { status: '401' }),
  },
  /** Jeton sans la permission « Issues : écriture » sur ce dépôt. */
  permissionRefusee: {
    provenance: 'reconstituee',
    source: AUTH,
    status: 403,
    corps: erreur('Resource not accessible by personal access token', { status: '403' }),
  },
  /** Dépôt inexistant, ou hors de portée du jeton. */
  introuvable: {
    provenance: 'reconstituee',
    source: `${ISSUES} ; ${AUTH}`,
    status: 404,
    corps: erreur('Not Found', { status: '404' }),
  },
  issuesDesactivees: {
    provenance: 'reconstituee',
    source: ISSUES,
    status: 410,
    corps: erreur('Issues are disabled for this repo', { status: '410' }),
  },
  validationEchouee: {
    provenance: 'reconstituee',
    source: `${ISSUES} ; ${DEPANNAGE}`,
    status: 422,
    corps: erreur('Validation Failed', {
      status: '422',
      errors: [{ resource: 'Issue', code: 'custom', field: 'body', message: 'body is too long' }],
    }),
  },
  requeteInvalide: {
    provenance: 'reconstituee',
    source: ISSUES,
    status: 400,
    corps: erreur('Problems parsing JSON', { status: '400' }),
  },
  limitePrimaire: {
    provenance: 'reconstituee',
    source: LIMITES,
    status: 403,
    corps: erreur('API rate limit exceeded for user ID 1.', { status: '403' }),
    entetes: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1792834200' },
  },
  limiteSecondaire: {
    provenance: 'reconstituee',
    source: LIMITES,
    status: 403,
    corps: erreur('You have exceeded a secondary rate limit. Please wait a few minutes.', {
      status: '403',
    }),
    entetes: { 'retry-after': '60', 'x-ratelimit-remaining': '4990' },
  },
  limite429: {
    provenance: 'reconstituee',
    source: LIMITES,
    status: 429,
    corps: erreur('You have exceeded a secondary rate limit.', { status: '429' }),
    entetes: { 'retry-after': '30' },
  },
  indisponible: {
    provenance: 'reconstituee',
    source: ISSUES,
    status: 503,
    corps: erreur('Service unavailable', { status: '503' }),
  },
  /** Dépôt renommé ou transféré. */
  deplace: {
    provenance: 'reconstituee',
    source: DEPOT,
    status: 301,
    corps: erreur('Moved Permanently', { url: 'https://api.github.com/repositories/1296269' }),
    entetes: { location: 'https://api.github.com/repositories/1296269' },
  },
} as const satisfies Record<string, Enregistrement>;
