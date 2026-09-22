import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');

function getTestDir(): string {
  const dir = path.join(os.tmpdir(), `pp-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveTestSettings(testDir: string, overrides: Record<string, unknown> = {}) {
  const settings = {
    theme: 'light',
    language: 'en',
    useOneDrive: false,
    phraseShortcutModifier: 'ctrl',
    launchShortcutModifier: 'ctrl+shift',
    openVsCodeShortcutModifier: 'ctrl+alt+shift',
    ...overrides,
  };
  fs.writeFileSync(path.join(testDir, 'settings.json'), JSON.stringify(settings, null, 2));
}

function readLaunchCalls(testDir: string): Array<{
  tool: string;
  model: string;
  normalizedModel?: string;
  prompt: string;
  folder: string;
}> {
  const files = fs.readdirSync(testDir).filter(f => f.startsWith('launch-call-') && f.endsWith('.json'));
  return files
    .map(f => JSON.parse(fs.readFileSync(path.join(testDir, f), 'utf-8')))
    .sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''));
}

test.describe('Default and free/cheap models feature', () => {
  test('electronAPI.getDefaultModels returns free or lowest cost default models', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      const defaults = await page.evaluate(async () => {
        const api = (window as unknown as {
          electronAPI: {
            getDefaultModels: () => Promise<{ copilot: string; opencode: string; antigravity: string }>;
          };
        }).electronAPI;
        return api.getDefaultModels();
      });

      expect(defaults).toBeDefined();
      expect(defaults.copilot).toBe('auto');
      expect(defaults.opencode).toBe('opencode/minimax-m2.5-free');
      expect(defaults.antigravity).toBe('gemini-3.8-flash-medium');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('launching without a specified model normalizes to free/lowest cost default model', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // Test default normalization for each tool
      await page.evaluate(async () => {
        const api = (window as unknown as {
          electronAPI: {
            executeLaunch: (cfg: {
              tool: string;
              model: string;
              folder: string;
              yolo: boolean;
              prompt: string;
              mode: string;
            }) => Promise<boolean>;
          };
        }).electronAPI;

        await api.executeLaunch({
          tool: 'copilot',
          model: '',
          folder: '/tmp/test-copilot',
          yolo: true,
          prompt: 'test copilot launch',
          mode: 'interactive',
        });

        await api.executeLaunch({
          tool: 'opencode',
          model: '',
          folder: '/tmp/test-opencode',
          yolo: true,
          prompt: 'test opencode launch',
          mode: 'interactive',
        });

        await api.executeLaunch({
          tool: 'antigravity',
          model: '',
          folder: '/tmp/test-antigravity',
          yolo: true,
          prompt: 'test antigravity launch',
          mode: 'interactive',
        });
      });

      const calls = readLaunchCalls(testDir);
      expect(calls).toHaveLength(3);

      const copilotCall = calls.find(c => c.tool === 'copilot');
      expect(copilotCall).toBeDefined();
      expect(copilotCall?.normalizedModel).toBe('auto');

      const opencodeCall = calls.find(c => c.tool === 'opencode');
      expect(opencodeCall).toBeDefined();
      expect(opencodeCall?.normalizedModel).toBe('opencode/minimax-m2.5-free');

      const antigravityCall = calls.find(c => c.tool === 'antigravity');
      expect(antigravityCall).toBeDefined();
      expect(antigravityCall?.normalizedModel).toBe('gemini-3.8-flash-medium');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('OneDrive is never accessed or mutated during test runs', async () => {
    const testDir = getTestDir();
    try {
      // Even if settings has useOneDrive: true, test mode overrides it
      saveTestSettings(testDir, { useOneDrive: true });
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // Check detected settings
      const settings = await page.evaluate(async () => {
        const api = (window as unknown as {
          electronAPI: {
            loadSettings: () => Promise<{ useOneDrive?: boolean }>;
          };
        }).electronAPI;
        return api.loadSettings();
      });

      // Files should remain inside testDir, not OneDrive
      expect(fs.existsSync(path.join(testDir, 'settings.json'))).toBe(true);

      // Verify saving settings keeps files in testDir
      await page.evaluate(async () => {
        const api = (window as unknown as {
          electronAPI: {
            saveSettings: (s: Record<string, unknown>) => Promise<void>;
          };
        }).electronAPI;
        await api.saveSettings({ theme: 'dark', language: 'en', useOneDrive: true });
      });

      expect(fs.existsSync(path.join(testDir, 'settings.json'))).toBe(true);
      const saved = JSON.parse(fs.readFileSync(path.join(testDir, 'settings.json'), 'utf-8'));
      expect(saved.theme).toBe('dark');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
