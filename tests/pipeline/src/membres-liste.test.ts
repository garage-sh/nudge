import type { MembreListeVu } from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type DashboardClient, type Pipeline } from './harness/index.js';

describe('Liste des Membres', () => {
  let pipeline: Pipeline;
  let premier: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline();
    premier = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  it('montre à un Membre tous les Membres de l’Instance, du plus ancien au plus récent', async () => {
    const invitation = await premier.post<{ jeton: string }>('/api/invitations');
    const acceptation = await pipeline
      .dashboard()
      .post(`/api/invitations/${invitation.body.jeton}/acceptation`, {
        email: 'bob@nudge.test',
        motDePasse: 'le mot de passe de bob',
      });
    expect(acceptation.status).toBe(201);

    const liste = await premier.get<MembreListeVu[]>('/api/membres');

    expect(liste.status).toBe(200);
    expect(liste.body).toEqual([
      { id: expect.any(String), email: 'premier@nudge.test', depuis: expect.any(String) },
      { id: expect.any(String), email: 'bob@nudge.test', depuis: expect.any(String) },
    ]);
    // Jamais d'empreinte de mot de passe.
    expect(JSON.stringify(liste.body)).not.toMatch(/argon2|empreinte/i);
  });

  it('refuse un navigateur sans session', async () => {
    expect(await pipeline.dashboard().get('/api/membres')).toMatchObject({
      status: 401,
      body: { erreur: 'session_requise' },
    });
  });
});
