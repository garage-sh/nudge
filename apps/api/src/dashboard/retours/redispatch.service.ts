import { Inject, Injectable } from '@nestjs/common';
import type { DispatchJob } from '@nudge/core';
import {
  annulerRedispatch,
  redispatcherRetour,
  type Db,
  type ResultatRedispatch,
} from '@nudge/database';
import type { Queue } from 'bullmq';
import { DB, DISPATCH_QUEUE_TOKEN } from '../../infra/tokens.js';
import { isUuid } from '../../validation.js';

/**
 * Redispatch manuel d'un Retour Trié ou Dispatché (D22) : seul chemin, avec le rejeu
 * d'un Envoi, qui propage une correction du Verdict vers les Destinations. Il crée les
 * Envois manquants vers celles dont le Filtre retient désormais le Retour, sans
 * toucher aux Envois existants.
 */
@Injectable()
export class RedispatchService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue<DispatchJob>,
  ) {}

  /**
   * Les Envois créés en attente partent avec un job d'id `<envoiId>`, comme au Dispatch
   * après le Triage : un Envoi n'est créé qu'une fois, son premier job aussi. Si la mise
   * en queue échoue, le redispatch est annulé pour que le Membre puisse réessayer.
   */
  async redispatcher(retourId: string): Promise<ResultatRedispatch> {
    if (!isUuid(retourId)) return { statut: 'introuvable' };
    const resultat = await redispatcherRetour(this.db, retourId);
    if (resultat.statut !== 'applique') return resultat;
    const enAttente = resultat.envois.filter((envoi) => envoi.statut === 'en_attente');
    try {
      await this.dispatchQueue.addBulk(
        enAttente.map(({ id }) => ({
          name: 'dispatch',
          data: { envoiId: id },
          opts: { jobId: id },
        })),
      );
    } catch (erreur) {
      await annulerRedispatch(
        this.db,
        retourId,
        enAttente.map(({ id }) => id),
      );
      throw erreur;
    }
    return resultat;
  }
}
