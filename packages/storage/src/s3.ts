import { createHash, createHmac } from 'node:crypto';
import { checkKey, type CaptureStorage, type StoredObject } from './port.js';

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

  const objectUrl = (key: string): URL =>
    bucketUrl([...(prefix ? [prefix] : []), checkKey(key)].join('/'));

  /** The URL of `path` in the bucket (`''`: the bucket itself). */
  function bucketUrl(path: string): URL {
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
    url: URL,
    body?: { content: Uint8Array; contentType: string },
  ): Promise<Response> {
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

  /** One ListObjectsV2 page of the keys under `keyPrefix`, from `token` (`null`: the first). */
  async function listPage(
    keyPrefix: string,
    token: string | null,
  ): Promise<{ objects: StoredObject[]; next: string | null }> {
    const url = bucketUrl('');
    url.search = canonicalQuery({
      'list-type': '2',
      prefix: `${prefix ? `${prefix}/` : ''}${keyPrefix}`,
      ...(token ? { 'continuation-token': token } : {}),
    });
    const response = await call('GET', url);
    if (!response.ok) throw await failure('LIST', keyPrefix, response);
    const body = await response.text();
    const objects: StoredObject[] = [];
    for (const [, contents = ''] of body.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const fullKey = xmlText(contents, 'Key') ?? '';
      const key = prefix ? fullKey.slice(prefix.length + 1) : fullKey;
      const modifiedAt = new Date(xmlText(contents, 'LastModified') ?? '');
      // An object no Capture key could name is not nudge's: it is never listed.
      if (!isValidKey(key) || Number.isNaN(modifiedAt.getTime())) continue;
      objects.push({ key, modifiedAt });
    }
    const truncated = xmlText(body, 'IsTruncated') === 'true';
    return { objects, next: truncated ? xmlText(body, 'NextContinuationToken') : null };
  }

  return {
    async save(key, content, contentType) {
      const response = await call('PUT', objectUrl(key), { content, contentType });
      if (!response.ok) throw await failure('PUT', key, response);
      await response.body?.cancel();
    },
    async read(key) {
      const response = await call('GET', objectUrl(key));
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) throw await failure('GET', key, response);
      return new Uint8Array(await response.arrayBuffer());
    },
    async delete(key) {
      const response = await call('DELETE', objectUrl(key));
      if (!response.ok && response.status !== 404) throw await failure('DELETE', key, response);
      await response.body?.cancel();
    },
    async *list(keyPrefix) {
      let token: string | null = null;
      do {
        const page = await listPage(keyPrefix, token);
        yield* page.objects;
        token = page.next;
      } while (token);
    },
    // A PUT is atomic: an interrupted write leaves nothing behind.
    removeIncomplete: () => Promise.resolve(0),
  };
}

const isValidKey = (key: string): boolean => {
  try {
    checkKey(key);
    return true;
  } catch {
    return false;
  }
};

const XML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** The text of the first `<tag>` element of `xml`, unescaped; `null` if there is none. */
function xmlText(xml: string, tag: string): string | null {
  const text = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1];
  return text === undefined
    ? null
    : text.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => XML_ENTITIES[entity] ?? '');
}

/** URI encoding of Signature V4: everything but the RFC 3986 unreserved characters. */
const uriEncode = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * A query string in the canonical form of Signature V4 (names sorted, names and values
 * encoded): sent as is, it is also the one signed.
 */
const canonicalQuery = (query: Readonly<Record<string, string>>): string =>
  Object.keys(query)
    .sort()
    .map((name) => `${uriEncode(name)}=${uriEncode(query[name] ?? '')}`)
    .join('&');

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
 * The path is taken as is (S3 does not normalize it), and so is the query: the caller
 * builds it in canonical form (`canonicalQuery`).
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
