import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { OpenCodeActivity, OpenCodeSession, OpenCodeSessionsSnapshot } from './sessionTypes';

// Claude Code and Codex CLI both write append-only JSONL transcripts:
//   Claude: ~/.claude/projects/<munged-project>/<session-uuid>.jsonl
//   Codex:  ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<session-uuid>.jsonl
// The board reads them live (read-only) and keeps the latest messages/tools in
// a column, exactly like OpenCode and Antigravity. No store is ever written.
//
// Sources (checked 2026-11-19):
//   - https://claude-dev.tools/docs/jsonl-format
//   - https://dev.to/bargan/what-codex-cli-writes-to-disk-for-every-session-and-how-to-follow-it-live-1i04

const RECENT_MS = 24 * 60 * 60 * 1000;
const ACTIVE_MS = 90 * 1000;
const STALE_TOOL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 80;
const MAX_ACTIVITY = 80;
const MAX_TOOL_TEXT = 6000;
const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 768 * 1024;

function truncate(value: string, max = MAX_TOOL_TEXT): string {
  return value.length > max ? value.slice(0, max - 1).trimEnd() + '…' : value;
}

function parseTime(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function readUtf8Window(filePath: string, bytes: number, fromEnd: boolean): string {
  const stat = fs.statSync(filePath);
  if (stat.size <= bytes) return fs.readFileSync(filePath, 'utf8');
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = bytes;
    const buffer = Buffer.alloc(size);
    const position = fromEnd ? stat.size - size : 0;
    const read = fs.readSync(fd, buffer, 0, size, position);
    let text = buffer.subarray(0, read).toString('utf8');
    // Drop the partial edge line so JSON.parse never sees half an object.
    const firstBreak = text.indexOf('\n');
    if (fromEnd && firstBreak >= 0) text = text.slice(firstBreak + 1);
    const lastBreak = text.lastIndexOf('\n');
    if (!fromEnd && lastBreak >= 0) text = text.slice(0, lastBreak);
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

function parseJsonl(text: string): Array<Record<string, any>> {
  const entries: Array<Record<string, any>> = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') entries.push(parsed);
    } catch {
      // Corrupt/partial JSONL line: skip it, like the CLIs do.
    }
  }
  return entries;
}

// All transcript files under a root, newest first and limited to the recent
// window. `subagents` directories are skipped: the parent transcript already
// carries the useful main-thread activity, and child files would add noise.
function findRecentJsonl(root: string, now: number): Array<{ filePath: string; mtime: number }> {
  const found: Array<{ filePath: string; mtime: number }> = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || found.length > MAX_SESSIONS * 4) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'subagents' || entry.name === 'tasks' || entry.name === 'plans') continue;
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      try {
        const stat = fs.statSync(full);
        if (now - stat.mtimeMs <= RECENT_MS) found.push({ filePath: full, mtime: stat.mtimeMs });
      } catch { /* unreadable file */ }
    }
  };
  walk(root, 0);
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_SESSIONS);
}

function textFromBlocks(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const record = block as Record<string, any>;
    if (typeof record.text === 'string') parts.push(record.text);
    else if (typeof record.content === 'string') parts.push(record.content);
  }
  return parts.join('\n').trim();
}

function seedAwareText(text: string): string {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return '';
  // Prompt Pad sends a seed that points at a temp prompt file and embeds a
  // one-line summary. Show the summary instead of the plumbing.
  if (/pp-prompt-|Read the file at/i.test(cleaned)) {
    const match = cleaned.match(/Summary of the file content:\s*(.+)/i);
    if (match) return match[1].replace(/\s+/g, ' ').trim().slice(0, 200);
  }
  return cleaned.slice(0, MAX_TOOL_TEXT);
}

function claudeUserText(entry: Record<string, any>): string {
  const content = entry.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

function firstClaudeTitle(entries: Array<Record<string, any>>): string {
  for (const entry of entries) {
    if (entry.type !== 'user' || entry.isSidechain === true) continue;
    const title = seedAwareText(claudeUserText(entry));
    if (title) return title.slice(0, 120);
  }
  return '';
}

function firstCodexTitle(entries: Array<Record<string, any>>): string {
  for (const entry of entries) {
    const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
    if (entry.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
      const title = seedAwareText(codexContent(payload));
      if (title) return title.slice(0, 120);
    }
    if (entry.type === 'event_msg' && payload.type === 'user_message' && typeof payload.message === 'string') {
      const title = seedAwareText(payload.message);
      if (title) return title.slice(0, 120);
    }
  }
  return '';
}

function toolInputSummary(input: unknown): string {
  if (typeof input === 'string') return truncate(input, 1000);
  if (!input || typeof input !== 'object') return '';
  const record = input as Record<string, any>;
  const command = record.command ?? record.cmd;
  if (Array.isArray(command)) return truncate(command.join(' '), 1000);
  if (typeof command === 'string') return truncate(command, 1000);
  for (const key of ['file_path', 'path', 'pattern', 'query', 'url', 'description', 'prompt']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return truncate(value.trim(), 1000);
  }
  try { return truncate(JSON.stringify(input), 1000); } catch { return ''; }
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return textFromBlocks(value);
  if (value && typeof value === 'object') {
    const record = value as Record<string, any>;
    if (typeof record.output === 'string') return record.output;
    if (typeof record.text === 'string') return record.text;
    try { return JSON.stringify(value); } catch { return ''; }
  }
  return value == null ? '' : String(value);
}

function addText(activity: OpenCodeActivity[], seen: Set<string>, id: string, role: string, text: string) {
  const display = seedAwareText(text);
  if (!display) return;
  const key = `${role}\u0000${display}`;
  if (seen.has(key)) return;
  seen.add(key);
  activity.push({ id, role, type: 'text', text: display });
}

abstract class JsonlSessionMonitor {
  constructor(
    protected readonly source: 'claude-code' | 'codex',
    protected readonly root: () => string | null,
    protected readonly statePath: string,
  ) {}

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

  read(now = Date.now()): OpenCodeSessionsSnapshot {
    const root = this.root();
    const result: OpenCodeSessionsSnapshot = {
      dbPath: root && fs.existsSync(root) ? root : null,
      sessions: [],
      hiddenCount: 0,
      checkedAt: now,
    };
    if (!root || !fs.existsSync(root)) return result;
    const hidden = this.hidden();
    for (const { filePath } of findRecentJsonl(root, now)) {
      try {
        const session = this.parse(filePath, now);
        if (!session) continue;
        if (hidden[session.id] === session.turnId) {
          result.hiddenCount++;
          continue;
        }
        result.sessions.push(session);
      } catch {
        // A malformed or locked transcript never breaks the whole board.
      }
    }
    result.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    return result;
  }

  protected abstract parse(filePath: string, now: number): OpenCodeSession | null;
}

// ── Claude Code ───────────────────────────────────────────────────────────────

function decodeClaudeProjectDir(dirName: string): string {
  // Claude munges the cwd: /Users/me/app -> -Users-me-app. On Windows the drive
  // colon disappears the same way (C:\code\app -> C--code-app), so the exact
  // path is not recoverable from the folder name. The transcript's cwd field
  // is authoritative; this is only a best-effort fallback.
  if (!dirName.startsWith('-')) return '';
  const unix = '/' + dirName.slice(1).replace(/-/g, '/');
  return unix;
}

export class ClaudeSessionMonitor extends JsonlSessionMonitor {
  constructor(root: () => string | null, statePath: string) {
    super('claude-code', root, statePath);
  }

  protected parse(filePath: string, now: number): OpenCodeSession | null {
    const stat = fs.statSync(filePath);
    const headEntries = parseJsonl(readUtf8Window(filePath, HEAD_BYTES, false));
    const tailEntries = stat.size > HEAD_BYTES
      ? parseJsonl(readUtf8Window(filePath, TAIL_BYTES, true))
      : headEntries;

    const meta = headEntries.find(e => typeof e.sessionId === 'string' || typeof e.cwd === 'string') ??
      tailEntries.find(e => typeof e.sessionId === 'string' || typeof e.cwd === 'string') ?? {};
    const id = String(meta.sessionId || path.basename(filePath, '.jsonl'));
    const directory = typeof meta.cwd === 'string' && meta.cwd
      ? meta.cwd
      : decodeClaudeProjectDir(path.basename(path.dirname(filePath)));

    const activity: OpenCodeActivity[] = [];
    const seenText = new Set<string>();
    const pending = new Map<string, OpenCodeActivity>();
    let model = '';
    let lastTs = stat.mtimeMs;
    let firstTs = 0;
    let lastEventId = '';
    let lastKind: 'user' | 'assistant' | 'tool' | 'error' = 'user';
    let lastStopReason = '';
    let title = firstClaudeTitle(headEntries);

    for (let i = 0; i < tailEntries.length; i++) {
      const entry = tailEntries[i];
      if (entry.isSidechain === true) continue;
      const ts = parseTime(entry.timestamp);
      if (ts) lastTs = ts;
      if (ts && (!firstTs || ts < firstTs)) firstTs = ts;
      const uuid = typeof entry.uuid === 'string' ? entry.uuid : `${ts}-${i}`;
      if (uuid) lastEventId = uuid;

      if (entry.type === 'user') {
        lastKind = 'user';
        const content = entry.message?.content;
        if (typeof content === 'string') {
          if (!title) title = seedAwareText(content).slice(0, 120);
          addText(activity, seenText, `claude-${uuid}-user`, 'user', content);
        } else if (Array.isArray(content)) {
          for (let b = 0; b < content.length; b++) {
            const block = content[b];
            if (!block || typeof block !== 'object') continue;
            if (block.type === 'tool_result') {
              const tool = pending.get(String(block.tool_use_id || ''));
              if (tool) {
                const output = outputText(block.content);
                if (output) tool.output = truncate(output);
                tool.status = block.is_error ? 'error' : 'completed';
                pending.delete(String(block.tool_use_id || ''));
                if (block.is_error) lastKind = 'error';
              }
            } else if (block.type === 'text' && typeof block.text === 'string') {
              if (!title) title = seedAwareText(block.text).slice(0, 120);
              addText(activity, seenText, `claude-${uuid}-user-${b}`, 'user', block.text);
            }
          }
        }
      } else if (entry.type === 'assistant') {
        lastKind = 'assistant';
        if (typeof entry.message?.model === 'string') model = entry.message.model;
        if (typeof entry.message?.stop_reason === 'string') lastStopReason = entry.message.stop_reason;
        const content = entry.message?.content;
        if (Array.isArray(content)) {
          for (let b = 0; b < content.length; b++) {
            const block = content[b];
            if (!block || typeof block !== 'object') continue;
            if (block.type === 'text' && typeof block.text === 'string') {
              addText(activity, seenText, `claude-${uuid}-text-${b}`, 'assistant', block.text);
            } else if (block.type === 'tool_use') {
              const callId = String(block.id || `${uuid}-${b}`);
              const tool: OpenCodeActivity = {
                id: `claude-${callId}`,
                role: 'assistant',
                type: 'tool',
                tool: String(block.name || 'tool'),
                status: 'completed',
                text: '',
                input: toolInputSummary(block.input),
              };
              activity.push(tool);
              pending.set(callId, tool);
              lastKind = 'tool';
            }
          }
        }
      } else if (entry.type === 'system') {
        if (/error/i.test(String(entry.subtype || '')) || entry.isApiErrorMessage === true) {
          lastKind = 'error';
        }
      }
    }

    if (activity.length === 0) return null;
    const pendingFresh = pending.size > 0 && lastKind !== 'error' && now - lastTs < STALE_TOOL_MS;
    const working = pendingFresh || (!lastKind || lastKind === 'user' || lastKind === 'tool'
      ? now - lastTs < ACTIVE_MS
      : lastKind === 'assistant'
        ? (lastStopReason === 'tool_use' ? now - lastTs < ACTIVE_MS : false)
        : false);
    const status = lastKind === 'error' ? 'error' : working ? 'working' : 'completed';
    if (status === 'working' && pending.size > 0) {
      for (const tool of pending.values()) tool.status = 'running';
    }
    if (!title) {
      title = activity.find(a => a.role === 'user')?.text.slice(0, 120) || 'Claude Code';
    }

    return {
      id,
      turnId: lastEventId || String(lastTs),
      title,
      directory,
      parentId: null,
      model,
      status,
      createdAt: firstTs || parseTime(meta.timestamp) || lastTs || stat.birthtimeMs,
      updatedAt: lastTs,
      completedAt: status === 'working' ? null : lastTs,
      expiresAt: null,
      activity: activity.slice(-MAX_ACTIVITY),
      source: 'claude-code',
    };
  }
}

// ── OpenAI Codex ──────────────────────────────────────────────────────────────

function codexContent(payload: Record<string, any>): string {
  const content = payload.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const record = block as Record<string, any>;
      if (typeof record.text === 'string') parts.push(record.text);
      else if (typeof record.content === 'string') parts.push(record.content);
    }
    return parts.join('\n').trim();
  }
  return '';
}

function codexToolInput(payload: Record<string, any>): string {
  let args: unknown = payload.arguments ?? payload.input;
  if (typeof args === 'string') {
    const raw = args;
    try { args = JSON.parse(raw); } catch { return truncate(raw, 1000); }
  }
  return toolInputSummary(args);
}

export class CodexSessionMonitor extends JsonlSessionMonitor {
  constructor(root: () => string | null, statePath: string) {
    super('codex', root, statePath);
  }

  protected parse(filePath: string, now: number): OpenCodeSession | null {
    const stat = fs.statSync(filePath);
    const headEntries = parseJsonl(readUtf8Window(filePath, HEAD_BYTES, false));
    const tailEntries = stat.size > HEAD_BYTES
      ? parseJsonl(readUtf8Window(filePath, TAIL_BYTES, true))
      : headEntries;

    const metaLine = headEntries.find(e => e.type === 'session_meta') ??
      tailEntries.find(e => e.type === 'session_meta');
    const meta = metaLine?.payload && typeof metaLine.payload === 'object' ? metaLine.payload as Record<string, any> : {};
    let id = typeof meta.id === 'string' ? meta.id : '';
    if (!id) {
      const match = path.basename(filePath).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      id = match ? match[1] : path.basename(filePath, '.jsonl');
    }
    const directory = typeof meta.cwd === 'string' ? meta.cwd : '';

    const activity: OpenCodeActivity[] = [];
    const seenText = new Set<string>();
    const pending = new Map<string, OpenCodeActivity>();
    let model = typeof meta.model === 'string' ? meta.model : '';
    let lastTs = stat.mtimeMs;
    let lastEventId = '';
    let lastKind: 'user' | 'assistant' | 'tool' | 'completed' | 'error' = 'user';
    let title = firstCodexTitle(headEntries);

    for (let i = 0; i < tailEntries.length; i++) {
      const entry = tailEntries[i];
      const ts = parseTime(entry.timestamp) || parseTime(entry.payload?.timestamp);
      if (ts) lastTs = ts;
      const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload as Record<string, any> : {};
      const eventId = String(payload.id || payload.call_id || entry.uuid || `${ts}-${i}`);
      lastEventId = eventId;

      if (entry.type === 'turn_context') {
        if (typeof payload.model === 'string') model = payload.model;
        continue;
      }

      if (entry.type === 'response_item') {
        const kind = payload.type;
        if (kind === 'message') {
          const text = codexContent(payload);
          if (!text) continue;
          const role = payload.role === 'user' ? 'user' : payload.role === 'assistant' ? 'assistant' : '';
          if (!role) continue;
          if (role === 'user' && !title) title = seedAwareText(text).slice(0, 120);
          addText(activity, seenText, `codex-${eventId}-${role}`, role, text);
          lastKind = role;
        } else if (kind === 'function_call' || kind === 'custom_tool_call') {
          const callId = String(payload.call_id || eventId);
          const tool: OpenCodeActivity = {
            id: `codex-${callId}`,
            role: 'assistant',
            type: 'tool',
            tool: String(payload.name || (kind === 'custom_tool_call' ? 'tool' : 'shell')),
            status: 'completed',
            text: '',
            input: codexToolInput(payload),
          };
          activity.push(tool);
          pending.set(callId, tool);
          lastKind = 'tool';
        } else if (kind === 'function_call_output' || kind === 'custom_tool_call_output') {
          const callId = String(payload.call_id || '');
          const tool = pending.get(callId);
          if (tool) {
            const output = outputText(payload.output);
            if (output) tool.output = truncate(output);
            tool.status = 'completed';
            pending.delete(callId);
          }
        }
        continue;
      }

      if (entry.type === 'event_msg') {
        switch (payload.type) {
          case 'user_message':
            if (typeof payload.message === 'string') {
              if (!title) title = seedAwareText(payload.message).slice(0, 120);
              addText(activity, seenText, `codex-${eventId}-user-msg`, 'user', payload.message);
              lastKind = 'user';
            }
            break;
          case 'agent_message':
            if (typeof payload.message === 'string') {
              addText(activity, seenText, `codex-${eventId}-assistant-msg`, 'assistant', payload.message);
              lastKind = 'assistant';
            }
            break;
          case 'task_started':
            lastKind = 'user';
            break;
          case 'task_complete':
            lastKind = payload.error ? 'error' : 'completed';
            break;
          case 'turn_aborted':
          case 'error':
          case 'stream_error':
            lastKind = 'error';
            break;
          default:
            break;
        }
      }
    }

    if (activity.length === 0) return null;
    const pendingFresh = pending.size > 0 && lastKind !== 'error' && lastKind !== 'completed' && now - lastTs < STALE_TOOL_MS;
    const working = pendingFresh || (lastKind === 'user' || lastKind === 'tool'
      ? now - lastTs < ACTIVE_MS
      : false);
    const status = lastKind === 'error' ? 'error' : working ? 'working' : 'completed';
    if (status === 'working' && pending.size > 0) {
      for (const tool of pending.values()) tool.status = 'running';
    }
    if (!title) title = activity.find(a => a.role === 'user')?.text.slice(0, 120) || 'Codex';

    return {
      id,
      turnId: lastEventId || String(lastTs),
      title,
      directory,
      parentId: typeof meta.forked_from_id === 'string' && meta.forked_from_id ? meta.forked_from_id : null,
      agent: typeof meta.agent_nickname === 'string' ? meta.agent_nickname
        : typeof meta.agent_role === 'string' ? meta.agent_role : undefined,
      model,
      status,
      createdAt: parseTime(meta.timestamp) || lastTs || stat.birthtimeMs,
      updatedAt: lastTs,
      completedAt: status === 'working' ? null : lastTs,
      expiresAt: null,
      activity: activity.slice(-MAX_ACTIVITY),
      source: 'codex',
    };
  }
}

// ── Locations ─────────────────────────────────────────────────────────────────

function firstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function findClaudeProjectsDir(testDir: string | null = null): string | null {
  // Test mode must never fall through to the developer's real history.
  if (testDir) {
    return firstExisting([
      process.env.PROMPT_PAD_CLAUDE_PROJECTS || '',
      path.join(testDir, 'claude-projects'),
    ]);
  }
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  return firstExisting([
    process.env.PROMPT_PAD_CLAUDE_PROJECTS || '',
    configDir ? path.join(configDir, 'projects') : '',
    path.join(os.homedir(), '.claude', 'projects'),
  ]);
}

export function findCodexSessionsDir(testDir: string | null = null): string | null {
  if (testDir) {
    return firstExisting([
      process.env.PROMPT_PAD_CODEX_SESSIONS || '',
      path.join(testDir, 'codex-sessions'),
    ]);
  }
  const codexHome = process.env.CODEX_HOME;
  return firstExisting([
    process.env.PROMPT_PAD_CODEX_SESSIONS || '',
    codexHome ? path.join(codexHome, 'sessions') : '',
    path.join(os.homedir(), '.codex', 'sessions'),
  ]);
}
