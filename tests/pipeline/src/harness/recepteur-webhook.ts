import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RequeteWebhook {
  readonly methode: string;
  readonly chemin: string;
  readonly entetes: IncomingHttpHeaders;
  /** Corps brut, tel que signé. */
  readonly corps: string;
}

/**
 * Un récepteur de webhooks sur HTTP (port libre de 127.0.0.1) : il garde chaque
 * requête reçue et répond 204, ou la réponse fixée pour un chemin.
 */
export class RecepteurWebhook {
  readonly requetes: RequeteWebhook[] = [];
  private readonly reponses = new Map<string, { status: number; corps: string }>();

  private readonly serveur: Server = createServer((requete, reponse) => {
    let corps = '';
    requete.setEncoding('utf8');
    requete.on('data', (morceau: string) => (corps += morceau));
    requete.on('end', () => {
      const chemin = requete.url ?? '';
      this.requetes.push({
        methode: requete.method ?? '',
        chemin,
        entetes: requete.headers,
        corps,
      });
      const fixee = this.reponses.get(chemin);
      reponse.writeHead(fixee?.status ?? 204);
      reponse.end(fixee?.corps);
    });
  });

  private constructor(private port = 0) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  static async demarrer(): Promise<RecepteurWebhook> {
    const instance = new RecepteurWebhook();
    await new Promise<void>((resolve) => instance.serveur.listen(0, '127.0.0.1', resolve));
    instance.port = (instance.serveur.address() as AddressInfo).port;
    return instance;
  }

  /** Les requêtes suivantes sur ce chemin reçoivent cette réponse. */
  repondre(chemin: string, status: number, corps = ''): void {
    this.reponses.set(chemin, { status, corps });
  }

  arreter(): Promise<void> {
    return new Promise((resolve, reject) =>
      this.serveur.close((erreur) => (erreur ? reject(erreur) : resolve())),
    );
  }
}
