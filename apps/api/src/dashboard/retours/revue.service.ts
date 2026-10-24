import { Inject, Injectable } from '@nestjs/common';
import {
  idJobRevue,
  TRIAGE_JOB,
  type ActionRevue,
  type ResultatRevue,
  type TriageJob,
} from '@nudge/core';
import { annulerRevue, revoirRetour, type Db } from '@nudge/database';
import type { Queue } from 'bullmq';
import { DB, TRIAGE_QUEUE_TOKEN } from '../../infra/tokens.js';
import { isUuid } from '../../validation.js';

/**
 * Transitions de revue d'un Retour, déclenchées par un Membre : valider ou rejeter un
 * Retour En revue, réhabiliter un Retour Écarté comme Indésirable.
 */
@Injectable()
export class RevueService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TRIAGE_QUEUE_TOKEN) private readonly triageQueue: Queue<TriageJob>,
  ) {}

  /** Valider ou réhabiliter rend le Retour Trié, puis Dispatché si un Filtre le retient. */
  async revoir(retourId: string, action: ActionRevue): Promise<ResultatRevue> {
    if (!isUuid(retourId)) return { statut: 'introuvable' };
    const resultat = await revoirRetour(this.db, retourId, action);
    if (resultat.statut === 'applique' && resultat.etat === 'trie') {
      await this.dispatcher(retourId, action);
    }
    return resultat;
  }

  /**
   * Le job de triage dispatche un Retour Trié. Un Retour ne redevient Trié qu'une
   * fois : un jobId propre à la revue suffit à ne pas l'enfiler deux fois. Si la mise
   * en queue échoue, la transition est annulée pour que le Membre puisse réessayer
   * plutôt que de laisser un Retour Trié que rien ne dispatchera.
   */
  private async dispatcher(retourId: string, action: ActionRevue): Promise<void> {
    try {
      await this.triageQueue.add(TRIAGE_JOB, { retourId }, { jobId: idJobRevue(retourId) });
    } catch (erreur) {
      await annulerRevue(this.db, retourId, action);
      throw erreur;
    }
  }
}
