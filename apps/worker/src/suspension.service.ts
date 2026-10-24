import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  DestinationAdapterResolver,
  DispatchJob,
  ResultatEnvoi,
  SanteDestination,
  SecretCipher,
} from '@nudge/core';
import { destinations, envois, toDestinationConfiguree, type Db } from '@nudge/database';
import type { Queue } from 'bullmq';
import { and, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import {
  SUSPENSION_PAR_DEFAUT,
  type OptionsSuspension,
  type Suspension,
  type SurSuspension,
  type WorkerOptions,
} from './options.js';
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

/**
 * Suspension des Destinations (circuit breaker, forme reprise des connecteurs
 * d'alliances-pa). Chaque transition de la Destination est un UPDATE conditionnel sur
 * son état courant : deux workers qui échouent en même temps ne la suspendent qu'une
 * fois, et une sonde ne réactive pas une Destination qu'un autre vient de réactiver.
 *
 * - `transient` : compte un échec consécutif ; au seuil, la Destination est Suspendue ;
 * - `auth` : la Destination est Suspendue aussitôt ;
 * - `permanent` : l'Envoi échoue, le compte d'échecs consécutifs repart de zéro.
 *
 * L'Envoi d'une Destination Suspendue est retenu, sans appel sortant ; quand la sonde
 * la trouve joignable, ses Envois retenus repartent.
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

  /**
   * Retient l'Envoi en attente si sa Destination est Suspendue. Le verrou partagé sur
   * la Destination empêche une réactivation de passer entre la lecture et la retenue
   * (l'Envoi manquerait sa libération). Rend vrai si l'Envoi est retenu.
   */
  async retenirSiSuspendue(envoiId: string, destinationId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [destination] = await tx
        .select({ etat: destinations.etat })
        .from(destinations)
        .where(eq(destinations.id, destinationId))
        .for('share');
      if (destination?.etat !== 'suspendue') return false;
      await tx
        .update(envois)
        .set({ statut: 'retenu' })
        .where(and(eq(envois.id, envoiId), eq(envois.statut, 'en_attente')));
      return true;
    });
  }

  /** Une livraison remet à zéro le compte d'échecs consécutifs. */
  async apresLivraison(destinationId: string): Promise<void> {
    await this.remettreAZero(destinationId);
  }

  /**
   * Enregistre l'échec d'un Envoi en attente et rend ce qu'il devient : retenu (sa
   * Destination est, ou vient d'être, Suspendue), à retenter (transient sous le seuil)
   * ou en échec (permanent, ou transient à la dernière tentative).
   */
  async apresEchec(
    envoi: { readonly id: string; readonly destinationId: string },
    resultat: Echec,
    derniereTentative: boolean,
  ): Promise<IssueEchec> {
    const enAttente = and(eq(envois.id, envoi.id), eq(envois.statut, 'en_attente'));
    const tentatives = sql`${envois.tentatives} + 1`;
    const derniereErreur = `${resultat.classe}: ${resultat.message}`;

    if (resultat.classe === 'permanent') {
      await this.db
        .update(envois)
        .set({ statut: 'echec', tentatives, derniereErreur })
        .where(enAttente);
      // La Destination a répondu : la série d'échecs transient est rompue.
      await this.remettreAZero(envoi.destinationId);
      return 'echec';
    }
    const { classe, message } = resultat;

    const { issue, suspension } = await this.db.transaction(async (tx) => {
      // L'UPDATE verrouille la Destination jusqu'au commit : les échecs concurrents
      // se comptent l'un après l'autre et une réactivation attend la retenue.
      const [destination] = await tx
        .update(destinations)
        .set({
          echecsConsecutifs:
            classe === 'transient'
              ? sql`${destinations.echecsConsecutifs} + 1`
              : sql`${destinations.echecsConsecutifs}`,
        })
        .where(eq(destinations.id, envoi.destinationId))
        .returning({ etat: destinations.etat, echecsConsecutifs: destinations.echecsConsecutifs });
      const doitSuspendre =
        destination?.etat === 'active' &&
        (classe === 'auth' || destination.echecsConsecutifs >= this.politique.seuilEchecs);
      const suspension = doitSuspendre
        ? await this.suspendre(tx, envoi.destinationId, classe, message)
        : null;

      const issue: IssueEchec =
        destination?.etat === 'suspendue' || suspension
          ? 'retenu'
          : derniereTentative
            ? 'echec'
            : 'a_retenter';
      await tx
        .update(envois)
        .set({
          tentatives,
          derniereErreur,
          ...(issue === 'a_retenter' ? {} : { statut: issue }),
        })
        .where(enAttente);
      return { issue, suspension };
    });

    if (suspension) await this.notifier(suspension);
    return issue;
  }

  /**
   * Tâche planifiée : sonde chaque Destination Suspendue dont le refroidissement est
   * écoulé et réactive celles qui répondent, puis libère les Envois retenus de toute
   * Destination active (celles qu'elle vient de réactiver, et le filet d'une
   * libération interrompue).
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
          `Destination ${destination.id} toujours injoignable (${sante.classe}: ${sante.message}) : reste Suspendue`,
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

    const aLiberer = await this.db
      .selectDistinct({ id: envois.destinationId })
      .from(envois)
      .innerJoin(destinations, eq(destinations.id, envois.destinationId))
      .where(and(eq(envois.statut, 'retenu'), eq(destinations.etat, 'active')));
    for (const { id } of aLiberer) await this.liberer(id);
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
        motifSuspension: `${classe}: ${message}`,
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
      `Destination ${suspension.destinationId} Suspendue (${suspension.classe}: ${suspension.message})`,
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
   * Les Envois retenus repartent en queue. Repassés en attente avant la mise en queue
   * (un job ne sert qu'un Envoi en attente), puis remis en retenue si elle échoue :
   * le passage suivant de la sonde les reprendra.
   */
  private async liberer(destinationId: string): Promise<void> {
    const liberes = await this.db
      .update(envois)
      .set({ statut: 'en_attente' })
      .where(and(eq(envois.destinationId, destinationId), eq(envois.statut, 'retenu')))
      .returning({ id: envois.id });
    if (liberes.length === 0) return;
    const ids = liberes.map(({ id }) => id);
    try {
      // Pas d'id de job imposé : celui de la première tentative (id de l'Envoi) est
      // déjà pris par un job terminé.
      await this.dispatchQueue.addBulk(
        ids.map((envoiId) => ({ name: 'dispatch', data: { envoiId } })),
      );
    } catch (erreur) {
      await this.db
        .update(envois)
        .set({ statut: 'retenu' })
        .where(and(inArray(envois.id, ids), eq(envois.statut, 'en_attente')));
      throw erreur;
    }
    this.logger.log(`Destination ${destinationId} : ${ids.length} Envoi(s) retenu(s) libéré(s)`);
  }

  private async sante(destination: typeof destinations.$inferSelect): Promise<SanteDestination> {
    try {
      return await this.resolveDestinationAdapter(
        toDestinationConfiguree(destination, this.cipher),
      ).healthCheck();
    } catch (erreur) {
      return {
        joignable: false,
        classe: 'transient',
        message: erreur instanceof Error ? erreur.message : String(erreur),
      };
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
