import { createHmac } from 'node:crypto';
import type { DestinationConfiguree, EnvoiASortir } from '@nudge/core';
import { describe, expect, it } from 'vitest';
import { resolveDestinationAdapter } from './index.js';
import { adaptateurWebhook } from './webhook.js';

const SECRET = 'secret-de-signature-de-test';
const MAINTENANT = new Date('2026-10-24T09:30:00.000Z');
const HORODATAGE = '1792834200';

const DESTINATION: DestinationConfiguree = {
  id: '6f1c2a40-0000-4000-8000-000000000001',
  projetId: '6f1c2a40-0000-4000-8000-000000000002',
  nom: 'Récepteur',
  type: 'webhook',
  config: { url: 'https://recepteur.test/nudge?canal=bugs' },
  secrets: { secretSignature: SECRET },
};

const ENVOI: EnvoiASortir = {
  envoiId: '6f1c2a40-0000-4000-8000-000000000003',
  essai: false,
  projet: { id: DESTINATION.projetId, nom: 'Boutique' },
  retour: {
    id: '6f1c2a40-0000-4000-8000-000000000004',
    texte: '@everyone <script>alert(1)</script> [clic](javascript:alert(1)) **gras**',
    source: 'api',
    typeRetenu: 'bug',
    gravite: 'majeure',
    incertain: true,
    auteur: { id: 'u-42', email: 'ada@client.test', confiance: 'attestee' },
    contexte: { url: 'https://boutique.test/panier', metadonnees: { version: '2.3.1' } },
    recuLe: new Date('2026-10-24T09:29:58.000Z'),
    lienDashboard: 'https://nudge.exemple/retours/6f1c2a40-0000-4000-8000-000000000004',
  },
};

interface RequeteRecue {
  readonly url: string;
  readonly init: RequestInit;
  readonly entetes: Headers;
  readonly corps: string;
}

/** Un récepteur enregistré : il rend les réponses données, dans l'ordre, et garde les requêtes. */
function recepteur(...reponses: ({ status: number; corps?: string } | Error | 'bloque')[]) {
  const requetes: RequeteRecue[] = [];
  let suivante = 0;
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    requetes.push({
      url: String(url),
      init,
      entetes: new Headers(init.headers),
      corps: String(init.body),
    });
    const reponse = reponses[Math.min(suivante++, reponses.length - 1)] ?? { status: 204 };
    if (reponse instanceof Error) throw reponse;
    if (reponse === 'bloque') {
      // Ne répond jamais : seul le délai de l'adaptateur (signal) l'interrompt.
      return new Promise<Response>((_, reject) =>
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
      );
    }
    // Un 204 ou un 3xx n'a pas de corps.
    const sansCorps = reponse.status === 204 || (reponse.status >= 300 && reponse.status < 400);
    return new Response(sansCorps ? null : (reponse.corps ?? null), { status: reponse.status });
  }) as typeof globalThis.fetch;
  return { fetch, requetes };
}

const webhook = (fetch: typeof globalThis.fetch, delaiMs?: number) =>
  adaptateurWebhook(DESTINATION, { fetch, maintenant: () => MAINTENANT, delaiMs });

const signatureAttendue = (horodatage: string, corps: string) =>
  `sha256=${createHmac('sha256', SECRET).update(`${horodatage}.${corps}`).digest('hex')}`;

describe('Adaptateur webhook', () => {
  it('POSTe le Retour en JSON à l’URL configurée, texte brut et non réécrit', async () => {
    const { fetch, requetes } = recepteur({ status: 200 });

    expect(await webhook(fetch).send(ENVOI)).toEqual({ statut: 'livre', lienExterne: null });

    const [requete] = requetes;
    expect(requete?.url).toBe('https://recepteur.test/nudge?canal=bugs');
    expect(requete?.init.method).toBe('POST');
    expect(requete?.entetes.get('content-type')).toBe('application/json');
    expect(requete?.entetes.get('x-nudge-evenement')).toBe('retour');
    expect(requete?.entetes.get('x-nudge-envoi')).toBe(ENVOI.envoiId);
    expect(JSON.parse(requete!.corps)).toEqual({
      evenement: 'retour',
      essai: false,
      envoi: { id: ENVOI.envoiId },
      projet: { id: DESTINATION.projetId, nom: 'Boutique' },
      retour: {
        id: ENVOI.retour.id,
        texte: '@everyone <script>alert(1)</script> [clic](javascript:alert(1)) **gras**',
        source: 'api',
        type: 'bug',
        gravite: 'majeure',
        incertain: true,
        auteur: { id: 'u-42', email: 'ada@client.test', nom: null, confiance: 'attestee' },
        contexte: { url: 'https://boutique.test/panier', metadonnees: { version: '2.3.1' } },
        recuLe: '2026-10-24T09:29:58.000Z',
        lien: 'https://nudge.exemple/retours/6f1c2a40-0000-4000-8000-000000000004',
      },
    });
  });

  it('signe le corps brut et l’horodatage en HMAC-SHA256 avec le secret de la Destination', async () => {
    const { fetch, requetes } = recepteur({ status: 204 });

    await webhook(fetch).send(ENVOI);

    const [requete] = requetes;
    expect(requete?.entetes.get('x-nudge-timestamp')).toBe(HORODATAGE);
    expect(requete?.entetes.get('x-nudge-signature')).toBe(
      signatureAttendue(HORODATAGE, requete!.corps),
    );
    // Un autre secret ne produit pas la même signature.
    const autre = createHmac('sha256', 'autre').update(`${HORODATAGE}.${requete!.corps}`);
    expect(requete?.entetes.get('x-nudge-signature')).not.toBe(`sha256=${autre.digest('hex')}`);
  });

  it('marque le Retour d’exemple du bouton « tester »', async () => {
    const { fetch, requetes } = recepteur({ status: 200 });

    await webhook(fetch).send({ ...ENVOI, essai: true });

    expect(JSON.parse(requetes[0]!.corps)).toMatchObject({ evenement: 'retour', essai: true });
  });

  it('ne suit pas les redirections : un 3xx est un échec permanent', async () => {
    const { fetch, requetes } = recepteur({ status: 301 });

    expect(await webhook(fetch).send(ENVOI)).toMatchObject({
      statut: 'echec',
      classe: 'permanent',
    });
    expect(requetes[0]?.init.redirect).toBe('manual');
  });

  it.each([
    [200, 'livre'],
    [202, 'livre'],
    [204, 'livre'],
    [408, 'transient'],
    [425, 'transient'],
    [429, 'transient'],
    [500, 'transient'],
    [502, 'transient'],
    [503, 'transient'],
    [401, 'auth'],
    [403, 'auth'],
    [400, 'permanent'],
    [404, 'permanent'],
    [410, 'permanent'],
    [413, 'permanent'],
    [422, 'permanent'],
  ])('classe une réponse %i : %s', async (status, attendu) => {
    const { fetch } = recepteur({ status, corps: 'détail du récepteur' });

    const resultat = await webhook(fetch).send(ENVOI);

    if (attendu === 'livre') {
      expect(resultat).toEqual({ statut: 'livre', lienExterne: null });
    } else {
      expect(resultat).toEqual({
        statut: 'echec',
        classe: attendu,
        message: expect.stringContaining(String(status)),
      });
    }
  });

  it('reprend le début de la réponse du récepteur dans le message d’échec, borné', async () => {
    const { fetch } = recepteur({ status: 422, corps: `champ manquant ${'x'.repeat(1000)}` });

    const resultat = await webhook(fetch).send(ENVOI);

    expect(resultat).toMatchObject({ message: expect.stringContaining('champ manquant') });
    expect(resultat.statut === 'echec' && resultat.message.length).toBeLessThan(400);
  });

  it('une erreur réseau est transitoire', async () => {
    const { fetch } = recepteur(new TypeError('fetch failed'));

    expect(await webhook(fetch).send(ENVOI)).toMatchObject({
      statut: 'echec',
      classe: 'transient',
      message: expect.stringContaining('fetch failed'),
    });
  });

  it('un récepteur qui ne répond pas dans le délai est transitoire', async () => {
    const { fetch } = recepteur('bloque');

    expect(await webhook(fetch, 50).send(ENVOI)).toMatchObject({
      statut: 'echec',
      classe: 'transient',
    });
  });

  describe('healthCheck', () => {
    it('envoie un ping signé ; une réponse 2xx rend la Destination joignable', async () => {
      const { fetch, requetes } = recepteur({ status: 200 });

      expect(await webhook(fetch).healthCheck()).toEqual({ joignable: true });

      const [requete] = requetes;
      expect(requete?.init.method).toBe('POST');
      expect(requete?.entetes.get('x-nudge-evenement')).toBe('ping');
      expect(JSON.parse(requete!.corps)).toEqual({ evenement: 'ping' });
      expect(requete?.entetes.get('x-nudge-signature')).toBe(
        signatureAttendue(HORODATAGE, requete!.corps),
      );
    });

    it.each([
      [503, 'transient'],
      [401, 'auth'],
      [404, 'permanent'],
    ])('une réponse %i rend la Destination injoignable (%s)', async (status, classe) => {
      const { fetch } = recepteur({ status });

      expect(await webhook(fetch).healthCheck()).toMatchObject({ joignable: false, classe });
    });
  });

  it('est enregistré pour le type « webhook » dans le registre des adaptateurs', async () => {
    const adaptateur = resolveDestinationAdapter(DESTINATION);

    expect(typeof adaptateur.send).toBe('function');
    expect(typeof adaptateur.healthCheck).toBe('function');
  });
});
