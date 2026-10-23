import { hashCleSecrete, generateProjetKeys, type DestinationConfiguree } from '@nudge/core';
import type { Db } from './client.js';
import { destinations, projets } from './schema.js';

export type Projet = typeof projets.$inferSelect;
export type DestinationRow = typeof destinations.$inferSelect;

/** Une Destination lue en base, telle que la reçoit un `DestinationAdapterResolver`. */
export function toDestinationConfiguree(destination: DestinationRow): DestinationConfiguree {
  return {
    id: destination.id,
    projetId: destination.projetId,
    nom: destination.nom,
    type: destination.type,
    config: destination.config,
  };
}

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

export async function createDestination(
  db: Db,
  donnees: { projetId: string; nom: string; type: string; config?: Record<string, unknown> },
): Promise<DestinationConfiguree> {
  const [destination] = await db
    .insert(destinations)
    .values({ ...donnees, config: donnees.config ?? {} })
    .returning();
  if (!destination) throw new Error('Destination non créée');
  return toDestinationConfiguree(destination);
}
