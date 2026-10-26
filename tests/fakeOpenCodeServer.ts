import * as http from 'http';
import { AddressInfo } from 'net';

export interface RecordedRequest {
  method: string;
  path: string;
  body: any;
}

export interface FakeV2Form {
  id: string;
  sessionID: string;
  title: string;
  fields: Array<Record<string, unknown>>;
}

export interface FakeV2Permission {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save?: string[];
}

export interface FakeOpenCodeOptions {
  flavor: 'v1' | 'v2';
  sessionID?: string;
  forms?: FakeV2Form[];
  permissions?: FakeV2Permission[];
  legacyQuestions?: Array<Record<string, unknown>>;
}

export interface FakeOpenCodeServer {
  url: string;
  requests: RecordedRequest[];
  last(method: string, path: string): RecordedRequest | undefined;
  close(): Promise<void>;
}

const createdSessionId = 'ses_created_by_pad';

/**
 * Minimal OpenCode HTTP server used by the Playwright specs. It implements just
 * the endpoints Prompt Pad calls, for both the v2 (/api/...) and v1 APIs, and
 * records every request so tests can assert the exact integration contract.
 */
export async function startFakeOpenCode(options: FakeOpenCodeOptions): Promise<FakeOpenCodeServer> {
  const sessionID = options.sessionID || 'ses_fake';
  const requests: RecordedRequest[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: any = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
    const url = new URL(req.url || '/', 'http://localhost');
    requests.push({ method: req.method || 'GET', path: url.pathname + url.search, body });

    const json = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    const empty = (status = 204) => { res.writeHead(status); res.end(); };

    if (options.flavor === 'v2') {
      if (req.method === 'GET' && url.pathname === '/api/session') return json(200, { data: [] });
      if (req.method === 'POST' && url.pathname === '/api/session') {
        return json(200, { data: { id: createdSessionId } });
      }
      const prompt = url.pathname.match(/^\/api\/session\/([^/]+)\/prompt$/);
      if (req.method === 'POST' && prompt) return json(200, { data: { id: 'msg_test', sessionID: prompt[1] } });
      const permissions = url.pathname.match(/^\/api\/session\/([^/]+)\/permission$/);
      if (req.method === 'GET' && permissions) {
        return json(200, { data: (options.permissions || []).filter(p => p.sessionID === permissions[1]) });
      }
      const forms = url.pathname.match(/^\/api\/session\/([^/]+)\/form$/);
      if (req.method === 'GET' && forms) {
        return json(200, { data: (options.forms || []).filter(f => f.sessionID === forms[1]) });
      }
      if (req.method === 'POST' && /^\/api\/session\/[^/]+\/permission\/[^/]+\/reply$/.test(url.pathname)) return empty();
      if (req.method === 'POST' && /^\/api\/session\/[^/]+\/form\/[^/]+\/reply$/.test(url.pathname)) return empty();
      return json(404, { error: 'not found' });
    }

    if (req.method === 'GET' && url.pathname === '/session') return json(200, []);
    if (req.method === 'POST' && url.pathname === '/session') return json(200, { id: createdSessionId });
    if (req.method === 'POST' && /^\/session\/[^/]+\/prompt_async$/.test(url.pathname)) return json(200, {});
    if (req.method === 'GET' && url.pathname === '/permission') return json(200, options.permissions || []);
    if (req.method === 'GET' && url.pathname === '/question') return json(200, options.legacyQuestions || []);
    if (req.method === 'POST' && /^\/permission\/[^/]+\/reply$/.test(url.pathname)) return empty(200);
    if (req.method === 'POST' && /^\/question\/[^/]+\/reply$/.test(url.pathname)) return empty(200);
    return json(404, { error: 'not found' });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    last(method: string, path: string) {
      return [...requests].reverse().find(request => request.method === method && request.path === path);
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections?.();
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}
