import { errorMessage, readTextPrefix } from '@nudge/shared';
import {
  JudgeRefusedError,
  JudgeTransientError,
  type Answer,
  type Answers,
  type Judge,
  type JudgeOptions,
  type Question,
  type Questions,
  type JudgeRequest,
} from './port.js';

/**
 * Common format of System One providers: POST JSON `{ model, state, questions }`
 * → `{ model, answers, usage }`, questions and answers typed `noul` / `choice` / `score`.
 * It is that of TypeSafe's systemone API, OpenRouter's Decisions API and Perplexity's
 * Decisions API (hosted or served locally); only the URL, the model and the
 * authentication change from one adapter to another.
 */
export interface DecisionsClient {
  /** Full URL of the endpoint. */
  readonly url: string;
  readonly model: string;
  /** Sent as `Authorization: Bearer`; absent for a local server without a key. */
  readonly apiKey?: string | null;
  /** Provider name, for error messages. */
  readonly provider: string;
  readonly fetch?: typeof globalThis.fetch;
}

/** Maximum length of a provider's error message carried over into our errors. */
const MESSAGE_MAX = 300;

/** Bytes of an error response read to find its message (JSON `error.message` or `detail`). */
const ERROR_BODY_MAX = 8 * 1024;

export function decisionsJudge(client: DecisionsClient): Judge {
  return {
    async judge<Qs extends Questions>(
      request: JudgeRequest<Qs>,
      options: JudgeOptions = {},
    ): Promise<Answers<Qs>> {
      const body = await call(client, encodeRequest(client.model, request), options.signal);
      return decodeAnswers(client.provider, request.questions, body);
    },
  };
}

/**
 * The general instructions are fixed: they precede each question (these APIs have no
 * request-level instructions). The state is sent as is, the only place an Author's
 * content appears.
 */
function encodeRequest(model: string, request: JudgeRequest): unknown {
  const prefix = request.instructions ? `${request.instructions}\n\n` : '';
  return {
    model,
    state: request.state,
    questions: Object.fromEntries(
      Object.entries(request.questions).map(([id, q]) => [id, encodeQuestion(prefix, q)]),
    ),
  };
}

function encodeQuestion(prefix: string, question: Question): unknown {
  const instructions = `${prefix}${question.question}`;
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
        criteria: question.levels.map((level) => descriptions[level] ?? level),
      };
    }
  }
}

async function call(
  client: DecisionsClient,
  body: unknown,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const fetch = client.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetch(client.url, {
      method: 'POST',
      // The key never follows a redirect to another host: the final URL is configured.
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        ...(client.apiKey ? { authorization: `Bearer ${client.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (cause) {
    // Network outage, DNS, timeout (abort): the Judge is unreachable.
    throw new JudgeTransientError(`${client.provider} unreachable: ${errorMessage(cause)}`, {
      cause,
    });
  }

  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new JudgeRefusedError(
      'request',
      `${client.provider} responded ${response.status}: redirect refused, configure the final URL`,
      response.status,
    );
  }
  if (!response.ok) {
    // Only the start of an error body is read: its message is truncated anyway.
    const start = await readTextPrefix(response, ERROR_BODY_MAX);
    throw httpError(client.provider, response.status, start);
  }
  const text = await response.text().catch(() => '');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new JudgeRefusedError('response', `${client.provider}: response is not JSON`);
  }
}

/**
 * Transient: 408, 425, 429 and any 5xx (including 524 and 529, provider timeouts and
 * overloads). "auth" refusal: 401, 402 (credits exhausted), 403. Any other 4xx: the
 * request itself is rejected.
 */
function httpError(provider: string, status: number, text: string): Error {
  const message = `${provider} responded ${status}${errorDetail(text)}`;
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return new JudgeTransientError(message);
  }
  if (status === 401 || status === 402 || status === 403) {
    return new JudgeRefusedError('auth', message, status);
  }
  return new JudgeRefusedError('request', message, status);
}

/** The readable message of an error body (`error.message` or `detail`), truncated. */
function errorDetail(text: string): string {
  let detail: unknown = text;
  try {
    const json = JSON.parse(text) as { error?: { message?: unknown }; detail?: unknown };
    detail = json.error?.message ?? json.detail ?? text;
  } catch {
    // Non-JSON body: keep the raw text.
  }
  const str = typeof detail === 'string' ? detail : JSON.stringify(detail);
  return str ? `: ${str.slice(0, MESSAGE_MAX)}` : '';
}

type Obj = Record<string, unknown>;
const isObject = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isProbability = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

class InvalidAnswer extends Error {}

function decodeAnswers<Qs extends Questions>(
  provider: string,
  questions: Qs,
  body: unknown,
): Answers<Qs> {
  try {
    const answers = isObject(body) ? body.answers : undefined;
    if (!isObject(answers)) throw new InvalidAnswer('no `answers` field');
    return Object.fromEntries(
      Object.entries(questions).map(([id, question]) => [
        id,
        decodeAnswer(id, question, answers[id]),
      ]),
    ) as Answers<Qs>;
  } catch (error) {
    if (!(error instanceof InvalidAnswer)) throw error;
    throw new JudgeRefusedError('response', `${provider}: invalid response (${error.message})`);
  }
}

function decodeAnswer(id: string, question: Question, raw: unknown): Answer<Question> {
  if (!isObject(raw) || raw.type !== question.kind) {
    throw new InvalidAnswer(`"${id}": answer missing or of another type`);
  }
  switch (question.kind) {
    case 'noul': {
      if (!isProbability(raw.noul)) throw new InvalidAnswer(`"${id}": invalid noul`);
      return { kind: 'noul', probability: raw.noul };
    }
    case 'choice': {
      const picked = raw.choice;
      if (typeof picked !== 'string' || !question.choices.includes(picked)) {
        throw new InvalidAnswer(`"${id}": choice outside the options asked`);
      }
      return {
        kind: 'choice',
        choice: picked,
        distribution: distribution(id, question.choices, (option) => option, raw.probabilities),
        confidence: confidence(id, raw.confidence),
      };
    }
    case 'score': {
      const levels = question.levels;
      // A Score's probabilities are indexed by the level's position ("0", "1"…).
      const dist = distribution(id, levels, (_, rank) => String(rank), raw.probabilities);
      if (typeof raw.score !== 'number' || !Number.isFinite(raw.score)) {
        throw new InvalidAnswer(`"${id}": invalid score`);
      }
      const mostLikely = levels.reduce((best, level) =>
        dist[level]! > dist[best]! ? level : best,
      );
      return {
        kind: 'score',
        level: mostLikely,
        value: levels.length > 1 ? raw.score / (levels.length - 1) : 0,
        distribution: dist,
        confidence: confidence(id, raw.confidence),
      };
    }
  }
}

/** Probability of each option; an option missing from the response counts as 0. */
function distribution(
  id: string,
  options: readonly string[],
  key: (option: string, rank: number) => string,
  raw: unknown,
): Record<string, number> {
  if (!isObject(raw)) throw new InvalidAnswer(`"${id}": no probabilities`);
  return Object.fromEntries(
    options.map((option, rank) => {
      const p = raw[key(option, rank)] ?? 0;
      if (!isProbability(p)) throw new InvalidAnswer(`"${id}": invalid probability`);
      return [option, p];
    }),
  );
}

function confidence(id: string, raw: unknown): number {
  if (!isProbability(raw)) throw new InvalidAnswer(`"${id}": invalid confidence`);
  return raw;
}
