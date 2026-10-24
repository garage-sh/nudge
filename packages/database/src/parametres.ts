import type { Chiffreur } from '@nudge/core';
import type { ConfigJuge } from '@nudge/judge';
import type { FournisseurJuge } from '@nudge/shared';
import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { parametresInstance } from './schema.js';

/** Contexte de chiffrement de la clé du Juge : elle ne se déchiffre que pour cet usage. */
export const CONTEXTE_CLE_JUGE = 'parametres_instance.juge_cle';

const LIGNE = 1;

/** Le Juge tel qu'enregistré pour l'Instance, clé encore chiffrée. */
export interface JugeEnregistre {
  readonly fournisseur: FournisseurJuge | null;
  readonly modele: string | null;
  readonly urlBase: string | null;
  readonly cleChiffree: string | null;
}

const AUCUN_JUGE: JugeEnregistre = {
  fournisseur: null,
  modele: null,
  urlBase: null,
  cleChiffree: null,
};

export async function lireJugeInstance(db: Db): Promise<JugeEnregistre> {
  const [ligne] = await db
    .select({
      fournisseur: parametresInstance.jugeFournisseur,
      modele: parametresInstance.jugeModele,
      urlBase: parametresInstance.jugeUrlBase,
      cleChiffree: parametresInstance.jugeCleChiffree,
    })
    .from(parametresInstance)
    .where(eq(parametresInstance.id, LIGNE));
  return ligne ?? AUCUN_JUGE;
}

/** Crée la ligne des paramètres d'Instance au premier enregistrement. */
export async function enregistrerJugeInstance(db: Db, juge: JugeEnregistre): Promise<void> {
  const valeurs = {
    jugeFournisseur: juge.fournisseur,
    jugeModele: juge.modele,
    jugeUrlBase: juge.urlBase,
    jugeCleChiffree: juge.cleChiffree,
  };
  await db
    .insert(parametresInstance)
    .values({ id: LIGNE, ...valeurs })
    .onConflictDoUpdate({ target: parametresInstance.id, set: valeurs });
}

/**
 * Le Juge choisi pour l'Instance, clé déchiffrée, ou `null` si aucun n'est choisi.
 * Lève `ErreurDechiffrement` si la clé d'Instance a changé depuis l'enregistrement.
 */
export async function lireConfigJuge(db: Db, chiffreur: Chiffreur): Promise<ConfigJuge | null> {
  const juge = await lireJugeInstance(db);
  if (!juge.fournisseur) return null;
  return {
    fournisseur: juge.fournisseur,
    modele: juge.modele,
    urlBase: juge.urlBase,
    cleApi: juge.cleChiffree ? chiffreur.dechiffrer(juge.cleChiffree, CONTEXTE_CLE_JUGE) : null,
  };
}
