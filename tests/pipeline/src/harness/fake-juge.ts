import type {
  Answer,
  Answers,
  Juge,
  OptionsJugement,
  Question,
  Questions,
  RequeteJuge,
} from '@nudge/judge';
import { ErreurJugeTransitoire } from '@nudge/judge';

/**
 * Verdict scripté, question par question (clé = clé de la question) :
 * - Choice : l'option retenue ; Score : le niveau retenu ;
 * - Noul : la probabilité de « oui ».
 * Une question non scriptée reçoit la première option / le premier niveau / 0.
 */
export type Script = Readonly<Record<string, string | number>>;

/**
 * Juge de test branché sur le port : il rend des réponses scriptées, enregistre
 * chaque requête reçue, peut échouer (erreur transitoire) ou être retenu.
 */
export class FakeJuge implements Juge {
  /** Toutes les requêtes reçues, dans l'ordre. */
  readonly requests: RequeteJuge[] = [];
  /** Les requêtes que l'appelant a annulées (signal) pendant qu'elles étaient retenues. */
  readonly cancelled: RequeteJuge[] = [];
  private current: Script = {};
  private confidence = 0.9;
  private remainingFailures = 0;
  private held: Promise<void> | null = null;

  /**
   * Fixe les réponses des requêtes suivantes. `confidence` : masse donnée à
   * l'option retenue des Choice et Score (0.9 par défaut).
   */
  script(script: Script, options: { confidence?: number } = {}): void {
    this.current = script;
    this.confidence = options.confidence ?? 0.9;
  }

  /** Les `times` prochaines requêtes échouent avec une `ErreurJugeTransitoire`. */
  fail(times = 1): void {
    this.remainingFailures = times;
  }

  /** Bloque les requêtes jusqu'à l'appel de la fonction rendue (pour observer l'état Reçu). */
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

  async juger<Qs extends Questions>(
    requete: RequeteJuge<Qs>,
    { signal }: OptionsJugement = {},
  ): Promise<Answers<Qs>> {
    this.requests.push(requete);
    if (this.held) await this.attendre(this.held, requete, signal);
    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw new ErreurJugeTransitoire('FakeJuge : échec scripté');
    }
    const answers = Object.fromEntries(
      Object.entries(requete.questions).map(([key, question]) => [
        key,
        this.answer(question, this.current[key]),
      ]),
    );
    return answers as Answers<Qs>;
  }

  /** Retenue jusqu'à la libération, ou rejetée dès que l'appelant annule. */
  private attendre(held: Promise<void>, requete: RequeteJuge, signal?: AbortSignal): Promise<void> {
    if (!signal) return held;
    return new Promise<void>((resolve, reject) => {
      const annuler = () => {
        this.cancelled.push(requete);
        reject(new ErreurJugeTransitoire('FakeJuge : requête annulée'));
      };
      if (signal.aborted) return annuler();
      signal.addEventListener('abort', annuler, { once: true });
      void held.then(() => {
        signal.removeEventListener('abort', annuler);
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
      throw new Error(`FakeJuge : « ${chosen} » n'est pas une option de « ${question.question} »`);
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
