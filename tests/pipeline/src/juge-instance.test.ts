import type { JugeInstanceVu } from '@nudge/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FakeServeurDecisions } from './harness/fake-serveur-decisions.js';
import { startPipeline, type Pipeline } from './harness/index.js';

const CLE_TYPESAFE = 'ts-cle-de-test-0123456789';

describe('Juge choisi pour l’Instance', () => {
  let pipeline: Pipeline;
  let fournisseur: FakeServeurDecisions;

  beforeAll(async () => {
    fournisseur = await FakeServeurDecisions.demarrer();
    pipeline = await startPipeline({ juge: 'instance' });
  });

  afterAll(async () => {
    await pipeline?.stop();
    await fournisseur?.arreter();
  });

  afterEach(async () => {
    const dashboard = await pipeline.signIn();
    await dashboard.put('/api/instance/juge', { fournisseur: null });
  });

  async function trier(texte: string) {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom: `Projet ${texte}` });
    await pipeline.createDestination(projet.id);
    const reponse = await pipeline.postRetour(cleSecrete, { texte });
    const { id } = (await reponse.json()) as { id: string };
    return pipeline.waitForRetour(id, (r) => r.etat === 'dispatche');
  }

  it('sans Juge choisi ni variables NUDGE_JUDGE_*, le Triage tourne en mode dégradé', async () => {
    const dashboard = await pipeline.signIn();
    const lu = await dashboard.get('/api/instance/juge');
    expect(lu.body).toEqual({
      fournisseur: null,
      modele: null,
      urlBase: null,
      cleConfiguree: false,
    } satisfies JugeInstanceVu);

    const retour = await trier('Sans Juge');
    expect(retour.verdict).toMatchObject({ incertain: true, gravite: null });
  });

  it('un Membre choisit TypeSafe : la clé est chiffrée en base et le Triage appelle l’API systemone', async () => {
    const dashboard = await pipeline.signIn();
    const choix = await dashboard.put('/api/instance/juge', {
      fournisseur: 'typesafe',
      cleApi: CLE_TYPESAFE,
      urlBase: fournisseur.url,
    });
    expect(choix.status).toBe(200);
    expect(choix.body).toEqual({
      fournisseur: 'typesafe',
      modele: null,
      urlBase: fournisseur.url,
      cleConfiguree: true,
    } satisfies JugeInstanceVu);

    const ligne = await pipeline.parametresInstance();
    expect(ligne?.jugeCleChiffree).toBeTruthy();
    expect(ligne?.jugeCleChiffree).not.toContain(CLE_TYPESAFE);

    fournisseur.repondreAvec({ type: 'suggestion', gravite: 2, indesirable: 0.01 });
    const texte = 'Ajoutez un mode sombre, svp';
    const retour = await trier(texte);

    expect(retour.verdict).toMatchObject({
      typeRetenu: 'suggestion',
      gravite: 'majeure',
      indesirable: false,
      incertain: false,
    });
    const appel = fournisseur.requetes.find((r) => r.corps.state.texte === texte);
    expect(appel).toMatchObject({ methode: 'POST', chemin: '/v1/systemone' });
    expect(appel?.entetes.authorization).toBe(`Bearer ${CLE_TYPESAFE}`);
    expect(appel?.corps.model).toBe('jev-latest');
  });

  it('ne rend jamais la clé ; la garde si seul le modèle change, l’oublie si le fournisseur change', async () => {
    const dashboard = await pipeline.signIn();
    await dashboard.put('/api/instance/juge', {
      fournisseur: 'openrouter',
      cleApi: 'sk-or-secret',
    });

    const modele = await dashboard.put('/api/instance/juge', {
      fournisseur: 'openrouter',
      modele: 'typesafe/jev-1.14',
    });
    expect(modele.body).toMatchObject({ modele: 'typesafe/jev-1.14', cleConfiguree: true });
    expect(JSON.stringify((await dashboard.get('/api/instance/juge')).body)).not.toContain(
      'sk-or-secret',
    );

    const autre = await dashboard.put('/api/instance/juge', { fournisseur: 'typesafe' });
    expect(autre.status).toBe(400);
    expect(autre.body).toMatchObject({
      erreur: 'requete_invalide',
      details: [{ chemin: 'cleApi' }],
    });
  });

  it('un serveur auto-hébergé de l’API Decisions sert de Juge, sans clé', async () => {
    const dashboard = await pipeline.signIn();
    const sansUrl = await dashboard.put('/api/instance/juge', { fournisseur: 'auto_heberge' });
    expect(sansUrl.status).toBe(400);

    const choix = await dashboard.put('/api/instance/juge', {
      fournisseur: 'auto_heberge',
      urlBase: fournisseur.url,
    });
    expect(choix.body).toMatchObject({ fournisseur: 'auto_heberge', cleConfiguree: false });

    fournisseur.repondreAvec({ type: 'question', gravite: 0 });
    const texte = 'Comment exporter mes données ?';
    const retour = await trier(texte);

    expect(retour.verdict).toMatchObject({ typeRetenu: 'question', gravite: 'cosmetique' });
    const appel = fournisseur.requetes.find((r) => r.corps.state.texte === texte);
    expect(appel).toMatchObject({ chemin: '/v1/decisions' });
    expect(appel?.entetes.authorization).toBeUndefined();
  });

  it('refuse le choix du Juge sans session', async () => {
    const anonyme = pipeline.dashboard();
    expect((await anonyme.get('/api/instance/juge')).status).toBe(401);
    expect((await anonyme.put('/api/instance/juge', { fournisseur: null })).status).toBe(401);
  });
});

describe('Juge par variables d’environnement', () => {
  let pipeline: Pipeline;
  let fournisseur: FakeServeurDecisions;

  beforeAll(async () => {
    fournisseur = await FakeServeurDecisions.demarrer();
    pipeline = await startPipeline({
      juge: 'instance',
      jugeParDefaut: {
        fournisseur: 'openrouter',
        cleApi: 'sk-or-env',
        modele: null,
        urlBase: fournisseur.url,
      },
    });
  });

  afterAll(async () => {
    await pipeline?.stop();
    await fournisseur?.arreter();
  });

  it('servent de repli tant que l’Instance n’a pas choisi de Juge, puis cèdent la place', async () => {
    const { projet, cleSecrete } = await pipeline.createProjet({ nom: 'Repli' });
    await pipeline.createDestination(projet.id);
    fournisseur.repondreAvec({ type: 'bug', gravite: 3 });

    const premier = await pipeline.postRetour(cleSecrete, { texte: 'Par l’environnement' });
    const { id } = (await premier.json()) as { id: string };
    await pipeline.waitForRetour(id, (r) => r.etat === 'dispatche');
    expect(fournisseur.requetes.at(-1)).toMatchObject({ chemin: '/api/alpha/decisions' });
    expect(fournisseur.requetes.at(-1)?.entetes.authorization).toBe('Bearer sk-or-env');

    const dashboard = await pipeline.signIn();
    await dashboard.put('/api/instance/juge', {
      fournisseur: 'auto_heberge',
      urlBase: fournisseur.url,
    });
    const second = await pipeline.postRetour(cleSecrete, { texte: 'Par l’Instance' });
    const { id: id2 } = (await second.json()) as { id: string };
    await pipeline.waitForRetour(id2, (r) => r.etat === 'dispatche');
    expect(fournisseur.requetes.at(-1)).toMatchObject({ chemin: '/v1/decisions' });
  });
});
