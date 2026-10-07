import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { renderMarkdown } from './markdown';
import type { OpenCodeSessionMonitor } from './opencodeSessions';
import type { OpenCodeInteractions, OpenCodePermissionRequest, OpenCodeQuestionRequest } from './sessionTypes';

// Mobile palette mirrors the desktop themes in src/App.css so the phone follows
// whichever theme is selected in Settings.
const THEME_CSS = `
  :root, [data-theme="dark"] { --bg: #09090b; --panel: #18181b; --border: #27272a; --text: #f4f4f5;
    --text2: #a1a1aa; --accent: #818cf8; --accent-dim: rgba(129,140,248,.15); --accent-t: #fff;
    --danger: #f87171; --ok: #34d399; --warn: #fbbf24; }
  [data-theme="light"] { --bg: #fafafa; --panel: #f4f4f5; --border: #e4e4e7; --text: #18181b;
    --text2: #52525b; --accent: #6366f1; --accent-dim: rgba(99,102,241,.12); --accent-t: #fff;
    --danger: #ef4444; --ok: #059669; --warn: #b45309; }
  [data-theme="gaudy"] { --bg: #140418; --panel: #210a29; --border: rgba(255,196,228,.18); --text: #d8fff6;
    --text2: #ffd0ea; --accent: #ff78c8; --accent-dim: rgba(255,120,200,.14); --accent-t: #2f0d29;
    --danger: #ff597d; --ok: #00ffcc; --warn: #ffe28a; }
  [data-theme="cyberpunk"] { --bg: #060913; --panel: rgba(8,14,25,.94); --border: rgba(80,226,255,.2); --text: #dff8ff;
    --text2: #8cb6c8; --accent: #47e9ff; --accent-dim: rgba(71,233,255,.14); --accent-t: #051018;
    --danger: #ff4d8f; --ok: #5eead4; --warn: #ffe28a; }
`;

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="__THEME__">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Prompt Pad Sessions</title>
<style>
__THEME_CSS__
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
  .event-code { font-family: ui-monospace, monospace; font-size: 11px; line-height: 1.55; white-space: pre-wrap;
    overflow-wrap: anywhere; background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    padding: 8px 10px; margin: 6px 0 0; max-height: 320px; overflow: auto; color: var(--text); }
  .event-output { color: var(--text2); }
  .event-output.error { color: var(--danger); border-color: var(--danger); }
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
  .interactions { padding: 0 14px; }
  .interactions:not(:empty) { padding: 12px 14px; border-bottom: 1px solid var(--border); background: var(--accent-dim); }
  .interaction { margin-bottom: 12px; }
  .interaction:last-child { margin-bottom: 0; }
  .q-header { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--accent); margin-bottom: 4px; }
  .q-text { font-size: 13px; line-height: 1.55; margin-bottom: 8px; overflow-wrap: anywhere; }
  .q-item + .q-item { margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border); }
  .q-options { display: flex; flex-direction: column; gap: 6px; }
  .q-opt { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border: 1px solid var(--border);
    border-radius: 8px; background: var(--panel); font-size: 13px; cursor: pointer; }
  .q-opt input { margin-top: 2px; flex-shrink: 0; }
  .q-opt-label { font-weight: 600; }
  .q-opt-desc { display: block; color: var(--text2); font-size: 11px; margin-top: 2px; }
  .q-custom { width: 100%; margin-top: 8px; padding: 10px 12px; background: var(--panel); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px; font-size: 16px; }
  .interaction-reply { margin-top: 10px; padding: 10px 16px; border: none; border-radius: 8px; background: var(--accent);
    color: var(--accent-t); font-weight: 600; cursor: pointer; font-size: 14px; }
  .interaction-reply:disabled { opacity: .5; cursor: default; }
  .interaction.permission .event-code { color: var(--danger); }
  .perm-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .perm-actions .interaction-reply { margin-top: 0; }
  .perm-actions .interaction-reply[data-reply="reject"] { background: transparent; color: var(--danger); border: 1px solid var(--danger); }
  .perm-actions .interaction-reply[data-reply="always"] { background: var(--panel); color: var(--accent); border: 1px solid var(--accent); }
  .mini-compose { display: flex; gap: 8px; margin-top: 12px; }
  .mini-compose input[type=text] { flex: 1; min-width: 0; padding: 10px 12px; background: var(--bg);
    color: var(--text); border: 1px solid var(--border); border-radius: 8px; font-size: 16px; }
  .mini-compose button { padding: 10px 14px; border: none; border-radius: 8px; background: var(--accent);
    color: var(--accent-t); font-weight: 600; cursor: pointer; font-size: 14px; }
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
<script>
const $ = id => document.getElementById(id);
const KEY = new URLSearchParams(location.search).get('key') || '';
const withKey = path => path + (path.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(KEY);
const state = { sessions: [], open: new Set(JSON.parse(sessionStorage.getItem('pp-open') || '[]')), filter: '',
  notes: {}, sendEnabled: false };
const pill = s => '<span class="status-pill status-' + s + '">' + s + '</span>';
const NL = String.fromCharCode(10);
function esc(text) { const d = document.createElement('div'); d.textContent = text == null ? '' : String(text); return d.innerHTML; }
function noteLine(id) {
  const n = state.notes[id];
  if (!n) return '';
  if (Date.now() - n.at > 15000) { delete state.notes[id]; return ''; }
  return '<div class="mini-note ' + n.cls + '">' + esc(n.text) + '</div>';
}
function questionBlock(q) {
  const items = (q.questions || []).map((info, qi) => {
    const type = info.multiple ? 'checkbox' : 'radio';
    const options = (info.options || []).map(o =>
      '<label class="q-opt"><input type="' + type + '" name="q-' + esc(q.id) + '-' + qi +
        '" data-key="' + esc(q.id + ':' + qi + ':' + o.label) + '" value="' + esc(o.label) + '">' +
      '<span><span class="q-opt-label">' + esc(o.label) + '</span>' +
      (o.description ? '<span class="q-opt-desc">' + esc(o.description) + '</span>' : '') + '</span></label>').join('');
    const custom = info.custom ? '<input type="text" class="q-custom" data-key="' + esc(q.id + ':' + qi + ':custom') +
      '" placeholder="Type your answer…" autocomplete="off">' : '';
    return '<div class="q-item"><div class="q-header">' + esc(info.header || 'Question') + '</div>' +
      '<div class="q-text">' + esc(info.question || '') + '</div>' +
      '<div class="q-options">' + options + '</div>' + custom + '</div>';
  }).join('');
  return '<div class="interaction question" data-kind="question" data-req="' + esc(q.id) + '">' + items +
    '<button type="button" class="interaction-reply" data-kind="question" data-req="' + esc(q.id) + '">Answer</button>' +
    noteLine(q.id) + '</div>';
}
function permissionBlock(p) {
  const detail = [p.permission, (p.patterns || []).join(NL)].filter(Boolean).join(NL);
  return '<div class="interaction permission" data-kind="permission" data-req="' + esc(p.id) + '">' +
    '<div class="q-header">Permission required</div>' +
    '<pre class="event-code">' + esc(detail) + '</pre>' +
    '<div class="perm-actions">' +
    '<button type="button" class="interaction-reply" data-kind="permission" data-req="' + esc(p.id) + '" data-reply="once">Allow once</button>' +
    '<button type="button" class="interaction-reply" data-kind="permission" data-req="' + esc(p.id) + '" data-reply="always">Allow always</button>' +
    '<button type="button" class="interaction-reply" data-kind="permission" data-req="' + esc(p.id) + '" data-reply="reject">Reject</button>' +
    '</div>' + noteLine(p.id) + '</div>';
}
function interactionsHtml(s) {
  return (s.questions || []).map(questionBlock).concat((s.permissions || []).map(permissionBlock)).join('');
}
function render() {
  const q = state.filter.toLowerCase();
  const shown = state.sessions.filter(s => (s.title + ' ' + s.directory + ' ' + s.model).toLowerCase().includes(q));
  // Preserve whatever is being typed/selected across the 5-second re-render.
  const typing = new Map();
  let focused = null;
  document.querySelectorAll('form.mini-compose').forEach(f => {
    typing.set('m:' + f.getAttribute('data-for'), f.querySelector('input').value);
    if (document.activeElement === f.querySelector('input')) focused = 'm:' + f.getAttribute('data-for');
  });
  document.querySelectorAll('.q-custom').forEach(inp => {
    typing.set('k:' + inp.getAttribute('data-key'), inp.value);
    if (document.activeElement === inp) focused = 'k:' + inp.getAttribute('data-key');
  });
  document.querySelectorAll('.interaction input[type=checkbox], .interaction input[type=radio]').forEach(inp => {
    if (inp.checked) typing.set('s:' + inp.getAttribute('data-key'), '1');
  });
  $('sessions').innerHTML = shown.map(s => {
    const isOpen = state.open.has(s.id);
    const events = (s.activity || []).map(a => {
      const label = a.type === 'tool' ? (a.tool || 'tool') : (a.role === 'user' ? 'You' : 'OpenCode');
      let body = '';
      if (a.type === 'text') {
        body = a.html ? '<div class="event-text">' + a.html + '</div>' : (a.text ? '<p>' + esc(a.text) + '</p>' : '');
      } else {
        if (a.text && a.text !== a.input) body += '<p>' + esc(a.text) + '</p>';
        if (a.input) body += '<pre class="event-code">' + esc(a.input) + '</pre>';
        if (a.output) body += '<pre class="event-code event-output' + (a.status === 'error' ? ' error' : '') + '">' + esc(a.output) + '</pre>';
      }
      return '<div class="event ' + (a.type === 'tool' ? 'event-tool' : '') + '"><div class="event-label">' +
        esc(label) + '</div>' + body + '</div>';
    }).join('');
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
      '<div class="interactions">' + interactionsHtml(s) + '</div>' +
      '<div class="activity">' + (events || '<div class="event"><p>No activity</p></div>') + composer + '</div></article>';
  }).join('');
  // Restore in-progress text, selections and focus.
  document.querySelectorAll('form.mini-compose').forEach(wrap => {
    const k = 'm:' + wrap.getAttribute('data-for');
    const input = wrap.querySelector('input');
    if (typing.has(k)) input.value = typing.get(k);
    if (k === focused) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  });
  document.querySelectorAll('.q-custom').forEach(inp => {
    const k = 'k:' + inp.getAttribute('data-key');
    if (typing.has(k)) inp.value = typing.get(k);
    if (k === focused) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  });
  document.querySelectorAll('.interaction input[type=checkbox], .interaction input[type=radio]').forEach(inp => {
    if (typing.get('s:' + inp.getAttribute('data-key')) === '1') inp.checked = true;
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
    if (data.theme) document.documentElement.setAttribute('data-theme', data.theme);
    $('error').hidden = true;
    state.sendEnabled = data.sendEnabled !== false;
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
document.addEventListener('click', async e => {
  const btn = e.target.closest('.interaction-reply');
  if (!btn) return;
  e.preventDefault();
  const kind = btn.getAttribute('data-kind');
  const requestId = btn.getAttribute('data-req');
  const payload = { kind, requestId };
  if (kind === 'permission') {
    payload.reply = btn.getAttribute('data-reply');
  } else {
    const box = btn.closest('.interaction');
    payload.answers = [...box.querySelectorAll('.q-item')].map(item => {
      const picked = [...item.querySelectorAll('input[type=checkbox]:checked, input[type=radio]:checked')].map(i => i.value);
      const custom = item.querySelector('.q-custom');
      if (custom && custom.value.trim()) picked.push(custom.value.trim());
      return picked;
    });
  }
  [...document.querySelectorAll('.interaction-reply[data-req="' + requestId + '"]')].forEach(b => { b.disabled = true; });
  try {
    const res = await fetch(withKey('/api/interaction/reply'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
  } catch (err) {
    state.notes[requestId] = { cls: 'error', text: 'Reply failed: ' + err.message, at: Date.now() };
  }
  poll();
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

/** The mobile page for a given theme; mirrors the selected desktop theme. */
export function renderIndexHtml(theme = 'dark'): string {
  const safe = ['light', 'dark', 'gaudy', 'cyberpunk'].includes(theme) ? theme : 'dark';
  return INDEX_HTML.replace('__THEME__', safe).replace('__THEME_CSS__', THEME_CSS);
}

export class RemoteSessionsServer {
  private server: http.Server | null = null;
  // 8 hex chars (4 bytes) keeps the QR URL within version 2-L (32 data bytes).
  private token = crypto.randomBytes(4).toString('hex');
  // Basic-auth credentials for the headless OpenCode server we spawn, persisted
  // so later app runs can authenticate against the still-running server.
  private serveAuthPath: string | null = null;
  // Theme selected in Settings; the mobile page follows it.
  private theme = 'dark';

  constructor(private readonly monitor: OpenCodeSessionMonitor, serveAuthPath?: string) {
    this.serveAuthPath = serveAuthPath ?? null;
  }

  /** Track the desktop theme so the served mobile page matches it. */
  setTheme(theme: string): void {
    if (typeof theme === 'string' && theme) this.theme = theme;
  }

  get currentTheme(): string { return this.theme; }

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
        const interactions = await this.listInteractions();
        const permissions = new Map<string, typeof interactions.permissions>();
        const questions = new Map<string, typeof interactions.questions>();
        for (const permission of interactions.permissions) {
          permissions.set(permission.sessionID, [...(permissions.get(permission.sessionID) || []), permission]);
        }
        for (const question of interactions.questions) {
          questions.set(question.sessionID, [...(questions.get(question.sessionID) || []), question]);
        }
        const body = JSON.stringify({ ...snapshot, theme: this.theme, sessions: snapshot.sessions.map(s => ({
          id: s.id, title: s.title, directory: s.directory, model: s.model, status: s.status,
          updatedAt: s.updatedAt, createdAt: s.createdAt, source: s.source,
          permissions: permissions.get(s.id) || [], questions: questions.get(s.id) || [],
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
        // A message must target an active session; asking with no session is not
        // allowed, so there is no "create a fresh session" path here.
        const sessionId = typeof payload.sessionId === 'string' && payload.sessionId.length <= 256 ? payload.sessionId.trim() : '';
        if (!sessionId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'An active session is required' })); return; }
        const result = await this.sendToSession(sessionId, text);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
        return;
      }
      if (url.pathname === '/api/interaction/reply' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += (chunk as Buffer).length;
          if (size > 64 * 1024) { res.writeHead(413, { 'Content-Type': 'text/plain' }); res.end('Payload too large'); return; }
          chunks.push(chunk as Buffer);
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const requestId = typeof payload.requestId === 'string' ? payload.requestId.trim() : '';
        const kind = payload.kind === 'permission' ? 'permission' : payload.kind === 'question' ? 'question' : '';
        if (!requestId || !kind || requestId.length > 256) {
          res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid interaction' })); return;
        }
        if (kind === 'permission') {
          const reply = ['once', 'always', 'reject'].includes(payload.reply) ? payload.reply as 'once' | 'always' | 'reject' : 'reject';
          const message = typeof payload.message === 'string' && payload.message ? payload.message.slice(0, 2000) : undefined;
          await this.replyPermission(requestId, reply, message);
        } else {
          const answers = Array.isArray(payload.answers)
            ? payload.answers.map((a: unknown) => Array.isArray(a) ? a.filter(x => typeof x === 'string').map((x: string) => x.slice(0, 500)) : [])
            : [];
          await this.replyQuestion(requestId, answers);
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      // Everything else serves the single-page mobile UI.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderIndexHtml(this.theme));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal error: ' + (err instanceof Error ? err.message : String(err)));
    }
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

  // ── Live interactions (permissions and questions) ────────────────────────────

  /**
   * Pending permission/question requests across all sessions. Only reuses a
   * server that is already running (never spawns one just to poll) and stays
   * best-effort, so polling the board without a server yields no interactions.
   */
  async listInteractions(): Promise<OpenCodeInteractions> {
    const empty: OpenCodeInteractions = { permissions: [], questions: [] };
    let base: string | null;
    try { base = await this.resolveRunningServer(); } catch { return empty; }
    if (!base) return empty;
    const [permissions, questions] = await Promise.all([
      this.requestOpenCode<OpenCodePermissionRequest[]>(base, 'GET', '/permission', undefined).catch(() => []),
      this.requestOpenCode<OpenCodeQuestionRequest[]>(base, 'GET', '/question', undefined).catch(() => []),
    ]);
    return {
      permissions: Array.isArray(permissions) ? permissions : [],
      questions: Array.isArray(questions) ? questions : [],
    };
  }

  async replyPermission(requestId: string, reply: 'once' | 'always' | 'reject', message?: string): Promise<void> {
    const base = await this.ensureOpenCodeServer();
    await this.requestOpenCode(base, 'POST', `/permission/${encodeURIComponent(requestId)}/reply`,
      message ? { reply, message } : { reply });
  }

  async replyQuestion(requestId: string, answers: string[][]): Promise<void> {
    const base = await this.ensureOpenCodeServer();
    await this.requestOpenCode(base, 'POST', `/question/${encodeURIComponent(requestId)}/reply`, { answers });
  }

  /** Reuse an OpenCode server already listening on this machine, if any. */
  private async resolveRunningServer(): Promise<string | null> {
    const persisted = this.readServeAuth();
    for (const port of [4096, 4097]) {
      const base = `http://127.0.0.1:${port}`;
      if (await this.pingOpenCode(base)) { this.activeServeAuth = null; return base; }
      // A server answering 401 needs basic auth: try ours (previous run) first,
      // then OpenCode's own persisted service password.
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
    return null;
  }

  /** Find or spawn `opencode serve` on a known port, polling the port until it answers. */
  private async ensureOpenCodeServer(): Promise<string> {
    const running = await this.resolveRunningServer();
    if (running) return running;
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

/**
 * Format the remote sessions URL to encode in the QR code and display in the UI.
 * If an external URL is configured (e.g. tunnel, reverse proxy, domain), it appends
 * or updates the token query parameter `key`. Otherwise, it falls back to the default
 * local LAN IP and port.
 */
export function formatRemoteSessionsUrl(
  baseUrl: string | undefined | null,
  host: string,
  port: number,
  key: string
): string {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return `http://${host}:${port}/?key=${key}`;
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    parsed.searchParams.set('key', key);
    return parsed.toString();
  } catch {
    const sep = withScheme.includes('?') ? '&' : '?';
    return `${withScheme}${sep}key=${encodeURIComponent(key)}`;
  }
}

