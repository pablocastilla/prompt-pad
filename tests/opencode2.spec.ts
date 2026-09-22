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

function readLaunchCalls(testDir: string): Array<{ tool: string; model: string; normalizedModel: string; prompt: string }> {
  const files = fs.readdirSync(testDir).filter(f => f.startsWith('launch-call-') && f.endsWith('.json'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(testDir, f), 'utf-8')));
}

function readLaunchScripts(testDir: string): string[] {
  const files = fs.readdirSync(testDir).filter(f => f.startsWith('launch-script-') && f.endsWith('.ps1'));
  return files.map(f => fs.readFileSync(path.join(testDir, f), 'utf-8'));
}

// Electron can keep file handles (e.g. electron-profile/DIPS) briefly after
// app.close(); retry so a slow handle release never fails the test.
async function cleanupTestDir(testDir: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise(r => setTimeout(r, 300));
    }
  }
}

test.describe('OpenCode 2 launch option', () => {
  test('getOpenCode2Models IPC returns models from mock CLI catalog', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'mock-opencode2-models.json'), JSON.stringify([
        { id: 'opencode-go/glm-5.3-flash', label: 'GLM 5.3 Flash Go' },
        { id: 'opencode/minimax-m2.5-free', label: 'MiniMax M2.5 Free' },
        { id: 'nvidia/mistralai/mistral-7b-instruct-v0.3', label: 'Nvidia Mistralai Mistral 7B Instruct V0.3' },
      ]));

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      const models = await page.evaluate(async () => {
        return (window as unknown as {
          electronAPI: { getOpenCode2Models: () => Promise<{ id: string; label: string }[]> }
        }).electronAPI.getOpenCode2Models();
      });

      expect(Array.isArray(models)).toBe(true);
      expect(models).toHaveLength(3);
      expect(models.map(m => m.id)).toContain('opencode/minimax-m2.5-free');

      await app.close();
    } finally {
      await cleanupTestDir(testDir);
    }
  });

  test('selecting OpenCode 2 in provider picker shows model list with tier toggles', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'OC2 Test', folder: '/tmp' },
      ]));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');
      fs.writeFileSync(path.join(testDir, 'mock-opencode2-models.json'), JSON.stringify([
        { id: 'opencode-go/glm-5.3-flash', label: 'GLM 5.3 Flash Go' },
        { id: 'opencode/minimax-m2.5-free', label: 'MiniMax M2.5 Free' },
      ]));

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.locator('.editor-textarea').fill('opencode2 picker test');

      await page.locator('.launch-list-item').first().dblclick();
      await expect(page.locator('.provider-picker-list')).toBeVisible();

      await page.locator('.provider-picker-item[data-provider="opencode2"]').click();

      await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.model-picker-tool-badge')).toContainText('OpenCode 2');

      // OpenCode-family tier toggles are shown for OpenCode 2 too
      await expect(page.locator('.model-picker-go-toggle[data-tier="go"]')).toBeVisible();
      await expect(page.locator('.model-picker-go-toggle[data-tier="zen"]')).toBeVisible();

      const items = page.locator('.model-picker-item');
      await expect(items).toHaveCount(2);

      // Searching filters by model name
      await page.locator('.model-picker-search-input').fill('minimax');
      await page.waitForTimeout(200);
      await expect(page.locator('.model-picker-item')).toHaveCount(1);
      await expect(page.locator('.model-picker-item-label').first()).toContainText('MiniMax');

      await app.close();
    } finally {
      await cleanupTestDir(testDir);
    }
  });

  test('launching with a model calls executeLaunch with tool=opencode2 and normalized model', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'OC2 Launch Test', folder: '/tmp/oc2' },
      ]));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');
      fs.writeFileSync(path.join(testDir, 'mock-opencode2-models.json'), JSON.stringify([
        { id: 'opencode-go/glm-5.3-flash', label: 'GLM 5.3 Flash Go' },
      ]));

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.locator('.editor-textarea').fill('opencode2 launch test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible();

      // Numeric shortcut 6 -> opencode2
      await page.keyboard.press('6');
      await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 5000 });

      await page.locator('.model-picker-item').first().click();
      await page.waitForTimeout(500);

      await expect(page.locator('.model-picker-overlay')).not.toBeVisible();

      const calls = readLaunchCalls(testDir);
      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('opencode2');
      expect(calls[0].normalizedModel).toBe('opencode-go/glm-5.3-flash');
      expect(calls[0].prompt).toBe('opencode2 launch test');

      // History entry records the opencode2 tool
      const history = JSON.parse(fs.readFileSync(path.join(testDir, 'launch-history.json'), 'utf-8'));
      expect(history).toHaveLength(1);
      expect(history[0].tool).toBe('opencode2');
      expect(history[0].model).toBe('opencode-go/glm-5.3-flash');

      await app.close();
    } finally {
      await cleanupTestDir(testDir);
    }
  });

  test('opencode2 launch script uses the run subcommand with --model and --file, never top-level --model', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'OC2 Script Test', folder: '/tmp/oc2' },
      ]));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');
      fs.writeFileSync(path.join(testDir, 'mock-opencode2-models.json'), JSON.stringify([
        { id: 'opencode-go/glm-5.3-flash', label: 'GLM 5.3 Flash Go' },
      ]));

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.locator('.editor-textarea').fill('script test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible();
      await page.keyboard.press('6');
      await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 5000 });
      await page.locator('.model-picker-item').first().click();
      await expect(page.locator('.model-picker-overlay')).not.toBeVisible();
      await page.waitForTimeout(500);

      await app.close();

      const scripts = readLaunchScripts(testDir);
      expect(scripts).toHaveLength(1);
      const script = scripts[0];

      // OpenCode 2 must go through the `run` subcommand (top-level --model is not supported)
      expect(script).toContain("$ocArgs = @('run', '--model', 'opencode-go/glm-5.3-flash', '--file',");
      expect(script).toContain(", '--auto',");
      expect(script).toContain("& $opencodePath @ocArgs");
      expect(script).not.toContain("@('--model'");
      expect(script).not.toContain("'--prompt'");
      // The message is passed as a positional argument after the flags
      expect(script).toContain(", 'script test')");
      // No stray empty-string arguments from conditional flags
      expect(script).not.toContain(", ''");
    } finally {
      await cleanupTestDir(testDir);
    }
  });

  test('opencode (v1) launch script keeps top-level --model and --prompt flags', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'OC1 Script Test', folder: '/tmp/oc1' },
      ]));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');
      fs.writeFileSync(path.join(testDir, 'mock-opencode-models.json'), JSON.stringify([
        { id: 'opencode/glm-5.3-flash', label: 'GLM 5.3 Flash' },
      ]));

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.locator('.editor-textarea').fill('v1 script test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible();
      await page.keyboard.press('1');
      await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 5000 });
      await page.locator('.model-picker-item').first().click();
      await expect(page.locator('.model-picker-overlay')).not.toBeVisible();
      await page.waitForTimeout(500);

      await app.close();

      const scripts = readLaunchScripts(testDir);
      expect(scripts).toHaveLength(1);
      const script = scripts[0];
      expect(script).toContain("@('--model', 'opencode/glm-5.3-flash', '--prompt',");
      expect(script).not.toContain("@('run'");
    } finally {
      await cleanupTestDir(testDir);
    }
  });

  test('pinned models for opencode2 persist and are preserved on load', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir, {
        pinnedModels: {
          opencode: ['opencode/minimax-m2.5-free'],
          opencode2: ['opencode-go/glm-5.3-flash'],
        },
      });
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'OC2 Pin Test', folder: '/tmp' },
      ]));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');
      fs.writeFileSync(path.join(testDir, 'mock-opencode2-models.json'), JSON.stringify([
        { id: 'opencode-go/glm-5.3-flash', label: 'GLM 5.3 Flash Go' },
        { id: 'opencode/minimax-m2.5-free', label: 'MiniMax M2.5 Free' },
      ]));

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.locator('.editor-textarea').fill('pin test');
      await page.locator('.launch-list-item').first().dblclick();
      await page.locator('.provider-picker-item[data-provider="opencode2"]').click();
      await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 5000 });

      // The pinned model appears in the Pinned section
      await expect(page.locator('.model-picker-section-header').first()).toHaveText(/Pinned/i);
      await expect(page.locator('.model-picker-item.pinned')).toHaveCount(1);

      await app.close();
      await new Promise(r => setTimeout(r, 500));

      // Settings still contain both tools' pins after the picker ran
      const saved = JSON.parse(fs.readFileSync(path.join(testDir, 'settings.json'), 'utf-8'));
      expect(saved.pinnedModels?.opencode2).toEqual(['opencode-go/glm-5.3-flash']);
      expect(saved.pinnedModels?.opencode).toEqual(['opencode/minimax-m2.5-free']);
    } finally {
      await cleanupTestDir(testDir);
    }
  });
});
