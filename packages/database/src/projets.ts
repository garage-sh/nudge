import { empreinteCleSecrete, genererClesProjet, type DestinationConfiguree } from '@nudge/core';
import type { Db } from './client.js';
import { destinations, projets } from './schema.js';

export type Projet = typeof projets.$inferSelect;

/** Crée un Projet et rend ses clés ; la clé secrète n'est lisible qu'ici. */
export async function creerProjet(
  db: Db,
  donnees: { nom: string; description?: string | null },
): Promise<{ projet: Projet; clePublique: string; cleSecrete: string }> {
  const { clePublique, cleSecrete } = genererClesProjet();
  const [projet] = await db
    .insert(projets)
    .values({
      nom: donnees.nom,
      description: donnees.description ?? null,
      clePublique,
      empreinteCleSecrete: empreinteCleSecrete(cleSecrete),
    })
    .returning();
  if (!projet) throw new Error('Projet non créé');
  return { projet, clePublique, cleSecrete };
}

export async function creerDestination(
  db: Db,
  donnees: { projetId: string; nom: string; type: string; config?: Record<string, unknown> },
): Promise<DestinationConfiguree> {
  const [destination] = await db
    .insert(destinations)
    .values({ ...donnees, config: donnees.config ?? {} })
    .returning();
  if (!destination) throw new Error('Destination non créée');
  return {
    id: destination.id,
    projetId: destination.projetId,
    nom: destination.nom,
    type: destination.type,
    config: destination.config,
  };
}
