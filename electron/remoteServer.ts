import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { renderMarkdown } from './markdown';
import type { OpenCodeSessionMonitor } from './opencodeSessions';

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Prompt Pad Sessions</title>
<style>
  :root { --bg: #16181d; --panel: #1e2126; --border: #2b2f36; --text: #e8eaed; --text2: #9aa0a8;
    --accent: #5eead4; --accent-dim: rgba(94, 234, 212, .12); --danger: #ff597d;
    --ok: #8ce99a; --warn: #ffe28a; }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; padding: 14px; }
  .toolbar { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
  .toolbar h1 { font-size: 18px; }
  .toolbar p { color: var(--text2); font-size: 12px; }
  .status { color: var(--text2); font-size: 11px; text-align: right; }
  .error { padding: 10px; color: var(--danger); border: 1px solid var(--danger); border-radius: 8px; margin-bottom: 10px; font-size: 12px; overflow-wrap: anywhere; }
  .empty { text-align: center; padding: 30px 10px; color: var(--text2); }
  .controls { display: flex; gap: 8px; margin-bottom: 12px; }
  .controls input[type=search] { flex: 1; padding: 10px 12px; background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px; font-size: 16px; }
  .sessions { display: flex; flex-direction: column; gap: 12px; }
  .session { border: 1px solid var(--border); border-radius: 10px; background: var(--panel); overflow: hidden; }
  .session-header { padding: 12px 14px; border-bottom: 1px solid var(--border); cursor: pointer; user-select: none; }
  .session-title { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
  .session-title h3 { font-size: 14px; line-height: 1.4; overflow-wrap: anywhere; }
  .session-meta { font-size: 11px; color: var(--text2); margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session-model { color: var(--accent); }
  .status-row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  .status-pill { font-size: 11px; font-weight: 600; padding: 4px 8px; border-radius: 5px; background: var(--border); }
  .status-working { color: var(--accent); background: var(--accent-dim); }
  .status-completed { color: var(--ok); }
  .status-error { color: var(--danger); }
  .status-waiting { color: var(--warn); }
  .status-unknown { color: var(--text2); }
  .chevron { color: var(--text2); font-size: 12px; flex-shrink: 0; transition: transform .15s; }
  .open .chevron { transform: rotate(180deg); }
  .activity { display: none; padding: 12px 14px; }
  .open .activity { display: block; }
  .event { margin-bottom: 12px; }
  .event-label { font-size: 11px; color: var(--accent); font-weight: 600; margin-bottom: 4px; }
  .event p { white-space: pre-wrap; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
  .event-tool { padding: 8px; border-left: 2px solid var(--border); background: var(--bg); border-radius: 4px; }
  .event-tool p { color: var(--text2); }
  .event-text { font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
  .event-text p { margin: 0; }
  .event-text p + p { margin-top: 8px; }
  .event-text h1, .event-text h2, .event-text h3, .event-text h4, .event-text h5, .event-text h6 { margin: 10px 0 6px; font-size: 13px; }
  .event-text h1 { font-size: 15px; }
  .event-text h2 { font-size: 14px; }
  .event-text ul, .event-text ol { margin: 6px 0; padding-left: 22px; }
  .event-text li { margin: 3px 0; }
  .event-text blockquote { margin: 6px 0; padding: 2px 10px; border-left: 3px solid var(--border); color: var(--text2); }
  .event-text hr { border: none; border-top: 1px solid var(--border); margin: 10px 0; }
  .event-text code { font-family: ui-monospace, monospace; font-size: 11px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
  .event-text pre { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 9px 11px; overflow-x: auto; margin: 8px 0; }
  .event-text pre code { padding: 0; border: none; background: transparent; white-space: pre; font-size: 11px; line-height: 1.6; }
  .event-text a { color: var(--accent); text-decoration: underline; }
  .composer { position: sticky; bottom: 0; padding: 10px 0 2px; background: var(--bg); }
  .composer form { display: flex; gap: 8px; }
  .composer input[type=text] { flex: 1; padding: 12px; background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px; font-size: 16px; }
  .composer button { padding: 12px 18px; border: none; border-radius: 8px; background: var(--accent);
    color: #10221d; font-weight: 600; cursor: pointer; font-size: 15px; }
  .composer button:disabled { opacity: .5; cursor: default; }
  .composer-note { font-size: 11px; color: var(--text2); margin-top: 6px; min-height: 14px; }
  .composer-note.error { color: var(--danger); }
  .composer-note.ok { color: var(--ok); }
  .mini-compose { display: flex; gap: 8px; margin-top: 12px; }
  .mini-compose input[type=text] { flex: 1; min-width: 0; padding: 10px 12px; background: var(--bg);
    color: var(--text); border: 1px solid var(--border); border-radius: 8px; font-size: 16px; }
  .mini-compose button { padding: 10px 14px; border: none; border-radius: 8px; background: var(--accent);
    color: #10221d; font-weight: 600; cursor: pointer; font-size: 14px; }
  .mini-compose button:disabled { opacity: .5; cursor: default; }
  .mini-note { font-size: 11px; margin-top: 6px; color: var(--text2); }
  .mini-note.ok { color: var(--ok); }
  .mini-note.error { color: var(--danger); }
</style>
</head>
<body>
<div class="toolbar"><div><h1>▥ Prompt Pad Sessions</h1><p>Read-only monitor · refresh every 5 s</p></div>
<div class="status" id="status"></div></div>
<div class="error" id="error" hidden></div>
<div class="controls"><input type="search" id="search" placeholder="Search sessions…" autocomplete="off"></div>
<div class="sessions" id="sessions"></div>
<div class="empty" id="empty" hidden>No sessions found</div>
<div class="composer" id="composer" hidden>
  <form id="promptForm">
    <input type="text" id="promptInput" placeholder="Message to send to OpenCode (new session)…" autocomplete="off">
    <button type="submit" id="promptSend">Send</button>
  </form>
  <div class="composer-note" id="promptNote"></div>
</div>
<script>
const $ = id => document.getElementById(id);
const KEY = new URLSearchParams(location.search).get('key') || '';
const withKey = path => path + (path.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(KEY);
const state = { sessions: [], open: new Set(JSON.parse(sessionStorage.getItem('pp-open') || '[]')), filter: '',
  notes: {}, sendEnabled: false };
const pill = s => '<span class="status-pill status-' + s + '">' + s + '</span>';
function esc(text) { const d = document.createElement('div'); d.textContent = text == null ? '' : String(text); return d.innerHTML; }
function noteLine(id) {
  const n = state.notes[id];
  if (!n) return '';
  if (Date.now() - n.at > 15000) { delete state.notes[id]; return ''; }
  return '<div class="mini-note ' + n.cls + '">' + esc(n.text) + '</div>';
}
function render() {
  const q = state.filter.toLowerCase();
  const shown = state.sessions.filter(s => (s.title + ' ' + s.directory + ' ' + s.model).toLowerCase().includes(q));
  // Preserve whatever is being typed across the 5-second re-render.
  const typing = new Map();
  let focused = null;
  document.querySelectorAll('form.mini-compose').forEach(f => {
    typing.set(f.getAttribute('data-for'), f.querySelector('input').value);
    if (document.activeElement === f.querySelector('input')) focused = f.getAttribute('data-for');
  });
  $('sessions').innerHTML = shown.map(s => {
    const isOpen = state.open.has(s.id);
    const events = (s.activity || []).map(a =>
      '<div class="event ' + (a.type === 'tool' ? 'event-tool' : '') + '"><div class="event-label">' +
      esc(a.type === 'tool' ? (a.tool || 'tool') : (a.role === 'user' ? 'You' : 'OpenCode')) + '</div>' +
      (a.type === 'text' && a.html ? '<div class="event-text">' + a.html + '</div>' :
        (a.text ? '<p>' + esc(a.text) + '</p>' : '')) + '</div>').join('');
    const composer = state.sendEnabled && s.source === 'opencode' ?
      '<form class="mini-compose" data-for="' + esc(s.id) + '"><input type="text" placeholder="Message this session…" autocomplete="off">' +
      '<button type="submit">Send</button></form>' + noteLine(s.id) : '';
    return '<article class="session' + (isOpen ? ' open' : '') + '" data-id="' + esc(s.id) + '">' +
      '<div class="session-header" onclick="toggle(this.parentElement)"><div class="session-title"><h3>' +
      esc(s.title || s.id) + '</h3><span class="chevron">▼</span></div>' +
      '<div class="session-meta" title="' + esc(s.directory) + '">' + esc(s.directory) + '</div>' +
      '<div class="session-meta session-model">' + esc(s.model || 'no model') + '</div>' +
      '<div class="status-row">' + pill(s.status) +
      '<span class="session-meta">' + new Date(s.updatedAt).toLocaleTimeString() + '</span></div></div>' +
      '<div class="activity">' + (events || '<div class="event"><p>No activity</p></div>') + composer + '</div></article>';
  }).join('');
  // Restore in-progress text and focus.
  document.querySelectorAll('form.mini-compose').forEach(wrap => {
    const id = wrap.getAttribute('data-for');
    const input = wrap.querySelector('input');
    if (typing.has(id)) input.value = typing.get(id);
    if (id === focused) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  });
  $('status').textContent = shown.length + ' session' + (shown.length === 1 ? '' : 's') + ' · updated ' + new Date().toLocaleTimeString();
}
function toggle(el) {
  const id = el.getAttribute('data-id');
  state.open.has(id) ? state.open.delete(id) : state.open.add(id);
  sessionStorage.setItem('pp-open', JSON.stringify([...state.open]));
  el.classList.toggle('open');
}
async function poll() {
  try {
    const res = await fetch(withKey('/api/sessions'));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    state.sessions = data.sessions || [];
    $('error').hidden = true;
    state.sendEnabled = data.sendEnabled !== false;
    $('composer').hidden = !state.sendEnabled;
  } catch (err) {
    $('error').textContent = 'Error fetching sessions: ' + err.message;
    $('error').hidden = false;
  }
  render();
}
$('search').addEventListener('input', e => { state.filter = e.target.value; render(); });
document.addEventListener('submit', async e => {
  const form = e.target.closest('form.mini-compose');
  if (!form) return;
  e.preventDefault();
  const sessionId = form.getAttribute('data-for');
  const input = form.querySelector('input');
  const button = form.querySelector('button');
  const text = input.value.trim();
  if (!text) return;
  button.disabled = true;
  try {
    const res = await fetch(withKey('/api/send'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sessionId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    state.notes[sessionId] = { cls: 'ok', text: 'Sent to ' + (data.title || sessionId), at: Date.now() };
    input.value = '';
    poll();
  } catch (err) {
    state.notes[sessionId] = { cls: 'error', text: 'Send failed: ' + err.message, at: Date.now() };
    render();
  } finally { button.disabled = false; }
});
$('promptForm').addEventListener('submit', async e => {
  e.preventDefault();
  const input = $('promptInput');
  const text = input.value.trim();
  if (!text) return;
  const button = $('promptSend');
  const note = $('promptNote');
  button.disabled = true;
  note.className = 'composer-note';
  note.textContent = 'Sending…';
  try {
    const res = await fetch(withKey('/api/send'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    note.className = 'composer-note ok';
    note.textContent = data.created ? 'Session created: ' + (data.title || data.id) : 'Message sent to session: ' + (data.title || data.id);
    input.value = '';
    poll();
  } catch (err) {
    note.className = 'composer-note error';
    note.textContent = 'Send failed: ' + err.message;
  } finally { button.disabled = false; }
});
poll();
setInterval(poll, 5000);
</script>
</body>
</html>`;

const TOKEN_HEADER = 'x-prompt-pad-key';
const SEND_TIMEOUT_MS = 10_000;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
}

export class RemoteSessionsServer {
  private server: http.Server | null = null;
  // 8 hex chars (4 bytes) keeps the QR URL within version 2-L (32 data bytes).
  private token = crypto.randomBytes(4).toString('hex');
  // Basic-auth credentials for the headless OpenCode server we spawn, persisted
  // so later app runs can authenticate against the still-running server.
  private serveAuthPath: string | null = null;

  constructor(private readonly monitor: OpenCodeSessionMonitor, serveAuthPath?: string) {
    this.serveAuthPath = serveAuthPath ?? null;
  }

  private readServeAuth(): { port: number; username: string; password: string } | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.serveAuthPath!, 'utf8'));
      if (typeof parsed?.password === 'string' && parsed.password && typeof parsed?.port === 'number') {
        return { port: parsed.port, username: typeof parsed.username === 'string' && parsed.username ? parsed.username : 'opencode', password: parsed.password };
      }
    } catch { /* missing or corrupt: fall through */ }
    return null;
  }

  /**
   * OpenCode's own service mode persists its server password in
   * `~/.config/opencode/service.json`; servers already running on this machine
   * use it. Reading it lets us reuse those servers instead of failing with 401.
   */
  private readOpenCodeServiceAuth(): { username: string; password: string } | null {
    try {
      const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
      const candidates = [path.join(configHome, 'opencode', 'service.json'),
        ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'opencode', 'service.json')] : [])];
      for (const file of candidates) {
        try {
          const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (typeof parsed?.password === 'string' && parsed.password) {
            const username = typeof parsed.username === 'string' && parsed.username ? parsed.username : 'opencode';
            return { username, password: parsed.password };
          }
        } catch { /* next candidate */ }
      }
    } catch { /* fall through */ }
    return null;
  }

  private writeServeAuth(auth: { port: number; username: string; password: string } | null): void {
    if (!this.serveAuthPath) return;
    try {
      if (auth) fs.writeFileSync(this.serveAuthPath, JSON.stringify(auth, null, 2));
      else fs.rmSync(this.serveAuthPath, { force: true });
    } catch { /* best effort */ }
  }

  /** The access token to append to the QR/URL. Regenerated on every app start. */
  get accessToken(): string { return this.token; }

  start(port = 4127, host = '0.0.0.0'): Promise<number> {
    if (this.server) return Promise.resolve(port);
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => { void this.handle(req, res); });
      server.on('error', reject);
      server.listen(port, host, () => {
        const address = server.address();
        const actual = typeof address === 'object' && address ? address.port : port;
        this.server = server;
        resolve(actual);
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private authorize(req: http.IncomingMessage): boolean {
    const url = new URL(req.url || '/', 'http://localhost');
    return url.searchParams.get('key') === this.token ||
      req.headers[TOKEN_HEADER] === this.token;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (!this.authorize(req)) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('Unauthorized: append ?key=<token> from the Sessions panel');
        return;
      }
      if (url.pathname === '/api/sessions' && req.method === 'GET') {
        const snapshot = this.monitor.read();
        const body = JSON.stringify({ ...snapshot, sessions: snapshot.sessions.map(s => ({
          id: s.id, title: s.title, directory: s.directory, model: s.model, status: s.status,
          updatedAt: s.updatedAt, createdAt: s.createdAt, source: s.source,
          activity: s.activity.map(a => ({ ...a, html: a.type === 'text' ? renderMarkdown(a.text) : '' })),
        })), sendEnabled: true });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(body);
        return;
      }
      if (url.pathname === '/api/send' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += (chunk as Buffer).length;
          if (size > 64 * 1024) { res.writeHead(413, { 'Content-Type': 'text/plain' }); res.end('Payload too large'); return; }
          chunks.push(chunk as Buffer);
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const text = typeof payload.text === 'string' ? payload.text.trim() : '';
        if (!text) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Empty message' })); return; }
        if (text.length > 20_000) { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Message too long' })); return; }
        // With a sessionId the message continues that live session; otherwise a
        // fresh OpenCode session is created for it.
        const sessionId = typeof payload.sessionId === 'string' && payload.sessionId.length <= 256 ? payload.sessionId.trim() : '';
        const result = sessionId ? await this.sendToSession(sessionId, text) : await this.sendToOpenCode(text);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
        return;
      }
      // Everything else serves the single-page mobile UI.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(INDEX_HTML);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal error: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  /** Send a prompt through the OpenCode HTTP server, creating a fresh session. */
  private async sendToOpenCode(text: string): Promise<{ id: string; title: string; created: boolean }> {
    const base = await this.ensureOpenCodeServer();
    const created = await this.requestOpenCode<{ id?: string; title?: string }>(base, 'POST', '/session', { title: 'Prompt Pad (mobile)' });
    const sessionId = created?.id;
    if (!sessionId) throw new Error('OpenCode did not return a session id');
    await this.requestOpenCode(base, 'POST', `/session/${sessionId}/prompt_async`, {
      parts: [{ type: 'text', text }],
    });
    return { id: sessionId, title: created.title || 'Prompt Pad (mobile)', created: true };
  }

  /** Send a prompt into an already-running OpenCode session (fire and forget). */
  private async sendToSession(sessionId: string, text: string): Promise<{ id: string; title: string; created: boolean }> {
    const base = await this.ensureOpenCodeServer();
    await this.requestOpenCode(base, 'POST', `/session/${encodeURIComponent(sessionId)}/prompt_async`, {
      parts: [{ type: 'text', text }],
    });
    const live = this.monitor.read().sessions.find(s => s.id === sessionId);
    return { id: sessionId, title: live?.title || sessionId, created: false };
  }

  /** Entry point for the desktop board IPC; same flow as the mobile mini-composer. */
  async sendToSessionForIpc(sessionId: string, text: string): Promise<{ id: string; title: string; created: boolean }> {
    return this.sendToSession(sessionId, text);
  }

  /** Find or spawn `opencode serve` on a known port, polling the port until it answers. */
  private async ensureOpenCodeServer(): Promise<string> {
    const persisted = this.readServeAuth();
    for (const port of [4096, 4097]) {
      const base = `http://127.0.0.1:${port}`;
      const existing = await this.pingOpenCode(base);
      if (existing) return base;
      // A server that answers 401 requires basic auth: try ours (from a previous
      // run) first, then OpenCode's own persisted service password.
      if (persisted && persisted.port === port && await this.pingOpenCode(base, persisted)) {
        this.activeServeAuth = persisted;
        return base;
      }
      const serviceAuth = this.readOpenCodeServiceAuth();
      if (await this.pingOpenCode(base, serviceAuth)) {
        this.activeServeAuth = serviceAuth;
        return base;
      }
    }
    // No server running: spawn one headless in the background, protected with
    // basic auth. Port 0 lets the OS assign a free one (4097 may be taken); the
    // real port is read from the server's own "listening on" banner.
    const { spawn } = await import('child_process');
    const password = crypto.randomBytes(16).toString('hex');
    const auth = { username: 'opencode', password };
    const child = spawn('opencode', ['serve', '--port', '0', '--hostname', '127.0.0.1'], {
      detached: true, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
      shell: process.platform === 'win32',
      env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
    });
    let serveLog = '';
    child.stdout?.on('data', (chunk: Buffer) => { serveLog += chunk.toString(); });
    child.unref();
    // Cold boot (plugins, LSP) can take well over 20 s; wait up to a minute.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const match = serveLog.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        this.activeServeAuth = auth;
        this.writeServeAuth({ port: Number(match[1]), username: auth.username, password });
        return `http://127.0.0.1:${match[1]}`;
      }
      await new Promise(r => setTimeout(r, 400));
    }
    throw new Error('OpenCode server did not start (is opencode on PATH?)');
  }

  private activeServeAuth: { username: string; password: string } | null = null;

  private async pingOpenCode(base: string, auth?: { username: string; password: string } | null): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${base}/session`, {
        signal: controller.signal,
        ...(auth ? { headers: { Authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}` } } : {}),
      });
      clearTimeout(timer);
      return res.ok;
    } catch { return false; }
  }

  private async requestOpenCode<T>(base: string, method: string, apiPath: string, body: unknown): Promise<T> {
    const auth = this.activeServeAuth;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch(base + apiPath, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(auth ? { Authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`OpenCode API ${res.status}: ${await res.text().catch(() => '')}`);
      return res.status === 204 ? ({} as T) : (await res.json()) as T;
    } finally { clearTimeout(timer); }
  }
}

/** Render a QR code as inline SVG via the `qrcode` package (no external assets). */
export async function qrSvg(text: string, size = 148): Promise<string> {
  const QRCode = (await import('qrcode')).default;
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'L',
    margin: 2,
    width: size,
  });
}
