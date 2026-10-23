/**
 * Port Juge (ADR « triage via port System One ») : le Triage pose des questions
 * typées Noul / Choice / Score sur un state, et chaque fournisseur compatible
 * System One (Jev, pplx-decider…) en est un adapter.
 *
 * Le port ne connaît pas le domaine : il ne sait rien des Retours. Les
 * primitives System One (questions, réponses et leurs champs) gardent le
 * vocabulaire anglais des fournisseurs ; seul le Juge porte un nom du domaine.
 */

/** Ce qui compte comme « oui » et comme « non ». */
export interface NoulCriteria {
  readonly true: string;
  readonly false: string;
}

/** Une condition est-elle vraie ? Réponse : probabilité de « oui ». */
export interface NoulQuestion {
  readonly kind: 'noul';
  readonly question: string;
  readonly criteria?: NoulCriteria;
}

/** Une option parmi un ensemble fermé. */
export interface ChoiceQuestion<C extends string = string> {
  readonly kind: 'choice';
  readonly question: string;
  readonly choices: readonly [C, ...C[]];
  /** Quand chaque option s'applique ; une option sans description vaut par son nom. */
  readonly descriptions?: Readonly<Partial<Record<C, string>>>;
}

/** Une position sur des niveaux ordonnés, du plus bas au plus haut. */
export interface ScoreQuestion<N extends string = string> {
  readonly kind: 'score';
  readonly question: string;
  readonly levels: readonly [N, ...N[]];
  /** La situation concrète que décrit chaque niveau ; un niveau sans description vaut par son nom. */
  readonly descriptions?: Readonly<Partial<Record<N, string>>>;
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type Questions = Readonly<Record<string, Question>>;

export interface NoulAnswer {
  readonly kind: 'noul';
  /** Probabilité de « oui », entre 0 et 1. */
  readonly probability: number;
}

export interface ChoiceAnswer<C extends string = string> {
  readonly kind: 'choice';
  /** L'option la plus probable. */
  readonly choice: C;
  readonly distribution: Readonly<Record<C, number>>;
  /** Concentration de la distribution, entre 0 et 1. */
  readonly confidence: number;
}

export interface ScoreAnswer<N extends string = string> {
  readonly kind: 'score';
  /** Le niveau le plus probable. */
  readonly level: N;
  /** Position pondérée sur l'échelle, de 0 (premier niveau) à 1 (dernier). */
  readonly value: number;
  readonly distribution: Readonly<Record<N, number>>;
  readonly confidence: number;
}

export type Answer<Q extends Question> =
  Q extends ChoiceQuestion<infer C>
    ? ChoiceAnswer<C>
    : Q extends ScoreQuestion<infer N>
      ? ScoreAnswer<N>
      : NoulAnswer;

export type Answers<Qs extends Questions> = { readonly [K in keyof Qs]: Answer<Qs[K]> };

/** Données sur lesquelles le Juge raisonne. Le contenu de l'Auteur n'apparaît QUE ici. */
export type StateJuge = Readonly<Record<string, unknown>>;

export interface RequeteJuge<Qs extends Questions = Questions> {
  /** Consignes générales, fixes : jamais de contenu venant d'un Auteur. */
  readonly instructions?: string;
  readonly state: StateJuge;
  /** Questions indépendantes, posées en une seule requête. */
  readonly questions: Qs;
}

export interface OptionsJugement {
  /** Annule l'appel en cours (délai dépassé côté appelant). */
  readonly signal?: AbortSignal;
}

export interface Juge {
  juger<Qs extends Questions>(
    requete: RequeteJuge<Qs>,
    options?: OptionsJugement,
  ): Promise<Answers<Qs>>;
}

/** Erreur passagère du Juge (indisponible, timeout, limite de débit) : l'appelant retente plus tard. */
export class ErreurJugeTransitoire extends Error {
  override readonly name = 'ErreurJugeTransitoire';
}

/**
 * Pourquoi un Juge refuse durablement, sans qu'un nouvel essai identique y change rien :
 * - `auth` : clé refusée, droits ou crédits insuffisants — la configuration de l'Instance est en cause ;
 * - `requete` : requête rejetée (schéma, taille, modèle inconnu) ;
 * - `reponse` : réponse illisible ou qui ne correspond pas aux questions posées.
 */
export type MotifRefusJuge = 'auth' | 'requete' | 'reponse';

/** Refus durable du Juge : retenter la même requête ne suffit pas. */
export class ErreurJugeRefusee extends Error {
  override readonly name = 'ErreurJugeRefusee';

  constructor(
    readonly motif: MotifRefusJuge,
    message: string,
    /** Statut HTTP de la réponse du fournisseur, s'il y en a une. */
    readonly statut?: number,
  ) {
    super(message);
  }
}

export const noul = (question: string, criteria?: NoulCriteria): NoulQuestion => ({
  kind: 'noul',
  question,
  ...(criteria === undefined ? {} : { criteria }),
});

export const choice = <const C extends string>(
  question: string,
  choices: readonly [C, ...C[]],
  descriptions?: Readonly<Partial<Record<C, string>>>,
): ChoiceQuestion<C> => ({
  kind: 'choice',
  question,
  choices,
  ...(descriptions === undefined ? {} : { descriptions }),
});

export const score = <const N extends string>(
  question: string,
  levels: readonly [N, ...N[]],
  descriptions?: Readonly<Partial<Record<N, string>>>,
): ScoreQuestion<N> => ({
  kind: 'score',
  question,
  levels,
  ...(descriptions === undefined ? {} : { descriptions }),
});
