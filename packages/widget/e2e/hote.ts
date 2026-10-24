import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { test as base, type Page, type Route } from '@playwright/test';

/** L'application d'un Projet qui intègre le Widget, et l'Instance nudge qui le sert. */
export const ORIGINE_HOTE = 'https://app.exemple';
export const CDN = 'https://cdn.exemple';
export const API = 'https://nudge.exemple';
export const CLE = 'nk_pub_test';

const DIST = join(import.meta.dirname, '..', 'dist');

/** Ce que l'API factice a reçu sur `POST /v1/retours`. */
export interface RequeteRecue {
  readonly autorisation: string | null;
  readonly origine: string | null;
  readonly corps: unknown;
}

type Reponse = (route: Route) => Promise<void>;

const CORS = (origine: string | undefined) => ({
  'access-control-allow-origin': origine ?? '*',
  vary: 'Origin',
});

/**
 * API publique factice de l'Instance : elle enregistre les Retours postés et répond
 * 202 par défaut, ou ce qu'on lui a demandé (statut, coupure réseau), une fois chacun.
 */
export class ApiFactice {
  readonly requetes: RequeteRecue[] = [];
  private readonly prochaines: Reponse[] = [];

  /** La prochaine requête reçoit ce statut, ce corps et ces en-têtes. */
  repondre(status: number, corps: unknown, enTetes: Record<string, string> = {}): void {
    this.prochaines.push((route) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { ...CORS(route.request().headers().origin), ...enTetes },
        body: JSON.stringify(corps),
      }),
    );
  }

  /** La prochaine requête n'atteint jamais l'Instance (réseau coupé). */
  couperLeReseau(): void {
    this.prochaines.push((route) => route.abort('internetdisconnected'));
  }

  async servir(route: Route): Promise<void> {
    const requete = route.request();
    const enTetes = requete.headers();
    if (requete.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          ...CORS(enTetes.origin),
          'access-control-allow-methods': 'POST',
          'access-control-allow-headers': 'Authorization, Content-Type',
        },
      });
      return;
    }
    this.requetes.push({
      autorisation: enTetes.authorization ?? null,
      origine: enTetes.origin ?? null,
      corps: requete.postDataJSON(),
    });
    const reponse = this.prochaines.shift();
    if (reponse) return reponse(route);
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      headers: CORS(enTetes.origin),
      body: JSON.stringify({ id: crypto.randomUUID(), etat: 'recu' }),
    });
  }
}

export interface PageHote {
  /** Chemin de la page sur l'origine de l'hôte. */
  readonly chemin?: string;
  /** Contenu de `<head>` (styles de l'application…). */
  readonly head?: string;
  /** Contenu de `<body>`, avant l'intégration du Widget. */
  readonly body?: string;
  /**
   * Intégration du Widget ; par défaut, la balise script du build IIFE avec la clé
   * publique et l'adresse de l'Instance en attributs `data-`.
   */
  readonly integration?: string;
}

export const BALISE_SCRIPT = `<script src="${CDN}/nudge-widget.js" data-cle="${CLE}" data-api="${API}"></script>`;

/** L'application hôte : une page servie sur son origine, les builds du Widget sur le CDN. */
export class Hote {
  constructor(private readonly page: Page) {}

  async ouvrir(options: PageHote = {}): Promise<void> {
    const chemin = options.chemin ?? '/';
    const html = `<!doctype html>
<html lang="fr">
  <head><meta charset="utf-8"><title>Application hôte</title>${options.head ?? ''}</head>
  <body>${options.body ?? ''}${options.integration ?? BALISE_SCRIPT}</body>
</html>`;
    await this.page.route(`${ORIGINE_HOTE}/**`, (route) =>
      route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
    );
    await this.page.goto(`${ORIGINE_HOTE}${chemin}`);
  }
}

async function servirDist(route: Route): Promise<void> {
  const fichier = normalize(new URL(route.request().url()).pathname).replace(/^\/+/, '');
  try {
    const contenu = await readFile(join(DIST, fichier));
    await route.fulfill({
      contentType: 'text/javascript; charset=utf-8',
      headers: { 'access-control-allow-origin': '*' },
      body: contenu,
    });
  } catch {
    await route.fulfill({ status: 404, body: 'introuvable' });
  }
}

export const test = base.extend<{ api: ApiFactice; hote: Hote }>({
  api: async ({ page }, use) => {
    const api = new ApiFactice();
    await page.route(`${API}/**`, (route) => api.servir(route));
    await use(api);
  },
  hote: async ({ page, api: _api }, use) => {
    await page.route(`${CDN}/**`, servirDist);
    await use(new Hote(page));
  },
});

export { expect } from '@playwright/test';
