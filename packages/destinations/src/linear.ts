import {
  presenterAlerte,
  type ClasseEchec,
  type DestinationAdapter,
  type DestinationConfiguree,
  type EnvoiASortir,
  type ResultatEnvoi,
} from '@nudge/core';
import {
  LIBELLES_GRAVITE,
  LIBELLES_TYPE,
  definitionLinear,
  nomFichierCapture,
  type SecretsLinear,
} from '@nudge/shared';
import { lireCapture, type ImageCapture } from './capture.js';
import {
  DELAI_HTTP_PAR_DEFAUT_MS,
  EXTRAIT_MAX,
  classerStatut,
  echecHttp,
  messageErreur,
} from './http.js';
import { alerteEnMarkdown, echapperPonctuation, lienSur } from './markdown.js';
import { titreAvecType, tronquer } from './texte.js';

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

/** https://linear.app/developers/how-to-upload-a-file-to-linear */
const MUTATION_FICHIER = `mutation FichierNudge($contentType: String!, $filename: String!, $size: Int!) {
  fileUpload(contentType: $contentType, filename: $filename, size: $size) {
    success
    uploadFile { uploadUrl assetUrl headers { key value } }
  }
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
      if (!label.isGroup) labels.set(cleLabel(label.name), label.id);
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
      noms.every((nom) => equipe.labels.has(cleLabel(nom)));
    const gardee = relire ? undefined : equipes.get(cleCache);
    let equipe: EquipeLue;
    if (gardee && connaitTout(gardee)) {
      equipe = gardee;
    } else {
      const lue = await lireEquipe();
      if (!lue.ok) return lue;
      equipe = lue.data;
    }
    const manquant = noms.find((nom) => !equipe.labels.has(cleLabel(nom)));
    if (manquant !== undefined) {
      return refus(`Label Linear « ${manquant} » introuvable dans l’équipe ${config.equipe}`);
    }
    return {
      ok: true,
      data: {
        equipeId: equipe.id,
        labelIds: noms.map((nom) => equipe.labels.get(cleLabel(nom))!),
      },
    };
  }

  /**
   * Téléverse l'image chez Linear (https://linear.app/developers/how-to-upload-a-file-to-linear) :
   * `fileUpload` prépare une URL signée, un PUT y dépose l'image avec les en-têtes rendus,
   * et l'`assetUrl` rendue la désigne dans la description. Un PUT refusé est passager :
   * l'Envoi retenté demandera une nouvelle URL signée.
   */
  async function televerser(retourId: string, image: ImageCapture): Promise<Appel<string>> {
    const preparation = await graphql<DonneesFichier>(MUTATION_FICHIER, {
      contentType: image.contentType,
      filename: nomFichierCapture(retourId, image.contentType),
      size: image.octets.length,
    });
    if (!preparation.ok) return preparation;
    const fichier = preparation.data.fileUpload.uploadFile;
    if (!preparation.data.fileUpload.success || !fichier) {
      return {
        ok: false,
        classe: 'permanent',
        message: 'Linear n’a pas préparé le téléversement de la Capture',
      };
    }
    let reponse: Response;
    try {
      reponse = await fetch(fichier.uploadUrl, {
        method: 'PUT',
        redirect: 'manual',
        signal: AbortSignal.timeout(delaiMs),
        headers: {
          'content-type': image.contentType,
          'cache-control': 'public, max-age=31536000',
          ...Object.fromEntries(fichier.headers.map(({ key, value }) => [key, value])),
        },
        body: image.octets,
      });
    } catch (erreur) {
      return { ok: false, classe: 'transient', message: messageErreur(erreur) };
    }
    await reponse.body?.cancel();
    if (!reponse.ok) {
      return {
        ok: false,
        classe: 'transient',
        message: `Linear : téléversement de la Capture refusé (HTTP ${reponse.status})`,
      };
    }
    return { ok: true, data: fichier.assetUrl };
  }

  async function creerIssue(entree: {
    teamId: string;
    title: string;
    description: string;
    labelIds: readonly string[];
  }): Promise<ResultatEnvoi> {
    const creation = await graphql<DonneesCreation>(MUTATION_ISSUE, { entree });
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
  }

  return {
    async send(envoi) {
      const noms = [
        config.labels.types[envoi.retour.typeRetenu],
        envoi.retour.gravite ? config.labels.gravites[envoi.retour.gravite] : undefined,
      ].filter((nom): nom is string => nom !== undefined);
      const cible = await resoudre(noms);
      if (!cible.ok) return echec(cible);
      const capture = await lireCapture(envoi.retour.capture);
      if (!capture.ok) return echec(capture);
      let assetUrl: string | null = null;
      if (capture.image) {
        const televersee = await televerser(envoi.retour.id, capture.image);
        if (!televersee.ok) return echec(televersee);
        assetUrl = televersee.data;
      }
      return creerIssue({
        teamId: cible.data.equipeId,
        title: titreAvecType(envoi, TITRE_MAX),
        description: description(envoi, assetUrl),
        labelIds: cible.data.labelIds,
      });
    },
    /** Une issue dans l'équipe configurée, sans label : les labels sont ceux des Retours. */
    async alerter(alerte) {
      const cible = await resoudre([]);
      if (!cible.ok) return echec(cible);
      const { titre } = presenterAlerte(alerte);
      return creerIssue({
        teamId: cible.data.equipeId,
        title: tronquer(titre, TITRE_MAX),
        description: alerteEnMarkdown(alerte, texteEchappe),
        labelIds: [],
      });
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

interface DonneesFichier {
  readonly fileUpload: {
    readonly success: boolean;
    readonly uploadFile: {
      readonly uploadUrl: string;
      readonly assetUrl: string;
      readonly headers: readonly { readonly key: string; readonly value: string }[];
    } | null;
  };
}

interface DonneesCreation {
  readonly issueCreate: {
    readonly success: boolean;
    readonly issue: { readonly url: string } | null;
  };
}

/** Longueur maximale du titre d'une issue (texte brut chez Linear), en unités UTF-16. */
const TITRE_MAX = 120;

/**
 * Description (markdown) : le texte de l'Auteur échappé, la Capture (image déjà
 * téléversée chez Linear, désignée par son `assetUrl`), puis un pied écrit par nudge.
 */
function description({ projet, retour }: EnvoiASortir, assetUrl: string | null): string {
  const gravite = retour.gravite ? LIBELLES_GRAVITE[retour.gravite] : 'Non évaluée';
  const pied = [
    `**Projet** : ${echapperPonctuation(projet.nom)}`,
    `**Type** : ${LIBELLES_TYPE[retour.typeRetenu]} · **Gravité** : ${gravite}`,
    ...(retour.incertain
      ? ['**Verdict incertain** : le Juge a hésité, vérifiez-le dans nudge.']
      : []),
    ...(lienSur(retour.lienDashboard)
      ? [`[Voir le Retour dans nudge](<${retour.lienDashboard}>)`]
      : []),
  ];
  const capture = lienSur(assetUrl) ? [`![Capture de la page](<${assetUrl}>)`] : [];
  return [texteEchappe(retour.texte), ...capture, '---', ...pied].join('\n\n');
}

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
      echapperPonctuation(ligne.trimEnd()).replace(/^[ \t]+/, (indentation) =>
        indentation.replaceAll('\t', '    ').replaceAll(' ', '\u00a0'),
      ),
    )
    .join('\n')
    .split(/\n{2,}/)
    .map((paragraphe) => paragraphe.split('\n').join('\\\n'))
    .filter((paragraphe) => paragraphe.length > 0);
  return paragraphes.length > 0 ? paragraphes.join('\n\n') : '_(texte vide)_';
}

/** Un nom de label tel que Linear le compare : sans tenir compte de la casse. */
const cleLabel = (nom: string) => nom.toLowerCase();

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
  return {
    classe,
    message: tronquer(`Linear (HTTP ${status}) : ${messages.join(' ; ')}`, EXTRAIT_MAX),
  };
}
