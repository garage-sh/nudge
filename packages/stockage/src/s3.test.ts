import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signerV4, stockageS3, type ConfigS3 } from './s3.js';

/**
 * Vecteurs de la suite de tests Signature V4 d'AWS, tels que botocore les embarque
 * (github.com/boto/botocore, tests/unit/auth/aws4_testsuite, lus le 2026-10-24) :
 * clé AKIDEXAMPLE, région us-east-1, service « service ».
 */
const SUITE_AWS = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'service',
} as const;
const DATE_SUITE = new Date('2015-08-30T12:36:00Z');
const sha256 = (contenu: string | Uint8Array) => createHash('sha256').update(contenu).digest('hex');

describe('Signature V4 (vecteurs de la suite AWS)', () => {
  it('get-vanilla', () => {
    const authorization = signerV4(
      {
        methode: 'GET',
        url: new URL('https://example.amazonaws.com/'),
        enTetes: { 'X-Amz-Date': '20150830T123600Z' },
        empreinteCorps: sha256(''),
      },
      SUITE_AWS,
      DATE_SUITE,
    );

    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it('post-x-www-form-urlencoded', () => {
    const authorization = signerV4(
      {
        methode: 'POST',
        url: new URL('https://example.amazonaws.com/'),
        enTetes: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Amz-Date': '20150830T123600Z',
        },
        empreinteCorps: sha256('Param1=value1'),
      },
      SUITE_AWS,
      DATE_SUITE,
    );

    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a',
    );
  });
});

interface RequeteVue {
  readonly url: string;
  readonly methode: string;
  readonly enTetes: Headers;
  readonly corps: Uint8Array | null;
}

/** Un faux service S3 : il note chaque requête et rend les réponses données, dans l'ordre. */
function serviceS3(...reponses: (Response | Error)[]) {
  const requetes: RequeteVue[] = [];
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    requetes.push({
      url: String(url),
      methode: init.method ?? 'GET',
      enTetes: new Headers(init.headers),
      corps: init.body ? new Uint8Array(init.body as Uint8Array) : null,
    });
    const reponse = reponses.shift() ?? new Response(null, { status: 200 });
    if (reponse instanceof Error) throw reponse;
    return reponse;
  }) as typeof globalThis.fetch;
  return { fetch, requetes };
}

const CONFIG: ConfigS3 = {
  endpoint: 'https://s3.exemple.test',
  region: 'eu-west-3',
  bucket: 'nudge-captures',
  accessKeyId: 'AKCLEFACTICE',
  secretAccessKey: 'secret-factice',
  prefixe: 'instance-1',
  styleChemin: true,
};
const MAINTENANT = () => new Date('2026-10-24T08:30:00Z');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 42]);

const erreurS3 = (status: number, code: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code></Error>`, {
    status,
    headers: { 'content-type': 'application/xml' },
  });

describe('Stockage des Captures S3-compatible', () => {
  it('enregistre par un PUT signé, en style chemin, sous le préfixe', async () => {
    const s3 = serviceS3();

    await stockageS3(CONFIG, { fetch: s3.fetch, maintenant: MAINTENANT }).enregistrer(
      'retours/8f1c.png',
      PNG,
      'image/png',
    );

    const [put] = s3.requetes;
    expect(put).toMatchObject({
      url: 'https://s3.exemple.test/nudge-captures/instance-1/retours/8f1c.png',
      methode: 'PUT',
      corps: PNG,
    });
    expect(put!.enTetes.get('content-type')).toBe('image/png');
    expect(put!.enTetes.get('x-amz-date')).toBe('20261024T083000Z');
    expect(put!.enTetes.get('x-amz-content-sha256')).toBe(sha256(PNG));
    expect(put!.enTetes.get('authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKCLEFACTICE\/20261024\/eu-west-3\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it('adresse le bucket en sous-domaine hors style chemin', async () => {
    const s3 = serviceS3();

    await stockageS3(
      {
        ...CONFIG,
        endpoint: 'https://s3.eu-west-3.amazonaws.com',
        styleChemin: false,
        prefixe: '',
      },
      { fetch: s3.fetch, maintenant: MAINTENANT },
    ).enregistrer('8f1c.png', PNG, 'image/png');

    expect(s3.requetes[0]!.url).toBe('https://nudge-captures.s3.eu-west-3.amazonaws.com/8f1c.png');
  });

  it('relit une Capture, et rend null pour une clé absente (404)', async () => {
    const s3 = serviceS3(new Response(PNG, { status: 200 }), erreurS3(404, 'NoSuchKey'));
    const stockage = stockageS3(CONFIG, { fetch: s3.fetch, maintenant: MAINTENANT });

    expect(await stockage.lire('retours/8f1c.png')).toEqual(PNG);
    expect(await stockage.lire('retours/absente.png')).toBeNull();
    expect(s3.requetes.map((requete) => requete.methode)).toEqual(['GET', 'GET']);
    expect(s3.requetes[0]!.enTetes.get('x-amz-content-sha256')).toBe(sha256(''));
  });

  it('supprime par un DELETE, sans lever si la clé n’existe déjà plus', async () => {
    const s3 = serviceS3(new Response(null, { status: 204 }), erreurS3(404, 'NoSuchKey'));
    const stockage = stockageS3(CONFIG, { fetch: s3.fetch, maintenant: MAINTENANT });

    await stockage.supprimer('retours/8f1c.png');
    await stockage.supprimer('retours/8f1c.png');

    expect(s3.requetes.map((requete) => [requete.methode, requete.url])).toEqual([
      ['DELETE', 'https://s3.exemple.test/nudge-captures/instance-1/retours/8f1c.png'],
      ['DELETE', 'https://s3.exemple.test/nudge-captures/instance-1/retours/8f1c.png'],
    ]);
  });

  it('lève avec le code S3 quand le service refuse', async () => {
    const s3 = serviceS3(erreurS3(403, 'SignatureDoesNotMatch'));

    await expect(
      stockageS3(CONFIG, { fetch: s3.fetch, maintenant: MAINTENANT }).enregistrer(
        'a.png',
        PNG,
        'image/png',
      ),
    ).rejects.toThrow('S3 PUT a.png : HTTP 403 SignatureDoesNotMatch');
  });

  it('lève sur une redirection, sans la suivre', async () => {
    const s3 = serviceS3(
      new Response(null, { status: 307, headers: { location: 'https://ailleurs.test/' } }),
    );

    await expect(
      stockageS3(CONFIG, { fetch: s3.fetch, maintenant: MAINTENANT }).lire('a.png'),
    ).rejects.toThrow(/HTTP 307/);
    expect(s3.requetes).toHaveLength(1);
  });

  it('lève quand le service est injoignable', async () => {
    const s3 = serviceS3(new TypeError('fetch failed'));

    await expect(
      stockageS3(CONFIG, { fetch: s3.fetch, maintenant: MAINTENANT }).lire('a.png'),
    ).rejects.toThrow('fetch failed');
  });

  it('refuse une clé qui sortirait du préfixe', async () => {
    const s3 = serviceS3();

    await expect(
      stockageS3(CONFIG, { fetch: s3.fetch }).lire('../autre-instance/a.png'),
    ).rejects.toThrow(/clé/i);
    expect(s3.requetes).toEqual([]);
  });
});
