import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  OpenCodePermissionRequest,
  OpenCodeQuestionInfo,
  OpenCodeQuestionRequest,
} from './sessionTypes';

// ── OpenCode API flavours ─────────────────────────────────────────────────────
// OpenCode 2 rewrote the HTTP API under /api and wraps every response in
// `{ data }`, while OpenCode 1 used the flat /session, /permission and /question
// endpoints. Both are supported so Prompt Pad keeps working with the CLI the
// user has installed.
export type OpenCodeFlavor = 'v1' | 'v2';

export interface OpenCodeAuth {
  username: string;
  password: string;
}

export interface OpenCodeServerTarget {
  base: string;
  flavor: OpenCodeFlavor;
  auth: OpenCodeAuth | null;
}

export interface OpenCodeServerOverride {
  base: string;
  flavor?: OpenCodeFlavor;
  auth?: OpenCodeAuth | null;
}

const DEFAULT_USERNAME = 'opencode';
const LIST_TIMEOUT_MS = 2500;
const SEND_TIMEOUT_MS = 10_000;

// OpenCode retired minimax-m2.5-free in v2; this free model exists in the
// current CLI model list, so it is the safe default for launches.
export const DEFAULT_OPENCODE_MODEL = 'opencode/deepseek-v4.1-flash-free';

/**
 * A stale pinned model (e.g. minimax-m2.5-free, retired by OpenCode 2) makes the
 * launch fail with "Model unavailable". When the live model list is known, fall
 * back to the free default so the prompt still runs with predictable cost.
 */
export function resolveOpenCodeLaunchModel(model: string, available: string[]): string {
  const selected = typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_OPENCODE_MODEL;
  if (!Array.isArray(available) || available.length === 0) return selected;
  if (available.includes(selected)) return selected;
  if (available.includes(DEFAULT_OPENCODE_MODEL)) return DEFAULT_OPENCODE_MODEL;
  return selected;
}

export function basicAuthHeader(auth: OpenCodeAuth | null | undefined): Record<string, string> {
  if (!auth || !auth.password) return {};
  return {
    Authorization: 'Basic ' + Buffer.from(`${auth.username || DEFAULT_USERNAME}:${auth.password}`).toString('base64'),
  };
}

/** The real executable behind the npm shim; GUI launches often lack npm on PATH. */
export function findOpenCodeExecutable(): string {
  if (process.env.PROMPT_PAD_OPENCODE_BIN) return process.env.PROMPT_PAD_OPENCODE_BIN;
  if (process.platform === 'win32') {
    const npmDir = path.join(process.env.APPDATA || '', 'npm');
    const candidates = [
      path.join(npmDir, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe'),
      path.join(npmDir, 'node_modules', '@opencode-ai', 'cli', 'bin', 'opencode.exe'),
      path.join(npmDir, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
    ];
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) return candidate;
    }
  }
  return 'opencode';
}

/**
 * OpenCode 2 persists its background service URL and password in
 * `~/.local/state/opencode/service.json`; OpenCode 1 used
 * `~/.config/opencode/service.json`. Servers already running on this machine
 * use those credentials, so reading them lets Prompt Pad reuse the exact
 * server the terminal UI is attached to.
 */
export function readOpenCodeServiceAuth(): (OpenCodeAuth & { url?: string }) | null {
  try {
    const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
    const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    const candidates = [
      path.join(stateHome, 'opencode', 'service.json'),
      path.join(configHome, 'opencode', 'service.json'),
      ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'opencode', 'service.json')] : []),
    ];
    for (const file of candidates) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (typeof parsed?.password === 'string' && parsed.password) {
          const username = typeof parsed.username === 'string' && parsed.username ? parsed.username : DEFAULT_USERNAME;
          const url = typeof parsed.url === 'string' && parsed.url ? parsed.url : undefined;
          return { username, password: parsed.password, url };
        }
      } catch { /* next candidate */ }
    }
  } catch { /* fall through */ }
  return null;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe a server. OpenCode 2 answers /api/session; OpenCode 1 answers /session.
 * Returns the flavour or null when the URL is not an OpenCode server.
 */
export async function detectOpenCodeFlavor(
  base: string,
  auth?: OpenCodeAuth | null,
  timeoutMs = 2000,
): Promise<OpenCodeFlavor | null> {
  const candidates: Array<{ path: string; flavor: OpenCodeFlavor }> = [
    { path: '/api/session', flavor: 'v2' },
    { path: '/session', flavor: 'v1' },
  ];
  for (const candidate of candidates) {
    try {
      const res = await fetchWithTimeout(base + candidate.path, {
        headers: basicAuthHeader(auth),
      }, timeoutMs);
      if (res.ok) return candidate.flavor;
    } catch { /* try the other flavour */ }
  }
  return null;
}

export async function requestOpenCode<T>(
  target: OpenCodeServerTarget,
  method: string,
  apiPath: string,
  body?: unknown,
  timeoutMs = SEND_TIMEOUT_MS,
): Promise<T> {
  const res = await fetchWithTimeout(target.base + apiPath, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...basicAuthHeader(target.auth),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, timeoutMs);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenCode API ${res.status}: ${detail}`);
  }
  if (res.status === 204) return {} as T;
  const text = await res.text();
  if (!text) return {} as T;
  try { return JSON.parse(text) as T; } catch { return {} as T; }
}

/** Split `provider/model` (OpenCode 2 models may include variant as `#v`). */
export function parseModelRef(model: string): { providerID: string; id: string; variant?: string } | null {
  if (typeof model !== 'string') return null;
  const value = model.trim();
  const slash = value.indexOf('/');
  if (slash <= 0 || slash === value.length - 1) return null;
  const providerID = value.slice(0, slash);
  let rest = value.slice(slash + 1);
  let variant: string | undefined;
  const hash = rest.indexOf('#');
  if (hash > 0) {
    variant = rest.slice(hash + 1) || undefined;
    rest = rest.slice(0, hash);
  }
  if (!rest) return null;
  return variant ? { providerID, id: rest, variant } : { providerID, id: rest };
}

// ── Session creation / prompting ─────────────────────────────────────────────

export interface CreateSessionOptions {
  title: string;
  directory: string;
  model?: string;
}

export async function createOpenCodeSession(
  target: OpenCodeServerTarget,
  options: CreateSessionOptions,
): Promise<string> {
  const model = options.model ? parseModelRef(options.model) : null;
  if (target.flavor === 'v2') {
    const body: Record<string, unknown> = {
      title: options.title,
      location: { directory: options.directory },
    };
    if (model) body.model = model;
    const response = await requestOpenCode<{ data?: { id?: string } }>(target, 'POST', '/api/session', body);
    const id = response?.data?.id;
    if (!id) throw new Error('OpenCode did not return a session id');
    return id;
  }
  // OpenCode 1 assigns the model when the prompt is sent, not when the session
  // is created (and rejects unknown fields), so keep the create body minimal.
  const query = '?directory=' + encodeURIComponent(options.directory);
  const response = await requestOpenCode<{ id?: string }>(target, 'POST', '/session' + query, { title: options.title });
  const id = response?.id;
  if (!id) throw new Error('OpenCode did not return a session id');
  return id;
}

export async function sendOpenCodePrompt(
  target: OpenCodeServerTarget,
  sessionId: string,
  text: string,
  model?: string,
): Promise<void> {
  const id = encodeURIComponent(sessionId);
  if (target.flavor === 'v2') {
    // `steer` matches the old prompt_async behaviour: the message joins the
    // running turn instead of waiting for it to finish.
    await requestOpenCode(target, 'POST', `/api/session/${id}/prompt`, {
      text,
      delivery: 'steer',
    });
    return;
  }
  const ref = model ? parseModelRef(model) : null;
  await requestOpenCode(target, 'POST', `/session/${id}/prompt_async`, {
    parts: [{ type: 'text', text }],
    ...(ref ? { model: { providerID: ref.providerID, modelID: ref.id } } : {}),
  });
}

// ── OpenCode 2 forms (the new questions UI) ──────────────────────────────────

export interface V2FormOption {
  value: string;
  label: string;
  description?: string;
}

export interface V2FormField {
  key: string;
  type: string;
  title?: string;
  description?: string;
  options?: V2FormOption[];
  custom?: boolean;
  required?: boolean;
  hidden?: boolean;
  default?: string | number | boolean | string[];
}

export interface V2Form {
  id: string;
  sessionID: string;
  title: string;
  fields: V2FormField[];
}

interface FormFieldPlan {
  key: string;
  type: string;
  optionValues: Map<string, string | number | boolean>;
  custom: boolean;
  defaultValue?: string | number | boolean | string[];
}

export interface FormPlan {
  form: V2Form;
  fields: FormFieldPlan[];
  question: OpenCodeQuestionRequest;
}

/**
 * Translate an OpenCode 2 form into the question shape the board and the phone
 * already render. The plan keeps the option label → value mapping because the
 * UI submits labels, while the v2 API expects the option values.
 */
export function formToQuestionPlan(form: V2Form): FormPlan | null {
  const questions: OpenCodeQuestionInfo[] = [];
  const planned: FormFieldPlan[] = [];
  for (const field of form.fields || []) {
    if (!field || typeof field.key !== 'string' || field.hidden) continue;
    if (field.type === 'external') continue;
    const title = field.title || form.title || 'Question';
    const question = field.description || '';
    const optionValues = new Map<string, string | number | boolean>();
    let options: Array<{ label: string; description: string }> = [];
    let multiple = false;
    let custom = false;
    if (field.type === 'boolean') {
      options = [
        { label: 'Yes', description: '' },
        { label: 'No', description: '' },
      ];
      optionValues.set('Yes', true);
      optionValues.set('No', false);
    } else if (field.type === 'multiselect') {
      multiple = true;
      custom = Boolean(field.custom);
      for (const option of field.options || []) {
        if (!option || typeof option.label !== 'string') continue;
        options.push({ label: option.label, description: option.description || '' });
        optionValues.set(option.label, option.value);
      }
    } else if (field.type === 'string') {
      custom = Boolean(field.custom) || !(field.options || []).length;
      for (const option of field.options || []) {
        if (!option || typeof option.label !== 'string') continue;
        options.push({ label: option.label, description: option.description || '' });
        optionValues.set(option.label, option.value);
      }
    } else {
      // number / integer: a free-text box is enough for the board.
      custom = true;
    }
    questions.push({ header: title, question, options, multiple, custom });
    planned.push({ key: field.key, type: field.type, optionValues, custom, defaultValue: field.default });
  }
  if (questions.length === 0) return null;
  return {
    form,
    fields: planned,
    question: { id: form.id, sessionID: form.sessionID, questions },
  };
}

/**
 * Build the v2 Form.Reply answer object from the positional label arrays the
 * question UI sends: one array per field, holding picked option labels plus any
 * custom text.
 */
export function buildFormAnswer(plan: FormPlan, answers: string[][]): Record<string, string | number | boolean | string[]> {
  const answer: Record<string, string | number | boolean | string[]> = {};
  plan.fields.forEach((field, index) => {
    const picked = Array.isArray(answers[index]) ? answers[index].filter(value => typeof value === 'string') : [];
    const optionPicks = picked.filter(label => field.optionValues.has(label));
    const customText = picked.filter(label => !field.optionValues.has(label)).join(' ').trim();
    if (field.type === 'multiselect') {
      const values = optionPicks.map(label => String(field.optionValues.get(label)));
      if (customText) values.push(customText);
      const fallback = Array.isArray(field.defaultValue) ? field.defaultValue : [];
      answer[field.key] = values.length ? values : fallback;
      return;
    }
    if (field.type === 'boolean') {
      if (optionPicks.length) {
        answer[field.key] = field.optionValues.get(optionPicks[0]) as boolean;
      } else if (typeof field.defaultValue === 'boolean') {
        answer[field.key] = field.defaultValue;
      } else {
        answer[field.key] = false;
      }
      return;
    }
    if (field.type === 'number' || field.type === 'integer') {
      const raw = customText || (optionPicks.length ? String(field.optionValues.get(optionPicks[0])) : '');
      const parsed = field.type === 'integer' ? Number.parseInt(raw, 10) : Number(raw);
      if (Number.isFinite(parsed)) answer[field.key] = parsed;
      else if (typeof field.defaultValue === 'number') answer[field.key] = field.defaultValue;
      return;
    }
    // string (with options or free text)
    if (customText) answer[field.key] = customText;
    else if (optionPicks.length) answer[field.key] = String(field.optionValues.get(optionPicks[0]));
    else if (typeof field.defaultValue === 'string') answer[field.key] = field.defaultValue;
    else answer[field.key] = '';
  });
  return answer;
}

export async function replyOpenCodeForm(
  target: OpenCodeServerTarget,
  sessionId: string,
  formId: string,
  answer: Record<string, string | number | boolean | string[]>,
): Promise<void> {
  await requestOpenCode(
    target,
    'POST',
    `/api/session/${encodeURIComponent(sessionId)}/form/${encodeURIComponent(formId)}/reply`,
    { answer },
  );
}

export async function listOpenCodeForms(target: OpenCodeServerTarget, sessionId: string): Promise<V2Form[]> {
  const response = await requestOpenCode<{ data?: V2Form[] }>(
    target,
    'GET',
    `/api/session/${encodeURIComponent(sessionId)}/form`,
    undefined,
    LIST_TIMEOUT_MS,
  );
  return Array.isArray(response?.data) ? response.data : [];
}

// ── OpenCode 2 permissions ───────────────────────────────────────────────────

export interface V2Permission {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save?: string[];
  metadata?: Record<string, unknown>;
  message?: string;
}

export function permissionToLegacy(permission: V2Permission): OpenCodePermissionRequest {
  return {
    id: permission.id,
    sessionID: permission.sessionID,
    permission: permission.action,
    patterns: Array.isArray(permission.resources) ? permission.resources : [],
    metadata: permission.metadata,
    always: Array.isArray(permission.save) ? permission.save : [],
  };
}

export async function listOpenCodePermissions(target: OpenCodeServerTarget, sessionId: string): Promise<V2Permission[]> {
  const response = await requestOpenCode<{ data?: V2Permission[] }>(
    target,
    'GET',
    `/api/session/${encodeURIComponent(sessionId)}/permission`,
    undefined,
    LIST_TIMEOUT_MS,
  );
  return Array.isArray(response?.data) ? response.data : [];
}

export async function replyOpenCodePermission(
  target: OpenCodeServerTarget,
  sessionId: string,
  requestId: string,
  reply: 'once' | 'always' | 'reject',
  message?: string,
): Promise<void> {
  await requestOpenCode(
    target,
    'POST',
    `/api/session/${encodeURIComponent(sessionId)}/permission/${encodeURIComponent(requestId)}/reply`,
    message ? { decision: reply, message } : { decision: reply },
  );
}
