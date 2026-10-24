import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { destinations, projets, retours, type Db } from '@nudge/database';
import type { AlertesVu } from '@nudge/shared';
import { asc, count, eq } from 'drizzle-orm';
import { DB } from '../../infra/tokens.js';
import { SessionGuard } from '../auth/session.guard.js';

/**
 * Badges du dashboard : ce qui attend un Membre (Retours En revue, Destinations
 * Suspendues), lu en base à chaque appel. Les alertes envoyées à la Destination
 * d'alerte partent du worker.
 */
@Controller('api/alertes')
@UseGuards(SessionGuard)
export class AlertesController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async lire(): Promise<AlertesVu> {
    const [[enRevue], suspendues] = await Promise.all([
      this.db.select({ nombre: count() }).from(retours).where(eq(retours.etat, 'en_revue')),
      this.db
        .select({
          id: destinations.id,
          nom: destinations.nom,
          projet: { id: projets.id, nom: projets.nom },
        })
        .from(destinations)
        .innerJoin(projets, eq(projets.id, destinations.projetId))
        .where(eq(destinations.etat, 'suspendue'))
        .orderBy(asc(destinations.suspendueLe), asc(destinations.id)),
    ]);
    return { retoursEnRevue: enRevue?.nombre ?? 0, destinationsSuspendues: suspendues };
  }
}
