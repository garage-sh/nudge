import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface WebhookRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  /** Raw body, as signed. */
  readonly body: string;
}

/**
 * A webhook receiver over HTTP (free port on 127.0.0.1): it keeps every request
 * it receives and answers 204, or the response set for a path.
 */
export class WebhookReceiver {
  readonly requests: WebhookRequest[] = [];
  private readonly responses = new Map<string, { status: number; body: string }>();

  private readonly server: Server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      const path = request.url ?? '';
      this.requests.push({
        method: request.method ?? '',
        path,
        headers: request.headers,
        body,
      });
      const preset = this.responses.get(path);
      response.writeHead(preset?.status ?? 204);
      response.end(preset?.body);
    });
  });

  private constructor(private port = 0) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  static async start(): Promise<WebhookReceiver> {
    const instance = new WebhookReceiver();
    await new Promise<void>((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
    instance.port = (instance.server.address() as AddressInfo).port;
    return instance;
  }

  /** The next requests on this path get this response. */
  respondWith(path: string, status: number, body = ''): void {
    this.responses.set(path, { status, body });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
