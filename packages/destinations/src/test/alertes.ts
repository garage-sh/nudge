import type { AlerteDestinationSuspendue, AlerteRetourEnRevue } from '@nudge/core';

/**
 * Alertes d'exemple des tests de contrat. Les noms (saisis par un Membre) et le
 * message du refus (formulé par la cible) sont hostiles : chaque adaptateur doit les
 * encoder pour qu'ils ne mentionnent personne et ne forment ni lien ni mise en forme.
 */

export const ALERTE_EN_REVUE: AlerteRetourEnRevue = {
  evenement: 'retour_en_revue',
  id: 'en-revue-6f1c2a40-0000-4000-8000-0000000000a1',
  essai: false,
  le: new Date('2026-10-24T09:30:00.000Z'),
  projet: { id: '6f1c2a40-0000-4000-8000-0000000000a2', nom: '@everyone *Boutique*' },
  retour: { id: '6f1c2a40-0000-4000-8000-0000000000a1' },
  lienDashboard: 'https://nudge.exemple/retours/6f1c2a40-0000-4000-8000-0000000000a1',
};

export const ALERTE_SUSPENSION: AlerteDestinationSuspendue = {
  evenement: 'destination_suspendue',
  id: 'suspension-6f1c2a40-0000-4000-8000-0000000000b1-1792834200000',
  essai: false,
  le: new Date('2026-10-24T09:30:00.000Z'),
  projet: { id: '6f1c2a40-0000-4000-8000-0000000000a2', nom: 'Boutique' },
  destination: {
    id: '6f1c2a40-0000-4000-8000-0000000000b1',
    nom: 'Linear [prod](https://piege.test)',
    classe: 'auth',
    message: 'HTTP 401 : <!channel> @here `jeton` refusé',
  },
  lienDashboard: null,
};
