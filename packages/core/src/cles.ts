import { createHash, randomBytes } from 'node:crypto';

/** Clés d'un Projet : la publique pour le Widget, la secrète pour l'API serveur. */
export interface ProjetKeys {
  readonly clePublique: string;
  readonly cleSecrete: string;
}

export const generateClePublique = (): string => `nk_pub_${randomBytes(18).toString('base64url')}`;

export const generateCleSecrete = (): string => `nk_sec_${randomBytes(32).toString('base64url')}`;

export function generateProjetKeys(): ProjetKeys {
  return { clePublique: generateClePublique(), cleSecrete: generateCleSecrete() };
}

/** La clé secrète n'est jamais stockée en clair : on stocke et on cherche son empreinte. */
export function hashCleSecrete(cleSecrete: string): string {
  return createHash('sha256').update(cleSecrete).digest('hex');
}
