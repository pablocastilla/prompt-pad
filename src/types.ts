// ── Phrase ──
export interface Phrase {
  id: string;
  name: string;
  content: string;
  shortcut?: number;
}

// ── Launch Configuration ──
export type LaunchTool = 'copilot' | 'opencode';

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

export type CostTier = 'free' | 1 | 2 | 3;

export interface ModelCostInfo {
  tier: CostTier;
  tooltip: string;
}

export interface ModelOption {
  id: string;
  label: string;
}

export const MODEL_COST_MAP: Record<string, ModelCostInfo> = {
  // ── Zen free models ──
  'opencode/big-pickle':           { tier: 'free', tooltip: 'Free (all costs $0)' },
  'opencode/deepseek-v4-flash-free': { tier: 'free', tooltip: 'Free (all costs $0)' },
  'opencode/minimax-m2.5-free':    { tier: 'free', tooltip: 'Free (all costs $0)' },
  'opencode/nemotron-3-super-free':{ tier: 'free', tooltip: 'Free (all costs $0)' },

  // ── Zen cheap: 1 bar (output ≤ $5/1M) ──
  'opencode/gpt-5-nano':           { tier: 1, tooltip: '$0.05 in · $0.40 out / 1M tokens' },
  'opencode/qwen3.5-plus':         { tier: 1, tooltip: '$0.20 in · $1.20 out / 1M tokens' },
  'opencode/gpt-5.4-nano':         { tier: 1, tooltip: '$0.20 in · $1.25 out / 1M tokens' },
  'opencode/gpt-5.1-codex-mini':   { tier: 1, tooltip: '$0.25 in · $2.00 out / 1M tokens' },
  'opencode/minimax-m2.7':         { tier: 1, tooltip: '$0.30 in · $1.20 out / 1M tokens' },
  'opencode/minimax-m2.5':         { tier: 1, tooltip: '$0.30 in · $1.20 out / 1M tokens' },
  'opencode/gemini-3-flash':       { tier: 1, tooltip: '$0.50 in · $3.00 out / 1M tokens' },
  'opencode/qwen3.6-plus':         { tier: 1, tooltip: '$0.50 in · $3.00 out / 1M tokens' },
  'opencode/kimi-k2.5':            { tier: 1, tooltip: '$0.60 in · $3.00 out / 1M tokens' },
  'opencode/gpt-5.4-mini':         { tier: 1, tooltip: '$0.75 in · $4.50 out / 1M tokens' },
  'opencode/kimi-k2.6':            { tier: 1, tooltip: '$0.95 in · $4.00 out / 1M tokens' },
  'opencode/glm-5':                { tier: 1, tooltip: '$1.00 in · $3.20 out / 1M tokens' },
  'opencode/claude-haiku-4-5':     { tier: 1, tooltip: '$1.00 in · $5.00 out / 1M tokens' },

  // ── Zen mid: 2 bars (output $5.01–$15/1M) ──
  'opencode/gpt-5':                { tier: 2, tooltip: '$1.07 in · $8.50 out / 1M tokens' },
  'opencode/gpt-5-codex':          { tier: 2, tooltip: '$1.07 in · $8.50 out / 1M tokens' },
  'opencode/gpt-5.1':              { tier: 2, tooltip: '$1.07 in · $8.50 out / 1M tokens' },
  'opencode/gpt-5.1-codex':        { tier: 2, tooltip: '$1.07 in · $8.50 out / 1M tokens' },
  'opencode/gpt-5.1-codex-max':    { tier: 2, tooltip: '$1.25 in · $10.00 out / 1M tokens' },
  'opencode/glm-5.1':              { tier: 2, tooltip: '$1.40 in · $4.40 out / 1M tokens' },
  'opencode/gpt-5.3-codex':        { tier: 2, tooltip: '$1.75 in · $14.00 out / 1M tokens' },
  'opencode/gpt-5.3-codex-spark':  { tier: 2, tooltip: '$1.75 in · $14.00 out / 1M tokens' },
  'opencode/gpt-5.2':              { tier: 2, tooltip: '$1.75 in · $14.00 out / 1M tokens' },
  'opencode/gpt-5.2-codex':        { tier: 2, tooltip: '$1.75 in · $14.00 out / 1M tokens' },
  'opencode/gemini-3.1-pro':       { tier: 2, tooltip: '$2.00 in · $12.00 out / 1M tokens (≤200K)' },
  'opencode/gpt-5.4':              { tier: 2, tooltip: '$2.50 in · $15.00 out / 1M tokens (≤272K)' },
  'opencode/claude-sonnet-4.6':    { tier: 2, tooltip: '$3.00 in · $15.00 out / 1M tokens' },
  'opencode/claude-sonnet-4-5':    { tier: 2, tooltip: '$3.00 in · $15.00 out / 1M tokens (≤200K)' },
  'opencode/claude-sonnet-4':      { tier: 2, tooltip: '$3.00 in · $15.00 out / 1M tokens (≤200K)' },
  'opencode/gpt-5.5':              { tier: 2, tooltip: '$5.00 in · $30.00 out / 1M tokens (≤272K)' },
  'opencode/claude-opus-4.7':      { tier: 2, tooltip: '$5.00 in · $25.00 out / 1M tokens' },
  'opencode/claude-opus-4-6':      { tier: 2, tooltip: '$5.00 in · $25.00 out / 1M tokens' },
  'opencode/claude-opus-4-5':      { tier: 2, tooltip: '$5.00 in · $25.00 out / 1M tokens' },

  // ── Zen expensive: 3 bars (output > $15/1M) ──
  'opencode/gpt-5.5-pro':          { tier: 3, tooltip: '$30.00 in · $180.00 out / 1M tokens' },
  'opencode/gpt-5.4-pro':          { tier: 3, tooltip: '$30.00 in · $180.00 out / 1M tokens' },
  'opencode/claude-opus-4-1':      { tier: 3, tooltip: '$15.00 in · $75.00 out / 1M tokens' },

  // ── Go models (tier based on requests per 5h: higher = cheaper) ──
  'opencode-go/deepseek-v4-flash': { tier: 1, tooltip: '31,650 req/5h — cheapest Go model' },
  'opencode-go/qwen3.5-plus':      { tier: 1, tooltip: '10,200 req/5h' },
  'opencode-go/minimax-m2.5':      { tier: 1, tooltip: '6,300 req/5h' },
  'opencode-go/minimax-m2.7':      { tier: 2, tooltip: '3,400 req/5h' },
  'opencode-go/deepseek-v4-pro':   { tier: 2, tooltip: '3,450 req/5h' },
  'opencode-go/qwen3.6-plus':      { tier: 2, tooltip: '3,300 req/5h' },
  'opencode-go/mimo-v2.5':         { tier: 2, tooltip: '2,150 req/5h' },
  'opencode-go/kimi-k2.5':         { tier: 2, tooltip: '1,850 req/5h' },
  'opencode-go/mimo-v2.5-pro':     { tier: 3, tooltip: '1,290 req/5h' },
  'opencode-go/glm-5':             { tier: 3, tooltip: '1,150 req/5h' },
  'opencode-go/kimi-k2.6':         { tier: 3, tooltip: '1,150 req/5h' },
  'opencode-go/glm-5.1':           { tier: 3, tooltip: '880 req/5h — most expensive Go model' },

  // ── Copilot models ──
  'auto':                          { tier: 2, tooltip: 'Auto-selects best model for task' },
  'claude-sonnet-4.6':             { tier: 2, tooltip: 'Copilot model — balanced speed/quality' },
  'gpt-4.5':                       { tier: 3, tooltip: 'Copilot model — high quality' },
};

export function getModelCostInfo(modelId: string): ModelCostInfo | undefined {
  return MODEL_COST_MAP[modelId];
}

export interface PinnedModel {
  modelId: string;
  order: number;
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

/** @deprecated Use COPILOT_MODELS or OPENCODE_MODELS */
export const AVAILABLE_MODELS = COPILOT_MODELS;

export type CopilotModelId = typeof COPILOT_MODELS[number]['id'];
export type OpenCodeModelId = typeof OPENCODE_MODELS[number]['id'];
export type AvailableModelId = CopilotModelId;

const ALLOWED_COPILOT_IDS = new Set<string>(COPILOT_MODELS.map(m => m.id));
const ALLOWED_OPENCODE_IDS = new Set<string>(OPENCODE_MODELS.map(m => m.id));

export function isAllowedModelId(modelId: string | undefined): modelId is AvailableModelId {
  return !!modelId && ALLOWED_COPILOT_IDS.has(modelId);
}

export function isAllowedOpenCodeModelId(modelId: string | undefined): modelId is OpenCodeModelId {
  return !!modelId && ALLOWED_OPENCODE_IDS.has(modelId);
}

export function normalizeModelId(modelId: string | undefined): AvailableModelId {
  return isAllowedModelId(modelId) ? modelId : COPILOT_MODELS[0].id;
}

export function normalizeOpenCodeModelId(modelId: string | undefined): OpenCodeModelId {
  return isAllowedOpenCodeModelId(modelId) ? modelId : OPENCODE_MODELS[0].id;
}

export function modelsForTool(tool: LaunchTool): ReadonlyArray<{ id: string; label: string }> {
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
    tool: 'copilot' | 'opencode';
    model: string;
    folder: string;
    yolo: boolean;
    prompt: string;
    mode: string;
    attachedFilePaths?: string[];
  }) => Promise<boolean>;
  getOpenCodeModels: () => Promise<ModelOption[]>;
  getCopilotModels: () => Promise<ModelOption[]>;
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
