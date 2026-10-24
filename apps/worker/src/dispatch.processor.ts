import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  envoyer,
  lienDashboard,
  type CaptureADispatcher,
  type DestinationAdapterResolver,
  type DispatchJob,
  type EnvoiASortir,
  type SecretCipher,
} from '@nudge/core';
import { envois, toDestinationConfiguree, type captures, type Db } from '@nudge/database';
import { eq } from 'drizzle-orm';
import type { WorkerOptions } from './options.js';
import { SuspensionService } from './suspension.service.js';
import { DB, DESTINATION_ADAPTER_RESOLVER, OPTIONS, SECRET_CIPHER } from './tokens.js';

/** Échec transitoire : le job est relancé par BullMQ (backoff exponentiel et jitter). */
export class EchecTransitoire extends Error {
  override readonly name = 'EchecTransitoire';
}

@Injectable()
export class DispatchProcessor {
  private readonly logger = new Logger(DispatchProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DESTINATION_ADAPTER_RESOLVER)
    private readonly resolveDestinationAdapter: DestinationAdapterResolver,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
    private readonly suspension: SuspensionService,
  ) {}

  /**
   * `derniereTentative` : BullMQ ne relancera plus ce job ; un échec transient y met
   * l'Envoi en échec au lieu de le laisser en attente sans job.
   */
  async handle({ envoiId }: DispatchJob, { derniereTentative = false } = {}): Promise<void> {
    const envoi = await this.db.query.envois.findFirst({
      where: eq(envois.id, envoiId),
      with: {
        destination: true,
        retour: { with: { projet: true, verdict: true, capture: true } },
      },
    });
    if (!envoi) return;
    const { destination, retour } = envoi;
    if (envoi.statut === 'retenu') {
      // Job de libération : l'Envoi repart si sa Destination est active.
      if (destination.etat === 'suspendue') {
        await this.suspension.prolongerRetenue(envoiId);
        return;
      }
      if (!(await this.suspension.reprendre(envoiId))) return;
    } else if (envoi.statut !== 'en_attente') {
      return;
    } else if (destination.etat === 'suspendue') {
      // Destination Suspendue : l'Envoi est retenu sans appel sortant.
      await this.suspension.retenir(envoiId);
      return;
    }
    if (!retour.verdict) {
      this.logger.error(`Envoi ${envoiId} sans Verdict, ignoré`);
      return;
    }

    const aSortir: EnvoiASortir = {
      envoiId,
      essai: false,
      projet: { id: retour.projet.id, nom: retour.projet.nom },
      retour: {
        id: retour.id,
        texte: retour.texte,
        source: retour.source,
        typeRetenu: retour.verdict.typeRetenu,
        gravite: retour.verdict.gravite,
        incertain: retour.verdict.incertain,
        auteur:
          retour.auteur && retour.confianceAuteur
            ? { ...retour.auteur, confiance: retour.confianceAuteur }
            : null,
        contexte: retour.contexte,
        capture: retour.capture ? this.captureADispatcher(retour.capture) : null,
        recuLe: retour.createdAt,
        lienDashboard: lienDashboard(this.options.dashboardUrl, `/retours/${retour.id}`),
      },
    };

    // Une exception (réseau, adaptateur, secrets indéchiffrables) est un échec transitoire.
    const resultat = await envoyer(
      () => this.resolveDestinationAdapter(toDestinationConfiguree(destination, this.cipher)),
      aSortir,
    );

    if (resultat.statut === 'livre') {
      await this.suspension.apresLivraison(envoi, resultat.lienExterne);
      return;
    }
    const issue = await this.suspension.apresEchec(envoi, resultat, derniereTentative);
    if (issue === 'a_retenter') throw new EchecTransitoire(resultat.message);
  }

  /** La Capture d'un Retour, lue dans le stockage seulement si l'adaptateur la joint. */
  private captureADispatcher({
    cle,
    contentType,
    octets,
  }: typeof captures.$inferSelect): CaptureADispatcher {
    return { contentType, octets, lire: () => this.options.stockageCaptures.lire(cle) };
  }
}
