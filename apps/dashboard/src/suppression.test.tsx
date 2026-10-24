import type { PageRetours, RetourDetailVu } from '@nudge/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CONNECTE, fakeApi } from './test/fake-api.js';
import { renderDashboard } from './test/render.js';

const RETOUR: RetourDetailVu = {
  id: 'retour-1',
  projet: { id: 'projet-1', nom: 'Boutique' },
  etat: 'dispatche',
  source: 'widget',
  texte: 'Effacez mes données',
  typeDeclare: null,
  auteur: null,
  contexte: {},
  capture: { contentType: 'image/png', octets: 2048 },
  verdict: null,
  envois: [],
  createdAt: '2026-10-24T09:00:00.000Z',
};

const BOITE_VIDE = { status: 200, body: { retours: [], suivant: null } satisfies PageRetours };

describe('Suppression d’un Retour', () => {
  it('supprime le Retour et sa Capture après confirmation, puis revient à la boîte de réception', async () => {
    const api = fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/retours/retour-1': { status: 200, body: RETOUR },
      'DELETE /api/retours/retour-1': { status: 204 },
      'GET /api/retours': BOITE_VIDE,
      'GET /api/projets': { status: 200, body: [] },
    });
    renderDashboard('/retours/retour-1');

    const suppression = await screen.findByRole('region', { name: 'Suppression' });
    expect(suppression.textContent).toMatch(/Capture/);
    await userEvent.click(within(suppression).getByRole('button', { name: 'Supprimer' }));
    expect(api.appels.map((a) => a.route)).not.toContain('DELETE /api/retours/retour-1');
    await userEvent.click(within(suppression).getByRole('button', { name: 'Confirmer' }));

    expect(await screen.findByRole('heading', { name: 'Boîte de réception' })).toBeTruthy();
    expect(api.appels.map((a) => a.route)).toContain('DELETE /api/retours/retour-1');
  });

  it('explique un refus et garde le Retour affiché', async () => {
    fakeApi({
      'GET /api/session': CONNECTE,
      'GET /api/retours/retour-1': { status: 200, body: RETOUR },
      'DELETE /api/retours/retour-1': { status: 503, body: { erreur: 'stockage_indisponible' } },
    });
    renderDashboard('/retours/retour-1');

    const suppression = await screen.findByRole('region', { name: 'Suppression' });
    await userEvent.click(within(suppression).getByRole('button', { name: 'Supprimer' }));
    await userEvent.click(within(suppression).getByRole('button', { name: 'Confirmer' }));

    expect((await within(suppression).findByRole('alert')).textContent).toMatch(
      /Capture n’a pas pu être effacée/,
    );
    expect(screen.getByLabelText('Texte du Retour').textContent).toBe('Effacez mes données');
  });
});
