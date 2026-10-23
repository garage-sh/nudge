import type { Juge, Question, Questions, Reponse, Reponses, RequeteJuge } from '@nudge/judge';
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
  readonly requetes: RequeteJuge[] = [];
  private script: Script = {};
  private confiance = 0.9;
  private echecsRestants = 0;
  private retenue: Promise<void> | null = null;

  /** Fixe les réponses des prochaines requêtes. `confiance` : masse du choix retenu (0.9 par défaut). */
  scripter(script: Script, options: { confiance?: number } = {}): void {
    this.script = script;
    this.confiance = options.confiance ?? 0.9;
  }

  /** Les `fois` prochaines requêtes échouent avec une `ErreurJugeTransitoire`. */
  echouer(fois = 1): void {
    this.echecsRestants = fois;
  }

  /** Bloque les requêtes jusqu'à l'appel de la fonction rendue (observer l'état Reçu). */
  retenir(): () => void {
    let liberer!: () => void;
    this.retenue = new Promise<void>((resolve) => {
      liberer = resolve;
    });
    return () => {
      this.retenue = null;
      liberer();
    };
  }

  async juger<Qs extends Questions>(requete: RequeteJuge<Qs>): Promise<Reponses<Qs>> {
    this.requetes.push(requete);
    if (this.retenue) await this.retenue;
    if (this.echecsRestants > 0) {
      this.echecsRestants -= 1;
      throw new ErreurJugeTransitoire('FakeJuge : échec scripté');
    }
    const reponses = Object.fromEntries(
      Object.entries(requete.questions).map(([cle, question]) => [
        cle,
        this.repondre(question, this.script[cle]),
      ]),
    );
    return reponses as Reponses<Qs>;
  }

  private repondre(question: Question, valeur: string | number | undefined): Reponse<Question> {
    if (question.kind === 'noul') {
      return { kind: 'noul', probabilite: typeof valeur === 'number' ? valeur : 0 };
    }
    const options: readonly string[] =
      question.kind === 'choice' ? question.choix : question.niveaux;
    const retenue = typeof valeur === 'string' ? valeur : options[0]!;
    if (!options.includes(retenue)) {
      throw new Error(`FakeJuge : « ${retenue} » n'est pas une option de « ${question.question} »`);
    }
    const reste = options.length > 1 ? (1 - this.confiance) / (options.length - 1) : 0;
    const distribution = Object.fromEntries(
      options.map((option) => [option, option === retenue ? this.confiance : reste]),
    );
    if (question.kind === 'choice') {
      return { kind: 'choice', choix: retenue, distribution, confiance: this.confiance };
    }
    const rang = options.indexOf(retenue);
    return {
      kind: 'score',
      niveau: retenue,
      valeur: options.length > 1 ? rang / (options.length - 1) : 0,
      distribution,
      confiance: this.confiance,
    };
  }
}
