import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DispatchJob, TriageJob } from '@nudge/core';
import { envois, retours, type Db } from '@nudge/database';
import type { JobType, Queue } from 'bullmq';
import { and, asc, eq, lt } from 'drizzle-orm';
import { BALAYAGE_PAR_DEFAUT, type WorkerOptions } from './options.js';
import { DB, DISPATCH_QUEUE_TOKEN, OPTIONS, TRIAGE_QUEUE_TOKEN } from './tokens.js';

/** Retours (ou Envois) remis en queue par passage : le suivant reprend le reste. */
const LOT = 100;

/** États d'un job qui finira par traiter son Envoi : ni terminé, ni en échec. */
const JOBS_VIVANTS: JobType[] = [
  'active',
  'waiting',
  'delayed',
  'prioritized',
  'paused',
  'waiting-children',
];

/**
 * Balayages des Retours restés Reçu (D18) et des Envois restés en attente (D26).
 * Sans outbox, un Retour ou un Envoi peut être enregistré sans que sa mise en queue
 * aboutisse ; son job peut aussi avoir épuisé ses retries sans le faire avancer
 * (Juge longtemps absent, Postgres indisponible). Le balayage les remet en queue,
 * sans doubler un job encore en attente ou en cours.
 */
@Injectable()
export class BalayageProcessor {
  private readonly logger = new Logger(BalayageProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TRIAGE_QUEUE_TOKEN) private readonly triageQueue: Queue<TriageJob>,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue<DispatchJob>,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
  ) {}

  async balayerRecus(): Promise<void> {
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

  /**
   * Remet au dispatch les Envois en attente depuis plus que le délai dont aucun job
   * n'est vivant. Un Envoi a plusieurs jobs au fil de sa vie (premier envoi, rejeu,
   * libération) : on les reconnaît par l'Envoi qu'ils portent, pas par leur id.
   */
  async balayerEnvois(): Promise<void> {
    const { delaiMs } = this.options.balayage ?? BALAYAGE_PAR_DEFAUT;
    const enAttente = await this.db
      .select({ id: envois.id })
      .from(envois)
      .where(
        and(eq(envois.statut, 'en_attente'), lt(envois.updatedAt, new Date(Date.now() - delaiMs))),
      )
      .orderBy(asc(envois.updatedAt))
      .limit(LOT);
    if (enAttente.length === 0) return;
    const vivants = new Set(
      (await this.dispatchQueue.getJobs(JOBS_VIVANTS))
        .filter((job) => job !== undefined)
        .map((job) => job.data.envoiId),
    );
    const oublies = enAttente.filter(({ id }) => !vivants.has(id));
    if (oublies.length === 0) return;
    // Un id neuf par passage : un job en échec garde le sien, l'Envoi repart avec
    // toutes ses tentatives.
    const passage = Date.now();
    await this.dispatchQueue.addBulk(
      oublies.map(({ id }) => ({
        name: 'dispatch',
        data: { envoiId: id },
        opts: { jobId: `${id}-balayage-${passage}` },
      })),
    );
    for (const { id } of oublies) {
      this.logger.warn(`Envoi ${id} resté en attente sans job : remis au dispatch`);
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
