import { createHash, createHmac } from 'node:crypto';
import { verifierCle, type StockageCaptures } from './port.js';

/** Un service S3-compatible (AWS S3, MinIO, Garage, R2…). */
export interface ConfigS3 {
  /** Point d'appel du service : `https://s3.eu-west-3.amazonaws.com`, `http://minio:9000`… */
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Préfixe des clés dans le bucket (`''` : à la racine). */
  readonly prefixe: string;
  /**
   * `true` : `<endpoint>/<bucket>/<clé>` (MinIO, Garage et la plupart des services
   * auto-hébergés) ; `false` : `<bucket>.<hôte>/<clé>` (AWS).
   */
  readonly styleChemin: boolean;
}

export interface OptionsS3 {
  readonly fetch?: typeof globalThis.fetch;
  /** Horloge de la signature (tests). */
  readonly maintenant?: () => Date;
  /** Délai de réponse du service, au-delà duquel l'appel échoue. */
  readonly delaiMs?: number;
}

const DELAI_PAR_DEFAUT_MS = 15_000;

/**
 * Captures dans un bucket S3-compatible, par l'API REST signée en Signature V4
 * (en-tête `Authorization`, corps haché dans `x-amz-content-sha256`). Une réponse
 * hors 2xx lève, avec le code d'erreur S3 ; les redirections ne sont pas suivies.
 */
export function stockageS3(config: ConfigS3, options: OptionsS3 = {}): StockageCaptures {
  const fetch = options.fetch ?? globalThis.fetch;
  const maintenant = options.maintenant ?? (() => new Date());
  const delaiMs = options.delaiMs ?? DELAI_PAR_DEFAUT_MS;
  const prefixe = config.prefixe.replace(/^\/+|\/+$/g, '');
  const base = new URL(config.endpoint);
  const identifiants = { ...config, service: 's3' };

  function urlObjet(cle: string): URL {
    const chemin = [...(prefixe ? [prefixe] : []), verifierCle(cle)].join('/');
    const url = new URL(base);
    const racine = base.pathname.replace(/\/+$/, '');
    if (config.styleChemin) {
      url.pathname = `${racine}/${encodeURIComponent(config.bucket)}/${chemin}`;
    } else {
      url.hostname = `${config.bucket}.${base.hostname}`;
      url.pathname = `${racine}/${chemin}`;
    }
    return url;
  }

  async function appeler(
    methode: 'PUT' | 'GET' | 'DELETE',
    cle: string,
    corps?: { contenu: Uint8Array; contentType: string },
  ): Promise<Response> {
    const url = urlObjet(cle);
    const date = maintenant();
    const empreinteCorps = sha256Hex(corps?.contenu ?? new Uint8Array());
    const enTetes: Record<string, string> = {
      ...(corps ? { 'content-type': corps.contentType } : {}),
      'x-amz-content-sha256': empreinteCorps,
      'x-amz-date': horodatageAmz(date),
    };
    enTetes.authorization = signerV4({ methode, url, enTetes, empreinteCorps }, identifiants, date);
    return fetch(url, {
      method: methode,
      headers: enTetes,
      redirect: 'manual',
      signal: AbortSignal.timeout(delaiMs),
      ...(corps ? { body: corps.contenu } : {}),
    });
  }

  async function echec(methode: string, cle: string, reponse: Response): Promise<Error> {
    const corps = await reponse.text().catch(() => '');
    const code = /<Code>([^<]{1,100})<\/Code>/.exec(corps)?.[1];
    return new Error(`S3 ${methode} ${cle} : HTTP ${reponse.status}${code ? ` ${code}` : ''}`);
  }

  return {
    async enregistrer(cle, contenu, contentType) {
      const reponse = await appeler('PUT', cle, { contenu, contentType });
      if (!reponse.ok) throw await echec('PUT', cle, reponse);
      await reponse.body?.cancel();
    },
    async lire(cle) {
      const reponse = await appeler('GET', cle);
      if (reponse.status === 404) {
        await reponse.body?.cancel();
        return null;
      }
      if (!reponse.ok) throw await echec('GET', cle, reponse);
      return new Uint8Array(await reponse.arrayBuffer());
    },
    async supprimer(cle) {
      const reponse = await appeler('DELETE', cle);
      if (!reponse.ok && reponse.status !== 404) throw await echec('DELETE', cle, reponse);
      await reponse.body?.cancel();
    },
  };
}

export interface RequeteASigner {
  readonly methode: string;
  readonly url: URL;
  /** En-têtes signés, hors `host` (déduit de l'URL) : noms insensibles à la casse. */
  readonly enTetes: Readonly<Record<string, string>>;
  /** SHA-256 hexadécimal du corps. */
  readonly empreinteCorps: string;
}

export interface Identifiants {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
  readonly service: string;
}

/**
 * La valeur de l'en-tête `Authorization` d'une requête signée en Signature V4
 * (https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html).
 * Le chemin est pris tel quel (S3 ne le normalise pas) ; la requête n'a pas de query.
 */
export function signerV4(requete: RequeteASigner, identifiants: Identifiants, date: Date): string {
  const enTetes = new Map<string, string>([['host', requete.url.host]]);
  for (const [nom, valeur] of Object.entries(requete.enTetes)) {
    enTetes.set(nom.toLowerCase(), valeur.trim().replace(/\s+/g, ' '));
  }
  const noms = [...enTetes.keys()].sort();
  const signes = noms.join(';');
  const requeteCanonique = [
    requete.methode,
    requete.url.pathname || '/',
    requete.url.search.replace(/^\?/, ''),
    ...noms.map((nom) => `${nom}:${enTetes.get(nom)}`),
    '',
    signes,
    requete.empreinteCorps,
  ].join('\n');
  const horodatage = horodatageAmz(date);
  const jour = horodatage.slice(0, 8);
  const portee = `${jour}/${identifiants.region}/${identifiants.service}/aws4_request`;
  const aSigner = [
    'AWS4-HMAC-SHA256',
    horodatage,
    portee,
    sha256Hex(Buffer.from(requeteCanonique, 'utf8')),
  ].join('\n');
  const cle = [jour, identifiants.region, identifiants.service, 'aws4_request'].reduce<
    Buffer | string
  >((cle, morceau) => hmac(cle, morceau), `AWS4${identifiants.secretAccessKey}`);
  const signature = createHmac('sha256', cle).update(aSigner, 'utf8').digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${identifiants.accessKeyId}/${portee}, SignedHeaders=${signes}, Signature=${signature}`;
}

const hmac = (cle: Buffer | string, donnee: string): Buffer =>
  createHmac('sha256', cle).update(donnee, 'utf8').digest();

const sha256Hex = (contenu: Uint8Array): string =>
  createHash('sha256').update(contenu).digest('hex');

/** `20261024T083000Z` : l'horodatage ISO 8601 basique de la Signature V4. */
const horodatageAmz = (date: Date): string =>
  date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
