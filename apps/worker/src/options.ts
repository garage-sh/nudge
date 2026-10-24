import type { LogLevel } from '@nestjs/common';
import type { DestinationAdapterResolver, RetryPolicy, SeuilsTriage } from '@nudge/core';
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
  /** Balayage des Retours restés Reçu (D18) ; 5 min de délai, toutes les minutes, à défaut. */
  readonly balayage?: OptionsBalayage;
  readonly logger?: false | LogLevel[];
}

export interface OptionsBalayage {
  /** Âge au-delà duquel un Retour encore Reçu est remis au Triage. */
  readonly delaiMs: number;
  /** Période du balayage. */
  readonly intervalleMs: number;
}

export const BALAYAGE_PAR_DEFAUT: OptionsBalayage = { delaiMs: 5 * 60_000, intervalleMs: 60_000 };
