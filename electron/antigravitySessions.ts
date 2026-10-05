import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { OpenCodeActivity, OpenCodeSession, OpenCodeSessionsSnapshot } from './sessionTypes';

// Show Prompt Pad-launched Antigravity conversations updated within the last day.
const RECENT_MS = 24 * 60 * 60 * 1000;
// A conversation whose summary changed within this window is still running (legacy fallback).
const ACTIVE_MS = 90 * 1000;
// An Antigravity conversation marked running in SQLite stays active unless no activity occurred for 30 minutes.
const STALE_RUNNING_MS = 30 * 60 * 1000;
const MAX_CONVERSATIONS = 250;

// Prompt Pad seeds Antigravity with a message pointing at a unique temp prompt
// file (pp-prompt-<id>.txt); conversations embedding that marker were launched
// from Prompt Pad. Everything else (IDE, scheduled agents) stays invisible.
const MARKER = 'pp-prompt-';

// Antigravity has two stores, each with a global index (titles, workspaces,
// status) plus one SQLite database per conversation: the IDE under
// ~/.gemini/antigravity and the CLI (agy) under ~/.gemini/antigravity-cli.
// An explicit PROMPT_PAD_ANTIGRAVITY_DB override wins in every mode; test mode
// otherwise uses the test directory and never the user's real data.
export function findAntigravityDbs(testDir: string | null = null): string[] {
  const candidates = process.env.PROMPT_PAD_ANTIGRAVITY_DB ? [process.env.PROMPT_PAD_ANTIGRAVITY_DB] :
    testDir ? [path.join(testDir, 'conversation_summaries.db')] :
    [
      path.join(os.homedir(), '.gemini', 'antigravity', 'conversation_summaries.db'),
      path.join(os.homedir(), '.gemini', 'antigravity-cli', 'conversation_summaries.db'),
    ];
  return candidates.filter(p => fs.existsSync(p));
}

function conversationsDirFor(dbPath: string): string {
  return path.join(path.dirname(dbPath), 'conversations');
}

// Timestamps look like '2026-09-24 08:18:24.1581864+00:00'; JavaScript's Date
// cannot read 7-digit fractions, so normalize before parsing.
function parseAntigravityTime(value: string): number {
  try {
    const normalized = value.trim()
      .replace(' ', 'T')
      .replace(/(\.\d{3})\d+/, '$1');
    const parsed = new Date(/[Zz]|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : normalized + 'Z');
    return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  } catch {
    return 0;
  }
}

function decodeWorkspaceDir(raw: string): string {
  try {
    const list = JSON.parse(raw);
    const first = Array.isArray(list) && list.length > 0 ? String(list[0]) : '';
    if (!first) return '';
    return decodeURIComponent(first.replace(/^file:\/\//, '')).replace(/^\/([a-zA-Z]:)/, '$1');
  } catch {
    return '';
  }
}

interface SummaryRow {
  conversation_id: string;
  title: string;
  preview: string;
  last_modified_time: string;
  workspace_uris: string;
  agent_name: string;
  parent_conversation_id: string;
  nesting_depth: number;
  status?: string;
  not_fully_idle?: number | boolean;
  killed?: number | boolean;
}

export class AntigravitySessionMonitor {
  constructor(private readonly dbPaths: () => string[], private readonly statePath: string) {}

  private hidden(): Record<string, string> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
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

  // A conversation counts as Prompt Pad-launched when any stored blob embeds
  // the pp-prompt marker from the seed message. Confirmed results are cached
  // by conversationId so confirmed sessions never require re-reading.
  private markerCache = new Map<string, { mtime: number; marked: boolean }>();

  private isPromptPadLaunched(dbPath: string, conversationId: string, conversationDb: string): boolean {
    const cached = this.markerCache.get(conversationId);
    if (cached?.marked) return true;

    // Check transcript first if available (fastest for live sessions as step 0 is written here immediately)
    const rootDir = path.dirname(dbPath);
    const transcriptPath = path.join(rootDir, 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl');
    if (fs.existsSync(transcriptPath)) {
      try {
        const fd = fs.openSync(transcriptPath, 'r');
        try {
          const buf = Buffer.alloc(4096);
          const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
          if (bytesRead > 0 && buf.subarray(0, bytesRead).includes(MARKER)) {
            this.markerCache.set(conversationId, { mtime: 0, marked: true });
            return true;
          }
        } finally {
          fs.closeSync(fd);
        }
      } catch {
        // Fall through to database check
      }
    }

    if (!fs.existsSync(conversationDb)) return false;

    let mtime = 0;
    try {
      mtime = fs.statSync(conversationDb).mtimeMs;
      const walPath = conversationDb + '-wal';
      if (fs.existsSync(walPath)) {
        mtime = Math.max(mtime, fs.statSync(walPath).mtimeMs);
      }
    } catch {
      return false;
    }

    if (cached && cached.mtime === mtime) return cached.marked;

    let marked = false;
    try {
      const db = new Database(conversationDb, { readonly: true, fileMustExist: true, timeout: 1000 });
      try {
        const needle = Buffer.from(MARKER, 'utf8');
        for (const row of db.prepare('SELECT data FROM trajectory_metadata_blob').all() as { data: Buffer | null }[]) {
          if (row.data && Buffer.from(row.data).includes(needle)) { marked = true; break; }
        }
        if (!marked) {
          const stepCols = new Set((db.prepare("PRAGMA table_info(steps)").all() as { name: string }[]).map(c => c.name));
          const hasPayload = stepCols.has('step_payload');
          const sql = hasPayload
            ? 'SELECT metadata, step_payload FROM steps ORDER BY idx LIMIT 200'
            : 'SELECT metadata FROM steps ORDER BY idx LIMIT 200';
          for (const row of db.prepare(sql).all() as { metadata?: Buffer | null; step_payload?: Buffer | null }[]) {
            if (row.metadata && Buffer.from(row.metadata).includes(needle)) { marked = true; break; }
            if (row.step_payload && Buffer.from(row.step_payload).includes(needle)) { marked = true; break; }
          }
        }
      } finally { db.close(); }
    } catch {
      marked = false;
    }
    this.markerCache.set(conversationId, { mtime, marked });
    return marked;
  }

  read(now = Date.now()): OpenCodeSessionsSnapshot {
    const dbPaths = this.dbPaths();
    const result: OpenCodeSessionsSnapshot = { dbPath: dbPaths[0] || null, sessions: [], hiddenCount: 0, checkedAt: now };
    if (dbPaths.length === 0) return result;
    const hidden = this.hidden();
    for (const dbPath of dbPaths) {
      try {
        this.readRoot(dbPath, now, result, hidden);
      } catch {
        // An unreadable store is skipped; the other one still contributes.
      }
    }
    result.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    return result;
  }

  private readRoot(dbPath: string, now: number, result: OpenCodeSessionsSnapshot, hidden: Record<string, string>): void {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 1000 });
    try {
      const tableCols = new Set(
        (db.prepare("PRAGMA table_info(conversation_summaries)").all() as { name: string }[]).map(c => c.name)
      );
      const selectCols = [
        'conversation_id', 'title', 'preview', 'last_modified_time', 'workspace_uris',
        'agent_name', 'parent_conversation_id', 'nesting_depth',
      ];
      if (tableCols.has('status')) selectCols.push('status');
      if (tableCols.has('not_fully_idle')) selectCols.push('not_fully_idle');
      if (tableCols.has('killed')) selectCols.push('killed');

      const rows = db.prepare(`
        SELECT ${selectCols.join(', ')}
        FROM conversation_summaries
        ORDER BY last_modified_time DESC
        LIMIT 500
      `).all() as SummaryRow[];
      const conversationsDir = conversationsDirFor(dbPath);
      // CLI (agy) conversations carry no workspace URIs; the CLI history log
      // maps conversation ids to the working directory instead.
      const historyDirs = this.historyDirs(path.join(path.dirname(dbPath), 'history.jsonl'));
      for (const row of rows) {
        const createdAt = parseAntigravityTime(row.last_modified_time);
        if (!createdAt || now - createdAt > RECENT_MS) continue;
        if (result.sessions.length >= MAX_CONVERSATIONS) break;
        if (result.sessions.some(s => s.id === row.conversation_id)) continue;
        const convDbPath = path.join(conversationsDir, `${row.conversation_id}.db`);
        if (!this.isPromptPadLaunched(dbPath, row.conversation_id, convDbPath)) continue;
        const turnId = row.conversation_id;
        if (hidden[turnId] === turnId) { result.hiddenCount++; continue; }

        const { activity, latestActivityTime } = this.readActivity(dbPath, row.conversation_id);
        const updatedAt = Math.max(createdAt, latestActivityTime);

        const isKilled = Boolean(row.killed);
        const hasExplicitRunning = (row.status === 'CASCADE_RUN_STATUS_RUNNING') || Boolean(row.not_fully_idle);
        const hasExplicitIdle = (row.status === 'CASCADE_RUN_STATUS_IDLE') && !row.not_fully_idle;

        let working = false;
        if (isKilled) {
          working = false;
        } else if (hasExplicitRunning) {
          working = (now - updatedAt < STALE_RUNNING_MS);
        } else if (hasExplicitIdle) {
          working = false;
        } else {
          working = (now - updatedAt < ACTIVE_MS);
        }

        if (working && activity.length > 0) {
          for (let i = activity.length - 1; i >= 0; i--) {
            if (activity[i].type === 'tool') {
              activity[i].status = 'running';
              break;
            }
          }
        }

        result.sessions.push({
          id: row.conversation_id,
          turnId,
          title: row.title || row.preview || (activity.find(a => a.role === 'user')?.text?.slice(0, 80)) || 'Antigravity',
          directory: decodeWorkspaceDir(row.workspace_uris) || historyDirs.get(row.conversation_id) || '',
          parentId: row.parent_conversation_id || (row.nesting_depth > 0 ? 'nested' : null),
          model: row.agent_name || '',
          status: working ? 'working' : 'completed',
          createdAt,
          updatedAt,
          completedAt: working ? null : updatedAt,
          expiresAt: null,
          activity,
          source: 'antigravity',
        });
      }
    } finally { db.close(); }
  }

  private readActivity(dbPath: string, conversationId: string): { activity: OpenCodeActivity[]; latestActivityTime: number } {
    const activity: OpenCodeActivity[] = [];
    let latestActivityTime = 0;
    const rootDir = path.dirname(dbPath);
    const transcriptPath = path.join(rootDir, 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl');

    if (fs.existsSync(transcriptPath)) {
      try {
        const stat = fs.statSync(transcriptPath);
        if (stat.mtimeMs > latestActivityTime) latestActivityTime = stat.mtimeMs;
        const content = fs.readFileSync(transcriptPath, 'utf8');
        const lines = content.split(/\r?\n/).filter(line => line.trim());
        const recentLines = lines.slice(-80);
        for (let i = 0; i < recentLines.length; i++) {
          try {
            const entry = JSON.parse(recentLines[i]);
            const stepIdx = entry.step_index ?? i;
            if (entry.created_at) {
              const entryTime = parseAntigravityTime(entry.created_at);
              if (entryTime > latestActivityTime) latestActivityTime = entryTime;
            }
            if (entry.type === 'USER_INPUT' && typeof entry.content === 'string') {
              let text = entry.content.replace(/<\/?USER_REQUEST>/g, '').trim();
              const seedMatch = text.match(/Summary of the file content:\s*"?([^"]+)"?/);
              if (seedMatch) text = seedMatch[1].trim();
              if (text) {
                activity.push({
                  id: `agy-${conversationId}-input-${stepIdx}`,
                  role: 'user',
                  type: 'text',
                  text: text.slice(-6000),
                });
              }
            } else if (entry.type === 'PLANNER_RESPONSE') {
              if (Array.isArray(entry.tool_calls) && entry.tool_calls.length > 0) {
                for (let t = 0; t < entry.tool_calls.length; t++) {
                  const call = entry.tool_calls[t];
                  const toolName = call.name || call.function?.name || 'tool';
                  let args = call.args;
                  if (typeof args === 'string') {
                    try { args = JSON.parse(args); } catch {}
                  }
                  let desc = '';
                  if (args && typeof args === 'object') {
                    desc = args.CommandLine || args.toolAction || args.toolSummary ||
                           args.AbsolutePath || args.query || args.Prompt || args.description || '';
                    if (typeof desc !== 'string') desc = JSON.stringify(desc);
                  }
                  activity.push({
                    id: `agy-${conversationId}-tool-${stepIdx}-${t}`,
                    role: 'assistant',
                    type: 'tool',
                    tool: String(toolName),
                    status: 'completed',
                    text: desc ? desc.slice(0, 1000) : '',
                  });
                }
              }
              if (typeof entry.content === 'string' && entry.content.trim()) {
                activity.push({
                  id: `agy-${conversationId}-text-${stepIdx}`,
                  role: 'assistant',
                  type: 'text',
                  text: entry.content.slice(-6000),
                });
              }
            }
          } catch {}
        }
      } catch {}
    }

    if (activity.length === 0) {
      const convDbPath = path.join(conversationsDirFor(dbPath), `${conversationId}.db`);
      if (fs.existsSync(convDbPath)) {
        try {
          const stat = fs.statSync(convDbPath);
          if (stat.mtimeMs > latestActivityTime) latestActivityTime = stat.mtimeMs;
          const convDb = new Database(convDbPath, { readonly: true, fileMustExist: true, timeout: 500 });
          try {
            const hasSteps = convDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'steps'").get();
            if (hasSteps) {
              const rows = convDb.prepare('SELECT idx, metadata FROM steps ORDER BY idx DESC LIMIT 30').all() as { idx: number; metadata: Buffer | null }[];
              for (const r of rows.reverse()) {
                if (r.metadata) {
                  try {
                    const parsed = JSON.parse(r.metadata.toString('utf8'));
                    const desc = parsed.toolAction || parsed.toolSummary || parsed.AbsolutePath || parsed.CommandLine || '';
                    if (desc) {
                      activity.push({
                        id: `agy-${conversationId}-step-${r.idx}`,
                        role: 'assistant',
                        type: 'tool',
                        tool: parsed.toolName || (parsed.AbsolutePath ? 'file' : 'tool'),
                        status: 'completed',
                        text: String(desc).slice(0, 1000),
                      });
                    }
                  } catch {}
                }
              }
            }
          } finally { convDb.close(); }
        } catch {}
      }
    }

    return { activity: activity.slice(-80), latestActivityTime };
  }

  private historyDirs(historyPath: string): Map<string, string> {
    const map = new Map<string, string>();
    try {
      for (const line of fs.readFileSync(historyPath, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as { conversationId?: string; workspace?: string };
          if (entry.conversationId && entry.workspace) map.set(entry.conversationId, entry.workspace);
        } catch { /* malformed history line */ }
      }
    } catch {
      // No history log – directories simply stay empty.
    }
    return map;
  }
}
