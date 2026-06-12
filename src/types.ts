// ── Phrase ──
export interface Phrase {
  id: string;
  name: string;
  content: string;
  shortcut?: string;
}

// ── Launch Configuration ──
// 'gemini' is kept for backward compatibility with old launch history entries.
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
  showFreeModelsOnly?: Partial<Record<LaunchTool, boolean>>;
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

interface RemotePricing {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

// Fallback pricing data used when the remote source cannot be reached.
const ZEN_PRICING: Record<string, ZenPricing> = {
  'big-pickle':              { input: 0,     output: 0,      cachedRead: 0 },
  'deepseek-v4-flash-free':  { input: 0,     output: 0,      cachedRead: 0 },
  'mimo-v2.5-free':          { input: 0,     output: 0,      cachedRead: 0 },
  'nemotron-3-super-free':   { input: 0,     output: 0,      cachedRead: 0 },

  'gpt-5-nano':              { input: 0.05,  output: 0.40,   cachedRead: 0.005 },
  'gpt-5.4-nano':            { input: 0.20,  output: 1.25,   cachedRead: 0.02 },
  'minimax-m2.5':            { input: 0.30,  output: 1.20,   cachedRead: 0.06,  cachedWrite: 0.375 },
  'minimax-m2.7':            { input: 0.30,  output: 1.20,   cachedRead: 0.06,  cachedWrite: 0.375 },
  'qwen3.5-plus':            { input: 0.20,  output: 1.20,   cachedRead: 0.02,  cachedWrite: 0.25 },
  'deepseek-v4-flash':       { input: 0.14,  output: 0.28,   cachedRead: 0.03 },
  'mimo-v2.5':               { input: 0.14,  output: 0.28,   cachedRead: 0.0028 },

  'gpt-5.1-codex-mini':      { input: 0.25,  output: 2.00,   cachedRead: 0.025 },
  'grok-build-0.1':          { input: 1.00,  output: 2.00,   cachedRead: 0.20 },
  'qwen3.7-plus':            { input: 0.40,  output: 1.60,   cachedRead: 0.04,  cachedWrite: 0.50 },
  'gemini-3-flash':          { input: 0.50,  output: 3.00,   cachedRead: 0.05 },
  'kimi-k2.5':               { input: 0.60,  output: 3.00,   cachedRead: 0.10 },
  'qwen3.6-plus':            { input: 0.50,  output: 3.00,   cachedRead: 0.05,  cachedWrite: 0.625 },
  'glm-5':                   { input: 1.00,  output: 3.20,   cachedRead: 0.20 },
  'deepseek-v4-pro':         { input: 1.74,  output: 3.48,   cachedRead: 0.0145 },
  'mimo-v2.5-pro':           { input: 1.74,  output: 3.48,   cachedRead: 0.0145 },

  'kimi-k2.6':               { input: 0.95,  output: 4.00,   cachedRead: 0.16 },
  'glm-5.1':                 { input: 1.40,  output: 4.40,   cachedRead: 0.26 },
  'gpt-5.4-mini':            { input: 0.75,  output: 4.50,   cachedRead: 0.075 },
  'claude-haiku-4-5':        { input: 1.00,  output: 5.00,   cachedRead: 0.10,  cachedWrite: 1.25 },
  'gpt-5':                   { input: 1.07,  output: 8.50,   cachedRead: 0.107 },
  'gpt-5-codex':             { input: 1.07,  output: 8.50,   cachedRead: 0.107 },
  'gpt-5.1':                 { input: 1.07,  output: 8.50,   cachedRead: 0.107 },
  'gpt-5.1-codex':           { input: 1.07,  output: 8.50,   cachedRead: 0.107 },
  'gemini-3.5-flash':        { input: 1.50,  output: 9.00,   cachedRead: 0.15 },

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

  'claude-opus-4-5':         { input: 5.00,  output: 25.00,  cachedRead: 0.50,  cachedWrite: 6.25 },
  'claude-opus-4-6':         { input: 5.00,  output: 25.00,  cachedRead: 0.50,  cachedWrite: 6.25 },
  'claude-opus-4-7':         { input: 5.00,  output: 25.00,  cachedRead: 0.50,  cachedWrite: 6.25 },
  'claude-opus-4-8':         { input: 5.00,  output: 25.00,  cachedRead: 0.50,  cachedWrite: 6.25 },
  'gpt-5.5':                 { input: 5.00,  output: 30.00,  cachedRead: 0.50 },
  'claude-opus-4-1':         { input: 15.00, output: 75.00,  cachedRead: 1.50,  cachedWrite: 18.75 },
  'gpt-5.4-pro':             { input: 30.00, output: 180.00, cachedRead: 30.00 },
  'gpt-5.5-pro':             { input: 30.00, output: 180.00, cachedRead: 30.00 },

  'claude-3-5-haiku':        { input: 0.80,  output: 4.00,   cachedRead: 0.08,  cachedWrite: 1.00 },
};

// Remote pricing data populated from https://models.dev/api.json on startup.
let remotePricing: Record<string, RemotePricing> | null = null;

export async function initPricingData(): Promise<void> {
  try {
    const data = await window.electronAPI.getPricingData();
    if (data) {
      remotePricing = data;
    }
  } catch {
    // Fall back to hardcoded data
  }
}

function findRemotePricing(modelId: string): RemotePricing | undefined {
  if (!remotePricing) return;
  const bare = getBareId(modelId);
  return remotePricing[bare];
}

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

function tierFromOutputPrice(output: number): Exclude<CostTier, 'free'> {
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

function formatPricing(n: number): string {
  return n === 0 ? 'Free' : '$' + n.toFixed(n < 1 ? 3 : 2);
}

function buildPricingTooltip(tier: Exclude<CostTier, 'free'>, pricing: { input: number; output: number; cache_read?: number; cache_write?: number }): string {
  const parts: string[] = [TIER_LABELS[tier]];
  parts.push(`Input: ${formatPricing(pricing.input)}/M • Output: ${formatPricing(pricing.output)}/M`);
  if (pricing.cache_read !== undefined) {
    parts.push(`Cached read: ${formatPricing(pricing.cache_read)}/M`);
  }
  if (pricing.cache_write !== undefined) {
    parts.push(`Cached write: ${formatPricing(pricing.cache_write)}/M`);
  }
  parts.push('Pricing: models.dev');
  return parts.join('\n');
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

  // Remote pricing data takes priority
  const remote = findRemotePricing(id);
  if (remote) {
    const tier = tierFromOutputPrice(remote.output);
    return { tier, tooltip: buildPricingTooltip(tier, remote) };
  }

  // Fallback to hardcoded Zen pricing
  const zen = findZenPrice(id);
  if (zen) {
    const tier = tierFromOutputPrice(zen.output);
    return { tier, tooltip: buildPricingTooltip(tier, { input: zen.input, output: zen.output, cache_read: zen.cachedRead, cache_write: zen.cachedWrite }) };
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

// ── OpenCode Statistics ──
export interface OpenCodeModelCost {
  modelId: string;
  cost: number;
  sessions: number;
  tokensIn: number;
  tokensOut: number;
}

export interface OpenCodeDayCost {
  date: string;       // 'YYYY-MM-DD'
  cost: number;
  sessions: number;
  tokensIn: number;
  tokensOut: number;
  models: OpenCodeModelCost[];
}

export interface OpenCodeStats {
  days: OpenCodeDayCost[];
  totalCost: number;
  totalSessions: number;
  dbPath: string | null;
}

// ── GitHub PR Statistics ──
export interface DayPRs {
  date: string;
  count: number;
}

export interface PRStats {
  days: DayPRs[];
  total: number;
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
  getOpenCodeStats: () => Promise<OpenCodeStats>;
  getPRStats: () => Promise<PRStats>;
  getPricingData: () => Promise<Record<string, { input: number; output: number; cache_read?: number; cache_write?: number }> | null>;
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
