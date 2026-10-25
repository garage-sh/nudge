/**
 * Judge port (ADR "triage via System One port"): Triage asks typed Noul / Choice /
 * Score questions about a state, and each System One compatible provider (Jev,
 * pplx-decider…) is an adapter of it.
 *
 * The port does not know the domain: it knows nothing about Feedback. The System One
 * primitives (questions, answers and their fields) keep the providers' vocabulary;
 * only the Judge bears a domain name.
 */

/** What counts as "yes" and as "no". */
export interface NoulCriteria {
  readonly true: string;
  readonly false: string;
}

/** Is a condition true? Answer: probability of "yes". */
export interface NoulQuestion {
  readonly kind: 'noul';
  readonly question: string;
  readonly criteria?: NoulCriteria;
}

/** One option out of a closed set. */
export interface ChoiceQuestion<C extends string = string> {
  readonly kind: 'choice';
  readonly question: string;
  readonly choices: readonly [C, ...C[]];
  /** When each option applies; an option without a description stands for its name. */
  readonly descriptions?: Readonly<Partial<Record<C, string>>>;
}

/** A position on ordered levels, from lowest to highest. */
export interface ScoreQuestion<N extends string = string> {
  readonly kind: 'score';
  readonly question: string;
  readonly levels: readonly [N, ...N[]];
  /** The concrete situation each level describes; a level without a description stands for its name. */
  readonly descriptions?: Readonly<Partial<Record<N, string>>>;
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type Questions = Readonly<Record<string, Question>>;

export interface NoulAnswer {
  readonly kind: 'noul';
  /** Probability of "yes", between 0 and 1. */
  readonly probability: number;
}

export interface ChoiceAnswer<C extends string = string> {
  readonly kind: 'choice';
  /** The most likely option. */
  readonly choice: C;
  readonly distribution: Readonly<Record<C, number>>;
  /** Concentration of the distribution, between 0 and 1. */
  readonly confidence: number;
}

export interface ScoreAnswer<N extends string = string> {
  readonly kind: 'score';
  /** The most likely level. */
  readonly level: N;
  /** Weighted position on the scale, from 0 (first level) to 1 (last). */
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

/** Data the Judge reasons about. The Author's content appears ONLY here. */
export type JudgeState = Readonly<Record<string, unknown>>;

export interface JudgeRequest<Qs extends Questions = Questions> {
  /** General, fixed instructions: never content coming from an Author. */
  readonly instructions?: string;
  readonly state: JudgeState;
  /** Independent questions, asked in a single request. */
  readonly questions: Qs;
}

export interface JudgeOptions {
  /** Aborts the call in progress (timeout on the caller's side). */
  readonly signal?: AbortSignal;
}

export interface Judge {
  judge<Qs extends Questions>(
    request: JudgeRequest<Qs>,
    options?: JudgeOptions,
  ): Promise<Answers<Qs>>;
}

/** Temporary Judge error (unavailable, timeout, rate limit): the caller retries later. */
export class JudgeTransientError extends Error {
  override readonly name = 'JudgeTransientError';
}

/**
 * Why a Judge refuses for good, with no identical retry changing anything:
 * - `auth`: key rejected, insufficient rights or credits — the Instance's configuration is at fault;
 * - `request`: request rejected (schema, size, unknown model);
 * - `response`: unreadable response, or one that does not match the questions asked.
 */
export type JudgeRefusalReason = 'auth' | 'request' | 'response';

/** Lasting Judge refusal: retrying the same request is not enough. */
export class JudgeRefusedError extends Error {
  override readonly name = 'JudgeRefusedError';

  constructor(
    readonly reason: JudgeRefusalReason,
    message: string,
    /** HTTP status of the provider's response, if there is one. */
    readonly status?: number,
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
