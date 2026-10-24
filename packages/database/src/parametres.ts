import type { FournisseurJuge } from '@nudge/shared';
import { eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { parametresInstance } from './schema.js';

/** Contexte de chiffrement de la clé du Juge : elle ne se déchiffre que pour cet usage. */
export const JUGE_KEY_CONTEXT = 'parametres_instance.juge_cle';

const LIGNE = 1;

/** Le Juge tel qu'enregistré pour l'Instance, clé encore chiffrée. */
export interface JugeEnregistre {
  readonly fournisseur: FournisseurJuge | null;
  readonly modele: string | null;
  readonly urlBase: string | null;
  readonly cleChiffree: string | null;
}

/** Aucun Juge choisi : l'Instance se replie sur l'environnement, sinon le mode dégradé. */
export const AUCUN_JUGE: JugeEnregistre = {
  fournisseur: null,
  modele: null,
  urlBase: null,
  cleChiffree: null,
};

export async function readJugeInstance(db: Db): Promise<JugeEnregistre> {
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
export async function writeJugeInstance(db: Db, juge: JugeEnregistre): Promise<void> {
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
