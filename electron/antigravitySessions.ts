import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import log from 'electron-log';
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

// Result entries Antigravity writes after a tool call. Matching them to the
// pending call lets the board show the command and what it printed.
const TOOL_RESULT_TYPES = new Set([
  'GENERIC', 'RUN_COMMAND', 'VIEW_FILE', 'LIST_DIRECTORY', 'GREP_SEARCH', 'SEARCH_WEB',
  'READ_URL_CONTENT', 'CODE_ACTION', 'FIND', 'INVOKE_SUBAGENT', 'GENERATE_IMAGE',
  'ASK_QUESTION', 'ERROR_MESSAGE',
]);

const MAX_TOOL_OUTPUT = 6000;
const MAX_USER_TEXT = 6000;
const MAX_REASONING = 4000;
const MAX_ACTIVITY = 80;
// Live conversations grow to thousands of steps, so only the transcript tail is
// parsed on every poll. The opening prompt is added back so a long autonomous
// run still shows what it was asked to do.
const TRANSCRIPT_WINDOW = 300;

// Antigravity often quotes its tool arguments ("\"git status\""); strip the
// wrapping quotes so the command reads naturally on the board.
function unwrapArg(value: unknown): string {
  if (typeof value !== 'string') return value == null ? '' : String(value);
  let text = value.trim();
  for (let i = 0; i < 2; i++) {
    if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
      text = text.slice(1, -1).trim();
    }
  }
  return text;
}

function trimText(value: string, max: number): string {
  const text = String(value || '').trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

function trimTailText(value: string, max: number): string {
  const text = String(value || '').trim();
  return text.length > max ? '…' + text.slice(-(max - 1)).trimStart() : text;
}

// Antigravity repeats the "Created At / Completed At" envelope (sometimes twice)
// in front of every tool result. Drop every copy so the board shows the payload.
function cleanToolResult(content: string): string {
  const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n');
  let start = 0;
  while (start < lines.length) {
    const line = lines[start].trim();
    if (!line || /^(Created At|Completed At):/.test(line)) { start++; continue; }
    break;
  }
  return lines.slice(start).join('\n').trim();
}

// Machine-only blocks Antigravity appends to the visible user request.
const MACHINE_BLOCKS = ['ADDITIONAL_METADATA', 'USER_SETTINGS_CHANGE', 'EPHEMERAL_MESSAGE'];

// <USER_REQUEST> holds what the user typed; everything else in a USER_INPUT
// entry (time, model changes, reminders) is machine noise for the board.
function cleanUserPrompt(content: unknown): string {
  const raw = typeof content === 'string' ? content : '';
  if (!raw.trim()) return '';
  const requests = [...raw.matchAll(/<USER_REQUEST\b[^>]*>([\s\S]*?)<\/USER_REQUEST>/gi)]
    .map(match => match[1].trim())
    .filter(Boolean);
  let text = requests.length > 0 ? requests.join('\n\n') : raw;
  if (requests.length === 0) {
    for (const tag of MACHINE_BLOCKS) {
      text = text.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
    }
    text = text.replace(/<\/?[A-Z][A-Z0-9_]*\b[^>]*>/g, '');
  }
  // The launch seed carries a one-line summary of the prompt file; show that
  // instead of the "Read the file at …" envelope.
  if (text.includes(MARKER)) {
    const summary = text.match(/Summary of the file content:\s*"?([\s\S]*?)"?\s*$/);
    if (summary && summary[1].trim()) text = summary[1].trim();
  }
  return trimText(text, MAX_USER_TEXT);
}

// A subagent conversation starts with a SYSTEM_MESSAGE carrying the task its
// parent handed over; keep the task, not the boilerplate around it.
function cleanSystemMessage(content: unknown): string {
  const raw = typeof content === 'string' ? content : '';
  if (!raw.trim()) return '';
  const body = raw.replace(/^\s*The following is a <SYSTEM_MESSAGE>[\s\S]*?\n\s*\n/i, '');
  const inner = body.match(/<SYSTEM_MESSAGE\b[^>]*>([\s\S]*?)<\/SYSTEM_MESSAGE>/i);
  return trimText(inner ? inner[1] : body, MAX_USER_TEXT);
}

interface TranscriptEntry {
  step_index?: number;
  type?: string;
  status?: string;
  created_at?: string;
  content?: unknown;
  thinking?: unknown;
  model?: unknown;
  tool_calls?: Array<{ name?: string; args?: unknown; function?: { name?: string } }>;
}

function parseTranscriptEntry(line: string): TranscriptEntry | null {
  try {
    const value = JSON.parse(line);
    return value && typeof value === 'object' ? value as TranscriptEntry : null;
  } catch {
    return null;
  }
}

// `invoke_subagent` results embed the child conversation that was created.
function childConversationId(value: string): string {
  const match = value.match(/"?conversationId"?\s*[:=]\s*"?([0-9a-fA-F]{8}-[0-9a-fA-F-]{20,})"?/);
  return match ? match[1] : '';
}

// The command (or path/query) a call ran with, regardless of the tool used.
function antigravityToolInput(args: unknown): string {
  if (args && typeof args === 'object') {
    const record = args as Record<string, unknown>;
    for (const key of ['CommandLine', 'Command', 'AbsolutePath', 'Path', 'FilePath', 'Url', 'URL', 'query', 'Query']) {
      const value = unwrapArg(record[key]);
      if (value) return value;
    }
  }
  return typeof args === 'string' ? unwrapArg(args) : '';
}

// Antigravity has two stores, each with a global index (titles, workspaces,
// status) plus one SQLite database per conversation: the IDE under
// ~/.gemini/antigravity and the CLI (agy) under ~/.gemini/antigravity-cli.
// An explicit PROMPT_PAD_ANTIGRAVITY_DB override wins in every mode and may
// list several stores separated by ';' (IDE plus CLI, or custom locations);
// test mode otherwise uses the test directory and never the user's real data.
export function findAntigravityDbs(testDir: string | null = null): string[] {
  const candidates = process.env.PROMPT_PAD_ANTIGRAVITY_DB
    ? process.env.PROMPT_PAD_ANTIGRAVITY_DB.split(';').map(p => p.trim()).filter(Boolean)
    : testDir
      ? [path.join(testDir, 'conversation_summaries.db'), path.join(testDir, 'antigravity-cli', 'conversation_summaries.db')]
      : [
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
    // The IDE store mirrors CLI conversations (same conversation id, often an
    // empty title, a stale status and no transcript of its own). Each store is
    // read separately and candidates merge per conversation id, so the store
    // that actually owns the conversation data always wins over its mirror.
    const merged = new Map<string, OpenCodeSession>();
    const hiddenIds = new Set<string>();
    for (const dbPath of dbPaths) {
      try {
        for (const session of this.readRoot(dbPath, now, hidden, hiddenIds)) {
          merged.set(session.id, merged.has(session.id) ? this.mergeSession(merged.get(session.id)!, session) : session);
        }
        this.readFailures.delete(dbPath);
      } catch (err) {
        this.noteReadFailure(dbPath, err);
        // An unreadable store is skipped; the other one still contributes.
      }
    }
    result.sessions = [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    result.hiddenCount = hiddenIds.size;
    return result;
  }

  // Two stores can hold the same conversation (the IDE mirrors CLI rows with
  // an empty title, a stale status and no transcript). The candidate that
  // carries the conversation's data wins; the other only fills missing
  // labels, and a "working" signal from either side is trusted so a stale
  // mirror never marks a live run as finished.
  private mergeSession(a: OpenCodeSession, b: OpenCodeSession): OpenCodeSession {
    const primary = b.activity.length > a.activity.length ? b : a;
    const other = primary === a ? b : a;
    const filled = (value?: string) => value && value.trim() ? value : '';
    const working = primary.status === 'working' || other.status === 'working';
    return {
      ...primary,
      title: filled(primary.title) || filled(other.title) || primary.title,
      directory: filled(primary.directory) || filled(other.directory) || primary.directory,
      agent: primary.agent || other.agent,
      model: filled(primary.model) || filled(other.model) || primary.model,
      parentId: primary.parentId || other.parentId,
      status: working ? 'working' : primary.status,
      createdAt: Math.max(primary.createdAt, other.createdAt),
      updatedAt: Math.max(primary.updatedAt, other.updatedAt),
      completedAt: working ? null : (primary.completedAt ?? other.completedAt),
    };
  }

  // Read failures used to disappear silently, leaving the board empty with no
  // trace. Log each new failure (deduplicated per store, cleared on recovery).
  private readFailures = new Map<string, string>();

  private noteReadFailure(dbPath: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    if (this.readFailures.get(dbPath) === message) return;
    this.readFailures.set(dbPath, message);
    log.warn(`Antigravity store unreadable (${dbPath}): ${message}`);
  }

  private readRoot(dbPath: string, now: number, hidden: Record<string, string>, hiddenIds: Set<string>): OpenCodeSession[] {
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

      const recent = rows.filter(row => {
        const createdAt = parseAntigravityTime(row.last_modified_time);
        return createdAt > 0 && now - createdAt <= RECENT_MS;
      });
      const conversationDbFor = (id: string) => path.join(conversationsDir, `${id}.db`);
      // Only Prompt Pad-launched conversations are shown. Antigravity stores its
      // summaries in more than one place and mirrors rows between them, so the
      // marker (and not the database) decides.
      const visible = new Set<string>();
      for (const row of recent) {
        if (this.isPromptPadLaunched(dbPath, row.conversation_id, conversationDbFor(row.conversation_id))) {
          visible.add(row.conversation_id);
        }
      }
      // Subagents run their own conversation without the seed marker, so they
      // stay visible while the conversation that spawned them is visible.
      for (let changed = visible.size > 0; changed;) {
        changed = false;
        for (const row of recent) {
          if (visible.has(row.conversation_id) || !row.parent_conversation_id) continue;
          if (visible.has(row.parent_conversation_id)) {
            visible.add(row.conversation_id);
            changed = true;
          }
        }
      }

      const sessions: OpenCodeSession[] = [];
      for (const row of recent) {
        if (sessions.length >= MAX_CONVERSATIONS) break;
        if (!visible.has(row.conversation_id)) continue;
        if (sessions.some(s => s.id === row.conversation_id)) continue;
        const createdAt = parseAntigravityTime(row.last_modified_time);
        const turnId = row.conversation_id;
        if (hidden[turnId] === turnId) { hiddenIds.add(turnId); continue; }

        const { activity, latestActivityTime, model, running } = this.readActivity(dbPath, row.conversation_id);
        const updatedAt = Math.max(createdAt, latestActivityTime);

        const isKilled = Boolean(row.killed);
        const hasExplicitRunning = (row.status === 'CASCADE_RUN_STATUS_RUNNING') || Boolean(row.not_fully_idle);
        const hasExplicitIdle = (row.status === 'CASCADE_RUN_STATUS_IDLE') && !row.not_fully_idle;

        // Antigravity reports IDLE between turns of a session that is still
        // running in the terminal (observed flips every 30-60 s), so IDLE alone
        // must not finish a conversation: fresh transcript activity keeps it
        // Working for a short grace window, and a tool that has not captured a
        // result yet (or a background task marked RUNNING) keeps it Working up
        // to the same 30-minute cap as the explicit running status.
        let working = false;
        if (isKilled) {
          working = false;
        } else if (hasExplicitRunning) {
          working = (now - updatedAt < STALE_RUNNING_MS);
        } else if (hasExplicitIdle) {
          working = (now - updatedAt < ACTIVE_MS) || (running && now - updatedAt < STALE_RUNNING_MS);
        } else {
          working = (now - updatedAt < ACTIVE_MS);
        }

        if (working && activity.length > 0) {
          for (let i = activity.length - 1; i >= 0; i--) {
            if (activity[i].type === 'tool') {
              // Only the tool still in flight is "running"; once a result was
              // captured the call is done even if the conversation continues.
              if (!activity[i].output) activity[i].status = 'running';
              break;
            }
          }
        }

        sessions.push({
          id: row.conversation_id,
          turnId,
          title: row.title || row.preview || row.agent_name ||
            (activity.find(a => a.role === 'user')?.text?.slice(0, 80)) || 'Antigravity',
          directory: decodeWorkspaceDir(row.workspace_uris) || historyDirs.get(row.conversation_id) || '',
          parentId: row.parent_conversation_id || (row.nesting_depth > 0 ? 'nested' : null),
          agent: row.agent_name || undefined,
          model: model || '',
          status: working ? 'working' : 'completed',
          createdAt,
          updatedAt,
          completedAt: working ? null : updatedAt,
          expiresAt: null,
          activity,
          source: 'antigravity',
        });
      }
      return sessions;
    } finally { db.close(); }
  }

  private readActivity(dbPath: string, conversationId: string): { activity: OpenCodeActivity[]; latestActivityTime: number; model: string; running: boolean } {
    const activity: OpenCodeActivity[] = [];
    const head: OpenCodeActivity[] = [];
    let latestActivityTime = 0;
    let model = '';
    let running = false;
    let lastStatus = '';
    const rootDir = path.dirname(dbPath);
    const transcriptPath = path.join(rootDir, 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl');

    // Parse the transcript entries in order, pairing each tool result with the
    // call still waiting for it so commands and their output stay together.
    const collect = (lines: string[], target: OpenCodeActivity[]) => {
      const pendingTools: OpenCodeActivity[] = [];
      for (let i = 0; i < lines.length; i++) {
        const entry = parseTranscriptEntry(lines[i]);
        if (!entry) continue;
        const stepIdx = typeof entry.step_index === 'number' ? entry.step_index : i;
        if (entry.created_at) {
          const entryTime = parseAntigravityTime(entry.created_at);
          if (entryTime > latestActivityTime) latestActivityTime = entryTime;
        }
        lastStatus = String(entry.status || '');
        if (entry.type === 'USER_INPUT') {
          const text = cleanUserPrompt(entry.content);
          if (text) {
            target.push({ id: `agy-${conversationId}-input-${stepIdx}`, role: 'user', type: 'text', text });
          }
        } else if (entry.type === 'SYSTEM_MESSAGE') {
          const text = cleanSystemMessage(entry.content);
          if (text) {
            target.push({ id: `agy-${conversationId}-system-${stepIdx}`, role: 'system', type: 'text', text });
          }
        } else if (entry.type === 'PLANNER_RESPONSE') {
          if (typeof entry.model === 'string' && entry.model.trim()) model = entry.model.trim();
          const thinking = typeof entry.thinking === 'string' ? entry.thinking.trim() : '';
          const content = typeof entry.content === 'string' ? entry.content.trim() : '';
          // The visible answer precedes the calls it triggers, so it is pushed first.
          if (content || thinking) {
            target.push({
              id: `agy-${conversationId}-text-${stepIdx}`,
              role: 'assistant',
              type: 'text',
              text: content ? trimTailText(content, MAX_USER_TEXT) : '',
              reasoning: thinking ? trimText(thinking, MAX_REASONING) : undefined,
            });
          }
          if (Array.isArray(entry.tool_calls) && entry.tool_calls.length > 0) {
            for (let t = 0; t < entry.tool_calls.length; t++) {
              const call = entry.tool_calls[t];
              const toolName = call.name || call.function?.name || 'tool';
              let args = call.args;
              if (typeof args === 'string') {
                try { args = JSON.parse(args); } catch {}
              }
              const record = args && typeof args === 'object' ? args as Record<string, unknown> : {};
              const command = antigravityToolInput(args);
              const description = unwrapArg(record.toolAction) || unwrapArg(record.toolSummary);
              const toolActivity: OpenCodeActivity = {
                id: `agy-${conversationId}-tool-${stepIdx}-${t}`,
                role: 'assistant',
                type: 'tool',
                tool: String(toolName),
                status: 'completed',
                text: description.slice(0, 1000),
                input: command.slice(0, 1000),
              };
              target.push(toolActivity);
              pendingTools.push(toolActivity);
            }
          }
        } else if (typeof entry.type === 'string' && TOOL_RESULT_TYPES.has(entry.type) && typeof entry.content === 'string') {
          const tool = pendingTools.shift();
          const result = cleanToolResult(entry.content);
          if (tool && result) {
            tool.output = result.slice(0, MAX_TOOL_OUTPUT);
            tool.status = String(entry.status || '').toUpperCase() === 'ERROR' ? 'error' : 'completed';
            const child = childConversationId(result);
            if (child && child !== conversationId) tool.childId = child;
          }
        }
      }
      // Execution is still in flight when the transcript ends on a step marked
      // RUNNING (e.g. a background task) or a tool call has not received its
      // result yet. The head call runs first and is overwritten by the window.
      running = pendingTools.length > 0 || lastStatus.toUpperCase() === 'RUNNING';
    };

    if (fs.existsSync(transcriptPath)) {
      try {
        const stat = fs.statSync(transcriptPath);
        if (stat.mtimeMs > latestActivityTime) latestActivityTime = stat.mtimeMs;
        const content = fs.readFileSync(transcriptPath, 'utf8');
        const lines = content.split(/\r?\n/).filter(line => line.trim());
        const windowLines = lines.slice(-TRANSCRIPT_WINDOW);
        if (windowLines.length < lines.length) {
          // Long autonomous runs push the original request out of the window; it
          // stays as the first entry so the conversation keeps its context.
          const first = parseTranscriptEntry(lines[0]);
          if (first && (first.type === 'USER_INPUT' || first.type === 'SYSTEM_MESSAGE')) collect([lines[0]], head);
        }
        collect(windowLines, activity);
        if (!model) {
          const models = [...content.matchAll(/"model"\s*:\s*"([^"]+)"/g)];
          if (models.length > 0) model = models[models.length - 1][1];
        }
      } catch {}
    }

    if (activity.length === 0 && head.length === 0) {
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
                    const command = antigravityToolInput(parsed);
                    if (desc || command) {
                      activity.push({
                        id: `agy-${conversationId}-step-${r.idx}`,
                        role: 'assistant',
                        type: 'tool',
                        tool: parsed.toolName || (parsed.AbsolutePath ? 'file' : 'tool'),
                        status: 'completed',
                        text: String(desc).slice(0, 1000),
                        input: command.slice(0, 1000),
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

    const tailLimit = Math.max(0, MAX_ACTIVITY - head.length);
    let tail = activity.slice(-tailLimit);
    // The task that started the conversation stays visible even when a long run
    // pushes it out of the activity window.
    if (head.length === 0) {
      const firstUser = activity.find(a => a.role === 'user' || a.role === 'system');
      if (firstUser && !tail.includes(firstUser)) {
        tail = [firstUser, ...tail];
        if (tail.length > tailLimit) tail = [tail[0], ...tail.slice(tail.length - (tailLimit - 1))];
      }
    }
    return { activity: [...head, ...tail], latestActivityTime, model, running };
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
