import type { EnvoiVu, StatutEnvoi } from '@nudge/shared';

/** Un Envoi tel que le dashboard le lit, avec sa Destination. */
export const toEnvoiVu = (envoi: {
  id: string;
  destination: EnvoiVu['destination'];
  statut: StatutEnvoi;
  lienExterne: string | null;
  tentatives: number;
  derniereErreur: string | null;
  createdAt: Date;
  updatedAt: Date;
}): EnvoiVu => ({
  id: envoi.id,
  destination: envoi.destination,
  statut: envoi.statut,
  lienExterne: envoi.lienExterne,
  tentatives: envoi.tentatives,
  derniereErreur: envoi.derniereErreur,
  createdAt: envoi.createdAt.toISOString(),
  updatedAt: envoi.updatedAt.toISOString(),
});

/** Les colonnes de la Destination reprises dans un `EnvoiVu`. */
export const COLONNES_DESTINATION_ENVOI = { id: true, nom: true, type: true, etat: true } as const;
