import { randomUUID } from 'node:crypto';
import type { ClasseEchec } from '@nudge/shared';

/**
 * Contrat des queues BullMQ entre l'api et le worker. La queue n'est qu'un
 * transport : l'état d'un Retour ou d'un Envoi se lit toujours en base.
 */

export const TRIAGE_QUEUE = 'triage';
export const DISPATCH_QUEUE = 'dispatch';
/** Alertes des Membres, envoyées à la Destination d'alerte de l'Instance (retentées). */
export const ALERTES_QUEUE = 'alertes';
/** Tâches planifiées du worker (jobs répétables) : balayage des Retours restés Reçu… */
export const MAINTENANCE_QUEUE = 'maintenance';
export const BALAYAGE_RECUS_JOB = 'balayage-recus';
/** Balayage des Envois restés en attente sans job de dispatch vivant (D26). */
export const BALAYAGE_ENVOIS_JOB = 'balayage-envois';
/** Sonde des Destinations Suspendues dont le refroidissement est écoulé. */
export const SONDE_SUSPENDUES_JOB = 'sonde-suspendues';
/** Purge des Retours (et de leurs Captures) plus anciens que la durée de rétention. */
export const PURGE_RETENTION_JOB = 'purge-retention';

/** Préfixe des clés BullMQ par défaut ; l'api et le worker doivent partager le même. */
export const DEFAULT_QUEUE_PREFIX = 'nudge';

/** Nom des jobs des queues de Triage et de dispatch (une seule sorte de job chacune). */
export const TRIAGE_JOB = 'triage';
export const DISPATCH_JOB = 'dispatch';

/** Identifiant de job : `idJobTriage` ou `idJobRevue`. */
export interface TriageJob {
  readonly retourId: string;
}

/** Identifiant de job : `idJobDispatch`, puis `idJobRejeu`, `idJobLiberation`, `idJobBalayage`. */
export interface DispatchJob {
  readonly envoiId: string;
}

/** Premier job de Triage d'un Retour (ingestion, balayage D18) : il n'est mis en queue qu'une fois. */
export const idJobTriage = (retourId: string): string => retourId;

/** Un Retour ne redevient Trié par une revue qu'une fois : un job propre à la revue suffit. */
export const idJobRevue = (retourId: string): string => `${retourId}-revue`;

/**
 * Premier job de dispatch d'un Envoi (après le Triage ou un redispatch, D22) : un Envoi
 * n'est créé qu'une fois, son premier job aussi. Les jobs suivants ont un id propre,
 * cet id restant pris par le job terminé de la première tentative.
 */
export const idJobDispatch = (envoiId: string): string => envoiId;

/** Rejeu manuel d'un Envoi (D9) : un job neuf par demande du Membre. */
export const idJobRejeu = (envoiId: string): string => `${envoiId}-rejeu-${randomUUID()}`;

/**
 * Libération d'un Envoi retenu, propre à la retenue en cours : une sonde suivante ne
 * double pas un job encore en attente.
 */
export const idJobLiberation = (envoiId: string, retenuLe: Date | null): string =>
  `${envoiId}-liberation-${retenuLe?.getTime() ?? 0}`;

/**
 * Remise au dispatch par le balayage (D26), propre au passage : un job en échec garde
 * son id, l'Envoi repart avec toutes ses tentatives.
 */
export const idJobBalayage = (envoiId: string, passage: number): string =>
  `${envoiId}-balayage-${passage}`;

/**
 * Un événement à signaler aux Membres. L'alerte est composée à l'envoi, d'après la
 * base ; l'identifiant du job (`idJobAlerte`) la rend unique par événement.
 */
export type AlerteJob =
  | { readonly evenement: 'retour_en_revue'; readonly retourId: string }
  | {
      readonly evenement: 'destination_suspendue';
      readonly destinationId: string;
      readonly classe: Exclude<ClasseEchec, 'permanent'>;
      readonly message: string;
      /** ISO 8601 : distingue deux Suspensions successives de la même Destination. */
      readonly suspendueLe: string;
    };

/** Un job par événement : un Retour ne passe En revue qu'une fois, une Suspension a sa date. */
export function idJobAlerte(job: AlerteJob): string {
  return job.evenement === 'retour_en_revue'
    ? `en-revue-${job.retourId}`
    : `suspension-${job.destinationId}-${Date.parse(job.suspendueLe)}`;
}

/** Politique de retry des jobs : backoff exponentiel avec jitter. */
export interface RetryPolicy {
  readonly attempts: number;
  /** Délai du premier retry ; il double à chaque tentative. */
  readonly backoffDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { attempts: 8, backoffDelayMs: 1000 };

/** Options BullMQ par défaut d'une queue, selon la politique de retry. */
export function jobOptions(policy: RetryPolicy = DEFAULT_RETRY_POLICY) {
  return {
    attempts: policy.attempts,
    backoff: { type: 'exponential', delay: policy.backoffDelayMs, jitter: 0.5 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  } as const;
}
