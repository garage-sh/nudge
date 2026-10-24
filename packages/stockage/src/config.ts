import { isAbsolute } from 'node:path';
import { stockageDisque } from './disque.js';
import type { StockageCaptures } from './port.js';
import { stockageS3, type ConfigS3, type OptionsS3 } from './s3.js';

/** Le stockage des Captures de l'Instance. */
export type ConfigStockage =
  { readonly type: 'disque'; readonly dossier: string } | ({ readonly type: 's3' } & ConfigS3);

/** Le volume des Captures dans les conteneurs de l'api et du worker. */
export const DOSSIER_CAPTURES_PAR_DEFAUT = '/var/lib/nudge/captures';

/** L'adaptateur du stockage choisi. */
export function createStockage(config: ConfigStockage, options: OptionsS3 = {}): StockageCaptures {
  if (config.type === 'disque') return stockageDisque(config.dossier);
  const { type: _type, ...s3 } = config;
  return stockageS3(s3, options);
}

type Env = Readonly<Record<string, string | undefined>>;

const requise = (env: Env, nom: string): string => {
  const valeur = env[nom]?.trim();
  if (!valeur) throw new Error(`${nom} requise pour le stockage S3 des Captures`);
  return valeur;
};

/**
 * Le stockage des Captures : `NUDGE_CAPTURES_STOCKAGE` = `disque` (défaut, dans
 * `NUDGE_CAPTURES_DOSSIER`, chemin absolu — l'api et le worker ne tournent pas dans
 * le même dossier —, `/var/lib/nudge/captures` à défaut) ou `s3` (`NUDGE_S3_ENDPOINT`,
 * `NUDGE_S3_BUCKET`, `NUDGE_S3_ACCESS_KEY_ID`, `NUDGE_S3_SECRET_ACCESS_KEY`, et
 * facultatives `NUDGE_S3_REGION` (us-east-1), `NUDGE_S3_PREFIXE`,
 * `NUDGE_S3_STYLE_CHEMIN` (`true`)). Une configuration invalide lève, pour échouer
 * au démarrage plutôt qu'à la première Capture. L'api et le worker lisent la même.
 */
export function configStockageDepuisEnv(env: Env): ConfigStockage {
  const type = env.NUDGE_CAPTURES_STOCKAGE?.trim() || 'disque';
  if (type === 'disque') {
    const dossier = env.NUDGE_CAPTURES_DOSSIER?.trim() || DOSSIER_CAPTURES_PAR_DEFAUT;
    if (!isAbsolute(dossier)) {
      throw new Error(`NUDGE_CAPTURES_DOSSIER invalide : « ${dossier} » (chemin absolu attendu)`);
    }
    return { type, dossier };
  }
  if (type !== 's3') {
    throw new Error(`NUDGE_CAPTURES_STOCKAGE invalide : « ${type} » (attendu : disque, s3)`);
  }
  const endpoint = requise(env, 'NUDGE_S3_ENDPOINT');
  if (!/^https?:\/\/[^/]/.test(endpoint) || !URL.canParse(endpoint)) {
    throw new Error(`NUDGE_S3_ENDPOINT invalide : « ${endpoint} » (URL http(s) attendue)`);
  }
  return {
    type,
    endpoint,
    region: env.NUDGE_S3_REGION?.trim() || 'us-east-1',
    bucket: requise(env, 'NUDGE_S3_BUCKET'),
    accessKeyId: requise(env, 'NUDGE_S3_ACCESS_KEY_ID'),
    secretAccessKey: requise(env, 'NUDGE_S3_SECRET_ACCESS_KEY'),
    prefixe: env.NUDGE_S3_PREFIXE?.trim() ?? '',
    styleChemin: env.NUDGE_S3_STYLE_CHEMIN?.trim() !== 'false',
  };
}
