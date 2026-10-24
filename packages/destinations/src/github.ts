import {
  presenterAlerte,
  type Alerte,
  type ClasseEchec,
  type DestinationAdapter,
  type DestinationConfiguree,
  type EnvoiASortir,
  type ResultatEnvoi,
} from '@nudge/core';
import {
  LIBELLES_GRAVITE,
  LIBELLES_TYPE,
  definitionGitHub,
  lireDepotGitHub,
  type SecretsGitHub,
} from '@nudge/shared';
import {
  DELAI_HTTP_PAR_DEFAUT_MS,
  classerStatut,
  echecHttp,
  messageErreur,
  messageEchec,
  texteReponse,
} from './http.js';
import { alerteEnMarkdown, echapperPonctuation, lienSur } from './markdown.js';
import { titreAvecType, tronquer } from './texte.js';

export interface OptionsGitHub {
  readonly fetch?: typeof globalThis.fetch;
  /** Délai de réponse de GitHub, au-delà duquel l'appel est un échec transitoire. */
  readonly delaiMs?: number;
}

/** https://docs.github.com/en/rest/about-the-rest-api/api-versions */
const VERSION_API = '2026-03-10';

/** « Requests without a valid User-Agent header will be rejected. » */
const USER_AGENT = 'nudge (https://github.com/garage-sh/nudge)';

/**
 * GitHub Issues : une issue par Envoi, créée par l'API REST avec un jeton d'accès
 * personnel (https://docs.github.com/en/rest/issues/issues#create-an-issue).
 */
export function adaptateurGitHub(
  destination: DestinationConfiguree,
  options: OptionsGitHub = {},
): DestinationAdapter {
  const config = definitionGitHub.config.parse(destination.config);
  const depot = lireDepotGitHub(config.depot);
  if (!depot) throw new Error(`GitHub ${destination.id} sans dépôt valide`);
  const jeton = (destination.secrets as Partial<SecretsGitHub>).jeton;
  if (!jeton) throw new Error(`GitHub ${destination.id} sans jeton d'accès`);
  const fetch = options.fetch ?? globalThis.fetch;
  const delaiMs = options.delaiMs ?? DELAI_HTTP_PAR_DEFAUT_MS;
  const pointDAppel = `https://api.github.com/repos/${encodeURIComponent(depot.proprietaire)}/${encodeURIComponent(depot.nom)}`;

  const appeler = (url: string, init: RequestInit = {}) =>
    fetch(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(delaiMs),
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${jeton}`,
        'x-github-api-version': VERSION_API,
        'user-agent': USER_AGENT,
        ...init.headers,
      },
    });

  /** « Create an issue » : livrée avec son lien, ou l'échec classé. */
  async function creerIssue(issue: { title: string; body: string }): Promise<ResultatEnvoi> {
    let reponse: Response;
    try {
      reponse = await appeler(`${pointDAppel}/issues`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(issue),
      });
    } catch (erreur) {
      return { statut: 'echec', classe: 'transient', message: messageErreur(erreur) };
    }
    if (!reponse.ok) return { statut: 'echec', ...(await echecGitHub(reponse)) };
    const creee = (await reponse.json().catch(() => ({}))) as { html_url?: unknown };
    return {
      statut: 'livre',
      lienExterne: typeof creee.html_url === 'string' ? creee.html_url : null,
    };
  }

  return {
    send: (envoi) => creerIssue({ title: titre(envoi), body: corps(envoi) }),
    alerter: (alerte) => creerIssue(issueAlerte(alerte)),
    /**
     * « Get a repository » : le jeton voit le dépôt, ses issues sont ouvertes et il
     * n'est pas archivé (lecture seule). Ne vérifie pas la permission d'écrire des
     * issues, que seule une création prouverait.
     */
    async healthCheck() {
      let reponse: Response;
      try {
        reponse = await appeler(pointDAppel);
      } catch (erreur) {
        return { joignable: false, classe: 'transient', message: messageErreur(erreur) };
      }
      if (!reponse.ok) return { joignable: false, ...(await echecGitHub(reponse)) };
      const lu = (await reponse.json().catch(() => ({}))) as {
        has_issues?: unknown;
        archived?: unknown;
      };
      if (lu.has_issues === false) {
        return {
          joignable: false,
          classe: 'auth',
          message: `Issues désactivées sur ${config.depot}`,
        };
      }
      if (lu.archived === true) {
        return {
          joignable: false,
          classe: 'auth',
          message: `Dépôt ${config.depot} archivé : il n’accepte plus d’issue`,
        };
      }
      return { joignable: true };
    },
  };
}

/**
 * Classe d'un refus de GitHub :
 * - une limite de débit, primaire (`x-ratelimit-remaining: 0`) ou secondaire
 *   (`retry-after`, message « secondary rate limit »), arrive en 403 ou 429 : passagère
 *   (https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) ;
 * - 401 (jeton invalide), 403 (permission refusée), 404 (dépôt inconnu ou hors de
 *   portée du jeton), 410 (issues désactivées) et une redirection (dépôt renommé ou
 *   transféré) refusent la Destination : chaque Envoi échouerait (D21) ;
 * - 400 et 422 (validation, contenu jugé indésirable) visent cette issue.
 */
async function echecGitHub(reponse: Response): Promise<{ classe: ClasseEchec; message: string }> {
  if (reponse.status >= 300 && reponse.status < 400) {
    await reponse.body?.cancel();
    return {
      classe: 'auth',
      message: `HTTP ${reponse.status} : dépôt renommé ou transféré, configurez son nom actuel`,
    };
  }
  if ((reponse.status === 403 || reponse.status === 429) && (await limiteDeDebit(reponse))) {
    return { classe: 'transient', message: await messageEchec(reponse) };
  }
  return echecHttp(reponse, (status) =>
    status === 404 || status === 410 ? 'auth' : classerStatut(status),
  );
}

async function limiteDeDebit(reponse: Response): Promise<boolean> {
  if (reponse.headers.get('x-ratelimit-remaining') === '0') return true;
  if (reponse.headers.has('retry-after')) return true;
  return /rate limit/i.test(await texteReponse(reponse));
}

/** Longueur maximale du titre d'une issue, en unités UTF-16. */
const TITRE_MAX = 120;

/**
 * Titre (texte brut chez GitHub) : le Type et la première ligne du texte, ses `@`
 * coupés d'un espace sans chasse pour ne mentionner personne.
 */
const titre = (envoi: EnvoiASortir) => sansMention(titreAvecType(envoi, TITRE_MAX));

/** Corps (markdown GitHub) : le texte de l'Auteur, puis un pied écrit par nudge. */
function corps({ projet, retour }: EnvoiASortir): string {
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
  return [blocDeCode(retour.texte), '---', ...pied].join('\n\n');
}

/**
 * L'issue d'une alerte : titre en texte brut sans mention ; corps écrit par nudge, où
 * les noms (saisis par un Membre) et le refus (formulé par la cible) sont littéraux.
 */
function issueAlerte(alerte: Alerte): { title: string; body: string } {
  const { titre: titreAlerte } = presenterAlerte(alerte);
  return {
    title: sansMention(tronquer(titreAlerte, TITRE_MAX)),
    body: alerteEnMarkdown(alerte, echapperMarkdown),
  };
}

/**
 * Longueur maximale du corps d'une issue : 65 536 caractères selon le message du 422
 * de GitHub (« body is too long (maximum is 65536 characters) »), que la documentation
 * de l'API REST ne chiffre pas.
 */
const CORPS_MAX = 65_536;

/** Place laissée au pied écrit par nudge (nom du Projet compris, 100 caractères). */
const PIED_MAX = 1_000;

/** Place du bloc de code du texte de l'Auteur, clôtures comprises. */
const TEXTE_MAX = CORPS_MAX - PIED_MAX;

/**
 * Le texte de l'Auteur dans un bloc de code clôturé : son contenu est littéral (GFM,
 * https://github.github.com/gfm/#fenced-code-blocks), sans mise en forme, lien, image,
 * HTML, ni mention ou référence d'issue. La clôture compte un accent grave de plus que
 * la plus longue suite du texte, qui ne peut donc pas la refermer.
 */
function blocDeCode(texte: string): string {
  let lignes = texte.replace(/\r\n?/g, '\n');
  let cloture = '';
  // La clôture dépend du texte gardé ; tronquer ne fait que la raccourcir : la boucle
  // s'arrête dès que texte et clôtures tiennent ensemble.
  for (;;) {
    const plusLongue = (lignes.match(/`+/g) ?? []).reduce(
      (max, suite) => Math.max(max, suite.length),
      0,
    );
    cloture = '`'.repeat(Math.max(3, plusLongue + 1));
    const place = TEXTE_MAX - 2 * (cloture.length + 1);
    if (lignes.length <= place) break;
    lignes = tronquer(lignes, place);
  }
  return `${cloture}\n${lignes}\n${cloture}`;
}

/** Un texte du Membre (nom du Projet) en markdown : littéral, et sans mention. */
const echapperMarkdown = (texte: string) => sansMention(echapperPonctuation(texte));

const sansMention = (texte: string) => texte.replaceAll('@', '@\u200b');
