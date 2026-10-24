import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TriageJob } from '@nudge/core';
import { captures, retours, type Db } from '@nudge/database';
import type { Auteur, CaptureEntrante, RetourRecu, RetourValide, Source } from '@nudge/shared';
import type { StockageCaptures } from '@nudge/stockage';
import type { Queue } from 'bullmq';
import { DB, STOCKAGE_CAPTURES, TRIAGE_QUEUE_TOKEN } from '../infra/tokens.js';
import { cleCapture } from './capture.js';

/** Cas d'usage commun aux deux voies d'ingestion (clé publique, clé secrète). */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TRIAGE_QUEUE_TOKEN) private readonly triageQueue: Queue<TriageJob>,
    @Inject(STOCKAGE_CAPTURES) private readonly stockage: StockageCaptures,
  ) {}

  /**
   * Enregistre le Retour, et sa Capture s'il en a une : l'image est écrite dans le
   * stockage avant la ligne en base. Un stockage indisponible refuse le Retour (5xx)
   * plutôt que de le garder sans la Capture que l'Auteur a choisi de joindre.
   *
   * Une fois la ligne en base, le Retour est reçu : si sa mise en queue échoue, le
   * balayage des Retours restés Reçu (D18) le remettra au Triage.
   */
  async receive(projetId: string, source: Source, retour: RetourValide): Promise<RetourRecu> {
    const id = randomUUID();
    const auteur = auteurIdentifie(retour.auteur);
    const capture = retour.capture ? await this.stocker(id, retour.capture) : null;
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(retours).values({
          id,
          projetId,
          source,
          texte: retour.texte,
          typeDeclare: retour.type ?? null,
          auteur,
          // Seule la clé secrète atteste l'identité ; le navigateur ne fait que la déclarer.
          confianceAuteur: auteur ? (source === 'api' ? 'attestee' : 'declaree') : null,
          contexte: retour.contexte ?? {},
        });
        if (capture) await tx.insert(captures).values({ retourId: id, ...capture });
      });
    } catch (erreur) {
      // Sans ligne en base, l'image ne serait jamais lue ni supprimée.
      if (capture) await this.stockage.supprimer(capture.cle).catch(() => undefined);
      throw erreur;
    }
    try {
      await this.triageQueue.add('triage', { retourId: id }, { jobId: id });
    } catch (erreur) {
      this.logger.error(
        `Retour ${id} enregistré mais pas mis en queue, le balayage le triera : ${String(erreur)}`,
      );
    }
    return { id, etat: 'recu' };
  }

  private async stocker(retourId: string, capture: CaptureEntrante) {
    const contenu = Buffer.from(capture.data, 'base64');
    const cle = cleCapture(retourId, capture.contentType);
    await this.stockage.enregistrer(cle, contenu, capture.contentType);
    return { cle, contentType: capture.contentType, octets: contenu.length };
  }
}

/** Un Auteur sans identifiant, email ni nom n'identifie personne : il n'y a rien à attester. */
const auteurIdentifie = (auteur: Auteur | undefined): Auteur | null =>
  auteur && Object.values(auteur).some((valeur) => valeur) ? auteur : null;
