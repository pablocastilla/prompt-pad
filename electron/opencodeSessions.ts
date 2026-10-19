import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { OpenCodeActivity, OpenCodeSessionsSnapshot } from './sessionTypes';

const RETENTION_MS = 30 * 60 * 1000;
const STALE_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// OpenCode uses XDG data directories on all platforms, including macOS/Windows.
// An explicit PROMPT_PAD_OPENCODE_DB override wins in every mode; test mode
// otherwise uses the test directory and never the user's real database.
export function findOpenCodeDb(testDir: string | null = null): string | null {
  const candidates = [
    ...(process.env.PROMPT_PAD_OPENCODE_DB ? [process.env.PROMPT_PAD_OPENCODE_DB] : []),
    ...(testDir ? [path.join(testDir, 'opencode.db')] : [
      path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'opencode', 'opencode.db'),
      ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'opencode', 'opencode.db')] : []),
      path.join(os.homedir(), 'Library', 'Application Support', 'opencode', 'opencode.db'),
    ]),
  ];
  return candidates.find(p => fs.existsSync(p)) ?? null;
}

function object(data: string | null): Record<string, any> {
  try {
    const parsed = JSON.parse(data || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

const MAX_TOOL_TEXT = 8000;

// The command or arguments a tool ran with, so executions (e.g. `python x.py`)
// are visible on the board even while the tool is still running and has no title.
export function toolInputText(value: Record<string, any>): string {
  const input = value?.state?.input;
  if (typeof input === 'string') return input.slice(0, MAX_TOOL_TEXT);
  if (!input || typeof input !== 'object') return '';
  for (const key of ['command', 'filePath', 'pattern', 'query', 'url', 'path']) {
    const candidate = input[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.slice(0, MAX_TOOL_TEXT);
  }
  try {
    const json = JSON.stringify(input);
    return json && json !== '{}' ? json.slice(0, MAX_TOOL_TEXT) : '';
  } catch { return ''; }
}

// The text of a tool result. OpenCode 2 stores results as a `content` array of
// text parts (a subagent write-back, a shell transcript, a read file…), while
// legacy parts carry `output`/`error` directly.
function contentText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const texts: string[] = [];
  for (const part of content) {
    if (typeof part === 'string' && part.trim()) texts.push(part);
    else if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' &&
      (part as { text: string }).text.trim()) texts.push((part as { text: string }).text);
  }
  return texts.join('\n');
}

// The captured result of a tool call: an error, the command output, or the
// metadata output OpenCode stores alongside it.
export function toolOutputText(value: Record<string, any>): string {
  const state = value?.state ?? {};
  const candidates = [state.error, contentText(state.content), state.output, state.metadata?.output];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.slice(0, MAX_TOOL_TEXT);
    if (candidate && typeof candidate === 'object') {
      const message = candidate.data?.message ?? candidate.message;
      if (typeof message === 'string' && message.trim()) return message.slice(0, MAX_TOOL_TEXT);
    }
  }
  return '';
}

interface SessionRow {
  id: string;
  title: string;
  directory: string;
  parent_id: string | null;
  agent: string | null;
  time_created: number;
  time_updated: number;
  message_id: string | null;
  message_updated: number | null;
  data: string | null;
}

// OpenCode 2 (beta) shares the database but keeps sessions in session_v2 with
// messages in session_message (data JSON embeds text, model and finish info).
interface SessionV2Row {
  id: string;
  slug: string | null;
  title: string | null;
  directory: string | null;
  parent_id: string | null;
  agent: string | null;
  model: string | null;
  time_created: number;
  time_updated: number;
  time_idle: number | null;
  time_archived: number | null;
}

interface SessionV2MessageRow {
  id: string;
  type: string;
  data: string;
  time_created: number;
}

// OpenCode 2 stores every assistant step (reasoning, text, tool calls) as parts
// inside `data.content`. Tool parts are the only trace of what a subagent is
// doing while it runs, so they must become first-class activity items just like
// legacy `part` rows.
function contentActivity(content: unknown, role: string, messageId: string): OpenCodeActivity[] {
  if (!Array.isArray(content)) return [];
  const items: OpenCodeActivity[] = [];
  content.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const part = raw as Record<string, any>;
    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
      items.push({ id: `${messageId}:${index}`, role, type: 'text', text: part.text.slice(-6000) });
    } else if (part.type === 'tool') {
      const state = part.state && typeof part.state === 'object' ? part.state : {};
      const name = String(part.name || 'tool');
      // A subagent call carries a full prompt; the useful summary is the agent
      // and the description, not thousands of characters of instructions.
      const input = name === 'subagent'
        ? [state.input?.agent, state.input?.description].filter((v: unknown) => typeof v === 'string' && v.trim()).join(' · ')
        : toolInputText({ state });
      const rawOutput = toolOutputText({ state });
      const output = name === 'subagent' ? subagentResultText(rawOutput) : rawOutput;
      const title = String(state.title || state.input?.description || '').slice(0, 1000);
      const childId = name === 'subagent'
        ? (typeof state.metadata?.sessionID === 'string' ? state.metadata.sessionID : undefined)
          ?? (typeof state.input?.sessionID === 'string' ? state.input.sessionID : undefined)
        : undefined;
      items.push({
        id: `${messageId}:${index}`, role, type: 'tool',
        tool: name, status: String(state.status || 'pending'),
        text: title, input, output, ...(childId ? { childId } : {}),
      });
    }
  });
  return items;
}

// The clean write-back text OpenCode injects back into the parent when a
// subagent finishes, without the `<subagent …>` envelope.
function subagentResultText(value: string): string {
  return value
    .replace(/^\s*<subagent\b[^>]*>\s*/i, '')
    .replace(/\s*<\/subagent>\s*$/i, '')
    .trim();
}

export class OpenCodeSessionMonitor {
  constructor(private readonly dbPath: () => string | null, private readonly statePath: string) {}

  private hidden(): Record<string, string> {
    try { return object(fs.readFileSync(this.statePath, 'utf8')); }
    catch { return {}; }
  }

  private saveHidden(hidden: Record<string, string>) {
    const tmp = this.statePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(hidden, null, 2));
    fs.renameSync(tmp, this.statePath);
  }

  dismiss(id: string, turnId: string): void {
    if (typeof id !== 'string' || typeof turnId !== 'string' || id.length > 256 || turnId.length > 256) {
      throw new Error('Invalid session');
    }
    this.saveHidden({ ...this.hidden(), [id]: turnId });
  }

  restore(): void { this.saveHidden({}); }

  read(now = Date.now()): OpenCodeSessionsSnapshot {
    const dbPath = this.dbPath();
    const result: OpenCodeSessionsSnapshot = { dbPath, sessions: [], hiddenCount: 0, checkedAt: now };
    if (!dbPath) return result;
    const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 1000 });
    try {
      // A read transaction provides a consistent view even while OpenCode streams into WAL.
      return db.transaction(() => {
        const columns = new Set((db.prepare('PRAGMA table_info(session)').all() as { name: string }[]).map(c => c.name));
        if (!['id', 'title', 'directory', 'time_created', 'time_updated'].every(c => columns.has(c))) {
          throw new Error('Unsupported OpenCode session schema');
        }
        const rows = db.prepare(`
          SELECT s.id, s.title, s.directory, ${columns.has('parent_id') ? 's.parent_id' : 'NULL AS parent_id'},
            ${columns.has('agent') ? 's.agent' : 'NULL AS agent'},
            s.time_created, s.time_updated, m.id AS message_id, m.time_updated AS message_updated, m.data
          FROM session s LEFT JOIN message m ON m.id = (
            SELECT id FROM message WHERE session_id = s.id ORDER BY time_created DESC, id DESC LIMIT 1
          )
          ${columns.has('time_archived') ? 'WHERE s.time_archived IS NULL' : ''}
          ORDER BY s.time_created DESC, s.id
        `).all() as SessionRow[];
        const userQuery = db.prepare(`SELECT id FROM message WHERE session_id = ?
          AND json_valid(data) AND json_extract(data, '$.role') = 'user'
          ORDER BY time_created DESC, id DESC LIMIT 1`);
        const latestParts = db.prepare('SELECT MAX(time_updated) AS updated FROM part WHERE message_id = ?');
        const messages = db.prepare('SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created DESC, id DESC LIMIT 12');
        const parts = db.prepare(`SELECT id, data FROM part WHERE message_id = ? ORDER BY id DESC LIMIT 80`);
        const hidden = this.hidden();
        const childByTitle = new Map<string, string>();
        for (const candidate of rows) {
          if (!candidate.parent_id || !candidate.title) continue;
          childByTitle.set(`${candidate.parent_id}\u0000${candidate.title.trim().toLowerCase()}`, candidate.id);
        }
        for (const row of rows) {
          const data = object(row.data);
          // time.completed alone also ends intermediate tool-call messages; only final finishes end a turn.
          const terminal = data.role === 'assistant' && (data.error ||
            (typeof data.time?.completed === 'number' && ['stop', 'length', 'content-filter'].includes(data.finish)));
          const completedAt = terminal ? (data.time?.completed ?? row.message_updated ?? row.time_updated) as number : null;
          if (completedAt !== null && now >= completedAt + RETENTION_MS) continue;
          const partTime = row.message_id ? (latestParts.get(row.message_id) as { updated: number | null }).updated : null;
          const updatedAt = Math.max(row.message_updated || row.time_created, partTime || 0);
          if (completedAt === null && now - updatedAt > MAX_AGE_MS) continue;
          const turnId = (userQuery.get(row.id) as { id: string } | undefined)?.id || row.id;
          if (hidden[row.id] === turnId || hidden[row.id] === row.id) { result.hiddenCount++; continue; }
          const status = terminal ? (data.error ? 'error' : 'completed') :
            now - updatedAt >= STALE_MS ? 'unknown' :
            data.role === 'assistant' ? 'working' : data.role === 'user' || !row.message_id ? 'waiting' : 'unknown';
          const activity: OpenCodeActivity[] = [];
          let model = '';
          for (const message of (messages.all(row.id) as { id: string; data: string }[]).reverse()) {
            const info = object(message.data);
            if (info.modelID) model = [info.providerID, info.modelID].filter(Boolean).join('/');
            else if (info.model?.modelID) model = [info.model.providerID, info.model.modelID].filter(Boolean).join('/');
            for (const part of (parts.all(message.id) as { id: string; data: string }[]).reverse()) {
              const value = object(part.data);
              if (value.type === 'text' && typeof value.text === 'string' && value.text.trim()) {
                activity.push({ id: part.id, role: info.role || 'assistant', type: 'text', text: value.text.slice(-6000) });
              } else if (value.type === 'tool') {
                const name = String(value.tool || 'tool');
                const command = name === 'subagent'
                  ? [value.state?.input?.agent, value.state?.input?.description].filter((v: unknown) => typeof v === 'string' && v.trim()).join(' · ')
                  : toolInputText(value);
                const rawOutput = toolOutputText(value);
                const output = name === 'subagent' ? subagentResultText(rawOutput) : rawOutput;
                const title = String(value.state?.title || value.state?.input?.description || '').slice(0, 1000);
                const childId = name === 'subagent'
                  ? (typeof value.state?.metadata?.sessionID === 'string' ? value.state.metadata.sessionID : undefined)
                    ?? (typeof value.state?.input?.sessionID === 'string' ? value.state.input.sessionID : undefined)
                    ?? (title ? childByTitle.get(`${row.id}\u0000${title.trim().toLowerCase()}`) : undefined)
                  : undefined;
                activity.push({ id: part.id, role: info.role || 'assistant', type: 'tool',
                  tool: name, status: String(value.state?.status || 'pending'),
                  text: title, input: command, output, ...(childId ? { childId } : {}) });
              }
            }
            if (info.error) activity.push({ id: message.id + '-error', role: 'assistant', type: 'text',
              text: String(info.error.data?.message || info.error.name || 'Error').slice(0, 1000) });
          }
          result.sessions.push({ id: row.id, turnId, title: row.title, directory: row.directory,
            parentId: row.parent_id, agent: row.agent || undefined, model, status, createdAt: row.time_created, updatedAt, completedAt,
            expiresAt: completedAt === null ? null : completedAt + RETENTION_MS, activity: activity.slice(-80), source: 'opencode' });
        }
        this.readV2(db, now, result, hidden);
        // Order by creation, not by live status/activity, so columns keep a stable
        // position while a session alternates between working, waiting and finished.
        result.sessions.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
        return result;
      })();
    } finally { db.close(); }
  }

  // OpenCode 2 (beta) sessions: same database, session_v2 + session_message
  // tables. Assistant steps keep their parts (text, tools, reasoning) inside
  // `session_message.data.content`; subagent calls run in child sessions whose
  // tools and write-backs must stay visible on the board.
  private readV2(db: Database.Database, now: number, result: OpenCodeSessionsSnapshot, hidden: Record<string, string>): void {
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(t => t.name));
    if (!tables.has('session_v2') || !tables.has('session_message')) return;
    const columns = new Set((db.prepare('PRAGMA table_info(session_v2)').all() as { name: string }[]).map(c => c.name));
    const rows = db.prepare(`
      SELECT id, slug, title, directory, parent_id, ${columns.has('agent') ? 'agent' : "'' AS agent"},
        ${columns.has('model') ? 'model' : 'NULL AS model'},
        time_created, time_updated, time_idle, time_archived
      FROM session_v2
      ORDER BY time_created DESC, id
      LIMIT 400
    `).all() as SessionV2Row[];
    const userQuery = db.prepare("SELECT id FROM session_message WHERE session_id = ? AND type = 'user' ORDER BY time_created DESC, seq DESC LIMIT 1");
    const messages = db.prepare('SELECT id, type, data, time_created FROM session_message WHERE session_id = ? ORDER BY time_created DESC, seq DESC LIMIT 20');
    // A running subagent only reveals its child session through the description
    // it was launched with (stored as the child's title); completed ones also
    // carry the session id in their metadata.
    const childByTitle = new Map<string, string>();
    for (const candidate of rows) {
      if (!candidate.parent_id || !candidate.title) continue;
      childByTitle.set(`${candidate.parent_id}\u0000${candidate.title.trim().toLowerCase()}`, candidate.id);
    }
    for (const row of rows) {
      if (row.time_archived) continue;
      if (result.sessions.some(s => s.id === row.id)) continue;
      const messageRows = (messages.all(row.id) as SessionV2MessageRow[]).reverse();
      let last: SessionV2MessageRow | undefined;
      for (let i = messageRows.length - 1; i >= 0; i--) {
        // Compaction markers and runtime notices are not conversation steps.
        if (messageRows[i].type !== 'compaction' && messageRows[i].type !== 'system') { last = messageRows[i]; break; }
      }
      const lastData = last ? object(last.data) : {};
      // A turn ends either with a final assistant message or with an explicit
      // `idle` marker (outcome succeeded/interrupted/failed).
      const idle = last?.type === 'idle' ? lastData : null;
      const terminal = Boolean(idle) || (last?.type === 'assistant' && (lastData.error ||
        (typeof lastData.time?.completed === 'number' && ['stop', 'length', 'content-filter'].includes(lastData.finish))));
      const failed = Boolean(lastData.error) || Boolean(idle && idle.outcome && idle.outcome !== 'succeeded');
      const completedAt = terminal ? (lastData.time?.completed ?? lastData.time?.created ?? last?.time_created ??
        row.time_idle ?? row.time_updated) as number : null;
      if (completedAt !== null && now >= completedAt + RETENTION_MS) continue;
      const updatedAt = Math.max(row.time_created, row.time_updated || 0, lastData.time?.created || 0, lastData.time?.completed || 0);
      if (completedAt === null && now - updatedAt > MAX_AGE_MS) continue;
      const userRow = userQuery.get(row.id) as { id: string } | undefined;
      const turnId = userRow?.id || row.id;
      if (hidden[row.id] === turnId || hidden[row.id] === row.id) { result.hiddenCount++; continue; }
      const status = terminal ? (failed ? 'error' : 'completed') :
        now - updatedAt >= STALE_MS ? 'unknown' :
        last?.type === 'assistant' || last?.type === 'synthetic' || last?.type === 'system' ? 'working' : 'waiting';
      const activity: OpenCodeActivity[] = [];
      let model = '';
      const sessionModel = object(row.model);
      if (sessionModel.id) model = [sessionModel.providerID, sessionModel.id].filter(Boolean).join('/');
      for (const message of messageRows) {
        const info = object(message.data);
        if (info.model?.id) model = [info.model.providerID, info.model.id].filter(Boolean).join('/');
        if (message.type === 'user') {
          const text = typeof info.text === 'string' ? info.text : contentText(info.content);
          if (text.trim()) activity.push({ id: message.id, role: 'user', type: 'text', text: text.slice(-6000) });
        } else if (message.type === 'assistant') {
          activity.push(...contentActivity(info.content, 'assistant', message.id));
        } else if (message.type === 'synthetic') {
          // Shell results duplicate their tool part; subagent write-backs are
          // the only way to read what the child session answered.
          if (info.metadata?.source === 'subagent' && typeof info.text === 'string') {
            const text = subagentResultText(info.text);
            const alreadyShown = activity.some(item => item.type === 'tool' && item.tool === 'subagent' && item.output === text);
            if (text && !alreadyShown) {
              activity.push({ id: message.id, role: info.metadata?.agent || 'subagent', type: 'text', text: text.slice(-6000) });
            }
          }
        }
        if (info.error) activity.push({ id: message.id + '-error', role: 'assistant', type: 'text',
          text: String(info.error.data?.message || info.error.name || 'Error').slice(0, 1000) });
      }
      for (const item of activity) {
        if (item.type !== 'tool' || item.tool !== 'subagent' || item.childId) continue;
        const match = item.text ? childByTitle.get(`${row.id}\u0000${item.text.trim().toLowerCase()}`) : undefined;
        if (match) item.childId = match;
      }
      result.sessions.push({ id: row.id, turnId, title: row.title || row.slug || 'OpenCode 2', directory: row.directory || '',
        parentId: row.parent_id, agent: row.agent || undefined, model, status, createdAt: row.time_created, updatedAt, completedAt,
        expiresAt: completedAt === null ? null : completedAt + RETENTION_MS, activity: activity.slice(-80), source: 'opencode' });
    }
  }
}
