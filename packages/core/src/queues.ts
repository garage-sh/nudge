/**
 * Contrat des queues BullMQ entre l'api et le worker. La queue n'est qu'un
 * transport : l'état d'un Retour ou d'un Envoi se lit toujours en base.
 */

export const QUEUE_TRIAGE = 'triage';
export const QUEUE_DISPATCH = 'dispatch';

/** Identifiant de job = id du Retour : un même Retour n'est mis en queue qu'une fois. */
export interface JobTriage {
  readonly retourId: string;
}

/** Identifiant de job = id de l'Envoi. */
export interface JobDispatch {
  readonly envoiId: string;
}

export const OPTIONS_JOB_PAR_DEFAUT = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 1000, jitter: 0.5 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
} as const;
