import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  alerter,
  idJobAlerte,
  lienDashboard,
  type Alerte,
  type AlerteJob,
  type DestinationAdapterResolver,
  type SecretCipher,
} from '@nudge/core';
import {
  destinationAlerteConfiguree,
  destinations,
  readDestinationAlerte,
  retours,
  type Db,
} from '@nudge/database';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { EchecTransitoire } from './dispatch.processor.js';
import type { WorkerOptions } from './options.js';
import {
  ALERTES_QUEUE_TOKEN,
  DB,
  DESTINATION_ADAPTER_RESOLVER,
  OPTIONS,
  SECRET_CIPHER,
} from './tokens.js';

/**
 * Alertes des Membres : un événement (Retour passé En revue, Destination Suspendue)
 * est mis en queue, puis envoyé à la Destination d'alerte de l'Instance par
 * l'adaptateur de son type. Sans Destination d'alerte, le job ne fait rien : le
 * dashboard signale toujours ces états par ses badges, lus en base.
 *
 * Un échec transient est retenté avec backoff ; auth ou permanent est journalisé, sans
 * retry ni Suspension (la Destination d'alerte n'a pas de circuit breaker).
 */
@Injectable()
export class AlertesService {
  private readonly logger = new Logger(AlertesService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ALERTES_QUEUE_TOKEN) private readonly queue: Queue<AlerteJob>,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
    @Inject(DESTINATION_ADAPTER_RESOLVER)
    private readonly resolveDestinationAdapter: DestinationAdapterResolver,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
  ) {}

  /**
   * Met en queue l'alerte d'un événement. L'id de job tient à l'événement : le
   * signaler de nouveau (job de Triage retenté) n'en fait pas une seconde.
   */
  async signaler(job: AlerteJob): Promise<void> {
    await this.queue.add(job.evenement, job, { jobId: idJobAlerte(job) });
  }

  /**
   * Compose l'alerte d'après la base et l'envoie. Lève `EchecTransitoire` pour que
   * BullMQ retente, sauf à la dernière tentative.
   */
  async envoyer(
    job: AlerteJob,
    {
      id,
      signaleLe,
      derniereTentative,
    }: { id: string; signaleLe: Date; derniereTentative: boolean },
  ): Promise<void> {
    const destination = await readDestinationAlerte(this.db);
    if (!destination) return;
    const alerte = await this.composer(job, id, signaleLe);
    if (!alerte) return;
    const resultat = await alerter(
      () => this.resolveDestinationAdapter(destinationAlerteConfiguree(destination, this.cipher)),
      alerte,
    );
    if (resultat.statut === 'livre') return;
    if (resultat.classe === 'transient' && !derniereTentative) {
      throw new EchecTransitoire(resultat.message);
    }
    this.logger.error(
      `Alerte ${id} non envoyée à la Destination d'alerte (${resultat.classe}: ${resultat.message})`,
    );
  }

  /** `null` : le Retour ou la Destination a été supprimé depuis, il n'y a plus rien à signaler. */
  private async composer(job: AlerteJob, id: string, signaleLe: Date): Promise<Alerte | null> {
    if (job.evenement === 'retour_en_revue') {
      const retour = await this.db.query.retours.findFirst({
        where: eq(retours.id, job.retourId),
        columns: { id: true },
        with: { projet: { columns: { id: true, nom: true } } },
      });
      if (!retour) return null;
      return {
        evenement: 'retour_en_revue',
        id,
        essai: false,
        le: signaleLe,
        projet: retour.projet,
        retour: { id: retour.id },
        lienDashboard: lienDashboard(this.options.dashboardUrl, `/retours/${retour.id}`),
      };
    }
    const destination = await this.db.query.destinations.findFirst({
      where: eq(destinations.id, job.destinationId),
      columns: { id: true, nom: true },
      with: { projet: { columns: { id: true, nom: true } } },
    });
    if (!destination) return null;
    return {
      evenement: 'destination_suspendue',
      id,
      essai: false,
      le: new Date(job.suspendueLe),
      projet: destination.projet,
      destination: {
        id: destination.id,
        nom: destination.nom,
        classe: job.classe,
        message: job.message,
      },
      lienDashboard: lienDashboard(
        this.options.dashboardUrl,
        `/projets/${destination.projet.id}/destinations`,
      ),
    };
  }
}
