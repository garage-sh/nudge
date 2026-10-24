import {
  booleanEnv,
  ENCRYPTION_KEY_VARIABLE,
  integerEnv,
  optionalEnv,
  requireEnv,
  type Env,
} from '@nudge/core';
import { configStockageFromEnv, type ConfigStockage } from '@nudge/stockage';
import type { ApiOptions } from './api.js';
import { LIMITES_WIDGET_PAR_DEFAUT } from './ingestion/acces-widget.js';

/** Ce que l'environnement fixe de l'api ; `main.ts` y branche les adaptateurs. */
export type ConfigApi = Required<
  Pick<
    ApiOptions,
    | 'databaseUrl'
    | 'redisUrl'
    | 'cleChiffrement'
    | 'sessionCookieSecure'
    | 'trustProxy'
    | 'limitesWidget'
  >
> & { readonly port: number; readonly stockage: ConfigStockage };

/**
 * `NUDGE_TRUST_PROXY` tel qu'Express l'entend : `true`/`false`, un nombre de proxys
 * à traverser depuis la droite de `X-Forwarded-For`, ou des adresses et sous-réseaux
 * de confiance (`loopback, uniquelocal`, `10.0.0.0/8`). Absente : aucun proxy, l'IP
 * vue est celle de la connexion.
 */
function trustProxyFromEnv(env: Env): boolean | number | string {
  const valeur = optionalEnv(env, 'NUDGE_TRUST_PROXY');
  if (valeur === null || valeur === 'false') return false;
  if (valeur === 'true') return true;
  if (/^\d+$/.test(valeur)) return Number(valeur);
  return valeur;
}

/**
 * La configuration de l'api, lue dans l'environnement (voir `.env.example`). Une
 * valeur invalide lève, pour échouer au démarrage plutôt qu'à la première requête.
 */
export function configApiFromEnv(env: Env): ConfigApi {
  const limites = LIMITES_WIDGET_PAR_DEFAUT;
  return {
    port: integerEnv(env, 'NUDGE_API_PORT', 3000, { min: 1, max: 65_535 }),
    databaseUrl: requireEnv(env, 'DATABASE_URL'),
    redisUrl: requireEnv(env, 'REDIS_URL'),
    cleChiffrement: requireEnv(env, ENCRYPTION_KEY_VARIABLE),
    // Le même stockage que celui du worker : un volume partagé, ou un bucket S3.
    stockage: configStockageFromEnv(env),
    sessionCookieSecure: booleanEnv(env, 'NUDGE_COOKIE_SECURE', true),
    trustProxy: trustProxyFromEnv(env),
    limitesWidget: {
      parIp: {
        limit: integerEnv(env, 'NUDGE_WIDGET_LIMITE_IP', limites.parIp.limit, { min: 1 }),
        windowMs: limites.parIp.windowMs,
      },
      parProjet: {
        limit: integerEnv(env, 'NUDGE_WIDGET_LIMITE_PROJET', limites.parProjet.limit, { min: 1 }),
        windowMs: limites.parProjet.windowMs,
      },
    },
  };
}
