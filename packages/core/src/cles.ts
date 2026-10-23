import { createHash, randomBytes } from 'node:crypto';

/** Clés d'un Projet : la publique pour le Widget, la secrète pour l'API serveur. */
export interface ClesProjet {
  readonly clePublique: string;
  readonly cleSecrete: string;
}

export function genererClesProjet(): ClesProjet {
  return {
    clePublique: `nk_pub_${randomBytes(18).toString('base64url')}`,
    cleSecrete: `nk_sec_${randomBytes(32).toString('base64url')}`,
  };
}

/** La clé secrète n'est jamais stockée en clair : on stocke et on cherche son empreinte. */
export function empreinteCleSecrete(cleSecrete: string): string {
  return createHash('sha256').update(cleSecrete).digest('hex');
}
