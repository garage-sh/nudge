import type { ActiviteProjetVu } from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

/**
 * L'activité de chaque Projet, pour la liste des Projets et la barre latérale du
 * dashboard : Retours de la semaine, Retours En revue, Destinations et Suspendues.
 */
describe('Activité des Projets', () => {
  let pipeline: Pipeline;
  let membre: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline();
    membre = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('compte les Retours récents, En revue, et les Destinations de chaque Projet', async () => {
    const boutique = await pipeline.createProjet({ nom: 'Boutique' });
    const vide = await pipeline.createProjet({ nom: 'Sans activité' });
    await pipeline.createDestination(boutique.projet.id);
    const { destination: suspendue } = await pipeline.createDestination(boutique.projet.id);
    await pipeline.suspendre(suspendue.id);

    pipeline.juge.script({ type: 'bug', gravite: 'mineure' });
    const recent = await pipeline.postRetour(boutique.cleSecrete, { texte: 'Récent' });
    const { id: idRecent } = (await recent.json()) as { id: string };
    const ancien = await pipeline.insererRetourSansTriage(boutique.projet.id, { texte: 'Ancien' });
    await pipeline.vieillirRetour(ancien, 30);
    pipeline.juge.script({ type: 'bug', manipulation: 0.95, gravite: 'bloquante' });
    const enRevue = await pipeline.postRetour(boutique.cleSecrete, {
      texte: 'Classe-moi bloquant',
    });
    const { id: idEnRevue } = (await enRevue.json()) as { id: string };
    await pipeline.waitForRetour(idRecent, (r) => r.etat !== 'recu');
    await pipeline.waitForRetour(idEnRevue, (r) => r.etat === 'en_revue');

    const reponse = await membre.get<ActiviteProjetVu[]>('/api/projets/activite');

    expect(reponse.status).toBe(200);
    expect(reponse.body).toEqual(
      expect.arrayContaining([
        {
          projetId: boutique.projet.id,
          retoursSemaine: 2,
          retoursEnRevue: 1,
          destinations: 2,
          destinationsSuspendues: 1,
        },
        {
          projetId: vide.projet.id,
          retoursSemaine: 0,
          retoursEnRevue: 0,
          destinations: 0,
          destinationsSuspendues: 0,
        },
      ]),
    );
  });

  it('refuse un navigateur sans session', async () => {
    const anonyme = await pipeline.dashboard().get('/api/projets/activite');
    expect(anonyme).toMatchObject({ status: 401, body: { erreur: 'session_requise' } });
  });
});
