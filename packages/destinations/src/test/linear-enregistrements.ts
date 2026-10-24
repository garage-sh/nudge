/**
 * Réponses HTTP enregistrées de l'API GraphQL de Linear, pour le test de contrat de
 * l'adaptateur Linear.
 *
 * Chaque enregistrement dit d'où il vient :
 * - `documentation` : forme ou corps repris de la documentation (URL dans `source`) ;
 * - `reconstituee` : écrit pour nos requêtes, en suivant la forme documentée et le
 *   schéma GraphQL publié par Linear (URL dans `source`).
 *
 * Aucune n'a été obtenue par un appel réel : la documentation et le schéma font foi.
 * Documentation lue le 2026-10-24 :
 * - https://linear.app/developers/graphql (point d'appel, authentification, `issueCreate`,
 *   erreurs dans un tableau `errors`, succès partiel possible en 200) ;
 * - https://linear.app/developers/rate-limiting (limite de débit : HTTP 400, code
 *   `RATELIMITED` dans `extensions`) ;
 * - schéma : https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql
 *   (`IssueCreateInput.teamId` / `labelIds`, `IssuePayload`, `Issue.url`, `IssueLabel.team`
 *   nul pour un label d'espace de travail, `TeamFilter.key`) ;
 * - types d'erreur (`extensions.type`) : https://github.com/linear/linear/blob/master/packages/sdk/src/error.ts.
 */

export interface Enregistrement {
  readonly provenance: 'documentation' | 'reconstituee';
  readonly source: string;
  readonly status: number;
  /** Corps JSON ; une chaîne est rendue telle quelle (page d'erreur d'un proxy). */
  readonly corps?: unknown;
  readonly entetes?: Readonly<Record<string, string>>;
}

const GRAPHQL = 'https://linear.app/developers/graphql';
const LIMITES = 'https://linear.app/developers/rate-limiting';
const SCHEMA = 'https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql';
const ERREURS = 'https://github.com/linear/linear/blob/master/packages/sdk/src/error.ts';

/** L'équipe des tests : id de l'exemple `issueCreate` de la documentation. */
export const EQUIPE_ID = '9cfb482a-81e3-4154-b5b9-2c805e70a02d';
export const LABEL_BUG_ID = '5f6b9a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
export const LABEL_URGENT_ID = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
export const LABEL_IDEE_ID = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
export const ISSUE_ID = '590a1127-f98b-49fc-ba74-2df8751c089e';
export const ISSUE_URL = 'https://linear.app/boutique/issue/ENG-123/bug-le-panier-se-vide';
export const CLE_API = 'lin_api_0123456789abcdefghijklmnopqrstuvwxyzABCD';

/** Une erreur GraphQL, sous la forme que décrit la documentation et que lit le SDK. */
const erreur = (message: string, extensions: Record<string, unknown>) => ({
  message,
  path: null,
  extensions: { userPresentableMessage: message, ...extensions },
});

export const LINEAR = {
  /**
   * L'équipe ENG et les labels qu'elle peut poser : les siens (`team` renseignée) et
   * ceux de l'espace de travail (`team: null`). « Type » est un groupe de labels, qu'une
   * issue ne peut pas porter.
   */
  equipe: {
    provenance: 'reconstituee',
    source: `${SCHEMA} (Query.teams, Query.issueLabels)`,
    status: 200,
    corps: {
      data: {
        teams: { nodes: [{ id: EQUIPE_ID, key: 'ENG', name: 'Engineering' }] },
        issueLabels: {
          nodes: [
            { id: LABEL_BUG_ID, name: 'Bug', isGroup: false, team: { id: EQUIPE_ID } },
            { id: LABEL_URGENT_ID, name: 'Urgent', isGroup: false, team: null },
            { id: LABEL_IDEE_ID, name: 'Idée', isGroup: false, team: { id: EQUIPE_ID } },
            {
              id: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
              name: 'Type',
              isGroup: true,
              team: { id: EQUIPE_ID },
            },
          ],
        },
      },
    },
  },
  /** Aucune équipe de clé ENG visible avec cette clé d'API. */
  equipeInconnue: {
    provenance: 'reconstituee',
    source: `${SCHEMA} (Query.teams)`,
    status: 200,
    corps: { data: { teams: { nodes: [] }, issueLabels: { nodes: [] } } },
  },
  /** `issueCreate` réussi : `success` et l'issue demandée (id, identifiant, url). */
  issueCreee: {
    provenance: 'documentation',
    source: `${GRAPHQL} (issueCreate) ; ${SCHEMA} (IssuePayload, Issue.url)`,
    status: 200,
    corps: {
      data: {
        issueCreate: {
          success: true,
          issue: { id: ISSUE_ID, identifier: 'ENG-123', url: ISSUE_URL },
        },
      },
    },
  },
  /** `issueCreate` sans erreur mais sans issue : `success` faux, `issue` nulle. */
  creationRefusee: {
    provenance: 'reconstituee',
    source: `${SCHEMA} (IssuePayload : success: Boolean!, issue: Issue)`,
    status: 200,
    corps: { data: { issueCreate: { success: false, issue: null } } },
  },
  /** Clé d'API révoquée ou invalide : erreur GraphQL de type « authentication error ». */
  cleRefusee: {
    provenance: 'reconstituee',
    source: `${GRAPHQL} (Errors) ; ${ERREURS}`,
    status: 400,
    corps: {
      data: null,
      errors: [
        erreur('Authentication required, not authenticated', {
          type: 'authentication error',
          code: 'AUTHENTICATION_ERROR',
          userError: true,
        }),
      ],
    },
  },
  /** La clé n'a pas accès à cette équipe : « forbidden ». */
  accesRefuse: {
    provenance: 'reconstituee',
    source: `${GRAPHQL} (Errors) ; ${ERREURS}`,
    status: 200,
    corps: {
      data: null,
      errors: [
        erreur('You do not have access to this team', {
          type: 'forbidden',
          code: 'FORBIDDEN',
          userError: true,
        }),
      ],
    },
  },
  /** Une entrée refusée pour cette issue précise : « invalid input ». */
  entreeInvalide: {
    provenance: 'reconstituee',
    source: `${GRAPHQL} (Errors) ; ${ERREURS}`,
    status: 200,
    corps: {
      data: null,
      errors: [
        erreur('Argument Validation Error', {
          type: 'invalid input',
          code: 'INVALID_INPUT',
          userError: true,
        }),
      ],
    },
  },
  /** Limite de débit : « the response http status code will be 400 », code RATELIMITED. */
  limiteDeDebit: {
    provenance: 'documentation',
    source: LIMITES,
    status: 400,
    entetes: {
      'x-ratelimit-requests-limit': '2500',
      'x-ratelimit-requests-remaining': '0',
      'x-ratelimit-requests-reset': '1793006400000',
    },
    corps: {
      errors: [{ message: 'Rate limit exceeded', extensions: { code: 'RATELIMITED' } }],
    },
  },
  /** Erreur interne de Linear : « internal error ». */
  erreurInterne: {
    provenance: 'reconstituee',
    source: `${GRAPHQL} (Errors) ; ${ERREURS}`,
    status: 200,
    corps: {
      data: null,
      errors: [erreur('Internal server error', { type: 'internal error', code: 'INTERNAL_ERROR' })],
    },
  },
  /** Page d'erreur d'un proxy, sans JSON. */
  serviceIndisponible: {
    provenance: 'reconstituee',
    source: `${GRAPHQL} (« Monitor HTTP status codes for server errors (5xx) »)`,
    status: 503,
    corps: '<html><body>503 Service Temporarily Unavailable</body></html>',
  },
  /** Clé refusée par un intermédiaire avant GraphQL : 401 sans corps JSON. */
  nonAutorise: {
    provenance: 'reconstituee',
    source: GRAPHQL,
    status: 401,
    corps: 'Unauthorized',
  },
} as const satisfies Record<string, Enregistrement>;
