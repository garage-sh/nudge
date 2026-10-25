import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Script } from './fake-judge.js';

interface ReceivedQuestion {
  readonly type: 'noul' | 'choice' | 'score';
  readonly criteria?: Record<string, unknown> | unknown[];
}

export interface ReceivedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: {
    readonly model: string;
    readonly state: Record<string, unknown>;
    readonly questions: Record<string, ReceivedQuestion>;
  };
}

/**
 * A fake System One provider over HTTP (free port on 127.0.0.1): it answers in the
 * format shared by TypeSafe and the Decisions APIs, on any URL, from a `Script`
 * (like the `FakeJudge`): Choice and Score return the scripted option / level,
 * Noul the scripted probability. It keeps the requests it receives.
 */
export class FakeDecisionsServer {
  readonly requests: ReceivedRequest[] = [];
  private script: Script = {};

  private readonly server: Server = createServer((request, response) => {
    let text = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (text += chunk));
    request.on('end', () => {
      const body = JSON.parse(text) as ReceivedRequest['body'];
      this.requests.push({
        method: request.method ?? '',
        path: request.url ?? '',
        headers: request.headers,
        body,
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(this.respond(body)));
    });
  });

  private constructor(private port = 0) {}

  /** Base URL of the server (no path). */
  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  static async start(): Promise<FakeDecisionsServer> {
    const instance = new FakeDecisionsServer();
    await new Promise<void>((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
    instance.port = (instance.server.address() as AddressInfo).port;
    return instance;
  }

  respondWith(script: Script): void {
    this.script = script;
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  private respond(body: ReceivedRequest['body']) {
    const answers = Object.fromEntries(
      Object.entries(body.questions).map(([id, question]) => [
        id,
        this.answer(question, this.script[id]),
      ]),
    );
    return { model: body.model, answers, usage: { input_tokens: 100, output_tokens: 4 } };
  }

  private answer(question: ReceivedQuestion, scripted: string | number | undefined) {
    if (question.type === 'noul') return { type: 'noul', noul: Number(scripted ?? 0) };
    if (question.type === 'choice') {
      const options = Object.keys(question.criteria ?? {});
      const choice = typeof scripted === 'string' ? scripted : options[0]!;
      const probabilities = Object.fromEntries(
        options.map((o) => [o, o === choice ? 0.97 : 0.03 / (options.length - 1)]),
      );
      return { type: 'choice', choice, confidence: 0.95, probabilities };
    }
    // Score: the Script names the level by its rank in `criteria` ("0", "1"…).
    const levels = (question.criteria as unknown[]).length;
    const rank = typeof scripted === 'number' ? scripted : 0;
    const probabilities = Object.fromEntries(
      Array.from({ length: levels }, (_, i) => [
        String(i),
        i === rank ? 0.97 : 0.03 / (levels - 1),
      ]),
    );
    return { type: 'score', score: rank, confidence: 0.95, legend: {}, probabilities };
  }
}
