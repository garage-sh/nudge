import type { LogLevel } from '@nestjs/common';
import type {
  ClasseEchec,
  DestinationAdapterResolver,
  RetryPolicy,
  SeuilsTriage,
} from '@nudge/core';
import type { ConfigJuge, Juge } from '@nudge/judge';
import type { StockageCaptures } from '@nudge/stockage';

export interface WorkerOptions {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  /** Préfixe des clés BullMQ, identique à celui de l'api. */
  readonly queuePrefix?: string;
  /** Retry des jobs de dispatch ; les tests le raccourcissent. */
  readonly retryPolicy?: RetryPolicy;
  /** Clé d'Instance (`NUDGE_ENCRYPTION_KEY`, 32 octets en base64) : déchiffre la clé du Juge. */
  readonly cleChiffrement: string;
  /**
   * Juge fixe, qui court-circuite celui de l'Instance (tests) ; `null` : mode dégradé.
   * Absent : le Juge choisi pour l'Instance, à défaut `jugeParDefaut`.
   */
  readonly juge?: Juge | null;
  /** Juge des variables `NUDGE_JUDGE_*`, quand l'Instance n'en a pas choisi. */
  readonly jugeParDefaut?: ConfigJuge | null;
  /** Délai au-delà duquel une requête au Juge est abandonnée et retentée (30 s par défaut). */
  readonly delaiJugeMs?: number;
  /** Seuils de la politique de Verdict ; `SEUILS_TRIAGE_PAR_DEFAUT` à défaut. */
  readonly seuilsTriage?: SeuilsTriage;
  readonly resolveDestinationAdapter: DestinationAdapterResolver;
  /** Stockage des Captures (`@nudge/stockage`), le même que celui de l'api. */
  readonly stockageCaptures: StockageCaptures;
  /** URL publique du dashboard (`NUDGE_DASHBOARD_URL`) : lien « voir le Retour » des Envois (D12). */
  readonly dashboardUrl?: string | null;
  /** Balayage des Retours restés Reçu (D18) ; 5 min de délai, toutes les minutes, à défaut. */
  readonly balayage?: OptionsBalayage;
  /** Période de la purge de rétention ; `PURGE_PAR_DEFAUT` à défaut. */
  readonly purge?: OptionsPurge;
  /** Seuil de Suspension, refroidissement et période de la sonde ; `SUSPENSION_PAR_DEFAUT` à défaut. */
  readonly suspension?: OptionsSuspension;
  /**
   * Observateur de chaque passage d'une Destination en Suspendue, appelé par
   * `SUR_SUSPENSION` après la mise en queue de l'alerte des Membres (tests).
   */
  readonly surSuspension?: SurSuspension;
  readonly logger?: false | LogLevel[];
}

/** Délai d'une requête au Juge avant abandon : un dépassement est transitoire, retenté. */
export const DELAI_JUGE_PAR_DEFAUT_MS = 30_000;

export interface OptionsBalayage {
  /** Âge au-delà duquel un Retour encore Reçu est remis au Triage. */
  readonly delaiMs: number;
  /** Période du balayage. */
  readonly intervalleMs: number;
}

export const BALAYAGE_PAR_DEFAUT: OptionsBalayage = { delaiMs: 5 * 60_000, intervalleMs: 60_000 };

export interface OptionsPurge {
  /**
   * Période de la purge des Retours plus anciens que la durée de rétention de
   * l'Instance (relue en base à chaque passage).
   */
  readonly intervalleMs: number;
}

/** Une purge par heure : la durée de rétention se compte en jours. */
export const PURGE_PAR_DEFAUT: OptionsPurge = { intervalleMs: 60 * 60_000 };

export interface OptionsSuspension {
  /** Échecs transient consécutifs au-delà desquels (inclus) la Destination est Suspendue. */
  readonly seuilEchecs: number;
  /** Délai entre la Suspension (ou une sonde sans réponse) et la sonde suivante. */
  readonly refroidissementMs: number;
  /** Période de la tâche qui sonde les Destinations Suspendues dont le refroidissement est écoulé. */
  readonly intervalleSondeMs: number;
}

/** Valeurs reprises d'alliances-pa : 5 échecs, 5 min de refroidissement, sonde chaque minute. */
export const SUSPENSION_PAR_DEFAUT: OptionsSuspension = {
  seuilEchecs: 5,
  refroidissementMs: 5 * 60_000,
  intervalleSondeMs: 60_000,
};

/** Le passage d'une Destination en Suspendue, tel que l'enregistre la base. */
export interface Suspension {
  readonly destinationId: string;
  readonly projetId: string;
  readonly nom: string;
  /** `transient` : seuil d'échecs consécutifs atteint ; `auth` : identifiants refusés. */
  readonly classe: Exclude<ClasseEchec, 'permanent'>;
  readonly message: string;
  readonly suspendueLe: Date;
}

/**
 * Point d'accroche de chaque passage en Suspendue : appelé une fois par transition,
 * après son commit en base (jamais pour une Destination déjà Suspendue). Au plus une
 * fois : un arrêt du worker entre le commit et l'appel le perd, l'état en base reste
 * la référence. Une erreur levée ici est journalisée sans annuler la Suspension.
 */
export type SurSuspension = (suspension: Suspension) => void | Promise<void>;
