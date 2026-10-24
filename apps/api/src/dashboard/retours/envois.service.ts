import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DispatchJob } from '@nudge/core';
import { annulerRejeu, envois, rouvrirEnvoi, type Db } from '@nudge/database';
import type { ApiErrorBody, EnvoiVu, StatutEnvoi } from '@nudge/shared';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { DB, DISPATCH_QUEUE_TOKEN } from '../../infra/tokens.js';
import { isUuid } from '../../validation.js';
import { COLONNES_DESTINATION_ENVOI, toEnvoiVu } from './envoi-vu.js';

/** Rejeu manuel des Envois, pour rattraper un échec ou propager une correction du Verdict. */
@Injectable()
export class EnvoisService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue<DispatchJob>,
  ) {}

  /**
   * Rejoue un Envoi livré ou en échec : le même Envoi repasse en attente et part avec
   * le Verdict courant. Son job a un id propre au rejeu, l'id `<envoiId>` étant pris par
   * le job de la première tentative. Si la mise en queue échoue, la réouverture est
   * annulée pour que le Membre puisse réessayer.
   */
  async rejouer(envoiId: string): Promise<EnvoiVu> {
    if (!isUuid(envoiId)) throw envoiIntrouvable();
    const resultat = await rouvrirEnvoi(this.db, envoiId);
    if (resultat.statut === 'introuvable') throw envoiIntrouvable();
    if (resultat.statut === 'refuse') {
      throw new ConflictException({
        erreur: 'envoi_non_rejouable',
        statut: resultat.statutEnvoi,
      } satisfies ApiErrorBody & { statut: StatutEnvoi });
    }
    try {
      await this.dispatchQueue.add(
        'dispatch',
        { envoiId },
        { jobId: `${envoiId}-rejeu-${randomUUID()}` },
      );
    } catch (erreur) {
      await annulerRejeu(this.db, envoiId, resultat.avant);
      throw erreur;
    }
    return this.lire(envoiId);
  }

  private async lire(envoiId: string): Promise<EnvoiVu> {
    const envoi = await this.db.query.envois.findFirst({
      where: eq(envois.id, envoiId),
      with: { destination: { columns: COLONNES_DESTINATION_ENVOI } },
    });
    if (!envoi) throw envoiIntrouvable();
    return toEnvoiVu(envoi);
  }
}

const envoiIntrouvable = () =>
  new NotFoundException({ erreur: 'envoi_introuvable' } satisfies ApiErrorBody);
