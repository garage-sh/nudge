import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DISPATCH_JOB,
  idJobLiberation,
  type DestinationAdapterResolver,
  type DispatchJob,
  type ResultatEnvoi,
  type SanteDestination,
  type SecretCipher,
} from '@nudge/core';
import { destinations, envois, toDestinationConfiguree, type Db } from '@nudge/database';
import { messageErreur } from '@nudge/shared';
import type { Queue } from 'bullmq';
import { and, eq, lte, ne, sql } from 'drizzle-orm';
import {
  SUSPENSION_PAR_DEFAUT,
  type OptionsSuspension,
  type Suspension,
  type SurSuspension,
  type WorkerOptions,
} from './options.js';
import { avecDelai } from './delai.js';
import {
  DB,
  DESTINATION_ADAPTER_RESOLVER,
  DISPATCH_QUEUE_TOKEN,
  OPTIONS,
  SECRET_CIPHER,
  SUR_SUSPENSION,
} from './tokens.js';

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
type Echec = Extract<ResultatEnvoi, { statut: 'echec' }>;

/** Ce que devient un Envoi après un échec. */
export type IssueEchec = 'retenu' | 'a_retenter' | 'echec';

/** Au-delà, une sonde sans réponse compte comme injoignable. */
const DELAI_SONDE_MS = 10_000;

const motif = (classe: string, message: string) => `${classe}: ${message}`;

/** Un Envoi précis, tant qu'il attend sa livraison. */
const envoiEnAttente = (envoiId: string) =>
  and(eq(envois.id, envoiId), eq(envois.statut, 'en_attente'));

/**
 * Issue des Envois et Suspension des Destinations. Chaque transition est un UPDATE
 * conditionnel sur l'état courant : deux workers qui échouent en même temps ne
 * suspendent la Destination qu'une fois, une sonde ne réactive pas une Destination
 * déjà réactivée, et un Envoi ne change de statut que depuis celui qu'on a lu.
 *
 * - `transient` : un échec consécutif de plus ; au seuil, la Destination est Suspendue ;
 * - `auth` : la Destination est Suspendue aussitôt ;
 * - `permanent` : l'Envoi échoue ; la Destination a répondu, la série repart de zéro.
 *
 * L'Envoi d'une Destination Suspendue est retenu, sans appel sortant. Les Envois
 * retenus d'une Destination active sont remis en queue à chaque passage de la sonde,
 * jusqu'à ce que leur job les reprenne : une libération interrompue (redémarrage,
 * Redis indisponible) est rattrapée au passage suivant.
 */
@Injectable()
export class SuspensionService {
  private readonly logger = new Logger(SuspensionService.name);
  private readonly politique: OptionsSuspension;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DESTINATION_ADAPTER_RESOLVER)
    private readonly resolveDestinationAdapter: DestinationAdapterResolver,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue<DispatchJob>,
    @Inject(SUR_SUSPENSION) private readonly surSuspension: SurSuspension,
    @Inject(OPTIONS) options: WorkerOptions,
  ) {
    this.politique = options.suspension ?? SUSPENSION_PAR_DEFAUT;
  }

  /** Retient un Envoi en attente, sans appel sortant (sa Destination est Suspendue). */
  async retenir(envoiId: string): Promise<void> {
    await this.db
      .update(envois)
      .set({ statut: 'retenu', retenuLe: sql`now()` })
      .where(envoiEnAttente(envoiId));
  }

  /**
   * Reprend un Envoi retenu dont la Destination est active : il repasse en attente.
   * Rend faux s'il n'était plus retenu (un autre job l'a déjà repris).
   */
  async reprendre(envoiId: string): Promise<boolean> {
    const repris = await this.db
      .update(envois)
      .set({ statut: 'en_attente', retenuLe: null })
      .where(and(eq(envois.id, envoiId), eq(envois.statut, 'retenu')))
      .returning({ id: envois.id });
    return repris.length > 0;
  }

  /**
   * Un job de libération arrivé quand la Destination est de nouveau Suspendue : la
   * retenue recommence, et la prochaine libération aura un nouvel id de job.
   */
  async prolongerRetenue(envoiId: string): Promise<void> {
    await this.db
      .update(envois)
      .set({ retenuLe: sql`now()` })
      .where(and(eq(envois.id, envoiId), eq(envois.statut, 'retenu')));
  }

  /** L'Envoi est livré ; la série d'échecs consécutifs de sa Destination repart de zéro. */
  async apresLivraison(
    envoi: { readonly id: string; readonly destinationId: string },
    lienExterne: string | null,
  ): Promise<void> {
    await this.db
      .update(envois)
      .set({
        statut: 'livre',
        lienExterne,
        tentatives: sql`${envois.tentatives} + 1`,
        derniereErreur: null,
      })
      .where(envoiEnAttente(envoi.id));
    await this.remettreAZero(envoi.destinationId);
  }

  /**
   * Enregistre l'échec d'un Envoi en attente et rend ce qu'il devient : retenu (sa
   * Destination est, ou vient d'être, Suspendue), à retenter (transient sous le seuil)
   * ou en échec (permanent, ou transient à la dernière tentative).
   *
   * `derniereTentative` : BullMQ ne relancera plus le job. `interne` : l'échec vient de
   * nudge et non de la cible (D25) ; il est retenté mais ne compte pas pour la Suspension.
   */
  async apresEchec(
    envoi: { readonly id: string; readonly destinationId: string },
    resultat: Echec,
    { derniereTentative, interne }: { derniereTentative: boolean; interne: boolean },
  ): Promise<IssueEchec> {
    const tentatives = sql`${envois.tentatives} + 1`;
    const derniereErreur = motif(resultat.classe, resultat.message);

    if (resultat.classe === 'permanent') {
      await this.db
        .update(envois)
        .set({ statut: 'echec', tentatives, derniereErreur })
        .where(envoiEnAttente(envoi.id));
      await this.remettreAZero(envoi.destinationId);
      return 'echec';
    }
    const { classe, message } = resultat;

    const { issue, suspension } = await this.db.transaction(async (tx) => {
      // Verrou jusqu'au commit : les échecs concurrents se comptent l'un après l'autre.
      const [destination] = await tx
        .select({ etat: destinations.etat })
        .from(destinations)
        .where(eq(destinations.id, envoi.destinationId))
        .for('update');
      let suspension: Suspension | null = null;
      if (destination?.etat === 'active' && !interne) {
        const seuilAtteint =
          classe === 'transient' &&
          (await this.compterEchec(tx, envoi.destinationId)) >= this.politique.seuilEchecs;
        if (classe === 'auth' || seuilAtteint) {
          suspension = await this.suspendre(tx, envoi.destinationId, classe, message);
        }
      }

      const suspendue = destination?.etat === 'suspendue' || suspension !== null;
      if (suspendue) {
        await tx
          .update(envois)
          .set({ statut: 'retenu', retenuLe: sql`now()`, tentatives, derniereErreur })
          .where(envoiEnAttente(envoi.id));
        return { issue: 'retenu' as const, suspension };
      }
      if (derniereTentative) {
        await tx
          .update(envois)
          .set({ statut: 'echec', tentatives, derniereErreur })
          .where(envoiEnAttente(envoi.id));
        return { issue: 'echec' as const, suspension };
      }
      await tx.update(envois).set({ tentatives, derniereErreur }).where(envoiEnAttente(envoi.id));
      return { issue: 'a_retenter' as const, suspension };
    });

    if (suspension) await this.notifier(suspension);
    return issue;
  }

  /**
   * Tâche planifiée : sonde chaque Destination Suspendue dont le refroidissement est
   * écoulé et réactive celles qui répondent, puis remet en queue les Envois retenus
   * de toute Destination active.
   */
  async sonder(): Promise<void> {
    // Réserver la sonde en repoussant la suivante : deux passages concurrents ne
    // sondent pas deux fois la même Destination.
    const aSonder = await this.db
      .update(destinations)
      .set({ prochaineSondeLe: this.finRefroidissement() })
      .where(
        and(eq(destinations.etat, 'suspendue'), lte(destinations.prochaineSondeLe, sql`now()`)),
      )
      .returning();
    for (const destination of aSonder) {
      const sante = await this.sante(destination);
      if (!sante.joignable) {
        this.logger.warn(
          `Destination ${destination.id} toujours injoignable (${motif(sante.classe, sante.message)}) : reste Suspendue`,
        );
        continue;
      }
      const [reactivee] = await this.db
        .update(destinations)
        .set({
          etat: 'active',
          echecsConsecutifs: 0,
          suspendueLe: null,
          motifSuspension: null,
          prochaineSondeLe: null,
        })
        .where(and(eq(destinations.id, destination.id), eq(destinations.etat, 'suspendue')))
        .returning({ id: destinations.id });
      if (reactivee) this.logger.log(`Destination ${destination.id} joignable : de nouveau active`);
    }
    await this.liberer();
  }

  /**
   * Seul passage d'une Destination en Suspendue : conditionnel sur `active`, il rend
   * `null` si elle l'était déjà. L'appelant notifie `SUR_SUSPENSION` après le commit.
   */
  private async suspendre(
    tx: Transaction,
    destinationId: string,
    classe: Suspension['classe'],
    message: string,
  ): Promise<Suspension | null> {
    const [suspendue] = await tx
      .update(destinations)
      .set({
        etat: 'suspendue',
        suspendueLe: sql`now()`,
        motifSuspension: motif(classe, message),
        prochaineSondeLe: this.finRefroidissement(),
      })
      .where(and(eq(destinations.id, destinationId), eq(destinations.etat, 'active')))
      .returning({
        destinationId: destinations.id,
        projetId: destinations.projetId,
        nom: destinations.nom,
        suspendueLe: destinations.suspendueLe,
      });
    if (!suspendue?.suspendueLe) return null;
    return { ...suspendue, suspendueLe: suspendue.suspendueLe, classe, message };
  }

  private async notifier(suspension: Suspension): Promise<void> {
    this.logger.warn(
      `Destination ${suspension.destinationId} Suspendue (${motif(suspension.classe, suspension.message)})`,
    );
    try {
      await this.surSuspension(suspension);
    } catch (erreur) {
      this.logger.error(
        `Suspension de la Destination ${suspension.destinationId} non signalée : ${String(erreur)}`,
      );
    }
  }

  /**
   * Remet en queue les Envois retenus des Destinations actives, sans les modifier : le
   * job les reprend lui-même. L'id de job tient à la retenue en cours, de sorte qu'un
   * passage suivant ne double pas un job encore en attente.
   */
  private async liberer(): Promise<void> {
    const retenus = await this.db
      .select({ id: envois.id, retenuLe: envois.retenuLe })
      .from(envois)
      .innerJoin(destinations, eq(destinations.id, envois.destinationId))
      .where(and(eq(envois.statut, 'retenu'), eq(destinations.etat, 'active')));
    if (retenus.length === 0) return;
    await this.dispatchQueue.addBulk(
      retenus.map(({ id, retenuLe }) => ({
        name: DISPATCH_JOB,
        data: { envoiId: id },
        opts: { jobId: idJobLiberation(id, retenuLe) },
      })),
    );
  }

  /** Un échec transient de plus ; rend la série en cours. */
  private async compterEchec(tx: Transaction, destinationId: string): Promise<number> {
    const [destination] = await tx
      .update(destinations)
      .set({ echecsConsecutifs: sql`${destinations.echecsConsecutifs} + 1` })
      .where(eq(destinations.id, destinationId))
      .returning({ echecsConsecutifs: destinations.echecsConsecutifs });
    return destination?.echecsConsecutifs ?? 0;
  }

  private async sante(destination: typeof destinations.$inferSelect): Promise<SanteDestination> {
    try {
      const adaptateur = this.resolveDestinationAdapter(
        toDestinationConfiguree(destination, this.cipher),
      );
      return await avecDelai(
        DELAI_SONDE_MS,
        () => new Error(`sans réponse après ${DELAI_SONDE_MS} ms`),
        () => adaptateur.healthCheck(),
      );
    } catch (erreur) {
      return { joignable: false, classe: 'transient', message: messageErreur(erreur) };
    }
  }

  private async remettreAZero(destinationId: string): Promise<void> {
    await this.db
      .update(destinations)
      .set({ echecsConsecutifs: 0 })
      .where(and(eq(destinations.id, destinationId), ne(destinations.echecsConsecutifs, 0)));
  }

  private finRefroidissement() {
    return sql`now() + ${this.politique.refroidissementMs} * interval '1 millisecond'`;
  }
}
