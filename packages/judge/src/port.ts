/**
 * Port Juge (ADR « triage via port System One ») : le Triage pose des questions
 * typées Noul / Choice / Score sur un state, et chaque fournisseur compatible
 * System One (Jev, pplx-decider…) en est un adaptateur.
 *
 * Le port ne connaît pas le domaine : il ne sait rien des Retours.
 */

/** Une condition est-elle vraie ? Réponse : probabilité de « oui ». */
export interface QuestionNoul {
  readonly kind: 'noul';
  readonly question: string;
  readonly criteria?: string;
}

/** Une option parmi un ensemble fermé. */
export interface QuestionChoice<C extends string = string> {
  readonly kind: 'choice';
  readonly question: string;
  readonly choix: readonly [C, ...C[]];
  readonly criteria?: string;
}

/** Une position sur des niveaux ordonnés, du plus bas au plus haut. */
export interface QuestionScore<N extends string = string> {
  readonly kind: 'score';
  readonly question: string;
  readonly niveaux: readonly [N, ...N[]];
  readonly criteria?: string;
}

export type Question = QuestionNoul | QuestionChoice | QuestionScore;
export type Questions = Readonly<Record<string, Question>>;

export interface ReponseNoul {
  readonly kind: 'noul';
  /** Probabilité de « oui », entre 0 et 1. */
  readonly probabilite: number;
}

export interface ReponseChoice<C extends string = string> {
  readonly kind: 'choice';
  /** L'option la plus probable. */
  readonly choix: C;
  readonly distribution: Readonly<Record<C, number>>;
  /** Concentration de la distribution, entre 0 et 1. */
  readonly confiance: number;
}

export interface ReponseScore<N extends string = string> {
  readonly kind: 'score';
  /** Le niveau le plus probable. */
  readonly niveau: N;
  /** Position pondérée sur l'échelle, de 0 (premier niveau) à 1 (dernier). */
  readonly valeur: number;
  readonly distribution: Readonly<Record<N, number>>;
  readonly confiance: number;
}

export type Reponse<Q extends Question> =
  Q extends QuestionChoice<infer C>
    ? ReponseChoice<C>
    : Q extends QuestionScore<infer N>
      ? ReponseScore<N>
      : ReponseNoul;

export type Reponses<Qs extends Questions> = { readonly [K in keyof Qs]: Reponse<Qs[K]> };

/** Données sur lesquelles le Juge raisonne. Le contenu de l'Auteur n'apparaît QUE ici. */
export type StateJuge = Readonly<Record<string, unknown>>;

export interface RequeteJuge<Qs extends Questions = Questions> {
  /** Consignes générales, fixes : jamais de contenu venant d'un Auteur. */
  readonly instructions?: string;
  readonly state: StateJuge;
  /** Questions indépendantes, posées en une seule requête. */
  readonly questions: Qs;
}

export interface Juge {
  juger<Qs extends Questions>(requete: RequeteJuge<Qs>): Promise<Reponses<Qs>>;
}

/** Erreur passagère du Juge (indisponible, timeout) : l'appelant retente plus tard. */
export class ErreurJugeTransitoire extends Error {
  override readonly name = 'ErreurJugeTransitoire';
}

export const noul = (question: string, criteria?: string): QuestionNoul => ({
  kind: 'noul',
  question,
  ...(criteria === undefined ? {} : { criteria }),
});

export const choice = <const C extends string>(
  question: string,
  choix: readonly [C, ...C[]],
  criteria?: string,
): QuestionChoice<C> => ({
  kind: 'choice',
  question,
  choix,
  ...(criteria === undefined ? {} : { criteria }),
});

export const score = <const N extends string>(
  question: string,
  niveaux: readonly [N, ...N[]],
  criteria?: string,
): QuestionScore<N> => ({
  kind: 'score',
  question,
  niveaux,
  ...(criteria === undefined ? {} : { criteria }),
});
