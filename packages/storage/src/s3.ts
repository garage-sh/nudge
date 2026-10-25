import { createHash, createHmac } from 'node:crypto';
import { checkKey, type CaptureStorage } from './port.js';

/** An S3-compatible service (AWS S3, MinIO, Garage, R2…). */
export interface S3Config {
  /** The service endpoint: `https://s3.eu-west-3.amazonaws.com`, `http://minio:9000`… */
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Key prefix in the bucket (`''`: at the root). */
  readonly prefix: string;
  /**
   * `true`: `<endpoint>/<bucket>/<key>` (MinIO, Garage and most self-hosted
   * services); `false`: `<bucket>.<host>/<key>` (AWS).
   */
  readonly forcePathStyle: boolean;
}

export interface S3Options {
  readonly fetch?: typeof globalThis.fetch;
  /** Signing clock (tests). */
  readonly now?: () => Date;
  /** Service response timeout, beyond which the call fails. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Captures in an S3-compatible bucket, through the REST API signed with Signature V4
 * (`Authorization` header, body hashed in `x-amz-content-sha256`). A non-2xx response
 * throws, with the S3 error code; redirects are not followed.
 */
export function s3Storage(config: S3Config, options: S3Options = {}): CaptureStorage {
  const fetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const prefix = config.prefix.replace(/^\/+|\/+$/g, '');
  const base = new URL(config.endpoint);
  const credentials = { ...config, service: 's3' };

  function objectUrl(key: string): URL {
    const path = [...(prefix ? [prefix] : []), checkKey(key)].join('/');
    const url = new URL(base);
    const root = base.pathname.replace(/\/+$/, '');
    if (config.forcePathStyle) {
      url.pathname = `${root}/${encodeURIComponent(config.bucket)}/${path}`;
    } else {
      url.hostname = `${config.bucket}.${base.hostname}`;
      url.pathname = `${root}/${path}`;
    }
    return url;
  }

  async function call(
    method: 'PUT' | 'GET' | 'DELETE',
    key: string,
    body?: { content: Uint8Array; contentType: string },
  ): Promise<Response> {
    const url = objectUrl(key);
    const date = now();
    const bodyHash = sha256Hex(body?.content ?? new Uint8Array());
    const headers: Record<string, string> = {
      ...(body ? { 'content-type': body.contentType } : {}),
      'x-amz-content-sha256': bodyHash,
      'x-amz-date': amzTimestamp(date),
    };
    headers.authorization = signV4({ method, url, headers, bodyHash }, credentials, date);
    return fetch(url, {
      method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      ...(body ? { body: body.content } : {}),
    });
  }

  async function failure(method: string, key: string, response: Response): Promise<Error> {
    const body = await response.text().catch(() => '');
    const code = /<Code>([^<]{1,100})<\/Code>/.exec(body)?.[1];
    return new Error(`S3 ${method} ${key}: HTTP ${response.status}${code ? ` ${code}` : ''}`);
  }

  return {
    async save(key, content, contentType) {
      const response = await call('PUT', key, { content, contentType });
      if (!response.ok) throw await failure('PUT', key, response);
      await response.body?.cancel();
    },
    async read(key) {
      const response = await call('GET', key);
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) throw await failure('GET', key, response);
      return new Uint8Array(await response.arrayBuffer());
    },
    async delete(key) {
      const response = await call('DELETE', key);
      if (!response.ok && response.status !== 404) throw await failure('DELETE', key, response);
      await response.body?.cancel();
    },
  };
}

export interface RequestToSign {
  readonly method: string;
  readonly url: URL;
  /** Signed headers, except `host` (derived from the URL): case-insensitive names. */
  readonly headers: Readonly<Record<string, string>>;
  /** Hex SHA-256 of the body. */
  readonly bodyHash: string;
}

export interface Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
  readonly service: string;
}

/**
 * The `Authorization` header value of a request signed with Signature V4
 * (https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html).
 * The path is taken as is (S3 does not normalize it); the request has no query.
 */
export function signV4(request: RequestToSign, credentials: Credentials, date: Date): string {
  const headers = new Map<string, string>([['host', request.url.host]]);
  for (const [name, value] of Object.entries(request.headers)) {
    headers.set(name.toLowerCase(), value.trim().replace(/\s+/g, ' '));
  }
  const names = [...headers.keys()].sort();
  const signed = names.join(';');
  const canonicalRequest = [
    request.method,
    request.url.pathname || '/',
    request.url.search.replace(/^\?/, ''),
    ...names.map((name) => `${name}:${headers.get(name)}`),
    '',
    signed,
    request.bodyHash,
  ].join('\n');
  const timestamp = amzTimestamp(date);
  const day = timestamp.slice(0, 8);
  const scope = `${day}/${credentials.region}/${credentials.service}/aws4_request`;
  const toSign = [
    'AWS4-HMAC-SHA256',
    timestamp,
    scope,
    sha256Hex(Buffer.from(canonicalRequest, 'utf8')),
  ].join('\n');
  const key = [day, credentials.region, credentials.service, 'aws4_request'].reduce<
    Buffer | string
  >((key, part) => hmac(key, part), `AWS4${credentials.secretAccessKey}`);
  const signature = createHmac('sha256', key).update(toSign, 'utf8').digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
}

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data, 'utf8').digest();

const sha256Hex = (content: Uint8Array): string =>
  createHash('sha256').update(content).digest('hex');

/** `20261024T083000Z`: the basic ISO 8601 timestamp of Signature V4. */
const amzTimestamp = (date: Date): string =>
  date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
