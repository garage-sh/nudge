import type {
  ClasseEchec,
  DestinationAdapter,
  DestinationConfiguree,
  EnvoiASortir,
  ResultatEnvoi,
} from '@nudge/core';
import {
  LIBELLES_GRAVITE,
  LIBELLES_TYPE,
  definitionLinear,
  type SecretsLinear,
} from '@nudge/shared';
import { DELAI_HTTP_PAR_DEFAUT_MS, classerStatut, echecHttp, messageErreur } from './http.js';

export interface OptionsLinear {
  readonly fetch?: typeof globalThis.fetch;
  /** Délai de réponse de Linear, au-delà duquel l'appel est un échec transitoire. */
  readonly delaiMs?: number;
  /** Équipe et labels déjà lus, par Destination (tests : un cache neuf). */
  readonly equipes?: Map<string, EquipeLue>;
}

/** L'équipe d'une Destination, telle que lue dans Linear : son id et ses labels par nom. */
export interface EquipeLue {
  readonly id: string;
  /** Id de chaque label applicable, par nom en minuscules. */
  readonly labels: ReadonlyMap<string, string>;
}

const EQUIPES_PAR_DESTINATION = new Map<string, EquipeLue>();

/** https://linear.app/developers/graphql */
const POINT_D_APPEL = 'https://api.linear.app/graphql';

/**
 * L'équipe par sa clé, et les labels qu'une issue de cette équipe peut porter : les
 * siens et ceux de l'espace de travail (`team` nulle).
 */
const REQUETE_EQUIPE = `query EquipeNudge($equipe: String!) {
  teams(filter: { key: { eqIgnoreCase: $equipe } }) { nodes { id key } }
  issueLabels(
    first: 250
    filter: { or: [{ team: { key: { eqIgnoreCase: $equipe } } }, { team: { null: true } }] }
  ) { nodes { id name isGroup } }
}`;

const MUTATION_ISSUE = `mutation IssueNudge($entree: IssueCreateInput!) {
  issueCreate(input: $entree) { success issue { id identifier url } }
}`;

/**
 * Linear : une issue par Envoi, créée par l'API GraphQL avec une clé d'API personnelle
 * (https://linear.app/developers/graphql).
 */
export function adaptateurLinear(
  destination: DestinationConfiguree,
  options: OptionsLinear = {},
): DestinationAdapter {
  const config = definitionLinear.config.parse(destination.config);
  const cleApi = (destination.secrets as Partial<SecretsLinear>).cleApi;
  if (!cleApi) throw new Error(`Linear ${destination.id} sans clé d'API`);
  const authorization: string = cleApi;
  const fetch = options.fetch ?? globalThis.fetch;
  const delaiMs = options.delaiMs ?? DELAI_HTTP_PAR_DEFAUT_MS;
  const equipes = options.equipes ?? EQUIPES_PAR_DESTINATION;

  /** Un appel GraphQL : ses données, ou l'échec classé (jamais une exception). */
  async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<Appel<T>> {
    let reponse: Response;
    try {
      reponse = await fetch(POINT_D_APPEL, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(delaiMs),
        // Clé personnelle : « Authorization: <API_KEY> », sans « Bearer ».
        headers: { 'content-type': 'application/json', authorization },
        body: JSON.stringify({ query, variables }),
      });
    } catch (erreur) {
      return { ok: false, classe: 'transient', message: messageErreur(erreur) };
    }
    if (reponse.status >= 300 && reponse.status < 400) {
      return { ok: false, ...(await echecHttp(reponse)) };
    }
    const corps = await corpsGraphQL<T>(reponse);
    if (!reponse.ok && !corps?.errors?.length) return { ok: false, ...(await echecHttp(reponse)) };
    await reponse.body?.cancel();
    if (corps?.errors?.length) return { ok: false, ...echecGraphQL(reponse.status, corps.errors) };
    if (!corps?.data) {
      return {
        ok: false,
        classe: 'transient',
        message: `Linear (HTTP ${reponse.status}) : réponse illisible`,
      };
    }
    return { ok: true, data: corps.data };
  }

  /** Cache par Destination et par équipe : changer d'équipe ne reprend pas l'ancienne. */
  const cleCache = `${destination.id}:${config.equipe}`;

  /** Lit l'équipe et ses labels dans Linear ; une équipe hors de portée de la clé est un refus. */
  async function lireEquipe(): Promise<Appel<EquipeLue>> {
    const appel = await graphql<DonneesEquipe>(REQUETE_EQUIPE, { equipe: config.equipe });
    if (!appel.ok) return appel;
    const [trouvee] = appel.data.teams.nodes;
    if (!trouvee) {
      return refus(`Équipe Linear « ${config.equipe} » introuvable avec cette clé d’API`);
    }
    const labels = new Map<string, string>();
    for (const label of appel.data.issueLabels.nodes) {
      if (!label.isGroup) labels.set(label.name.toLowerCase(), label.id);
    }
    const lue = { id: trouvee.id, labels };
    equipes.set(cleCache, lue);
    return { ok: true, data: lue };
  }

  /**
   * L'équipe et les ids des labels nommés. L'équipe lue est gardée : elle n'est relue
   * que si un nom manque (label créé depuis). Un nom toujours introuvable — ou un groupe
   * de labels, qu'une issue ne porte pas — refuse la Destination : chaque Envoi échouerait.
   */
  async function resoudre(
    noms: readonly string[],
    { relire = false } = {},
  ): Promise<Appel<EquipeEtLabels>> {
    const connaitTout = (equipe: EquipeLue) =>
      noms.every((nom) => equipe.labels.has(nom.toLowerCase()));
    const gardee = relire ? undefined : equipes.get(cleCache);
    let equipe: EquipeLue;
    if (gardee && connaitTout(gardee)) {
      equipe = gardee;
    } else {
      const lue = await lireEquipe();
      if (!lue.ok) return lue;
      equipe = lue.data;
    }
    const manquant = noms.find((nom) => !equipe.labels.has(nom.toLowerCase()));
    if (manquant !== undefined) {
      return refus(`Label Linear « ${manquant} » introuvable dans l’équipe ${config.equipe}`);
    }
    return {
      ok: true,
      data: {
        equipeId: equipe.id,
        labelIds: noms.map((nom) => equipe.labels.get(nom.toLowerCase())!),
      },
    };
  }

  return {
    async send(envoi) {
      const noms = [
        config.labels.types[envoi.retour.typeRetenu],
        envoi.retour.gravite ? config.labels.gravites[envoi.retour.gravite] : undefined,
      ].filter((nom): nom is string => nom !== undefined);
      const cible = await resoudre(noms);
      if (!cible.ok) return echec(cible);
      // #14 : la Capture se branche ici, avant la création — téléversée chez Linear
      // (mutation `fileUpload`, par ce même client `graphql`, puis PUT sur l'URL signée)
      // et son `assetUrl` passé à `description()`, qui l'ajoute comme une section.
      const creation = await graphql<DonneesCreation>(MUTATION_ISSUE, {
        entree: {
          teamId: cible.data.equipeId,
          title: titre(envoi),
          description: description(envoi),
          labelIds: cible.data.labelIds,
        },
      });
      const issue = creation.ok ? creation.data.issueCreate.issue : null;
      if (!creation.ok || !creation.data.issueCreate.success || !issue) {
        // Un label ou l'équipe a pu changer chez Linear : le prochain Envoi les relit.
        equipes.delete(cleCache);
        return creation.ok
          ? {
              statut: 'echec',
              classe: 'permanent',
              message: 'Linear n’a pas créé l’issue (success: false)',
            }
          : echec(creation);
      }
      return { statut: 'livre', lienExterne: issue.url };
    },
    /**
     * Relit l'équipe et tous les labels configurés avec la clé, sans rien créer : la
     * Destination n'est joignable que si chaque Envoi pourrait l'être.
     */
    async healthCheck() {
      const tous = [
        ...Object.values(config.labels.types),
        ...Object.values(config.labels.gravites),
      ];
      const cible = await resoudre(tous, { relire: true });
      if (!cible.ok) return { joignable: false, classe: cible.classe, message: cible.message };
      return { joignable: true };
    },
  };
}

interface DonneesEquipe {
  readonly teams: { readonly nodes: readonly { readonly id: string }[] };
  readonly issueLabels: {
    readonly nodes: readonly {
      readonly id: string;
      readonly name: string;
      readonly isGroup: boolean;
    }[];
  };
}

interface DonneesCreation {
  readonly issueCreate: {
    readonly success: boolean;
    readonly issue: { readonly url: string } | null;
  };
}

/** Longueur maximale du titre d'une issue, en unités UTF-16. */
const TITRE_MAX = 120;

/** Titre (texte brut chez Linear) : le Type et la première ligne non vide du texte. */
function titre({ essai, retour }: EnvoiASortir): string {
  const premiereLigne =
    retour.texte
      .split(/\r\n|\r|\n/)
      .map((ligne) => ligne.replace(/\s+/g, ' ').trim())
      .find((ligne) => ligne.length > 0) ?? '';
  const entete = `${essai ? 'Essai · ' : ''}${LIBELLES_TYPE[retour.typeRetenu]}`;
  return tronquer(premiereLigne ? `${entete} · ${premiereLigne}` : entete, TITRE_MAX);
}

/**
 * Description (markdown) : le texte de l'Auteur échappé, puis un pied écrit par nudge.
 * #14 ajoutera la Capture ici, comme une section de plus (image déjà téléversée chez
 * Linear par `fileUpload`, référencée par son `assetUrl`).
 */
function description({ projet, retour }: EnvoiASortir): string {
  const gravite = retour.gravite ? LIBELLES_GRAVITE[retour.gravite] : 'Non évaluée';
  const pied = [
    `**Projet** : ${echapperMarkdown(projet.nom)}`,
    `**Type** : ${LIBELLES_TYPE[retour.typeRetenu]} · **Gravité** : ${gravite}`,
    ...(retour.incertain
      ? ['**Verdict incertain** : le Juge a hésité, vérifiez-le dans nudge.']
      : []),
    ...(lienSur(retour.lienDashboard)
      ? [`[Voir le Retour dans nudge](<${retour.lienDashboard}>)`]
      : []),
  ];
  return [texteEchappe(retour.texte), '---', ...pied].join('\n\n');
}

/** Un lien du dashboard qu'on peut écrire tel quel entre chevrons. */
const lienSur = (lien: string | null): lien is string =>
  lien !== null && /^https?:\/\/[^\s<>]+$/.test(lien);

/**
 * Le texte de l'Auteur, affiché tel qu'il l'a écrit et jamais interprété : chaque
 * caractère de ponctuation ASCII est échappé d'une barre oblique inverse, ce que
 * CommonMark permet pour tous. Ni lien (même nu), ni image (que Linear irait chercher),
 * ni HTML, ni titre, liste ou mise en forme. Les lignes sont gardées par des retours à
 * la ligne forcés ; une indentation en tête de ligne, qui ferait un bloc de code,
 * devient des espaces insécables.
 */
function texteEchappe(texte: string): string {
  const paragraphes = texte
    .split(/\r\n|\r|\n/)
    .map((ligne) =>
      echapperMarkdown(ligne.trimEnd()).replace(/^[ \t]+/, (indentation) =>
        indentation.replaceAll('\t', '    ').replaceAll(' ', '\u00a0'),
      ),
    )
    .join('\n')
    .split(/\n{2,}/)
    .map((paragraphe) => paragraphe.split('\n').join('\\\n'))
    .filter((paragraphe) => paragraphe.length > 0);
  return paragraphes.length > 0 ? paragraphes.join('\n\n') : '_(texte vide)_';
}

const echapperMarkdown = (texte: string) => texte.replace(/[!-/:-@[-`{-~]/g, '\\$&');

/** Borné à `max` unités UTF-16, sans couper une paire de substitution, avec « … ». */
function tronquer(texte: string, max: number): string {
  if (texte.length <= max) return texte;
  let coupe = texte.slice(0, max - 1);
  if (/[\ud800-\udbff]$/.test(coupe)) coupe = coupe.slice(0, -1);
  return `${coupe}…`;
}

type Echec = { readonly ok: false; readonly classe: ClasseEchec; readonly message: string };
type Appel<T> = { readonly ok: true; readonly data: T } | Echec;

interface EquipeEtLabels {
  readonly equipeId: string;
  readonly labelIds: readonly string[];
}

/**
 * Une configuration que Linear refuse (équipe, label) : la Destination est Suspendue
 * comme pour une clé refusée, plutôt que chaque Envoi en échec.
 */
const refus = (message: string): Echec => ({ ok: false, classe: 'auth', message });

const echec = ({ classe, message }: Echec): ResultatEnvoi => ({ statut: 'echec', classe, message });

interface ErreurGraphQL {
  readonly message?: unknown;
  readonly extensions?: {
    readonly type?: unknown;
    readonly code?: unknown;
    readonly userPresentableMessage?: unknown;
  };
}

interface CorpsGraphQL<T> {
  readonly data?: T | null;
  readonly errors?: readonly ErreurGraphQL[];
}

/** Le corps JSON d'une réponse, lu sur une copie (le corps reste lisible), ou `null`. */
async function corpsGraphQL<T>(reponse: Response): Promise<CorpsGraphQL<T> | null> {
  try {
    const corps = (await reponse.clone().json()) as unknown;
    return corps && typeof corps === 'object' ? (corps as CorpsGraphQL<T>) : null;
  } catch {
    return null;
  }
}

/**
 * Types d'erreur de l'API Linear (`extensions.type`, ou `extensions.code` ramené à la
 * même forme : RATELIMITED, AUTHENTICATION_ERROR…), d'après le SDK Linear
 * (https://github.com/linear/linear/blob/master/packages/sdk/src/error.ts).
 */
const TYPES_AUTH = new Set(['authentication error', 'forbidden']);
const TYPES_TRANSITOIRES = new Set([
  'ratelimited',
  'internal error',
  'lock timeout',
  'network error',
  'bootstrap error',
]);

const typeErreur = ({ extensions }: ErreurGraphQL): string => {
  const brut = typeof extensions?.type === 'string' ? extensions.type : extensions?.code;
  return typeof brut === 'string' ? brut.toLowerCase().replaceAll('_', ' ') : '';
};

/**
 * Classe d'une réponse portant des erreurs GraphQL : une clé refusée (« authentication
 * error », « forbidden ») refuse la Destination ; une limite de débit (HTTP 400, code
 * RATELIMITED, https://linear.app/developers/rate-limiting) ou une erreur interne est
 * passagère ; tout autre refus vise cette issue (entrée invalide…). Plusieurs erreurs :
 * la plus grave l'emporte.
 */
function echecGraphQL(
  status: number,
  erreurs: readonly ErreurGraphQL[],
): { classe: ClasseEchec; message: string } {
  const classes = erreurs.map((erreur): ClasseEchec => {
    const type = typeErreur(erreur);
    if (TYPES_AUTH.has(type)) return 'auth';
    if (TYPES_TRANSITOIRES.has(type)) return 'transient';
    return status < 300 ? 'permanent' : classerStatut(status);
  });
  const classe = classes.includes('auth')
    ? 'auth'
    : classes.includes('transient')
      ? 'transient'
      : 'permanent';
  const messages = erreurs.map(({ message, extensions }) =>
    String(extensions?.userPresentableMessage ?? message ?? 'erreur sans message'),
  );
  return { classe, message: borne(`Linear (HTTP ${status}) : ${messages.join(' ; ')}`) };
}

const MESSAGE_MAX = 300;
const borne = (texte: string) =>
  texte.length > MESSAGE_MAX ? `${texte.slice(0, MESSAGE_MAX)}…` : texte;
