import { hashCleSecrete, generateProjetKeys } from '@nudge/core';
import type { Db } from './client.js';
import { projets } from './schema.js';

export type Projet = typeof projets.$inferSelect;

/** Crée un Projet et rend ses clés ; la clé secrète n'est lisible qu'ici. */
export async function createProjet(
  db: Db,
  donnees: { nom: string; description?: string | null; originesAutorisees?: readonly string[] },
): Promise<{ projet: Projet; clePublique: string; cleSecrete: string }> {
  const { clePublique, cleSecrete } = generateProjetKeys();
  const [projet] = await db
    .insert(projets)
    .values({
      nom: donnees.nom,
      description: donnees.description ?? null,
      originesAutorisees: [...(donnees.originesAutorisees ?? [])],
      clePublique,
      empreinteCleSecrete: hashCleSecrete(cleSecrete),
    })
    .returning();
  if (!projet) throw new Error('Projet non créé');
  return { projet, clePublique, cleSecrete };
}
