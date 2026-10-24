/**
 * Port de stockage des Captures : un magasin d'objets binaires adressés par clé.
 * L'Instance n'y range que des Captures déjà masquées dans le navigateur ; leur type
 * et leur taille sont en base, avec la clé.
 */
export interface StockageCaptures {
  /** Écrit l'objet `cle` (le remplace s'il existe). */
  enregistrer(cle: string, contenu: Uint8Array, contentType: string): Promise<void>;
  /** Le contenu de l'objet `cle`, ou `null` s'il n'existe pas. */
  lire(cle: string): Promise<Uint8Array | null>;
  /** Supprime l'objet `cle` ; sans effet s'il n'existe pas. */
  supprimer(cle: string): Promise<void>;
}

/**
 * Une clé est un chemin relatif fait de segments `[A-Za-z0-9._-]`, sans `.` ni `..`
 * seuls : elle ne peut pas sortir du dossier (disque) ni du préfixe (S3).
 */
const SEGMENT = /^[A-Za-z0-9._-]+$/;

export function verifierCle(cle: string): string {
  const segments = cle.split('/');
  const valide =
    cle.length > 0 &&
    cle.length <= 512 &&
    segments.every((segment) => SEGMENT.test(segment) && segment !== '.' && segment !== '..');
  if (!valide) throw new Error(`Stockage des Captures : clé invalide « ${cle} »`);
  return cle;
}
