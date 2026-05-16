import { app, BrowserWindow, ipcMain, dialog, Menu, clipboard, nativeImage } from 'electron';
import { setupAutoUpdater, registerUpdateIPC } from './updater';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';

const TEST_DIR = process.env.PROMPT_PAD_TEST_DIR || null;
const APP_DIR    = TEST_DIR ? TEST_DIR : path.join(os.homedir(), '.prompt-pad');
const PROMPTS_DIR = path.join(APP_DIR, 'prompts');
const FALLBACK_COPILOT_MODELS = [
  { id: 'auto', label: 'auto' },
  { id: 'claude-sonnet-4.6', label: 'claude-sonnet-4.6' },
  { id: 'claude-opus-4.6', label: 'claude-opus-4.6' },
  { id: 'gpt-4.5', label: 'gpt-4.5' },
];
const FALLBACK_OPENCODE_MODELS = [
  { id: 'opencode/kimi-k2.6', label: 'Kimi K2.6' },
  { id: 'opencode/minimax-m2.7', label: 'Minimax M2.7' },
  { id: 'opencode/minimax-m2.5-free', label: 'Minimax M2.5 Free' },
];
const DEFAULT_MODEL = 'claude-sonnet-4.6';
const DEFAULT_OPENCODE_MODEL = 'opencode/minimax-m2.7';

// Maximum reasoning effort supported by each model
const MODEL_MAX_EFFORT: Record<string, string> = {
  'claude-opus-4.6':   'high',
  'claude-sonnet-4.6': 'high',
  'gpt-4.5':           'xhigh',
};
function maxEffortForModel(model: string): string {
  return MODEL_MAX_EFFORT[model] ?? 'high';
}

// ── OneDrive detection ─────────────────────────────────────────────────
function detectOneDrivePath(): string | null {
  if (process.platform === 'win32') {
    const candidates = [
      process.env['OneDriveConsumer'],
      process.env['OneDrive'],
      path.join(os.homedir(), 'OneDrive'),
    ].filter(Boolean) as string[];
    const found = candidates.find(p => fs.existsSync(p));
    return found ? path.join(found, 'Apps', 'PromptPad') : null;
  }
  if (process.platform === 'darwin') {
    const candidates = [
      path.join(os.homedir(), 'Library', 'CloudStorage', 'OneDrive-Personal'),
      path.join(os.homedir(), 'OneDrive'),
    ];
    const found = candidates.find(p => fs.existsSync(p));
    return found ? path.join(found, 'Apps', 'PromptPad') : null;
  }
  return null;
}

// Runtime-mutable sync preference (updated when settings are saved)
let useOneDrive = true;

function getSyncDir(): string {
  if (TEST_DIR) return APP_DIR; // Never use OneDrive in test mode
  if (!useOneDrive) return APP_DIR;
  const odPath = detectOneDrivePath();
  if (odPath) {
    if (!fs.existsSync(odPath)) fs.mkdirSync(odPath, { recursive: true });
    return odPath;
  }
  return APP_DIR;
}

const localSettingsPath = path.join(APP_DIR, 'settings.json');

function getSettingsPath(): string {
  const syncSettingsPath = path.join(getSyncDir(), 'settings.json');
  if (syncSettingsPath !== localSettingsPath && !fs.existsSync(syncSettingsPath) && fs.existsSync(localSettingsPath)) {
    // Migrate settings once to the active sync directory.
    fs.copyFileSync(localSettingsPath, syncSettingsPath);
  }
  return syncSettingsPath;
}

function normalizeModel(model: unknown): string {
  if (typeof model !== 'string') return DEFAULT_MODEL;
  const candidate = model.trim();
  return candidate || DEFAULT_MODEL;
}

function normalizeOpenCodeModel(model: unknown): string {
  if (typeof model !== 'string') return DEFAULT_OPENCODE_MODEL;
  const candidate = model.trim();
  return candidate || DEFAULT_OPENCODE_MODEL;
}

function sanitizeLaunches(launches: unknown[]): unknown[] {
  return launches.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const launch = item as Record<string, unknown>;
    const tool = launch.tool === 'opencode' ? 'opencode' : 'copilot';
    return { ...launch, tool, model: tool === 'opencode' ? normalizeOpenCodeModel(launch.model) : normalizeModel(launch.model) };
  });
}

function runCommand(command: string, args: string[], timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let output = '';
    let errorOutput = '';
    proc.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
    proc.stderr?.on('data', (data: Buffer) => { errorOutput += data.toString(); });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(errorOutput || `Command failed with code ${String(code)}`));
    });
  });
}

function parseOpenCodeModels(raw: string): Array<{ id: string; label: string }> {
  const unique = new Map<string, { id: string; label: string }>();
  for (const line of raw.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean.startsWith('opencode/')) continue;
    unique.set(clean, {
      id: clean,
      label: clean.replace(/^opencode\//, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    });
  }
  return [...unique.values()];
}

function parseCopilotModels(raw: string): Array<{ id: string; label: string }> {
  const unique = new Set<string>();
  const lines = raw.split(/\r?\n/);
  let inModelSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inModelSection) {
      if (trimmed.startsWith('`model`:')) {
        inModelSection = true;
      }
      continue;
    }

    // End section when the next config key starts.
    if (trimmed.startsWith('`') && trimmed !== '`model`: AI model to use for Copilot CLI; can be changed with /model command or --model flag option.') {
      break;
    }

    // Model list entries are rendered as: - "model-name"
    const quoted = trimmed.match(/^-\s+"([^"]+)"$/);
    if (!quoted) continue;
    unique.add(quoted[1]);
  }

  const list = [...unique].map((model) => ({ id: model, label: model }));
  return [{ id: 'auto', label: 'auto' }, ...list.filter(m => m.id !== 'auto')];
}

function ensureAppDirs() {
  for (const dir of [APP_DIR, PROMPTS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function atomicWrite(filePath: string, data: string) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, data, 'utf-8');
  fs.renameSync(tmp, filePath);
}

// Safe write that always writes to the correct location (OneDrive or local)
function safeWrite(filePath: string, data: string) {
  atomicWrite(filePath, data);
}

function readJson<T>(filePath: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { return fallback; }
}

function spawnTerminalLinux(cmds: Array<[string, string[]]>, idx = 0): void {
  if (idx >= cmds.length) return;
  const [cmd, args] = cmds[idx];
  const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  p.on('error', () => spawnTerminalLinux(cmds, idx + 1));
  p.unref();
}

let mainWindow: BrowserWindow | null = null;

function getWindowIcon(): Electron.NativeImage | null {
  const candidates: string[] = [];

  // 1. Development: resources/ next to project root
  const projectRoot = path.join(__dirname, '..');
  candidates.push(path.join(projectRoot, 'resources', 'icon.ico'));
  candidates.push(path.join(projectRoot, 'resources', 'icon.png'));

  // 2. Packaged: embedded in resourcesPath
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'icon.ico'));
    candidates.push(path.join(process.resourcesPath, 'icon.png'));
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    }
  }
  return null;
}

function createWindow() {
  const icon = getWindowIcon();
  const winOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1200, height: 800, minWidth: 700, minHeight: 500,
    title: '',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
  if (icon) {
    winOptions.icon = icon;
  }
  mainWindow = new BrowserWindow(winOptions);

  // Explicitly set the icon after creation for reliable taskbar display on Windows
  if (icon) {
    mainWindow.setIcon(icon);
  }

  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();
  mainWindow.on('page-title-updated', (e) => { e.preventDefault(); mainWindow?.setTitle(''); });
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.prompt-pad.app');
  }
  ensureAppDirs();
  registerUpdateIPC();
  // Restore legacy preference from persisted settings; OneDrive path takes precedence at runtime.
  const savedSettings = readJson(getSettingsPath(), { useOneDrive: true });
  useOneDrive = savedSettings.useOneDrive === true;
  Menu.setApplicationMenu(null);
  createWindow();
  setupAutoUpdater(mainWindow);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// Settings
ipcMain.handle('settings:load', () => {
  const settings = readJson(getSettingsPath(), { theme: 'light', language: 'auto', useOneDrive: true });
  if (TEST_DIR) return settings; // Never force OneDrive in test mode
  if (detectOneDrivePath()) {
    return { ...settings, useOneDrive: true };
  }
  return settings;
});
ipcMain.handle('settings:save', (_e, s: Record<string, unknown>) => {
  if (TEST_DIR) {
    useOneDrive = false;
    safeWrite(getSettingsPath(), JSON.stringify(s, null, 2));
    return;
  }
  const persisted = { ...s, useOneDrive: detectOneDrivePath() ? true : s.useOneDrive === true };
  useOneDrive = persisted.useOneDrive === true;
  safeWrite(getSettingsPath(), JSON.stringify(persisted, null, 2));
});

// Phrases
ipcMain.handle('phrases:load', () => {
  const primary = path.join(getSyncDir(), 'phrases.json');
  const fallback = path.join(APP_DIR, 'phrases.json');
  if (primary !== fallback && !fs.existsSync(primary) && fs.existsSync(fallback)) {
    // Auto-migrate when OneDrive sync directory is active.
    fs.copyFileSync(fallback, primary);
  }
  return readJson(primary, []);
});
ipcMain.handle('phrases:save', (_e, p: unknown[]) => {
  safeWrite(path.join(getSyncDir(), 'phrases.json'), JSON.stringify(p, null, 2));
});

// Launches
ipcMain.handle('launches:load', () => {
  const primary = path.join(getSyncDir(), 'launches.json');
  const fallback = path.join(APP_DIR, 'launches.json');
  if (primary !== fallback && !fs.existsSync(primary) && fs.existsSync(fallback)) {
    fs.copyFileSync(fallback, primary);
  }
  return sanitizeLaunches(readJson(primary, []));
});
ipcMain.handle('launches:save', (_e, l: unknown[]) => {
  const sanitized = sanitizeLaunches(Array.isArray(l) ? l : []);
  safeWrite(path.join(getSyncDir(), 'launches.json'), JSON.stringify(sanitized, null, 2));
});

// Session – persists open tabs across restarts
const sessionPath = path.join(APP_DIR, 'session.json');
ipcMain.handle('session:load', () => readJson(sessionPath, null));
ipcMain.handle('session:save', (_e, session: unknown) => {
  atomicWrite(sessionPath, JSON.stringify(session, null, 2));
});

// OneDrive detection
ipcMain.handle('onedrive:detect', () => detectOneDrivePath());

// Dynamic model lists (cached in process memory)
let openCodeModelsCache: { id: string; label: string }[] | null = null;
let copilotModelsCache: { id: string; label: string }[] | null = null;

ipcMain.handle('models:get-opencode', async () => {
  if (openCodeModelsCache && openCodeModelsCache.length > 0) return openCodeModelsCache;
  try {
    const output = await runCommand('opencode', ['models']);
    const parsed = parseOpenCodeModels(output);
    if (parsed.length > 0) {
      openCodeModelsCache = parsed;
      return parsed;
    }
  } catch {
    // fallback below
  }
  openCodeModelsCache = FALLBACK_OPENCODE_MODELS;
  return openCodeModelsCache;
});

ipcMain.handle('models:get-copilot', async () => {
  if (copilotModelsCache && copilotModelsCache.length > 0) return copilotModelsCache;
  try {
    const cmd = process.platform === 'win32' ? 'copilot.exe' : 'copilot';
    const output = await runCommand(cmd, ['help', 'config'], 8000);
    const parsed = parseCopilotModels(output);
    if (parsed.length > 0) {
      copilotModelsCache = parsed;
      return parsed;
    }
  } catch {
    // fallback below
  }
  copilotModelsCache = FALLBACK_COPILOT_MODELS;
  return copilotModelsCache;
});

// File operations
ipcMain.handle('file:save', (_e, filePath: string, content: string) => { atomicWrite(filePath, content); return filePath; });

ipcMain.handle('file:save-as', async (_e, content: string, defaultName: string) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(PROMPTS_DIR, defaultName || 'prompt.txt'),
    filters: [{ name: 'Text', extensions: ['txt', 'md'] }, { name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePath) return null;
  atomicWrite(result.filePath, content);
  return result.filePath;
});

ipcMain.handle('file:open', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    defaultPath: PROMPTS_DIR,
    filters: [{ name: 'Text', extensions: ['txt', 'md'] }, { name: 'All Files', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  return { filePath, content: fs.readFileSync(filePath, 'utf-8') };
});

ipcMain.handle('file:get-prompts-dir', () => PROMPTS_DIR);

// File info (name + size) – used by renderer to validate attached files
ipcMain.handle('file:get-info', (_e, filePath: string) => {
  try {
    const stat = fs.statSync(filePath);
    return { name: path.basename(filePath), size: stat.size };
  } catch {
    return null;
  }
});

// Read native clipboard image via Electron (Snipping Tool, PrintScreen, etc.)
// Returns { name, path, size } or null when clipboard has no image
ipcMain.handle('clipboard:read-image', () => {
  try {
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    const safeTime = new Date().toLocaleTimeString('en-GB').replace(/:/g, '-');
    const name = 'Pasted Image ' + safeTime + '.png';
    const dest = path.join(os.tmpdir(), name);
    fs.writeFileSync(dest, img.toPNG());
    return { name, path: dest, size: fs.statSync(dest).size };
  } catch {
    return null;
  }
});

// Synchronous check — used to call e.preventDefault() before any await in the renderer
ipcMain.on('clipboard:has-image', (e) => {
  try { e.returnValue = !clipboard.readImage().isEmpty(); }
  catch { e.returnValue = false; }
});

// Save raw blob bytes (e.g. clipboard image from Snipping Tool) to a temp file
// Returns { name, path, size } or null on failure
ipcMain.handle('file:save-blob', (_e, bytes: number[], ext: string) => {
  try {
    const safeExt = /^[a-z0-9]+$/i.test(ext) ? ext : 'png';
    const name = 'Pasted Image ' + new Date().toLocaleTimeString('en-GB').replace(/:/g, '-') + '.' + safeExt;
    const dest = path.join(os.tmpdir(), name);
    fs.writeFileSync(dest, Buffer.from(bytes));
    const stat = fs.statSync(dest);
    return { name, path: dest, size: stat.size };
  } catch {
    return null;
  }
});

// Helper – sanitize a string for safe use inside single-quoted PS1 strings
function escapeSingleQuotePS(s: string): string { return s.replace(/'/g, "''"); }

// Launch Copilot CLI or OpenCode – opens a real terminal window
ipcMain.handle('launch:execute', async (_e, config: {
  tool?: string; model: string; folder: string; yolo: boolean; prompt: string; mode: string;
  attachedFilePaths?: string[];
}) => {
  const tool = config.tool === 'opencode' ? 'opencode' : 'copilot';
  if (tool === 'opencode') {
    return executeLaunchOpenCode(config);
  }
  return executeLaunchCopilot(config);
});

async function executeLaunchOpenCode(config: {
  model: string; folder: string; yolo: boolean; prompt: string; mode: string;
  attachedFilePaths?: string[];
}) {
  const { folder, yolo, prompt, mode, attachedFilePaths = [] } = config;
  const model = normalizeOpenCodeModel(config.model);
  // opencode uses provider/model format: strip the leading 'opencode/' prefix for --model flag
  // Actually opencode expects the full id like 'opencode/kimi-k2.6'
  const workDir = folder && fs.existsSync(folder) ? folder : os.homedir();
  const isInteractive = mode === 'interactive';
  const id = Date.now().toString();

  const launchTmpDir = path.join(os.tmpdir(), 'pp-launch-' + id);
  fs.mkdirSync(launchTmpDir, { recursive: true });

  const promptFileName = 'pp-prompt-' + id + '.txt';
  const promptPath = path.join(launchTmpDir, promptFileName);
  fs.writeFileSync(promptPath, prompt, 'utf-8');

  const copiedNames = new Set<string>([promptFileName]);
  const attachedFileNames: string[] = [];
  for (const srcPath of attachedFilePaths) {
    if (!srcPath || !fs.existsSync(srcPath)) continue;
    let destName = path.basename(srcPath);
    if (copiedNames.has(destName)) {
      const ext = path.extname(destName);
      destName = path.basename(destName, ext) + '-' + id + ext;
    }
    copiedNames.add(destName);
    attachedFileNames.push(destName);
    fs.copyFileSync(srcPath, path.join(launchTmpDir, destName));
  }

  // Build message: read the prompt file and mention attachments
  let message = `Read the file "${promptPath}" and treat its contents as my prompt.`;
  if (attachedFileNames.length > 0) {
    message += ` I have also attached: ${attachedFileNames.map(n => path.join(launchTmpDir, n)).join(', ')}.`;
  }

  if (process.platform === 'win32') {
    const psPath = path.join(os.tmpdir(), 'pp-oc-' + id + '.ps1');
    const safeDir   = escapeSingleQuotePS(workDir);
    const safeModel = escapeSingleQuotePS(model);
    const safeMsg   = escapeSingleQuotePS(message);
    const safeTmpDir = escapeSingleQuotePS(launchTmpDir);
    const variantArg = "--dangerously-skip-permissions";
    const script = [
      "Set-Location -LiteralPath '" + safeDir + "'",
      "$ocArgs = @('run', '--model', '" + safeModel + "', '--dir', '" + safeDir + "'" + (variantArg ? ", '" + variantArg + "'" : '') + (isInteractive ? ", '--interactive'" : '') + ", '" + safeMsg + "')",
      "& opencode @ocArgs",
      "Remove-Item -LiteralPath '" + safeTmpDir + "' -Recurse -Force -ErrorAction SilentlyContinue",
    ].join('\n');
    fs.writeFileSync(psPath, script, 'utf-8');
    const wt = spawn('wt.exe', [
      'new-tab', '--title', 'Prompt Pad',
      'powershell.exe', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', psPath,
    ], { detached: true, stdio: 'ignore' });
    wt.on('error', () => {
      spawn('cmd.exe', [
        '/c', 'start', '"Prompt Pad"', 'powershell.exe',
        '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', psPath,
      ], { detached: true, stdio: 'ignore' }).unref();
    });
    wt.unref();
  } else {
    const shPath = path.join(os.tmpdir(), 'pp-oc-' + id + '.sh');
    const variantArg = ' --dangerously-skip-permissions';
    const interactiveArg = isInteractive ? ' --interactive' : '';
    const script = [
      '#!/bin/bash',
      'cd ' + JSON.stringify(workDir),
      'opencode run --model ' + JSON.stringify(model) + ' --dir ' + JSON.stringify(workDir) + variantArg + interactiveArg + ' ' + JSON.stringify(message),
      'rm -rf ' + JSON.stringify(launchTmpDir),
      'rm -f "$0"',
    ].join('\n');
    fs.writeFileSync(shPath, script, { mode: 0o755 });
    if (process.platform === 'darwin') {
      const appleScript = [
        'tell application "Terminal"',
        '  do script "bash ' + shPath.replace(/'/g, "'\\''" ) + '"',
        '  activate',
        'end tell',
      ].join('\n');
      spawn('osascript', ['-e', appleScript], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawnTerminalLinux([
        ['gnome-terminal', ['--', 'bash', shPath]],
        ['konsole',        ['-e', 'bash', shPath]],
        ['xfce4-terminal', ['--command', 'bash "' + shPath + '"']],
        ['xterm',          ['-e', 'bash "' + shPath + '"']],
      ]);
    }
  }
  return true;
}

async function executeLaunchCopilot(config: {
  model: string; folder: string; yolo: boolean; prompt: string; mode: string;
  attachedFilePaths?: string[];
}) {
  const { folder, yolo, prompt, mode, attachedFilePaths = [] } = config;
  const model = normalizeModel(config.model);
  const workDir = folder && fs.existsSync(folder) ? folder : os.homedir();
  const isInteractive = mode === 'interactive';
  const id = Date.now().toString();

  // Create a per-launch temp directory that holds the prompt file + any attached files
  const launchTmpDir = path.join(os.tmpdir(), 'pp-launch-' + id);
  fs.mkdirSync(launchTmpDir, { recursive: true });

  const promptFileName = 'pp-prompt-' + id + '.txt';
  const promptPath = path.join(launchTmpDir, promptFileName);
  fs.writeFileSync(promptPath, prompt, 'utf-8');

  // Copy attached files into the launch temp dir (skip missing files, handle name collisions)
  const copiedNames = new Set<string>([promptFileName]);
  const attachedFileNames: string[] = [];
  for (const srcPath of attachedFilePaths) {
    if (!srcPath || !fs.existsSync(srcPath)) continue;
    let destName = path.basename(srcPath);
    if (copiedNames.has(destName)) {
      const ext = path.extname(destName);
      destName = path.basename(destName, ext) + '-' + id + ext;
    }
    copiedNames.add(destName);
    attachedFileNames.push(destName);
    fs.copyFileSync(srcPath, path.join(launchTmpDir, destName));
  }

  // Build the seed prompt, explicitly listing any attached files so Copilot CLI is aware of them
  let promptSeed = `Read the file "${promptPath}" and treat its contents as the user's prompt. Follow the file contents exactly.`;
  if (attachedFileNames.length > 0) {
    promptSeed += ` The user has also attached the following file(s), available in the same directory ("${launchTmpDir}"): ${attachedFileNames.join(', ')}.`;
  }

  if (process.platform === 'win32') {
    const psPath = path.join(os.tmpdir(), 'pp-' + id + '.ps1');
    const safeDir      = escapeSingleQuotePS(workDir);
    const safeModel    = escapeSingleQuotePS(model);
    const safeTmpDir   = escapeSingleQuotePS(launchTmpDir);
    const safePromptSeed = escapeSingleQuotePS(promptSeed);
    const script = [
      "Set-Location -LiteralPath '" + safeDir + "'",
      "$copilotPath = (Get-Command copilot.exe -ErrorAction SilentlyContinue).Source",
      "if (-not $copilotPath) {",
      "  $copilotCommand = Get-Command copilot -ErrorAction SilentlyContinue",
      "  if ($copilotCommand -and $copilotCommand.Source -like '*.ps1') {",
      "    $bootstrapDir = Split-Path $copilotCommand.Source -Parent",
      "    $oldPath = $env:PATH",
      "    $env:PATH = (($env:PATH -split ';') | Where-Object { $_ -ne $bootstrapDir }) -join ';'",
      "    $copilotPath = (Get-Command copilot.exe -ErrorAction SilentlyContinue).Source",
      "    $env:PATH = $oldPath",
      "  }",
      "}",
      "if (-not $copilotPath) { throw 'Unable to find copilot.exe' }",
      "$copilotArgs = @('--model', '" + safeModel + "', '--add-dir', '" + safeTmpDir + "', '--effort', '" + maxEffortForModel(model) + "')",
      ...(yolo ? ["$copilotArgs += '--yolo'"] : []),
      ...(isInteractive
        ? ["$copilotArgs += @('-i', '" + safePromptSeed + "')"]
        : ["$copilotArgs += @('-p', '" + safePromptSeed + "')"]),
      "& $copilotPath @copilotArgs",
      "Remove-Item -LiteralPath '" + safeTmpDir + "' -Recurse -Force -ErrorAction SilentlyContinue",
    ].join('\n');
    fs.writeFileSync(psPath, script, 'utf-8');

    // Try Windows Terminal first, then fall back to cmd /c start powershell
    const wt = spawn('wt.exe', [
      'new-tab', '--title', 'Prompt Pad',
      'powershell.exe', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', psPath,
    ], { detached: true, stdio: 'ignore' });
    wt.on('error', () => {
      spawn('cmd.exe', [
        '/c', 'start', '"Prompt Pad"', 'powershell.exe',
        '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', psPath,
      ], { detached: true, stdio: 'ignore' }).unref();
    });
    wt.unref();

  } else if (process.platform === 'darwin') {
    const shPath = path.join(os.tmpdir(), 'pp-' + id + '.sh');
    const script = [
      '#!/bin/bash',
      'cd ' + JSON.stringify(workDir),
      'args=(--model ' + JSON.stringify(model) + ' --add-dir ' + JSON.stringify(launchTmpDir) + ' --effort ' + maxEffortForModel(model) + ')',
      ...(yolo ? ['args+=(--yolo)'] : []),
      'args+=(' + JSON.stringify(isInteractive ? '-i' : '-p') + ' ' + JSON.stringify(promptSeed) + ')',
      'copilot "${args[@]}"',
      'rm -rf ' + JSON.stringify(launchTmpDir),
      'rm -f "$0"',
    ].join('\n');
    fs.writeFileSync(shPath, script, { mode: 0o755 });
    const appleScript = [
      'tell application "Terminal"',
      '  do script "bash ' + shPath.replace(/'/g, "'\\''") + '"',
      '  activate',
      'end tell',
    ].join('\n');
    spawn('osascript', ['-e', appleScript], { detached: true, stdio: 'ignore' }).unref();

  } else {
    const shPath = path.join(os.tmpdir(), 'pp-' + id + '.sh');
    const script = [
      '#!/bin/bash',
      'cd ' + JSON.stringify(workDir),
      'args=(--model ' + JSON.stringify(model) + ' --add-dir ' + JSON.stringify(launchTmpDir) + ' --effort ' + maxEffortForModel(model) + ')',
      ...(yolo ? ['args+=(--yolo)'] : []),
      'args+=(' + JSON.stringify(isInteractive ? '-i' : '-p') + ' ' + JSON.stringify(promptSeed) + ')',
      'copilot "${args[@]}"',
      'rm -rf ' + JSON.stringify(launchTmpDir),
      'rm -f "$0"',
    ].join('\n');
    fs.writeFileSync(shPath, script, { mode: 0o755 });
    spawnTerminalLinux([
      ['gnome-terminal', ['--', 'bash', shPath]],
      ['konsole',        ['-e', 'bash', shPath]],
      ['xfce4-terminal', ['--command', 'bash "' + shPath + '"']],
      ['xterm',          ['-e', 'bash "' + shPath + '"']],
    ]);
  }
  return true;
}

// Multi-file picker – returns { name, path, size }[] for chosen files
ipcMain.handle('file:pick-files', async () => {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled) return [];
  return result.filePaths.flatMap(fp => {
    try {
      const stat = fs.statSync(fp);
      return [{ name: path.basename(fp), path: fp, size: stat.size }];
    } catch { return []; }
  });
});

ipcMain.handle('dialog:pick-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('system:locale', () => app.getLocale());
ipcMain.handle('app:version', () => app.getVersion());
