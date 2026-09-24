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

interface SessionRow {
  id: string;
  title: string;
  directory: string;
  parent_id: string | null;
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
  time_created: number;
  time_updated: number;
  time_idle: number | null;
  time_archived: number | null;
}

interface SessionV2MessageRow {
  id: string;
  type: string;
  data: string;
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
                activity.push({ id: part.id, role: info.role || 'assistant', type: 'tool',
                  tool: String(value.tool || 'tool'), status: String(value.state?.status || 'pending'),
                  text: String(value.state?.title || value.state?.input?.description || value.state?.error || '').slice(0, 1000) });
              }
            }
            if (info.error) activity.push({ id: message.id + '-error', role: 'assistant', type: 'text',
              text: String(info.error.data?.message || info.error.name || 'Error').slice(0, 1000) });
          }
          result.sessions.push({ id: row.id, turnId, title: row.title, directory: row.directory,
            parentId: row.parent_id, model, status, updatedAt, completedAt,
            expiresAt: completedAt === null ? null : completedAt + RETENTION_MS, activity: activity.slice(-80), source: 'opencode' });
        }
        this.readV2(db, now, result, hidden);
        // Keep running work at the left; abandoned/inconclusive history must not bury it.
        const priority = { working: 0, waiting: 1, completed: 2, error: 2, unknown: 3 };
        result.sessions.sort((a, b) => priority[a.status] - priority[b.status]);
        return result;
      })();
    } finally { db.close(); }
  }

  // OpenCode 2 (beta) sessions: same database, session_v2 + session_message
  // tables. The shared tables carry no tool parts, so activity is text only.
  private readV2(db: Database.Database, now: number, result: OpenCodeSessionsSnapshot, hidden: Record<string, string>): void {
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(t => t.name));
    if (!tables.has('session_v2') || !tables.has('session_message')) return;
    const rows = db.prepare(`
      SELECT id, slug, title, directory, parent_id, time_created, time_updated, time_idle, time_archived
      FROM session_v2
      ORDER BY time_created DESC, id
      LIMIT 400
    `).all() as SessionV2Row[];
    const userQuery = db.prepare("SELECT id FROM session_message WHERE session_id = ? AND type = 'user' ORDER BY time_created DESC, seq DESC LIMIT 1");
    const messages = db.prepare('SELECT id, type, data FROM session_message WHERE session_id = ? ORDER BY time_created DESC, seq DESC LIMIT 12');
    for (const row of rows) {
      if (row.time_archived) continue;
      if (result.sessions.some(s => s.id === row.id)) continue;
      const messageRows = (messages.all(row.id) as SessionV2MessageRow[]).reverse();
      const last = messageRows[messageRows.length - 1];
      const lastData = last ? object(last.data) : {};
      // A completed assistant message marks the end of the turn; an idle
      // timestamp without one means the agent stopped without finishing.
      const terminal = last?.type === 'assistant' && (lastData.error ||
        (typeof lastData.time?.completed === 'number' && ['stop', 'length', 'content-filter'].includes(lastData.finish)));
      const completedAt = terminal ? (lastData.time?.completed ?? lastData.time?.idle ?? row.time_idle ?? row.time_updated) as number : null;
      if (completedAt !== null && now >= completedAt + RETENTION_MS) continue;
      const updatedAt = Math.max(row.time_created, row.time_updated || 0, lastData.time?.completed || 0);
      if (completedAt === null && now - updatedAt > MAX_AGE_MS) continue;
      const userRow = userQuery.get(row.id) as { id: string } | undefined;
      const turnId = userRow?.id || row.id;
      if (hidden[row.id] === turnId || hidden[row.id] === row.id) { result.hiddenCount++; continue; }
      const status = terminal ? (lastData.error ? 'error' : 'completed') :
        now - updatedAt >= STALE_MS ? 'unknown' :
        last?.type === 'assistant' ? 'working' : 'waiting';
      const activity: OpenCodeActivity[] = [];
      let model = '';
      for (const message of messageRows) {
        const info = object(message.data);
        if (info.model?.id) model = [info.model.providerID, info.model.id].filter(Boolean).join('/');
        const text = message.type === 'user' && typeof info.text === 'string' ? info.text :
          Array.isArray(info.content) ? info.content
            .filter((c: { type?: string; text?: string }) => c?.type === 'text' && typeof c.text === 'string')
            .map((c: { text: string }) => c.text).join('\n') : '';
        if (text.trim()) activity.push({ id: message.id, role: message.type, type: 'text', text: text.slice(-6000) });
        if (info.error) activity.push({ id: message.id + '-error', role: 'assistant', type: 'text',
          text: String(info.error.data?.message || info.error.name || 'Error').slice(0, 1000) });
      }
      result.sessions.push({ id: row.id, turnId, title: row.title || row.slug || 'OpenCode 2', directory: row.directory || '',
        parentId: row.parent_id, model, status, updatedAt, completedAt,
        expiresAt: completedAt === null ? null : completedAt + RETENTION_MS, activity: activity.slice(-80), source: 'opencode' });
    }
  }
}
