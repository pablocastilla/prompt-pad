// ── Phrase ──
export interface Phrase {
  id: string;
  name: string;
  content: string;
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
}

export interface ModelOption {
  id: string;
  label: string;
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
