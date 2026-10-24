import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildTriageState,
  etatApresTriage,
  filtreRetient,
  triageQuestions,
  renderVerdict,
  TRIAGE_INSTRUCTIONS,
  type DispatchJob,
  type TriageAnswers,
  type TriageJob,
} from '@nudge/core';
import { destinations, envois, filtreDe, retours, verdicts, type Db } from '@nudge/database';
import {
  ErreurJugeRefusee,
  ErreurJugeTransitoire,
  type Juge,
  type RequeteJuge,
} from '@nudge/judge';
import type { Queue } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
import { AlertesService } from './alertes.service.js';
import type { WorkerOptions } from './options.js';
import { JugeResolver } from './juge-resolver.js';
import { DB, DISPATCH_QUEUE_TOKEN, OPTIONS } from './tokens.js';

const DELAI_JUGE_PAR_DEFAUT_MS = 30_000;

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

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
    const annulation = new AbortController();
    let minuteur: NodeJS.Timeout | undefined;
    const expiration = new Promise<never>((_, reject) => {
      minuteur = setTimeout(() => {
        const erreur = new ErreurJugeTransitoire(`Juge sans réponse après ${delaiMs} ms`);
        annulation.abort(erreur);
        reject(erreur);
      }, delaiMs);
    });
    try {
      return await Promise.race([juge.juger(requete, { signal: annulation.signal }), expiration]);
    } catch (erreur) {
      // Un refus durable (clé refusée, requête rejetée) ne se résout pas seul : il est
      // retenté comme le reste, mais signalé pour qu'un Membre corrige la configuration.
      if (erreur instanceof ErreurJugeRefusee) {
        this.logger.error(
          `Juge : refus « ${erreur.motif} » pour le Retour ${retourId} : ${erreur.message}`,
        );
      }
      throw erreur;
    } finally {
      clearTimeout(minuteur);
    }
  }

  /**
   * Un Envoi par Destination du Projet dont le Filtre retient le Verdict ; le Retour
   * passe Dispatché dès qu'il en a un, et reste Trié si aucun Filtre ne le retient.
   * L'Envoi est unique par (Retour, Destination) : un job rejoué n'en crée pas d'autre.
   * Un Retour déjà Dispatché ne reçoit plus de nouvel Envoi (pas d'effet rétroactif
   * d'une Destination ajoutée ou d'un Filtre modifié depuis) : le job rejoué remet
   * seulement en queue ses Envois encore en attente.
   */
  private async dispatcher(
    retourId: string,
    projetId: string,
    etat: 'trie' | 'dispatche',
  ): Promise<void> {
    const aEnvoyer = await this.db.transaction(async (tx) => {
      if (etat === 'trie') await this.creerEnvois(tx, retourId, projetId);
      return tx
        .select({ id: envois.id })
        .from(envois)
        .where(and(eq(envois.retourId, retourId), eq(envois.statut, 'en_attente')));
    });

    // Après le commit : le job de dispatch lit un Envoi qui existe. jobId = id de l'Envoi.
    await this.dispatchQueue.addBulk(
      aEnvoyer.map(({ id }) => ({ name: 'dispatch', data: { envoiId: id }, opts: { jobId: id } })),
    );
  }

  /**
   * Les Envois des Destinations dont le Filtre retient le Verdict, retenus pour une
   * Destination Suspendue ; Dispatché s'il y en a.
   */
  private async creerEnvois(tx: Transaction, retourId: string, projetId: string): Promise<void> {
    const [verdict] = await tx
      .select({ typeRetenu: verdicts.typeRetenu, gravite: verdicts.gravite })
      .from(verdicts)
      .where(eq(verdicts.retourId, retourId));
    if (!verdict) throw new Error(`Retour ${retourId} Trié sans Verdict`);
    const destinationsDuProjet = await tx
      .select({
        id: destinations.id,
        etat: destinations.etat,
        filtreTypes: destinations.filtreTypes,
        filtreGraviteMinimale: destinations.filtreGraviteMinimale,
      })
      .from(destinations)
      .where(eq(destinations.projetId, projetId));
    const cibles = destinationsDuProjet.filter((d) => filtreRetient(filtreDe(d), verdict));
    if (cibles.length === 0) return;
    await tx
      .insert(envois)
      .values(
        cibles.map((d) => ({
          retourId,
          destinationId: d.id,
          // Destination Suspendue : l'Envoi est retenu d'emblée, sans job ni appel sortant.
          ...(d.etat === 'suspendue' ? { statut: 'retenu' as const, retenuLe: sql`now()` } : {}),
        })),
      )
      .onConflictDoNothing({ target: [envois.retourId, envois.destinationId] });
    await tx
      .update(retours)
      .set({ etat: 'dispatche' })
      .where(and(eq(retours.id, retourId), eq(retours.etat, 'trie')));
  }

  private async readEtat(retourId: string) {
    const [ligne] = await this.db
      .select({ etat: retours.etat })
      .from(retours)
      .where(eq(retours.id, retourId));
    return ligne?.etat;
  }
}
