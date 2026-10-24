import type { LogLevel } from '@nestjs/common';
import type {
  ClasseEchec,
  DestinationAdapterResolver,
  RetryPolicy,
  SeuilsTriage,
} from '@nudge/core';
import type { ConfigJuge, Juge } from '@nudge/judge';

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
  /** URL publique du dashboard (`NUDGE_DASHBOARD_URL`) : lien « voir le Retour » des Envois (D12). */
  readonly dashboardUrl?: string | null;
  /** Balayage des Retours restés Reçu (D18) ; 5 min de délai, toutes les minutes, à défaut. */
  readonly balayage?: OptionsBalayage;
  /** Seuil de Suspension, refroidissement et période de la sonde ; `SUSPENSION_PAR_DEFAUT` à défaut. */
  readonly suspension?: OptionsSuspension;
  /** Observateur de chaque passage d'une Destination en Suspendue (tests). */
  readonly surSuspension?: SurSuspension;
  readonly logger?: false | LogLevel[];
}

export interface OptionsBalayage {
  /** Âge au-delà duquel un Retour encore Reçu est remis au Triage. */
  readonly delaiMs: number;
  /** Période du balayage. */
  readonly intervalleMs: number;
}

export const BALAYAGE_PAR_DEFAUT: OptionsBalayage = { delaiMs: 5 * 60_000, intervalleMs: 60_000 };

export interface OptionsSuspension {
  /** Échecs transient consécutifs au-delà desquels (inclus) la Destination est Suspendue. */
  readonly seuilEchecs: number;
  /** Délai entre la Suspension (ou une sonde sans réponse) et la sonde suivante. */
  readonly refroidissementMs: number;
  /** Période de la tâche qui sonde les Destinations Suspendues dont le refroidissement est écoulé. */
  readonly intervalleSondeMs: number;
}

/** Forme reprise du disjoncteur des connecteurs d'alliances-pa : 5 échecs, 5 min, 1 min. */
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
 * après qu'elle est enregistrée en base (jamais pour une Destination déjà Suspendue).
 * Une erreur levée ici est journalisée sans annuler la Suspension.
 */
export type SurSuspension = (suspension: Suspension) => void | Promise<void>;
