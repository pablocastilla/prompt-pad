import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { OpenCodeActivity, OpenCodeSession, OpenCodeSessionsSnapshot } from './sessionTypes';

// Show Prompt Pad-launched Antigravity conversations updated within the last day.
const RECENT_MS = 24 * 60 * 60 * 1000;
// A conversation whose summary changed within this window is still running.
const ACTIVE_MS = 90 * 1000;
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
  // the pp-prompt marker from the seed message. Results are memoised per
  // (file, mtime) so unchanged conversations are not re-read every poll.
  private markerCache = new Map<string, { mtime: number; marked: boolean }>();

  private isPromptPadLaunched(conversationDb: string): boolean {
    let mtime = 0;
    try { mtime = fs.statSync(conversationDb).mtimeMs; } catch { return false; }
    const cached = this.markerCache.get(conversationDb);
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
          for (const row of db.prepare('SELECT metadata FROM steps ORDER BY idx LIMIT 200').all() as { metadata: Buffer | null }[]) {
            if (row.metadata && Buffer.from(row.metadata).includes(needle)) { marked = true; break; }
          }
        }
      } finally { db.close(); }
    } catch {
      marked = false;
    }
    this.markerCache.set(conversationDb, { mtime, marked });
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
      const rows = db.prepare(`
        SELECT conversation_id, title, preview, last_modified_time, workspace_uris,
          agent_name, parent_conversation_id, nesting_depth
        FROM conversation_summaries
        ORDER BY last_modified_time DESC
        LIMIT 500
      `).all() as SummaryRow[];
      const conversationsDir = conversationsDirFor(dbPath);
      // CLI (agy) conversations carry no workspace URIs; the CLI history log
      // maps conversation ids to the working directory instead.
      const historyDirs = this.historyDirs(path.join(path.dirname(dbPath), 'history.jsonl'));
      for (const row of rows) {
        const updatedAt = parseAntigravityTime(row.last_modified_time);
        if (!updatedAt || now - updatedAt > RECENT_MS) continue;
        if (result.sessions.length >= MAX_CONVERSATIONS) break;
        if (result.sessions.some(s => s.id === row.conversation_id)) continue;
        if (!this.isPromptPadLaunched(path.join(conversationsDir, `${row.conversation_id}.db`))) continue;
        const turnId = row.conversation_id;
        if (hidden[turnId] === turnId) { result.hiddenCount++; continue; }
        const working = now - updatedAt < ACTIVE_MS;
        const activity = this.readActivity(dbPath, row.conversation_id, working);
        result.sessions.push({
          id: row.conversation_id,
          turnId,
          title: row.title || row.preview || 'Antigravity',
          directory: decodeWorkspaceDir(row.workspace_uris) || historyDirs.get(row.conversation_id) || '',
          parentId: row.parent_conversation_id || (row.nesting_depth > 0 ? 'nested' : null),
          model: row.agent_name || '',
          status: working ? 'working' : 'completed',
          updatedAt,
          completedAt: working ? null : updatedAt,
          expiresAt: null,
          activity,
          source: 'antigravity',
        });
      }
    } finally { db.close(); }
  }

  private readActivity(dbPath: string, conversationId: string, working: boolean): OpenCodeActivity[] {
    const activity: OpenCodeActivity[] = [];
    const rootDir = path.dirname(dbPath);
    const transcriptPath = path.join(rootDir, 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl');

    if (fs.existsSync(transcriptPath)) {
      try {
        const content = fs.readFileSync(transcriptPath, 'utf8');
        const lines = content.split(/\r?\n/).filter(line => line.trim());
        const recentLines = lines.slice(-80);
        for (let i = 0; i < recentLines.length; i++) {
          try {
            const entry = JSON.parse(recentLines[i]);
            const stepIdx = entry.step_index ?? i;
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

    if (working && activity.length > 0) {
      const last = activity[activity.length - 1];
      if (last.type === 'tool') {
        last.status = 'running';
      }
    }

    return activity.slice(-80);
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
