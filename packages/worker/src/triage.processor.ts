import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildTriageState,
  DISPATCH_JOB,
  idJobDispatch,
  etatApresTriage,
  triageQuestions,
  renderVerdict,
  TRIAGE_INSTRUCTIONS,
  type DispatchJob,
  type TriageAnswers,
  type TriageJob,
} from '@nudge/core';
import { creerEnvoisManquants, envois, retours, verdicts, type Db } from '@nudge/database';
import {
  ErreurJugeRefusee,
  ErreurJugeTransitoire,
  type Juge,
  type RequeteJuge,
} from '@nudge/judge';
import type { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { AlertesService } from './alertes.service.js';
import { avecDelai } from './delai.js';
import { DELAI_JUGE_PAR_DEFAUT_MS, type WorkerOptions } from './options.js';
import { JugeResolver } from './juge-resolver.js';
import { DB, DISPATCH_QUEUE_TOKEN, OPTIONS } from './tokens.js';

/**
 * Triage puis création des Envois. Chaque transition est persistée et
 * conditionnelle sur l'état courant : un job rejoué reprend là où il s'était arrêté.
 */
@Injectable()
export class TriageProcessor {
  private readonly logger = new Logger(TriageProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jugeResolver: JugeResolver,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue<DispatchJob>,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
    private readonly alertes: AlertesService,
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
      await this.dispatcher(retourId, retour.projetId, etat);
    }
    // Après le commit du passage En revue (décidé par `etatApresTriage`). Si la mise en
    // queue échoue, le job de Triage retenté la refait : l'alerte est unique par Retour.
    if (etat === 'en_revue') {
      await this.alertes.signaler({ evenement: 'retour_en_revue', retourId });
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
    const juge = await this.jugeResolver.courant();
    const reponses = juge
      ? await this.jugerAvecDelai(juge, retour.id, {
          instructions: TRIAGE_INSTRUCTIONS,
          state: buildTriageState({
            texte: retour.texte,
            typeDeclare: retour.typeDeclare,
            contexte: retour.contexte,
            descriptionProjet: retour.projet.description,
          }),
          questions: triageQuestions,
        })
      : null;
    const verdict = renderVerdict(reponses, retour.typeDeclare, this.options.seuilsTriage);

    await this.db.transaction(async (tx) => {
      await tx
        .insert(verdicts)
        .values({ retourId: retour.id, ...verdict })
        .onConflictDoNothing({ target: verdicts.retourId });
      await tx
        .update(retours)
        .set({ etat: etatApresTriage(verdict) })
        .where(and(eq(retours.id, retour.id), eq(retours.etat, 'recu')));
    });
  }

  /**
   * Un Juge qui ne répond pas dans le délai est traité comme indisponible : erreur
   * transitoire, et l'appel en cours est annulé plutôt que laissé courir.
   */
  private async jugerAvecDelai(
    juge: Juge,
    retourId: string,
    requete: RequeteJuge<typeof triageQuestions>,
  ): Promise<TriageAnswers> {
    const delaiMs = this.options.delaiJugeMs ?? DELAI_JUGE_PAR_DEFAUT_MS;
    try {
      return await avecDelai(
        delaiMs,
        () => new ErreurJugeTransitoire(`Juge sans réponse après ${delaiMs} ms`),
        (signal) => juge.juger(requete, { signal }),
      );
    } catch (erreur) {
      // Un refus durable (clé refusée, requête rejetée) ne se résout pas seul : il est
      // retenté comme le reste, mais signalé pour qu'un Membre corrige la configuration.
      if (erreur instanceof ErreurJugeRefusee) {
        this.logger.error(
          `Juge : refus « ${erreur.motif} » pour le Retour ${retourId} : ${erreur.message}`,
        );
      }
      throw erreur;
    }
  }

  /**
   * Un Envoi par Destination du Projet dont le Filtre retient le Verdict ; le Retour
   * passe Dispatché dès qu'il en a un, et reste Trié si aucun Filtre ne le retient.
   * L'Envoi est unique par (Retour, Destination) : un job rejoué n'en crée pas d'autre.
   * Un Retour déjà Dispatché ne reçoit plus de nouvel Envoi (pas d'effet rétroactif
   * d'une Destination ajoutée ou d'un Filtre modifié depuis, sauf redispatch manuel
   * d'un Membre, D22) : le job rejoué remet seulement en queue ses Envois en attente.
   */
  private async dispatcher(
    retourId: string,
    projetId: string,
    etat: 'trie' | 'dispatche',
  ): Promise<void> {
    const aEnvoyer = await this.db.transaction(async (tx) => {
      if (etat === 'trie') await creerEnvoisManquants(tx, retourId, projetId);
      return tx
        .select({ id: envois.id })
        .from(envois)
        .where(and(eq(envois.retourId, retourId), eq(envois.statut, 'en_attente')));
    });

    // Après le commit : le job de dispatch lit un Envoi qui existe.
    await this.dispatchQueue.addBulk(
      aEnvoyer.map(({ id }) => ({
        name: DISPATCH_JOB,
        data: { envoiId: id },
        opts: { jobId: idJobDispatch(id) },
      })),
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
