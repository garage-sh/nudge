/** Réponse de l'API du dashboard : statut et corps JSON (ou `null` sans corps). */
export interface ReponseDashboard<T> {
  readonly status: number;
  readonly body: T;
}

const COOKIE_SESSION = 'nudge_session';

/**
 * Client HTTP de l'API du dashboard, tel que le navigateur d'un Membre :
 * il garde le cookie de session posé par l'api et le renvoie à chaque appel.
 */
export class DashboardClient {
  private session: string | null = null;

  constructor(private readonly baseUrl: string) {}

  /** Le cookie de session courant (pour vérifier qu'il est révoqué). */
  get sessionCookie(): string | null {
    return this.session;
  }

  /** Rejoue un cookie de session tel quel (session volée, session révoquée…). */
  withSessionCookie(valeur: string | null): this {
    this.session = valeur;
    return this;
  }

  get<T = unknown>(path: string) {
    return this.request<T>('GET', path);
  }

  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body);
  }

  put<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, body);
  }

  patch<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body);
  }

  delete<T = unknown>(path: string) {
    return this.request<T>('DELETE', path);
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<ReponseDashboard<T>> {
    // Le dashboard signe chacune de ses requêtes : l'api refuse une écriture sans cet en-tête.
    const headers: Record<string, string> = { 'x-nudge-client': 'dashboard' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.session) headers.cookie = `${COOKIE_SESSION}=${this.session}`;
    const reponse = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.retainSession(reponse.headers.getSetCookie());
    const texte = await reponse.text();
    return { status: reponse.status, body: (texte ? JSON.parse(texte) : null) as T };
  }

  private retainSession(setCookies: string[]): void {
    for (const ligne of setCookies) {
      const [paire = ''] = ligne.split(';');
      const separateur = paire.indexOf('=');
      if (paire.slice(0, separateur).trim() !== COOKIE_SESSION) continue;
      const valeur = decodeURIComponent(paire.slice(separateur + 1).trim());
      const expire = /max-age=0\b/i.test(ligne) || /expires=Thu, 01 Jan 1970/i.test(ligne);
      this.session = valeur && !expire ? valeur : null;
    }
  }
}
