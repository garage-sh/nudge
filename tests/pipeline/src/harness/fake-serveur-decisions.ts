import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Script } from './fake-juge.js';

interface QuestionRecue {
  readonly type: 'noul' | 'choice' | 'score';
  readonly criteria?: Record<string, unknown> | unknown[];
}

export interface RequeteRecue {
  readonly methode: string;
  readonly chemin: string;
  readonly entetes: IncomingHttpHeaders;
  readonly corps: {
    readonly model: string;
    readonly state: Record<string, unknown>;
    readonly questions: Record<string, QuestionRecue>;
  };
}

/**
 * Un fournisseur System One factice, sur HTTP (port libre de 127.0.0.1) : il
 * répond au format commun de TypeSafe et des API Decisions, à toute URL, d'après
 * un `Script` (comme le `FakeJuge`) : Choice et Score rendent l'option / le niveau
 * scripté, Noul la probabilité scriptée. Il garde les requêtes reçues.
 */
export class FakeServeurDecisions {
  readonly requetes: RequeteRecue[] = [];
  private script: Script = {};

  private readonly serveur: Server = createServer((requete, reponse) => {
    let texte = '';
    requete.setEncoding('utf8');
    requete.on('data', (morceau: string) => (texte += morceau));
    requete.on('end', () => {
      const corps = JSON.parse(texte) as RequeteRecue['corps'];
      this.requetes.push({
        methode: requete.method ?? '',
        chemin: requete.url ?? '',
        entetes: requete.headers,
        corps,
      });
      reponse.writeHead(200, { 'content-type': 'application/json' });
      reponse.end(JSON.stringify(this.repondre(corps)));
    });
  });

  private constructor(private port = 0) {}

  /** URL de base du serveur (sans chemin). */
  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  static async demarrer(): Promise<FakeServeurDecisions> {
    const instance = new FakeServeurDecisions();
    await new Promise<void>((resolve) => instance.serveur.listen(0, '127.0.0.1', resolve));
    instance.port = (instance.serveur.address() as AddressInfo).port;
    return instance;
  }

  repondreAvec(script: Script): void {
    this.script = script;
  }

  arreter(): Promise<void> {
    return new Promise((resolve, reject) =>
      this.serveur.close((erreur) => (erreur ? reject(erreur) : resolve())),
    );
  }

  private repondre(corps: RequeteRecue['corps']) {
    const answers = Object.fromEntries(
      Object.entries(corps.questions).map(([id, question]) => [
        id,
        this.reponse(question, this.script[id]),
      ]),
    );
    return { model: corps.model, answers, usage: { input_tokens: 100, output_tokens: 4 } };
  }

  private reponse(question: QuestionRecue, scripte: string | number | undefined) {
    if (question.type === 'noul') return { type: 'noul', noul: Number(scripte ?? 0) };
    if (question.type === 'choice') {
      const options = Object.keys(question.criteria ?? {});
      const choix = typeof scripte === 'string' ? scripte : options[0]!;
      const probabilities = Object.fromEntries(
        options.map((o) => [o, o === choix ? 0.97 : 0.03 / (options.length - 1)]),
      );
      return { type: 'choice', choice: choix, confidence: 0.95, probabilities };
    }
    // Score : le Script nomme le niveau par son rang dans `criteria` (« 0 », « 1 »…).
    const niveaux = (question.criteria as unknown[]).length;
    const rang = typeof scripte === 'number' ? scripte : 0;
    const probabilities = Object.fromEntries(
      Array.from({ length: niveaux }, (_, i) => [
        String(i),
        i === rang ? 0.97 : 0.03 / (niveaux - 1),
      ]),
    );
    return { type: 'score', score: rang, confidence: 0.95, legend: {}, probabilities };
  }
}
