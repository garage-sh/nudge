import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildTriageState,
  triageQuestions,
  renderVerdict,
  type DispatchJob,
  type TriageJob,
} from '@nudge/core';
import { destinations, envois, retours, verdicts, type Db } from '@nudge/database';
import type { Juge } from '@nudge/judge';
import type { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { DB, JUGE, DISPATCH_QUEUE_TOKEN } from './tokens.js';

/**
 * Triage puis création des Envois. Chaque transition est persistée et
 * conditionnelle sur l'état courant : un job rejoué reprend là où il s'était arrêté.
 */
@Injectable()
export class TriageProcessor {
  private readonly logger = new Logger(TriageProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(JUGE) private readonly juge: Juge | null,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue<DispatchJob>,
  ) {}

  async handle({ retourId }: TriageJob): Promise<void> {
    const retour = await this.db.query.retours.findFirst({
      where: eq(retours.id, retourId),
      with: { projet: true },
    });
    if (!retour) {
      this.logger.warn(`Retour ${retourId} introuvable, job ignoré`);
      return;
    }

    if (retour.etat === 'recu') {
      await this.trier(retour);
    }
    const etat = (await this.readEtat(retourId)) ?? retour.etat;
    if (etat === 'trie' || etat === 'dispatche') {
      await this.dispatcher(retourId, retour.projetId);
    }
  }

  private async trier(retour: {
    id: string;
    texte: string;
    typeDeclare: (typeof retours.$inferSelect)['typeDeclare'];
    contexte: (typeof retours.$inferSelect)['contexte'];
    projet: { description: string | null };
  }): Promise<void> {
    // Une erreur du Juge remonte : BullMQ retente avec backoff, le Retour reste Reçu.
    const reponses = this.juge
      ? await this.juge.juger({
          state: buildTriageState({
            texte: retour.texte,
            typeDeclare: retour.typeDeclare,
            contexte: retour.contexte,
            descriptionProjet: retour.projet.description,
          }),
          questions: triageQuestions,
        })
      : null;
    const verdict = renderVerdict(reponses, retour.typeDeclare);

    await this.db.transaction(async (tx) => {
      await tx
        .insert(verdicts)
        .values({ retourId: retour.id, ...verdict })
        .onConflictDoNothing({ target: verdicts.retourId });
      await tx
        .update(retours)
        .set({ etat: 'trie' })
        .where(and(eq(retours.id, retour.id), eq(retours.etat, 'recu')));
    });
  }

  /** Un Envoi par Destination du Projet ; le Retour passe Dispatché dès qu'il en a un. */
  private async dispatcher(retourId: string, projetId: string): Promise<void> {
    const aEnvoyer = await this.db.transaction(async (tx) => {
      const cibles = await tx
        .select({ id: destinations.id })
        .from(destinations)
        .where(eq(destinations.projetId, projetId));
      if (cibles.length > 0) {
        await tx
          .insert(envois)
          .values(cibles.map((d) => ({ retourId, destinationId: d.id })))
          .onConflictDoNothing({ target: [envois.retourId, envois.destinationId] });
      }
      const enAttente = await tx
        .select({ id: envois.id })
        .from(envois)
        .where(and(eq(envois.retourId, retourId), eq(envois.statut, 'en_attente')));
      const tous = await tx
        .select({ id: envois.id })
        .from(envois)
        .where(eq(envois.retourId, retourId));
      if (tous.length > 0) {
        await tx
          .update(retours)
          .set({ etat: 'dispatche' })
          .where(and(eq(retours.id, retourId), eq(retours.etat, 'trie')));
      }
      return enAttente;
    });

    // Après le commit : le job de dispatch lit un Envoi qui existe. jobId = id de l'Envoi.
    await this.dispatchQueue.addBulk(
      aEnvoyer.map(({ id }) => ({ name: 'dispatch', data: { envoiId: id }, opts: { jobId: id } })),
    );
  }

  private async readEtat(retourId: string) {
    const [ligne] = await this.db
      .select({ etat: retours.etat })
      .from(retours)
      .where(eq(retours.id, retourId));
    return ligne?.etat;
  }
}
