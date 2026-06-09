import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings: Record<string, unknown>) => ipcRenderer.invoke('settings:save', settings),

  // Phrases
  loadPhrases: () => ipcRenderer.invoke('phrases:load'),
  savePhrases: (phrases: unknown[]) => ipcRenderer.invoke('phrases:save', phrases),

  // Launches
  loadLaunches: () => ipcRenderer.invoke('launches:load'),
  saveLaunches: (launches: unknown[]) => ipcRenderer.invoke('launches:save', launches),

  // Launch History
  loadLaunchHistory: () => ipcRenderer.invoke('launch-history:load'),
  saveLaunchHistory: (entries: unknown[]) => ipcRenderer.invoke('launch-history:save', entries),

  // Session (tab autosave)
  loadSession: () => ipcRenderer.invoke('session:load'),
  saveSession: (session: unknown) => ipcRenderer.invoke('session:save', session),

  // OneDrive
  detectOneDrive: () => ipcRenderer.invoke('onedrive:detect'),

  // File operations
  saveFile: (filePath: string, content: string) => ipcRenderer.invoke('file:save', filePath, content),
  saveFileAs: (content: string, defaultName: string) => ipcRenderer.invoke('file:save-as', content, defaultName),
  openFile: () => ipcRenderer.invoke('file:open'),
  getPromptsDir: () => ipcRenderer.invoke('file:get-prompts-dir'),

  // Launch
  executeLaunch: (config: {
    tool: string;
    model: string;
    folder: string;
    yolo: boolean;
    prompt: string;
    mode: string;
    attachedFilePaths?: string[];
  }) => ipcRenderer.invoke('launch:execute', config),
  getOpenCodeModels: () => ipcRenderer.invoke('models:get-opencode'),
  getCopilotModels: () => ipcRenderer.invoke('models:get-copilot'),
  getAntigravityModels: () => ipcRenderer.invoke('models:get-antigravity'),
  clearModelCache: () => ipcRenderer.invoke('models:clear-cache'),

  // Read native clipboard image (Snipping Tool, PrintScreen)
  readClipboardImage: () => ipcRenderer.invoke('clipboard:read-image'),
  // Synchronous check so renderer can call e.preventDefault() before any await
  clipboardHasImage: () => ipcRenderer.sendSync('clipboard:has-image') as boolean,

  // Multi-file picker (returns [{name, path, size}])
  pickFiles: () => ipcRenderer.invoke('file:pick-files'),

  // File info
  getFileInfo: (filePath: string) => ipcRenderer.invoke('file:get-info', filePath),

  // Save raw image/blob bytes to a temp file (for clipboard images from Snipping Tool, etc.)
  saveBlob: (bytes: number[], ext: string) => ipcRenderer.invoke('file:save-blob', bytes, ext),

  // Dialogs
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),

  // System
  getLocale: () => ipcRenderer.invoke('system:locale'),
  getAppVersion: () => ipcRenderer.invoke('app:version'),

  // Updater
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),

  // VS Code
  openVsCode: (folder: string) => ipcRenderer.invoke('vscode:open', folder),

  // Statistics
  getOpenCodeStats: () => ipcRenderer.invoke('stats:opencode'),

  // Pricing data from models.dev
  getPricingData: () => ipcRenderer.invoke('pricing:get'),
});
