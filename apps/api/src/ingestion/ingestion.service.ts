import { Inject, Injectable } from '@nestjs/common';
import type { JobTriage } from '@nudge/core';
import { retours, type Db } from '@nudge/database';
import type { RetourValide, Source } from '@nudge/shared';
import type { Queue } from 'bullmq';
import { DB, QUEUE_TRIAGE } from '../infra/jetons.js';

/** Cas d'usage commun aux deux voies d'ingestion (clé publique, clé secrète). */
@Injectable()
export class IngestionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE_TRIAGE) private readonly queueTriage: Queue<JobTriage>,
  ) {}

  async recevoir(
    projetId: string,
    source: Source,
    retour: RetourValide,
  ): Promise<{ id: string; etat: 'recu' }> {
    const [enregistre] = await this.db
      .insert(retours)
      .values({
        projetId,
        source,
        texte: retour.texte,
        typeDeclare: retour.type ?? null,
        auteur: retour.auteur ?? null,
        // Seule la clé secrète atteste l'identité ; le navigateur ne fait que la déclarer.
        confianceAuteur: retour.auteur ? (source === 'api' ? 'attestee' : 'declaree') : null,
        contexte: retour.contexte ?? {},
      })
      .returning({ id: retours.id });
    if (!enregistre) throw new Error('Retour non enregistré');
    await this.queueTriage.add('triage', { retourId: enregistre.id }, { jobId: enregistre.id });
    return { id: enregistre.id, etat: 'recu' };
  }
}
