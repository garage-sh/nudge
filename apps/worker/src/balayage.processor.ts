import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TriageJob } from '@nudge/core';
import { retours, type Db } from '@nudge/database';
import type { Queue } from 'bullmq';
import { and, asc, eq, lt } from 'drizzle-orm';
import { BALAYAGE_PAR_DEFAUT, type WorkerOptions } from './options.js';
import { DB, OPTIONS, TRIAGE_QUEUE_TOKEN } from './tokens.js';

/** Retours remis au Triage par passage : le suivant reprend le reste. */
const LOT = 100;

/**
 * Balayage des Retours restés Reçu (D18). Sans outbox, un Retour peut être enregistré
 * sans que sa mise en queue aboutisse ; son job de Triage peut aussi avoir épuisé ses
 * retries pendant une longue indisponibilité du Juge. Le balayage remet ces Retours
 * au Triage, sans doubler un job encore en attente ou en cours.
 */
@Injectable()
export class BalayageProcessor {
  private readonly logger = new Logger(BalayageProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TRIAGE_QUEUE_TOKEN) private readonly triageQueue: Queue<TriageJob>,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
  ) {}

  async handle(): Promise<void> {
    const { delaiMs } = this.options.balayage ?? BALAYAGE_PAR_DEFAUT;
    const oublies = await this.db
      .select({ id: retours.id })
      .from(retours)
      .where(and(eq(retours.etat, 'recu'), lt(retours.createdAt, new Date(Date.now() - delaiMs))))
      .orderBy(asc(retours.createdAt))
      .limit(LOT);
    for (const { id } of oublies) {
      if (await this.relancerTriage(id)) {
        this.logger.warn(`Retour ${id} resté Reçu : remis au Triage`);
      }
    }
  }

  /** Le job de Triage d'un Retour a pour id celui du Retour. Rend vrai s'il a été (re)lancé. */
  private async relancerTriage(retourId: string): Promise<boolean> {
    const job = await this.triageQueue.getJob(retourId);
    if (job) {
      const etatJob = await job.getState();
      if (etatJob === 'failed') {
        // Remis à zéro, le job retrouve toutes ses tentatives et leur backoff.
        await job.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
        return true;
      }
      // En attente, différé ou en cours : le Triage suit son cours.
      if (etatJob !== 'completed' && etatJob !== 'unknown') return false;
      await job.remove();
    }
    await this.triageQueue.add('triage', { retourId }, { jobId: retourId });
    return true;
  }
}
