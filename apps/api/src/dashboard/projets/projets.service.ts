import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { generateCleSecrete, generateClePublique, hashCleSecrete } from '@nudge/core';
import { createProjet, projets, type Db, type Projet } from '@nudge/database';
import type { ProjetAvecCleSecrete, ProjetVu } from '@nudge/shared';
import { asc, eq } from 'drizzle-orm';
import { DB } from '../../infra/tokens.js';
import { isUuid } from '../../validation.js';

/** Un Projet tel qu'un Membre le voit : jamais l'empreinte de la clé secrète. */
export const toProjetVu = (projet: Projet): ProjetVu => ({
  id: projet.id,
  nom: projet.nom,
  description: projet.description,
  clePublique: projet.clePublique,
  originesAutorisees: projet.originesAutorisees,
  createdAt: projet.createdAt.toISOString(),
});

export interface ProjetFields {
  readonly nom?: string;
  readonly description?: string | null;
  readonly originesAutorisees?: readonly string[];
}

/** Projets de l'Instance : tous les Membres les voient tous (pas de rôles en v1). */
@Injectable()
export class ProjetsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(): Promise<ProjetVu[]> {
    const lignes = await this.db.select().from(projets).orderBy(asc(projets.createdAt));
    return lignes.map(toProjetVu);
  }

  async read(id: string): Promise<ProjetVu> {
    if (!isUuid(id)) throw projetIntrouvable();
    const [projet] = await this.db.select().from(projets).where(eq(projets.id, id)).limit(1);
    if (!projet) throw projetIntrouvable();
    return toProjetVu(projet);
  }

  async create(champs: ProjetFields & { nom: string }): Promise<ProjetAvecCleSecrete> {
    const { projet, cleSecrete } = await createProjet(this.db, champs);
    return { projet: toProjetVu(projet), cleSecrete };
  }

  async update(id: string, champs: ProjetFields): Promise<ProjetVu> {
    const { originesAutorisees, ...reste } = champs;
    return this.updateColumns(id, {
      ...reste,
      ...(originesAutorisees ? { originesAutorisees: [...originesAutorisees] } : {}),
    });
  }

  /** Nouvelle clé publique : l'ancienne n'existe plus nulle part, elle est donc révoquée. */
  regenerateClePublique(id: string): Promise<ProjetVu> {
    return this.updateColumns(id, { clePublique: generateClePublique() });
  }

  /** Nouvelle clé secrète, lisible une seule fois ; l'ancienne empreinte est remplacée. */
  async regenerateCleSecrete(id: string): Promise<ProjetAvecCleSecrete> {
    const cleSecrete = generateCleSecrete();
    const projet = await this.updateColumns(id, {
      empreinteCleSecrete: hashCleSecrete(cleSecrete),
    });
    return { projet, cleSecrete };
  }

  private async updateColumns(
    id: string,
    valeurs: Partial<typeof projets.$inferInsert>,
  ): Promise<ProjetVu> {
    if (!isUuid(id)) throw projetIntrouvable();
    // Un PATCH vide touche quand même `updated_at` : drizzle refuse un SET sans colonne.
    const [projet] = await this.db
      .update(projets)
      .set({ ...valeurs, updatedAt: new Date() })
      .where(eq(projets.id, id))
      .returning();
    if (!projet) throw projetIntrouvable();
    return toProjetVu(projet);
  }
}

const projetIntrouvable = () => new NotFoundException({ erreur: 'projet_introuvable' });
