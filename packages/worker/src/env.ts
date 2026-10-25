import {
  ENCRYPTION_KEY_VARIABLE,
  httpUrlEnv,
  integerEnv,
  numberEnv,
  requireEnv,
  SEUILS_TRIAGE_PAR_DEFAUT,
  type Env,
} from '@nudge/core';
import { configJugeFromEnv } from '@nudge/judge';
import { configStockageFromEnv, type ConfigStockage } from '@nudge/stockage';
import {
  DELAI_JUGE_PAR_DEFAUT_MS,
  PURGE_PAR_DEFAUT,
  SUSPENSION_PAR_DEFAUT,
  type WorkerOptions,
} from './options.js';

/** Ce que l'environnement fixe du worker ; l'api y branche les adaptateurs (`apps/api/src/main.ts`). */
export type ConfigWorker = Required<
  Pick<
    WorkerOptions,
    | 'databaseUrl'
    | 'redisUrl'
    | 'cleChiffrement'
    | 'jugeParDefaut'
    | 'dashboardUrl'
    | 'seuilsTriage'
    | 'delaiJugeMs'
    | 'suspension'
    | 'purge'
  >
> & { readonly stockage: ConfigStockage };

const bornesProbabilite = { min: 0, max: 1 };
const bornesDuree = { min: 1 };

/**
 * La configuration du worker, lue dans l'environnement (voir `.env.example`). Une
 * valeur invalide lève, pour échouer au démarrage plutôt qu'au premier Triage.
 */
export function configWorkerFromEnv(env: Env): ConfigWorker {
  const seuils = SEUILS_TRIAGE_PAR_DEFAUT;
  const suspension = SUSPENSION_PAR_DEFAUT;
  return {
    databaseUrl: requireEnv(env, 'DATABASE_URL'),
    redisUrl: requireEnv(env, 'REDIS_URL'),
    cleChiffrement: requireEnv(env, ENCRYPTION_KEY_VARIABLE),
    // Repli quand l'Instance n'a pas choisi de Juge dans le dashboard.
    jugeParDefaut: configJugeFromEnv(env),
    // Le même stockage que celui de l'api : un volume partagé, ou un bucket S3.
    stockage: configStockageFromEnv(env),
    dashboardUrl: httpUrlEnv(env, 'NUDGE_DASHBOARD_URL'),
    seuilsTriage: {
      indesirable: numberEnv(
        env,
        'NUDGE_TRIAGE_SEUIL_INDESIRABLE',
        seuils.indesirable,
        bornesProbabilite,
      ),
      manipulation: numberEnv(
        env,
        'NUDGE_TRIAGE_SEUIL_MANIPULATION',
        seuils.manipulation,
        bornesProbabilite,
      ),
      confiance: numberEnv(
        env,
        'NUDGE_TRIAGE_SEUIL_CONFIANCE',
        seuils.confiance,
        bornesProbabilite,
      ),
    },
    delaiJugeMs: integerEnv(env, 'NUDGE_JUDGE_TIMEOUT_MS', DELAI_JUGE_PAR_DEFAUT_MS, bornesDuree),
    suspension: {
      seuilEchecs: integerEnv(env, 'NUDGE_SUSPENSION_SEUIL_ECHECS', suspension.seuilEchecs, {
        min: 1,
      }),
      refroidissementMs: integerEnv(
        env,
        'NUDGE_SUSPENSION_REFROIDISSEMENT_MS',
        suspension.refroidissementMs,
        bornesDuree,
      ),
      intervalleSondeMs: integerEnv(
        env,
        'NUDGE_SUSPENSION_INTERVALLE_SONDE_MS',
        suspension.intervalleSondeMs,
        bornesDuree,
      ),
    },
    purge: {
      intervalleMs: integerEnv(
        env,
        'NUDGE_PURGE_INTERVALLE_MS',
        PURGE_PAR_DEFAUT.intervalleMs,
        bornesDuree,
      ),
    },
  };
}
