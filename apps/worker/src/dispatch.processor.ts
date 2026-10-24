import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  envoyer,
  type DestinationAdapterResolver,
  type DispatchJob,
  type EnvoiASortir,
  type SecretCipher,
} from '@nudge/core';
import { envois, toDestinationConfiguree, type Db } from '@nudge/database';
import { and, eq, sql } from 'drizzle-orm';
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
        retour: { with: { projet: true, verdict: true } },
      },
    });
    if (!envoi || envoi.statut !== 'en_attente') return;
    const { destination, retour } = envoi;
    // Destination Suspendue : l'Envoi est retenu sans appel sortant.
    if (
      destination.etat === 'suspendue' &&
      (await this.suspension.retenirSiSuspendue(envoiId, destination.id))
    ) {
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
        recuLe: retour.createdAt,
        lienDashboard: this.options.dashboardUrl
          ? `${this.options.dashboardUrl.replace(/\/+$/, '')}/retours/${retour.id}`
          : null,
      },
    };

    // Une exception (réseau, adaptateur, secrets indéchiffrables) est un échec transitoire.
    const resultat = await envoyer(
      () => this.resolveDestinationAdapter(toDestinationConfiguree(destination, this.cipher)),
      aSortir,
    );

    if (resultat.statut === 'livre') {
      await this.db
        .update(envois)
        .set({
          statut: 'livre',
          lienExterne: resultat.lienExterne,
          tentatives: sql`${envois.tentatives} + 1`,
          derniereErreur: null,
        })
        .where(and(eq(envois.id, envoiId), eq(envois.statut, 'en_attente')));
      await this.suspension.apresLivraison(destination.id);
      return;
    }
    const issue = await this.suspension.apresEchec(envoi, resultat, derniereTentative);
    if (issue === 'a_retenter') throw new EchecTransitoire(resultat.message);
  }
}
