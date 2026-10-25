import type {
  Answer,
  Answers,
  Judge,
  JudgeOptions,
  Question,
  Questions,
  JudgeRequest,
} from '@nudge/judge';
import { JudgeTransientError } from '@nudge/judge';

/**
 * Scripted Verdict, question by question (key = the question's key):
 * - Choice: the chosen option; Score: the chosen level;
 * - Noul: the probability of "yes".
 * An unscripted question gets the first option / the first level / 0.
 */
export type Script = Readonly<Record<string, string | number>>;

/**
 * Test Judge plugged into the port: it returns scripted answers, records every
 * request it receives, and can fail (transient error) or be held.
 */
export class FakeJudge implements Judge {
  /** Every request received, in order. */
  readonly requests: JudgeRequest[] = [];
  /** The requests the caller cancelled (signal) while they were held. */
  readonly cancelled: JudgeRequest[] = [];
  private current: Script = {};
  private confidence = 0.9;
  private remainingFailures = 0;
  private held: Promise<void> | null = null;

  /**
   * Sets the answers of the next requests. `confidence`: mass given to the
   * chosen option of Choice and Score questions (0.9 by default).
   */
  script(script: Script, options: { confidence?: number } = {}): void {
    this.current = script;
    this.confidence = options.confidence ?? 0.9;
  }

  /** The next `times` requests fail with a `JudgeTransientError`. */
  fail(times = 1): void {
    this.remainingFailures = times;
  }

  /** Blocks requests until the returned function is called (to observe the Received state). */
  hold(): () => void {
    let release!: () => void;
    this.held = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      this.held = null;
      release();
    };
  }

  async judge<Qs extends Questions>(
    request: JudgeRequest<Qs>,
    { signal }: JudgeOptions = {},
  ): Promise<Answers<Qs>> {
    this.requests.push(request);
    if (this.held) await this.wait(this.held, request, signal);
    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw new JudgeTransientError('FakeJudge: scripted failure');
    }
    const answers = Object.fromEntries(
      Object.entries(request.questions).map(([key, question]) => [
        key,
        this.answer(question, this.current[key]),
      ]),
    );
    return answers as Answers<Qs>;
  }

  /** Held until released, or rejected as soon as the caller cancels. */
  private wait(held: Promise<void>, request: JudgeRequest, signal?: AbortSignal): Promise<void> {
    if (!signal) return held;
    return new Promise<void>((resolve, reject) => {
      const cancel = () => {
        this.cancelled.push(request);
        reject(new JudgeTransientError('FakeJudge: request cancelled'));
      };
      if (signal.aborted) return cancel();
      signal.addEventListener('abort', cancel, { once: true });
      void held.then(() => {
        signal.removeEventListener('abort', cancel);
        resolve();
      });
    });
  }

  private answer(question: Question, scripted: string | number | undefined): Answer<Question> {
    if (question.kind === 'noul') {
      return { kind: 'noul', probability: typeof scripted === 'number' ? scripted : 0 };
    }
    const options: readonly string[] =
      question.kind === 'choice' ? question.choices : question.levels;
    const chosen = typeof scripted === 'string' ? scripted : options[0]!;
    if (!options.includes(chosen)) {
      throw new Error(`FakeJudge: "${chosen}" is not an option of "${question.question}"`);
    }
    const rest = options.length > 1 ? (1 - this.confidence) / (options.length - 1) : 0;
    const distribution = Object.fromEntries(
      options.map((option) => [option, option === chosen ? this.confidence : rest]),
    );
    if (question.kind === 'choice') {
      return { kind: 'choice', choice: chosen, distribution, confidence: this.confidence };
    }
    const rank = options.indexOf(chosen);
    return {
      kind: 'score',
      level: chosen,
      value: options.length > 1 ? rank / (options.length - 1) : 0,
      distribution,
      confidence: this.confidence,
    };
  }
}
