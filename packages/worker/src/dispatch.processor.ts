import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  echecDException,
  lienDashboard,
  type CaptureADispatcher,
  type DestinationAdapterResolver,
  type DispatchJob,
  type EnvoiASortir,
  type ResultatEnvoi,
  type SecretCipher,
} from '@nudge/core';
import {
  envois,
  toDestinationConfiguree,
  type captures,
  type Db,
  type DestinationRow,
} from '@nudge/database';
import { eq } from 'drizzle-orm';
import { EchecTransitoire } from './echec-transitoire.js';
import type { WorkerOptions } from './options.js';
import { SuspensionService } from './suspension.service.js';
import { DB, DESTINATION_ADAPTER_RESOLVER, OPTIONS, SECRET_CIPHER } from './tokens.js';

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

    let captureIllisible = false;
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
        capture: retour.capture
          ? this.captureADispatcher(retour.capture, () => {
              captureIllisible = true;
            })
          : null,
        recuLe: retour.createdAt,
        lienDashboard: lienDashboard(this.options.dashboardUrl, `/retours/${retour.id}`),
      },
    };

    const { resultat, exception } = await this.sortir(destination, aSortir);

    if (resultat.statut === 'livre') {
      await this.suspension.apresLivraison(envoi, resultat.lienExterne);
      return;
    }
    const issue = await this.suspension.apresEchec(envoi, resultat, {
      derniereTentative,
      interne: exception || captureIllisible,
    });
    if (issue === 'a_retenter') throw new EchecTransitoire(resultat.message);
  }

  /**
   * Envoie par l'adaptateur de la Destination. Une exception est un échec transitoire
   * qui vient de nudge et non de la cible (D25) : secrets indéchiffrables, type
   * d'adaptateur inconnu, défaut de l'adaptateur — chaque adaptateur rend en résultat
   * classé les réponses et les erreurs réseau de sa cible.
   */
  private async sortir(
    destination: DestinationRow,
    aSortir: EnvoiASortir,
  ): Promise<{ resultat: ResultatEnvoi; exception: boolean }> {
    try {
      const adaptateur = this.resolveDestinationAdapter(
        toDestinationConfiguree(destination, this.cipher),
      );
      return { resultat: await adaptateur.send(aSortir), exception: false };
    } catch (erreur) {
      return { resultat: echecDException(erreur), exception: true };
    }
  }

  /**
   * La Capture d'un Retour, lue dans le stockage seulement si l'adaptateur la joint.
   * `surEchec` signale un stockage qui ne la rend pas : un échec interne à nudge.
   */
  private captureADispatcher(
    { cle, contentType, octets }: typeof captures.$inferSelect,
    surEchec: () => void,
  ): CaptureADispatcher {
    return {
      contentType,
      octets,
      lire: async () => {
        try {
          return await this.options.stockageCaptures.lire(cle);
        } catch (erreur) {
          surEchec();
          throw erreur;
        }
      },
    };
  }
}
