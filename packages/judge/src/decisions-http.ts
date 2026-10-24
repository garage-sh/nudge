import { messageErreur } from '@nudge/shared';
import {
  ErreurJugeRefusee,
  ErreurJugeTransitoire,
  type Answer,
  type Answers,
  type Juge,
  type OptionsJugement,
  type Question,
  type Questions,
  type RequeteJuge,
} from './port.js';

/**
 * Format commun des fournisseurs System One : POST JSON `{ model, state, questions }`
 * → `{ model, answers, usage }`, questions et réponses typées `noul` / `choice` / `score`.
 * C'est celui de l'API systemone de TypeSafe, de l'API Decisions d'OpenRouter et de
 * l'API Decisions de Perplexity (hébergée ou servie localement) ; seuls l'URL, le
 * modèle et l'authentification changent d'un adaptateur à l'autre.
 */
export interface ClientDecisions {
  /** URL complète de l'endpoint. */
  readonly url: string;
  readonly modele: string;
  /** Envoyée en `Authorization: Bearer` ; absente pour un serveur local sans clé. */
  readonly cleApi?: string | null;
  /** Nom du fournisseur, pour les messages d'erreur. */
  readonly fournisseur: string;
  readonly fetch?: typeof globalThis.fetch;
}

/** Longueur maximale du message d'erreur d'un fournisseur repris dans nos erreurs. */
const MESSAGE_MAX = 300;

export function jugeDecisions(client: ClientDecisions): Juge {
  return {
    async juger<Qs extends Questions>(
      requete: RequeteJuge<Qs>,
      options: OptionsJugement = {},
    ): Promise<Answers<Qs>> {
      const corps = await appeler(client, encoderRequete(client.modele, requete), options.signal);
      return decoderReponses(client.fournisseur, requete.questions, corps);
    },
  };
}

/**
 * Les consignes générales sont fixes : elles précèdent chaque question (ces API n'ont
 * pas de consignes au niveau de la requête). Le state part tel quel, seul endroit où
 * figure le contenu d'un Auteur.
 */
function encoderRequete(modele: string, requete: RequeteJuge): unknown {
  const prefixe = requete.instructions ? `${requete.instructions}\n\n` : '';
  return {
    model: modele,
    state: requete.state,
    questions: Object.fromEntries(
      Object.entries(requete.questions).map(([id, q]) => [id, encoderQuestion(prefixe, q)]),
    ),
  };
}

function encoderQuestion(prefixe: string, question: Question): unknown {
  const instructions = `${prefixe}${question.question}`;
  switch (question.kind) {
    case 'noul':
      return {
        type: 'noul',
        instructions,
        ...(question.criteria
          ? { criteria: { true: question.criteria.true, false: question.criteria.false } }
          : {}),
      };
    case 'choice': {
      const descriptions: Partial<Record<string, string>> = question.descriptions ?? {};
      return {
        type: 'choice',
        instructions,
        criteria: Object.fromEntries(question.choices.map((c) => [c, descriptions[c] ?? null])),
      };
    }
    case 'score': {
      const descriptions: Partial<Record<string, string>> = question.descriptions ?? {};
      return {
        type: 'score',
        instructions,
        criteria: question.levels.map((niveau) => descriptions[niveau] ?? niveau),
      };
    }
  }
}

async function appeler(
  client: ClientDecisions,
  corps: unknown,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const fetch = client.fetch ?? globalThis.fetch;
  let reponse: Response;
  try {
    reponse = await fetch(client.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(client.cleApi ? { authorization: `Bearer ${client.cleApi}` } : {}),
      },
      body: JSON.stringify(corps),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    // Coupure réseau, DNS, délai dépassé (annulation) : le Juge est injoignable.
    throw new ErreurJugeTransitoire(`${client.fournisseur} injoignable : ${messageErreur(cause)}`, {
      cause,
    });
  }

  const texte = await reponse.text().catch(() => '');
  if (!reponse.ok) throw erreurHttp(client.fournisseur, reponse.status, texte);
  try {
    return JSON.parse(texte) as unknown;
  } catch {
    throw new ErreurJugeRefusee('reponse', `${client.fournisseur} : réponse qui n'est pas du JSON`);
  }
}

/**
 * Transitoires : 408, 425, 429 et tout 5xx (dont 524 et 529, délais et surcharges des
 * fournisseurs). Refus « auth » : 401, 402 (crédits épuisés), 403. Tout autre 4xx :
 * la requête elle-même est rejetée.
 */
function erreurHttp(fournisseur: string, statut: number, texte: string): Error {
  const message = `${fournisseur} a répondu ${statut}${detailErreur(texte)}`;
  if (statut === 408 || statut === 425 || statut === 429 || statut >= 500) {
    return new ErreurJugeTransitoire(message);
  }
  if (statut === 401 || statut === 402 || statut === 403) {
    return new ErreurJugeRefusee('auth', message, statut);
  }
  return new ErreurJugeRefusee('requete', message, statut);
}

/** Le message lisible d'un corps d'erreur (`error.message` ou `detail`), tronqué. */
function detailErreur(texte: string): string {
  let detail: unknown = texte;
  try {
    const json = JSON.parse(texte) as { error?: { message?: unknown }; detail?: unknown };
    detail = json.error?.message ?? json.detail ?? texte;
  } catch {
    // Corps non JSON : on garde le texte brut.
  }
  const chaine = typeof detail === 'string' ? detail : JSON.stringify(detail);
  return chaine ? ` : ${chaine.slice(0, MESSAGE_MAX)}` : '';
}

type Objet = Record<string, unknown>;
const estObjet = (valeur: unknown): valeur is Objet =>
  typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);
const estProbabilite = (valeur: unknown): valeur is number =>
  typeof valeur === 'number' && Number.isFinite(valeur) && valeur >= 0 && valeur <= 1;

class ReponseInvalide extends Error {}

function decoderReponses<Qs extends Questions>(
  fournisseur: string,
  questions: Qs,
  corps: unknown,
): Answers<Qs> {
  try {
    const answers = estObjet(corps) ? corps.answers : undefined;
    if (!estObjet(answers)) throw new ReponseInvalide('pas de champ `answers`');
    return Object.fromEntries(
      Object.entries(questions).map(([id, question]) => [
        id,
        decoderReponse(id, question, answers[id]),
      ]),
    ) as Answers<Qs>;
  } catch (erreur) {
    if (!(erreur instanceof ReponseInvalide)) throw erreur;
    throw new ErreurJugeRefusee('reponse', `${fournisseur} : réponse invalide (${erreur.message})`);
  }
}

function decoderReponse(id: string, question: Question, brute: unknown): Answer<Question> {
  if (!estObjet(brute) || brute.type !== question.kind) {
    throw new ReponseInvalide(`« ${id} » : réponse absente ou d'un autre type`);
  }
  switch (question.kind) {
    case 'noul': {
      if (!estProbabilite(brute.noul)) throw new ReponseInvalide(`« ${id} » : noul invalide`);
      return { kind: 'noul', probability: brute.noul };
    }
    case 'choice': {
      const choix = brute.choice;
      if (typeof choix !== 'string' || !question.choices.includes(choix)) {
        throw new ReponseInvalide(`« ${id} » : choix hors des options posées`);
      }
      return {
        kind: 'choice',
        choice: choix,
        distribution: distribution(id, question.choices, (option) => option, brute.probabilities),
        confidence: confiance(id, brute.confidence),
      };
    }
    case 'score': {
      const niveaux = question.levels;
      // Les probabilités d'un Score sont indexées par la position du niveau (« 0 », « 1 »…).
      const dist = distribution(id, niveaux, (_, rang) => String(rang), brute.probabilities);
      if (typeof brute.score !== 'number' || !Number.isFinite(brute.score)) {
        throw new ReponseInvalide(`« ${id} » : score invalide`);
      }
      const plusProbable = niveaux.reduce((meilleur, niveau) =>
        dist[niveau]! > dist[meilleur]! ? niveau : meilleur,
      );
      return {
        kind: 'score',
        level: plusProbable,
        value: niveaux.length > 1 ? brute.score / (niveaux.length - 1) : 0,
        distribution: dist,
        confidence: confiance(id, brute.confidence),
      };
    }
  }
}

/** Probabilité de chaque option ; une option absente de la réponse vaut 0. */
function distribution(
  id: string,
  options: readonly string[],
  cle: (option: string, rang: number) => string,
  brute: unknown,
): Record<string, number> {
  if (!estObjet(brute)) throw new ReponseInvalide(`« ${id} » : pas de probabilités`);
  return Object.fromEntries(
    options.map((option, rang) => {
      const p = brute[cle(option, rang)] ?? 0;
      if (!estProbabilite(p)) throw new ReponseInvalide(`« ${id} » : probabilité invalide`);
      return [option, p];
    }),
  );
}

function confiance(id: string, brute: unknown): number {
  if (!estProbabilite(brute)) throw new ReponseInvalide(`« ${id} » : confiance invalide`);
  return brute;
}
