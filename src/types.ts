// ── Phrase ──
export interface Phrase {
  id: string;
  name: string;
  content: string;
  shortcut?: number;
}

// ── Launch Configuration ──
export type LaunchTool = 'copilot' | 'opencode' | 'antigravity';

export interface LaunchConfig {
  id: string;
  name: string;
  tool: LaunchTool;
  model?: string;  // chosen at launch time, not stored in config form
  folder: string;
  yolo: boolean;
  mode: 'interactive' | 'non-interactive';
  shortcut?: number;
}

// ── Attached file (transient – not persisted in session) ──
export interface AttachedFile {
  id: string;
  name: string;
  path: string;
  size: number;
}

// ── Tab / Document ──
export interface Tab {
  id: string;
  title: string;
  path: string | null;
  content: string;
  dirty: boolean;
  lastSavedAt: number | null;
  attachedFiles: AttachedFile[];
}

// ── Settings ──
export interface Settings {
  theme: 'light' | 'dark' | 'gaudy' | 'cyberpunk';
  language: 'auto' | 'es' | 'en';
  useOneDrive?: boolean;
  pinnedModels?: Partial<Record<LaunchTool, string[]>>;
  showGoModelsOnly?: Partial<Record<LaunchTool, boolean>>;
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
interface ZenPricing {
  input: string;
  output: string;
  cachedRead: string;
  cachedWrite?: string;
}

interface GoPricing {
  per5Hour: string;
  perWeek: string;
  perMonth: string;
}

const ZEN_PRICING: Record<string, ZenPricing> = {
  'gpt-5.5':         { input: '$5.00',   output: '$30.00',  cachedRead: '$0.50' },
  'gpt-5.5-pro':     { input: '$30.00',  output: '$180.00', cachedRead: '$30.00' },
  'gpt-5.4':         { input: '$2.50',   output: '$15.00',  cachedRead: '$0.25' },
  'gpt-5.4-pro':     { input: '$30.00',  output: '$180.00', cachedRead: '$30.00' },
  'gpt-5.4-mini':    { input: '$0.75',   output: '$4.50',   cachedRead: '$0.075' },
  'gpt-5.4-nano':    { input: '$0.20',   output: '$1.25',   cachedRead: '$0.02' },
  'gpt-5.3-codex':   { input: '$1.75',   output: '$14.00',  cachedRead: '$0.175' },
  'gpt-5.3-codex-spark': { input: '$1.75', output: '$14.00', cachedRead: '$0.175' },
  'gpt-5.2':         { input: '$1.75',   output: '$14.00',  cachedRead: '$0.175' },
  'gpt-5.2-codex':   { input: '$1.75',   output: '$14.00',  cachedRead: '$0.175' },
  'gpt-5.1':         { input: '$1.07',   output: '$8.50',   cachedRead: '$0.107' },
  'gpt-5.1-codex':   { input: '$1.07',   output: '$8.50',   cachedRead: '$0.107' },
  'gpt-5.1-codex-max': { input: '$1.25', output: '$10.00',  cachedRead: '$0.125' },
  'gpt-5.1-codex-mini': { input: '$0.25', output: '$2.00',  cachedRead: '$0.025' },
  'gpt-5':           { input: '$1.07',   output: '$8.50',   cachedRead: '$0.107' },
  'gpt-5-codex':     { input: '$1.07',   output: '$8.50',   cachedRead: '$0.107' },
  'gpt-5-nano':      { input: '$0.05',   output: '$0.40',   cachedRead: '$0.005' },
  'claude-opus-4-7': { input: '$5.00',   output: '$25.00',  cachedRead: '$0.50',  cachedWrite: '$6.25' },
  'claude-opus-4-6': { input: '$5.00',   output: '$25.00',  cachedRead: '$0.50',  cachedWrite: '$6.25' },
  'claude-opus-4-5': { input: '$5.00',   output: '$25.00',  cachedRead: '$0.50',  cachedWrite: '$6.25' },
  'claude-opus-4-1': { input: '$15.00',  output: '$75.00',  cachedRead: '$1.50',  cachedWrite: '$18.75' },
  'claude-sonnet-4-6': { input: '$3.00', output: '$15.00',  cachedRead: '$0.30',  cachedWrite: '$3.75' },
  'claude-sonnet-4-5': { input: '$3.00', output: '$15.00',  cachedRead: '$0.30',  cachedWrite: '$3.75' },
  'claude-sonnet-4':  { input: '$3.00',  output: '$15.00',  cachedRead: '$0.30',  cachedWrite: '$3.75' },
  'claude-haiku-4-5': { input: '$1.00',  output: '$5.00',   cachedRead: '$0.10',  cachedWrite: '$1.25' },
  'gemini-3.1-pro':  { input: '$2.00',   output: '$12.00',  cachedRead: '$0.20' },
  'gemini-3-flash':  { input: '$0.50',   output: '$3.00',   cachedRead: '$0.05' },
  'qwen3.6-plus':    { input: '$0.50',   output: '$3.00',   cachedRead: '$0.05',  cachedWrite: '$0.625' },
  'qwen3.5-plus':    { input: '$0.20',   output: '$1.20',   cachedRead: '$0.02',  cachedWrite: '$0.25' },
  'minimax-m2.7':    { input: '$0.30',   output: '$1.20',   cachedRead: '$0.06',  cachedWrite: '$0.375' },
  'minimax-m2.5':    { input: '$0.30',   output: '$1.20',   cachedRead: '$0.06',  cachedWrite: '$0.375' },
  'glm-5.1':         { input: '$1.40',   output: '$4.40',   cachedRead: '$0.26' },
  'glm-5':           { input: '$1.00',   output: '$3.20',   cachedRead: '$0.20' },
  'kimi-k2.5':       { input: '$0.60',   output: '$3.00',   cachedRead: '$0.10' },
  'kimi-k2.6':       { input: '$0.95',   output: '$4.00',   cachedRead: '$0.16' },
};

const GO_PRICING: Record<string, GoPricing> = {
  'glm-5.1':          { per5Hour: '880',  perWeek: '2,150',  perMonth: '4,300' },
  'glm-5':            { per5Hour: '1,150', perWeek: '2,880', perMonth: '5,750' },
  'kimi-k2.5':        { per5Hour: '1,850', perWeek: '4,630', perMonth: '9,250' },
  'kimi-k2.6':        { per5Hour: '1,150', perWeek: '2,880', perMonth: '5,750' },
  'mimo-v2.5':        { per5Hour: '2,150', perWeek: '5,450', perMonth: '10,900' },
  'mimo-v2.5-pro':    { per5Hour: '1,290', perWeek: '3,225', perMonth: '6,450' },
  'minimax-m2.7':     { per5Hour: '3,400', perWeek: '8,500', perMonth: '17,000' },
  'minimax-m2.5':     { per5Hour: '6,300', perWeek: '15,900', perMonth: '31,800' },
  'qwen3.6-plus':     { per5Hour: '3,300', perWeek: '8,200', perMonth: '16,300' },
  'qwen3.5-plus':     { per5Hour: '10,200', perWeek: '25,200', perMonth: '50,500' },
  'deepseek-v4-pro':  { per5Hour: '3,450', perWeek: '8,550', perMonth: '17,150' },
  'deepseek-v4-flash': { per5Hour: '31,650', perWeek: '79,050', perMonth: '158,150' },
};

function findZenPrice(id: string): ZenPricing | undefined {
  const parts = id.replace(/^opencode\//, '').replace(/-/g, '-');
  const keys = Object.keys(ZEN_PRICING);
  for (const key of keys) {
    if (parts.includes(key) || key.includes(parts) || id.includes(key)) {
      return ZEN_PRICING[key];
    }
  }
  return undefined;
}

function findGoPrice(id: string): GoPricing | undefined {
  const parts = id.replace(/^opencode-go\//, '').replace(/-/g, '-');
  const keys = Object.keys(GO_PRICING);
  for (const key of keys) {
    if (parts.includes(key) || key.includes(parts) || id.includes(key)) {
      return GO_PRICING[key];
    }
  }
  return undefined;
}

type TooltipFn = (id: string) => string;

const tierTooltips: Record<string, TooltipFn> = {
  free: () => 'Free — no usage cost',
  '1':   (id: string) => buildPricingTooltip(id, 'Lowest cost'),
  '2':   (id: string) => buildPricingTooltip(id, 'Very low cost'),
  '3':   (id: string) => buildPricingTooltip(id, 'Mid cost'),
  '4':   (id: string) => buildPricingTooltip(id, 'High cost'),
  '5':   (id: string) => buildPricingTooltip(id, 'Highest cost'),
};

function buildPricingTooltip(id: string, label: string): string {
  const zen = findZenPrice(id);
  const go = findGoPrice(id);
  if (!zen && !go) return label;
  const lines: string[] = [label];
  if (zen) {
    lines.push(`Input: ${zen.input}/M • Output: ${zen.output}/M • Cached: ${zen.cachedRead}/M`);
    if (zen.cachedWrite) lines.push(`Cached write: ${zen.cachedWrite}/M`);
  }
  if (go) {
    lines.push(`Go: ${go.per5Hour} req/5h • ${go.perWeek} req/wk • ${go.perMonth} req/mo`);
  }
  return lines.join('\n');
}

export function getModelCostInfo(modelId: string): ModelCostInfo | undefined {
  if (!modelId) return;
  const id = modelId.toLowerCase();

  // Free models
  if (/\bfree\b/.test(id) || /big-pickle/.test(id))
    return { tier: 'free', tooltip: tierTooltips.free(id) };

  // Zen models (opencode/*)
  if (id.startsWith('opencode/')) {
    if (/nano/.test(id))      return { tier: 1, tooltip: tierTooltips['1'](id) };
    if (/mini/.test(id))      return { tier: 2, tooltip: tierTooltips['2'](id) };
    if (/haiku/.test(id))     return { tier: 2, tooltip: tierTooltips['2'](id) };
    if (/flash/.test(id))     return { tier: 2, tooltip: tierTooltips['2'](id) };
    if (/sonnet/.test(id))    return { tier: 3, tooltip: tierTooltips['3'](id) };
    if (/plus/.test(id))      return { tier: 3, tooltip: tierTooltips['3'](id) };
    if (/codex/.test(id))     return { tier: 3, tooltip: tierTooltips['3'](id) };
    if (/opus/.test(id))      return { tier: 4, tooltip: tierTooltips['4'](id) };
    if (/(5\.\d).*pro/.test(id)) return { tier: 5, tooltip: tierTooltips['5'](id) };
    if (/pro/.test(id))       return { tier: 4, tooltip: tierTooltips['4'](id) };
    if (/max/.test(id))       return { tier: 5, tooltip: tierTooltips['5'](id) };
    return { tier: 3, tooltip: tierTooltips['3'](id) };
  }

  // Go models (opencode-go/*)
  if (id.startsWith('opencode-go/')) {
    if (/flash/.test(id))     return { tier: 1, tooltip: tierTooltips['1'](id) };
    if (/qwen.*plus/.test(id)) return { tier: 2, tooltip: tierTooltips['2'](id) };
    if (/m2\.5/.test(id))     return { tier: 2, tooltip: tierTooltips['2'](id) };
    if (/plus/.test(id))      return { tier: 2, tooltip: tierTooltips['2'](id) };
    if (/m2\.7/.test(id))     return { tier: 3, tooltip: tierTooltips['3'](id) };
    if (/pro/.test(id))       return { tier: 3, tooltip: tierTooltips['3'](id) };
    if (/kimi/.test(id))      return { tier: 3, tooltip: tierTooltips['3'](id) };
    if (/mimo/.test(id))      return { tier: 3, tooltip: tierTooltips['3'](id) };
    if (/glm/.test(id))       return { tier: 4, tooltip: tierTooltips['4'](id) };
    return { tier: 3, tooltip: tierTooltips['3'](id) };
  }

  // Copilot / other models
  if (id === 'auto')          return { tier: 3, tooltip: 'Auto-selects best model for task' };
  if (/sonnet/.test(id))      return { tier: 3, tooltip: tierTooltips['3'](id) };
  if (/opus/.test(id))        return { tier: 4, tooltip: tierTooltips['4'](id) };
  if (/gpt/.test(id))         return { tier: 4, tooltip: tierTooltips['4'](id) };
  if (/claude/.test(id))      return { tier: 3, tooltip: tierTooltips['3'](id) };
}

// ── Default model fallbacks ──
export const COPILOT_MODELS = [
  { id: 'auto', label: 'auto' },
  { id: 'claude-sonnet-4.6', label: 'claude-sonnet-4.6' },
  { id: 'claude-opus-4.6', label: 'Claude Opus 4.6 (Smart)' },
  { id: 'gpt-4.5', label: 'gpt-4.5' },
] as const;

export const OPENCODE_MODELS = [
  { id: 'opencode/kimi-k2.6', label: 'Kimi K2.6' },
  { id: 'opencode/minimax-m2.7', label: 'Minimax M2.7' },
  { id: 'opencode/minimax-m2.5-free', label: 'Minimax M2.5 Free' },
] as const;

export const ANTIGRAVITY_MODELS = [
  { id: 'antigravity/default', label: 'Antigravity Default' },
] as const;

export function modelsForTool(tool: LaunchTool): ReadonlyArray<{ id: string; label: string }> {
  if (tool === 'antigravity') return ANTIGRAVITY_MODELS;
  return tool === 'opencode' ? OPENCODE_MODELS : COPILOT_MODELS;
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
    tool: 'copilot' | 'opencode' | 'antigravity';
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
  yolo: boolean;
  mode: 'interactive' | 'non-interactive';
}

// ── Session (persisted across restarts) ──
export interface SessionData {
  tabs: Pick<Tab, 'id' | 'title' | 'content' | 'path'>[];
  activeTabId: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
