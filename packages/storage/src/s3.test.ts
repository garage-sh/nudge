import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signV4, s3Storage, type S3Config } from './s3.js';

/**
 * Vectors from AWS's Signature V4 test suite, as botocore ships them
 * (github.com/boto/botocore, tests/unit/auth/aws4_testsuite, read on 2026-10-24):
 * key AKIDEXAMPLE, region us-east-1, service "service".
 */
const AWS_SUITE = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 'service',
} as const;
const SUITE_DATE = new Date('2015-08-30T12:36:00Z');
const sha256 = (content: string | Uint8Array) => createHash('sha256').update(content).digest('hex');

describe('Signature V4 (AWS suite vectors)', () => {
  it('get-vanilla', () => {
    const authorization = signV4(
      {
        method: 'GET',
        url: new URL('https://example.amazonaws.com/'),
        headers: { 'X-Amz-Date': '20150830T123600Z' },
        bodyHash: sha256(''),
      },
      AWS_SUITE,
      SUITE_DATE,
    );

    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it('post-x-www-form-urlencoded', () => {
    const authorization = signV4(
      {
        method: 'POST',
        url: new URL('https://example.amazonaws.com/'),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Amz-Date': '20150830T123600Z',
        },
        bodyHash: sha256('Param1=value1'),
      },
      AWS_SUITE,
      SUITE_DATE,
    );

    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a',
    );
  });
});

interface SeenRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: Uint8Array | null;
}

/** A fake S3 service: it records each request and returns the given responses, in order. */
function s3Service(...responses: (Response | Error)[]) {
  const requests: SeenRequest[] = [];
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    requests.push({
      url: String(url),
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: init.body ? new Uint8Array(init.body as Uint8Array) : null,
    });
    const response = responses.shift() ?? new Response(null, { status: 200 });
    if (response instanceof Error) throw response;
    return response;
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const CONFIG: S3Config = {
  endpoint: 'https://s3.example.test',
  region: 'eu-west-3',
  bucket: 'nudge-captures',
  accessKeyId: 'AKFAKEKEY',
  secretAccessKey: 'fake-secret',
  prefix: 'instance-1',
  forcePathStyle: true,
};
const NOW = () => new Date('2026-10-24T08:30:00Z');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 42]);

const s3Error = (status: number, code: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code></Error>`, {
    status,
    headers: { 'content-type': 'application/xml' },
  });

describe('S3-compatible Capture storage', () => {
  it('saves with a signed PUT, path-style, under the prefix', async () => {
    const s3 = s3Service();

    await s3Storage(CONFIG, { fetch: s3.fetch, now: NOW }).save(
      'feedbacks/8f1c.png',
      PNG,
      'image/png',
    );

    const [put] = s3.requests;
    expect(put).toMatchObject({
      url: 'https://s3.example.test/nudge-captures/instance-1/feedbacks/8f1c.png',
      method: 'PUT',
      body: PNG,
    });
    expect(put!.headers.get('content-type')).toBe('image/png');
    expect(put!.headers.get('x-amz-date')).toBe('20261024T083000Z');
    expect(put!.headers.get('x-amz-content-sha256')).toBe(sha256(PNG));
    expect(put!.headers.get('authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKFAKEKEY\/20261024\/eu-west-3\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it('addresses the bucket as a subdomain without path style', async () => {
    const s3 = s3Service();

    await s3Storage(
      {
        ...CONFIG,
        endpoint: 'https://s3.eu-west-3.amazonaws.com',
        forcePathStyle: false,
        prefix: '',
      },
      { fetch: s3.fetch, now: NOW },
    ).save('8f1c.png', PNG, 'image/png');

    expect(s3.requests[0]!.url).toBe('https://nudge-captures.s3.eu-west-3.amazonaws.com/8f1c.png');
  });

  it('reads a Capture back, and returns null for a missing key (404)', async () => {
    const s3 = s3Service(new Response(PNG, { status: 200 }), s3Error(404, 'NoSuchKey'));
    const storage = s3Storage(CONFIG, { fetch: s3.fetch, now: NOW });

    expect(await storage.read('feedbacks/8f1c.png')).toEqual(PNG);
    expect(await storage.read('feedbacks/missing.png')).toBeNull();
    expect(s3.requests.map((request) => request.method)).toEqual(['GET', 'GET']);
    expect(s3.requests[0]!.headers.get('x-amz-content-sha256')).toBe(sha256(''));
  });

  it('deletes with a DELETE, without throwing if the key no longer exists', async () => {
    const s3 = s3Service(new Response(null, { status: 204 }), s3Error(404, 'NoSuchKey'));
    const storage = s3Storage(CONFIG, { fetch: s3.fetch, now: NOW });

    await storage.delete('feedbacks/8f1c.png');
    await storage.delete('feedbacks/8f1c.png');

    expect(s3.requests.map((request) => [request.method, request.url])).toEqual([
      ['DELETE', 'https://s3.example.test/nudge-captures/instance-1/feedbacks/8f1c.png'],
      ['DELETE', 'https://s3.example.test/nudge-captures/instance-1/feedbacks/8f1c.png'],
    ]);
  });

  it('throws with the S3 code when the service refuses', async () => {
    const s3 = s3Service(s3Error(403, 'SignatureDoesNotMatch'));

    await expect(
      s3Storage(CONFIG, { fetch: s3.fetch, now: NOW }).save('a.png', PNG, 'image/png'),
    ).rejects.toThrow('S3 PUT a.png: HTTP 403 SignatureDoesNotMatch');
  });

  it('throws on a redirect, without following it', async () => {
    const s3 = s3Service(
      new Response(null, { status: 307, headers: { location: 'https://elsewhere.test/' } }),
    );

    await expect(s3Storage(CONFIG, { fetch: s3.fetch, now: NOW }).read('a.png')).rejects.toThrow(
      /HTTP 307/,
    );
    expect(s3.requests).toHaveLength(1);
  });

  it('throws when the service is unreachable', async () => {
    const s3 = s3Service(new TypeError('fetch failed'));

    await expect(s3Storage(CONFIG, { fetch: s3.fetch, now: NOW }).read('a.png')).rejects.toThrow(
      'fetch failed',
    );
  });

  it('lists the objects under the prefix, page after page, with a signed ListObjectsV2', async () => {
    const page = (contents: string, next: string | null) =>
      new Response(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>nudge-captures</Name>${contents}<IsTruncated>${next ? 'true' : 'false'}</IsTruncated>${next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ''}</ListBucketResult>`,
        { status: 200, headers: { 'content-type': 'application/xml' } },
      );
    const object = (key: string, at: string) =>
      `<Contents><Key>${key}</Key><LastModified>${at}</LastModified><Size>9</Size></Contents>`;
    const s3 = s3Service(
      page(
        object('instance-1/feedbacks/a.png', '2026-10-24T08:00:00.000Z') +
          // Not a key nudge could have written: never listed, so never swept.
          object('instance-1/feedbacks/../x.png', '2026-10-24T08:00:00.000Z'),
        'token+/=&1',
      ),
      page(object('instance-1/feedbacks/b.webp', '2026-10-24T08:10:00.000Z'), null),
    );

    const listed = [];
    for await (const stored of s3Storage(CONFIG, { fetch: s3.fetch, now: NOW }).list(
      'feedbacks/',
    )) {
      listed.push(stored);
    }

    expect(listed).toEqual([
      { key: 'feedbacks/a.png', modifiedAt: new Date('2026-10-24T08:00:00.000Z') },
      { key: 'feedbacks/b.webp', modifiedAt: new Date('2026-10-24T08:10:00.000Z') },
    ]);
    expect(s3.requests.map((request) => [request.method, request.url])).toEqual([
      [
        'GET',
        'https://s3.example.test/nudge-captures/?list-type=2&prefix=instance-1%2Ffeedbacks%2F',
      ],
      [
        'GET',
        'https://s3.example.test/nudge-captures/?continuation-token=token%2B%2F%3D%261&list-type=2&prefix=instance-1%2Ffeedbacks%2F',
      ],
    ]);
    expect(s3.requests[0]!.headers.get('authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKFAKEKEY\/20261024\/eu-west-3\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it('throws when listing is refused', async () => {
    const s3 = s3Service(s3Error(403, 'AccessDenied'));

    const listing = s3Storage(CONFIG, { fetch: s3.fetch, now: NOW }).list('feedbacks/');
    await expect(listing[Symbol.asyncIterator]().next()).rejects.toThrow(
      'S3 LIST feedbacks/: HTTP 403 AccessDenied',
    );
  });

  it('rejects a key that would escape the prefix', async () => {
    const s3 = s3Service();

    await expect(
      s3Storage(CONFIG, { fetch: s3.fetch }).read('../other-instance/a.png'),
    ).rejects.toThrow(/key/i);
    expect(s3.requests).toEqual([]);
  });
});
