// ── Phrase ──
export interface Phrase {
  id: string;
  name: string;
  content: string;
  shortcut?: string;
}

// ── Launch Configuration ──
// 'copilot' and 'antigravity' are kept for backward compatibility with old launch history entries.
export type LaunchTool = 'copilot' | 'opencode' | 'antigravity' | 'claude-code' | 'codex' | 'gemini';

export interface LaunchConfig {
  id: string;
  name: string;
  folder: string;
  shortcut?: string;
}

// ── Settings ──
export type ShortcutModifier = 'ctrl' | 'ctrl+shift' | 'ctrl+alt' | 'ctrl+alt+shift';

export interface Settings {
  theme: 'light' | 'dark' | 'gaudy' | 'cyberpunk';
  language: 'auto' | 'es' | 'en';
  useOneDrive?: boolean;
  pinnedModels?: Partial<Record<LaunchTool, string[]>>;
  showGoModelsOnly?: Partial<Record<LaunchTool, boolean>>;
  phraseShortcutModifier: ShortcutModifier;
  launchShortcutModifier: 'ctrl+shift' | 'ctrl+alt' | 'ctrl+alt+shift';
  openVsCodeShortcutModifier: 'ctrl+shift' | 'ctrl+alt' | 'ctrl+alt+shift';
}

// ── Attached file (transient – not persisted in session) ──
export interface AttachedFile {
  id: string;
  name: string;
  path: string;
  size: number;
}

// ── Tab / Document ──
export interface PhraseRange {
  start: number;
  end: number;
}

export interface Tab {
  id: string;
  title: string;
  path: string | null;
  content: string;
  dirty: boolean;
  lastSavedAt: number | null;
  attachedFiles: AttachedFile[];
  phraseRanges: PhraseRange[];
}

export type CostTier = 'free' | 1 | 2 | 3 | 4 | 5;

export interface ModelCostInfo {
  tier: CostTier;
  tooltip: string;
}

export interface ModelOption {
  id: string;
  label: string;
}

// ── Exact pricing data per model (per 1M tokens) ──
// All prices in USD per 1M tokens. Sourced from the OpenCode Go/Zen docs.
interface ZenPricing {
  input: number;
  output: number;
  cachedRead: number;
  cachedWrite?: number;
}

interface GoPricing {
  per5Hour: string;
  perWeek: string;
  perMonth: string;
}

const ZEN_PRICING: Record<string, ZenPricing> = {
  // Free models
  'big-pickle':              { input: 0,     output: 0,      cachedRead: 0 },
  'deepseek-v4-flash-free':  { input: 0,     output: 0,      cachedRead: 0 },
  'mimo-v2.5-free':          { input: 0,     output: 0,      cachedRead: 0 },
  'nemotron-3-super-free':   { input: 0,     output: 0,      cachedRead: 0 },

  // Tier 1 — output < $1.50 / 1M tokens
  'gpt-5-nano':              { input: 0.05,  output: 0.40,   cachedRead: 0.005 },
  'gpt-5.4-nano':            { input: 0.20,  output: 1.25,   cachedRead: 0.02 },
  'minimax-m2.5':            { input: 0.30,  output: 1.20,   cachedRead: 0.06,  cachedWrite: 0.375 },
  'minimax-m2.7':            { input: 0.30,  output: 1.20,   cachedRead: 0.06,  cachedWrite: 0.375 },
  'qwen3.5-plus':            { input: 0.20,  output: 1.20,   cachedRead: 0.02,  cachedWrite: 0.25 },
  'deepseek-v4-flash':       { input: 0.14,  output: 0.28,   cachedRead: 0.03 },
  'mimo-v2.5':               { input: 0.14,  output: 0.28,   cachedRead: 0.0028 },

  // Tier 2 — $1.50 ≤ output < $3.50
  'gpt-5.1-codex-mini':      { input: 0.25,  output: 2.00,   cachedRead: 0.025 },
  'grok-build-0.1':          { input: 1.00,  output: 2.00,   cachedRead: 0.20 },
  'qwen3.7-plus':            { input: 0.40,  output: 1.60,   cachedRead: 0.04,  cachedWrite: 0.50 },
  'gemini-3-flash':          { input: 0.50,  output: 3.00,   cachedRead: 0.05 },
  'kimi-k2.5':               { input: 0.60,  output: 3.00,   cachedRead: 0.10 },
  'qwen3.6-plus':            { input: 0.50,  output: 3.00,   cachedRead: 0.05,  cachedWrite: 0.625 },
  'glm-5':                   { input: 1.00,  output: 3.20,   cachedRead: 0.20 },
  'deepseek-v4-pro':         { input: 1.74,  output: 3.48,   cachedRead: 0.0145 },
  'mimo-v2.5-pro':           { input: 1.74,  output: 3.48,   cachedRead: 0.0145 },

  // Tier 3 — $3.50 ≤ output < $10.00
  'kimi-k2.6':               { input: 0.95,  output: 4.00,   cachedRead: 0.16 },
  'glm-5.1':                 { input: 1.40,  output: 4.40,   cachedRead: 0.26 },
  'gpt-5.4-mini':            { input: 0.75,  output: 4.50,   cachedRead: 0.075 },
  'claude-haiku-4-5':        { input: 1.00,  output: 5.00,   cachedRead: 0.10,  cachedWrite: 1.25 },
  'gpt-5':                   { input: 1.07,  output: 8.50,   cachedRead: 0.107 },
  'gpt-5-codex':             { input: 1.07,  output: 8.50,   cachedRead: 0.107 },
  'gpt-5.1':                 { input: 1.07,  output: 8.50,   cachedRead: 0.107 },
  'gpt-5.1-codex':           { input: 1.07,  output: 8.50,   cachedRead: 0.107 },
  'gemini-3.5-flash':        { input: 1.50,  output: 9.00,   cachedRead: 0.15 },

  // Tier 4 — $10.00 ≤ output < $25.00
  'gpt-5.1-codex-max':       { input: 1.25,  output: 10.00,  cachedRead: 0.125 },
  'gemini-3.1-pro':          { input: 2.00,  output: 12.00,  cachedRead: 0.20 },
  'gpt-5.2':                 { input: 1.75,  output: 14.00,  cachedRead: 0.175 },
  'gpt-5.2-codex':           { input: 1.75,  output: 14.00,  cachedRead: 0.175 },
  'gpt-5.3-codex':           { input: 1.75,  output: 14.00,  cachedRead: 0.175 },
  'gpt-5.3-codex-spark':     { input: 1.75,  output: 14.00,  cachedRead: 0.175 },
  'claude-sonnet-4':         { input: 3.00,  output: 15.00,  cachedRead: 0.30,  cachedWrite: 3.75 },
  'claude-sonnet-4-5':       { input: 3.00,  output: 15.00,  cachedRead: 0.30,  cachedWrite: 3.75 },
  'claude-sonnet-4-6':       { input: 3.00,  output: 15.00,  cachedRead: 0.30,  cachedWrite: 3.75 },
  'gpt-5.4':                 { input: 2.50,  output: 15.00,  cachedRead: 0.25 },
  'qwen3.7-max':             { input: 2.50,  output: 7.50,   cachedRead: 0.50,  cachedWrite: 3.125 },

  // Tier 5 — output ≥ $25.00
  'claude-opus-4-5':         { input: 5.00,  output: 25.00,  cachedRead: 0.50,  cachedWrite: 6.25 },
  'claude-opus-4-6':         { input: 5.00,  output: 25.00,  cachedRead: 0.50,  cachedWrite: 6.25 },
  'claude-opus-4-7':         { input: 5.00,  output: 25.00,  cachedRead: 0.50,  cachedWrite: 6.25 },
  'claude-opus-4-8':         { input: 5.00,  output: 25.00,  cachedRead: 0.50,  cachedWrite: 6.25 },
  'gpt-5.5':                 { input: 5.00,  output: 30.00,  cachedRead: 0.50 },
  'claude-opus-4-1':         { input: 15.00, output: 75.00,  cachedRead: 1.50,  cachedWrite: 18.75 },
  'gpt-5.4-pro':             { input: 30.00, output: 180.00, cachedRead: 30.00 },
  'gpt-5.5-pro':             { input: 30.00, output: 180.00, cachedRead: 30.00 },

  // Deprecated models (kept for backward compatibility with history entries)
  'claude-3-5-haiku':        { input: 0.80,  output: 4.00,   cachedRead: 0.08,  cachedWrite: 1.00 },
};

const GO_PRICING: Record<string, GoPricing> = {
  'glm-5.1':          { per5Hour: '880',    perWeek: '2,150',  perMonth: '4,300' },
  'glm-5':            { per5Hour: '1,150',  perWeek: '2,880',  perMonth: '5,750' },
  'kimi-k2.6':        { per5Hour: '1,150',  perWeek: '2,880',  perMonth: '5,750' },
  'kimi-k2.5':        { per5Hour: '1,850',  perWeek: '4,630',  perMonth: '9,250' },
  'mimo-v2.5':        { per5Hour: '30,100', perWeek: '75,200', perMonth: '150,400' },
  'mimo-v2.5-pro':    { per5Hour: '3,250',  perWeek: '8,150',  perMonth: '16,300' },
  'minimax-m3':       { per5Hour: '1,400',  perWeek: '3,500',  perMonth: '7,000' },
  'minimax-m2.7':     { per5Hour: '3,400',  perWeek: '8,500',  perMonth: '17,000' },
  'minimax-m2.5':     { per5Hour: '6,300',  perWeek: '15,900', perMonth: '31,800' },
  'qwen3.7-max':      { per5Hour: '950',    perWeek: '2,390',  perMonth: '4,770' },
  'qwen3.7-plus':     { per5Hour: '4,300',  perWeek: '10,800', perMonth: '21,600' },
  'qwen3.6-plus':     { per5Hour: '3,300',  perWeek: '8,200',  perMonth: '16,300' },
  'qwen3.5-plus':     { per5Hour: '4,300',  perWeek: '10,800', perMonth: '21,600' },
  'deepseek-v4-pro':  { per5Hour: '3,450',  perWeek: '8,550',  perMonth: '17,150' },
  'deepseek-v4-flash':{ per5Hour: '31,650', perWeek: '79,050', perMonth: '158,150' },
};

// Brand-new models the CLI may return before we ship a new release.
// Anything in this map gets a tier derived from its output price, so the
// model picker still shows a useful cost indicator even for unreleased
// or experimental entries. Tooltips will fall back to a generic label
// until the matching ZenPricing entry is added above.
const LEGACY_OR_GENERIC_TIER: Array<{ pattern: RegExp; tier: Exclude<CostTier, 'free'> }> = [
  { pattern: /haiku/,           tier: 2 },
  { pattern: /flash/,           tier: 2 },
  { pattern: /mini|nano/,       tier: 1 },
  { pattern: /plus/,            tier: 2 },
  { pattern: /sonnet/,          tier: 4 },
  { pattern: /opus/,            tier: 5 },
  { pattern: /max/,             tier: 4 },
  { pattern: /pro/,             tier: 5 },
  { pattern: /codex/,           tier: 3 },
  { pattern: /gpt-5/,           tier: 3 },
  { pattern: /claude/,          tier: 3 },
  { pattern: /gemini/,          tier: 3 },
];

function getBareId(modelId: string): string {
  return modelId
    .replace(/^opencode(-go)?\//, '')
    .replace(/^antigravity\//, '')
    .replace(/^copilot\//, '')
    .toLowerCase();
}

function findZenPrice(modelId: string): ZenPricing | undefined {
  const bare = getBareId(modelId);
  return ZEN_PRICING[bare];
}

function findGoPrice(modelId: string): GoPricing | undefined {
  const bare = getBareId(modelId);
  return GO_PRICING[bare];
}

function tierFromOutputPrice(output: number): Exclude<CostTier, 'free'> {
  // Price brackets chosen so every tier in the Go/Zen catalog is populated.
  if (output < 1.5)   return 1;
  if (output < 3.5)   return 2;
  if (output < 10.0)  return 3;
  if (output < 25.0)  return 4;
  return 5;
}

const TIER_LABELS: Record<Exclude<CostTier, 'free'>, string> = {
  1: 'Lowest cost',
  2: 'Very low cost',
  3: 'Mid cost',
  4: 'High cost',
  5: 'Highest cost',
};

function buildZenTooltip(id: string, zen: ZenPricing): string {
  const fmt = (n: number) => n === 0 ? 'Free' : '$' + n.toFixed(n < 1 ? 3 : 2);
  const parts: string[] = [];
  parts.push(`Input: ${fmt(zen.input)}/M • Output: ${fmt(zen.output)}/M • Cached read: ${fmt(zen.cachedRead)}/M`);
  if (zen.cachedWrite !== undefined) parts.push(`Cached write: ${fmt(zen.cachedWrite)}/M`);
  return parts.join('\n');
}

function buildGoTooltip(id: string, label: string, go: GoPricing): string {
  return [
    label,
    `Go: ${go.per5Hour} req/5h • ${go.perWeek} req/wk • ${go.perMonth} req/mo`,
  ].join('\n');
}

function buildPricingTooltip(id: string, tier: Exclude<CostTier, 'free'>, zen: ZenPricing | undefined, go: GoPricing | undefined): string {
  const lines: string[] = [TIER_LABELS[tier]];
  if (zen) lines.push(buildZenTooltip(id, zen));
  if (go) lines.push(buildGoTooltip(id, TIER_LABELS[tier], go));
  return lines.join('\n');
}

export function getModelCostInfo(modelId: string): ModelCostInfo | undefined {
  if (!modelId) return;
  const id = modelId.toLowerCase();
  const bare = getBareId(id);

  // Copilot "auto" — no specific cost known.
  if (bare === 'auto') return { tier: 3, tooltip: 'Auto-selects best model for task' };

  // Free models
  if (/\bfree\b/.test(bare) || /big-pickle/.test(bare)) {
    return { tier: 'free', tooltip: 'Free — no usage cost' };
  }

  // Price-based tier for any Zen/Go model that we have pricing data for.
  const zen = findZenPrice(id);
  const go  = findGoPrice(id);
  if (zen) {
    const tier = tierFromOutputPrice(zen.output);
    return { tier, tooltip: buildPricingTooltip(id, tier, zen, go) };
  }

  // No pricing data — pick a tier from the model name so the indicator is
  // still informative. This is only hit for models we have not catalogued
  // (new releases, deprecated stragglers, etc.).
  for (const { pattern, tier } of LEGACY_OR_GENERIC_TIER) {
    if (pattern.test(bare)) {
      return { tier, tooltip: TIER_LABELS[tier] + ' (estimated)' };
    }
  }
}

// ── Electron API type ──
export interface ElectronAPI {
  loadSettings: () => Promise<Settings>;
  saveSettings: (settings: Settings) => Promise<void>;
  loadPhrases: () => Promise<Phrase[]>;
  savePhrases: (phrases: Phrase[]) => Promise<void>;
  loadLaunches: () => Promise<LaunchConfig[]>;
  saveLaunches: (launches: LaunchConfig[]) => Promise<void>;
  loadLaunchHistory: () => Promise<LaunchHistoryEntry[]>;
  saveLaunchHistory: (entries: LaunchHistoryEntry[]) => Promise<void>;
  loadSession: () => Promise<SessionData | null>;
  saveSession: (session: SessionData) => Promise<void>;
  detectOneDrive: () => Promise<string | null>;
  saveFile: (filePath: string, content: string) => Promise<string>;
  saveFileAs: (content: string, defaultName: string) => Promise<string | null>;
  openFile: () => Promise<{ filePath: string; content: string } | null>;
  getPromptsDir: () => Promise<string>;
  executeLaunch: (config: {
    tool: LaunchTool;
    model: string;
    folder: string;
    yolo: boolean;
    prompt: string;
    mode: string;
    attachedFilePaths?: string[];
  }) => Promise<boolean>;
  getOpenCodeModels: () => Promise<ModelOption[]>;
  getCopilotModels: () => Promise<ModelOption[]>;
  getAntigravityModels: () => Promise<ModelOption[]>;
  clearModelCache: () => Promise<void>;
  readClipboardImage: () => Promise<{ name: string; path: string; size: number } | null>;
  clipboardHasImage: () => boolean;
  pickFiles: () => Promise<{ name: string; path: string; size: number }[]>;
  getFileInfo: (filePath: string) => Promise<{ name: string; size: number } | null>;
  saveBlob: (bytes: number[], ext: string) => Promise<{ name: string; path: string; size: number } | null>;
  pickFolder: () => Promise<string | null>;
  getLocale: () => Promise<string>;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<boolean>;
  openVsCode: (folder: string) => Promise<boolean>;
}

// ── Launch History ──
export interface LaunchHistoryEntry {
  id: string;
  launchId: string;
  launchName: string;
  tool: LaunchTool;
  model: string;
  prompt: string;
  timestamp: number;
  folder: string;
}

// ── Session (persisted across restarts) ──
export interface SessionData {
  tabs: Pick<Tab, 'id' | 'title' | 'content' | 'path' | 'phraseRanges'>[];
  activeTabId: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
