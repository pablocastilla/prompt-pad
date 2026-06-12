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

// Always force English + no OneDrive sync so tests are deterministic regardless of
// the system locale or whether OneDrive is installed.
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

function savePhrases(testDir: string, phrases: unknown[]) {
  fs.writeFileSync(path.join(testDir, 'phrases.json'), JSON.stringify(phrases, null, 2));
}

function saveLaunches(testDir: string, launches: unknown[]) {
  fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify(launches, null, 2));
}

function readLaunchCalls(testDir: string): Array<{ tool: string; model: string; prompt: string; folder: string }> {
  const files = fs.readdirSync(testDir).filter(f => f.startsWith('launch-call-') && f.endsWith('.json'));
  return files
    .map(f => JSON.parse(fs.readFileSync(path.join(testDir, f), 'utf-8')))
    .sort((a, b) => a.id?.localeCompare?.(b.id ?? '') ?? 0);
}

test.describe('Launch Panel double-click', () => {
  test('double-click on launch item opens provider picker first', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'My Project', folder: '/tmp/proj1' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.waitForTimeout(200);

      const editor = page.locator('.editor-textarea');
      await editor.fill('test prompt content');

      const launchItem = page.locator('.launch-list-item').first();
      await launchItem.dblclick();
      await page.waitForTimeout(500);

      await expect(page.locator('.model-picker-overlay')).toBeVisible();
      await expect(page.locator('.provider-picker-list')).toBeVisible();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('single click selects launch but does not open model picker', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'My Project', folder: '/tmp/proj1' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.waitForTimeout(200);

      const launchItem = page.locator('.launch-list-item').first();
      await launchItem.click();
      await page.waitForTimeout(300);

      await expect(page.locator('.model-picker-overlay')).not.toBeVisible();
      await expect(launchItem).toHaveClass(/selected/);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('double-click does not trigger if editor is empty', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'My Project', folder: '/tmp/proj1' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.waitForTimeout(200);

      const editor = page.locator('.editor-textarea');
      await editor.fill('');

      const launchItem = page.locator('.launch-list-item').first();
      await launchItem.dblclick();
      await page.waitForTimeout(300);

      await expect(page.locator('.model-picker-overlay')).not.toBeVisible();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('double-click on second launch opens provider picker', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Project Alpha', folder: '/tmp/alpha' },
        { id: 'l2', name: 'Project Beta', folder: '/tmp/beta' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.waitForTimeout(200);

      const editor = page.locator('.editor-textarea');
      await editor.fill('prompt for beta');

      const secondLaunch = page.locator('.launch-list-item').nth(1);
      await secondLaunch.dblclick();
      await page.waitForTimeout(500);

      await expect(page.locator('.model-picker-overlay')).toBeVisible();
      await expect(page.locator('.provider-picker-list')).toBeVisible();

      const selectedIndicator = page.locator('.launch-list-item.selected');
      await expect(selectedIndicator).toHaveCount(1);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});

test.describe('Launch configuration form', () => {
  test('add new launch config with only name and folder', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.waitForTimeout(200);

      // The "+" (Add config) button is the last action button in the header
      await page.locator('.panel-section-actions .btn-icon').last().click();
      await page.waitForTimeout(200);

      const nameInput = page.locator('.launch-form input[type="text"]').first();
      await nameInput.fill('My Test Launch');

      const folderInput = page.locator('.launch-form input[type="text"]').nth(1);
      await folderInput.fill('/tmp/test-folder');

      // The primary Save button in the form is the second button in form-actions
      await page.locator('.launch-form .form-actions .btn-primary').click();
      await page.waitForTimeout(300);

      const launchItem = page.locator('.launch-list-item');
      await expect(launchItem).toHaveCount(1);

      // Verify persisted format (no tool, no yolo, no mode)
      const saved = JSON.parse(fs.readFileSync(path.join(testDir, 'launches.json'), 'utf-8'));
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ name: 'My Test Launch', folder: '/tmp/test-folder' });
      expect(saved[0].tool).toBeUndefined();
      expect(saved[0].yolo).toBeUndefined();
      expect(saved[0].mode).toBeUndefined();
      expect(saved[0].model).toBeUndefined();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('launch form does not include tool, yolo or mode fields', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.waitForTimeout(200);

      await page.locator('.panel-section-actions .btn-icon').last().click();
      await page.waitForTimeout(200);

      // Tool selector should not exist
      await expect(page.locator('.launch-form .tool-selector')).toHaveCount(0);
      await expect(page.locator('.launch-form .tool-btn')).toHaveCount(0);

      // YOLO checkbox should not exist
      await expect(page.locator('.launch-form input[type="checkbox"]')).toHaveCount(0);

      // Should only have 2 text inputs (name + folder) and 1 select (shortcut)
      const textInputs = page.locator('.launch-form input[type="text"]');
      await expect(textInputs).toHaveCount(2);
      const selects = page.locator('.launch-form select');
      await expect(selects).toHaveCount(1);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('launch list item shows only name and folder, no tool chip', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test Launch', folder: '/tmp/test' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.waitForTimeout(200);

      const launchItem = page.locator('.launch-list-item').first();
      await expect(launchItem).toContainText('Test Launch');
      await expect(launchItem).toContainText('/tmp/test');

      // Old UI showed a tool chip + YOLO/safe + -i/-p suffix; none of those should remain
      await expect(launchItem.locator('.launch-tool-chip')).toHaveCount(0);
      await expect(launchItem).not.toContainText('YOLO');
      await expect(launchItem).not.toContainText('safe');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});

test.describe('Provider picker navigation', () => {
  test('provider picker shows exactly 5 providers in opencode/copilot/claude-code/codex/antigravity order', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test', folder: '/tmp' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.waitForTimeout(200);

      const editor = page.locator('.editor-textarea');
      await editor.fill('test');

      const launchItem = page.locator('.launch-list-item').first();
      await launchItem.dblclick();
      await page.waitForTimeout(500);

      await expect(page.locator('.provider-picker-list')).toBeVisible();

      const providers = page.locator('.provider-picker-list .provider-picker-item');
      await expect(providers).toHaveCount(5);

      const providerNames = await providers.evaluateAll((els) => els.map((el) => el.getAttribute('data-provider')));
      expect(providerNames).toEqual(['opencode', 'copilot', 'claude-code', 'codex', 'antigravity']);

      // Each item shows its numeric shortcut (1..5)
      for (let i = 0; i < 5; i++) {
        const shortcut = providers.nth(i).locator('.provider-picker-shortcut');
        await expect(shortcut).toHaveText(String(i + 1));
      }

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('selecting OpenCode provider shows the model picker', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test', folder: '/tmp' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Stub model fetching so this test does not require the real CLI
      await page.evaluate(() => {
        const api = (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI;
        (api as { getOpenCodeModels: () => Promise<unknown> }).getOpenCodeModels = async () => [
          { id: 'opencode-go/glm-5.1', label: 'GLM 5.1 Go' },
          { id: 'opencode/kimi-k2.6', label: 'Kimi K2.6' },
        ];
      });

      await page.locator('.activity-btn').first().click();
      await page.waitForTimeout(200);

      const editor = page.locator('.editor-textarea');
      await editor.fill('test');

      const launchItem = page.locator('.launch-list-item').first();
      await launchItem.dblclick();
      await page.waitForTimeout(500);

      await page.locator('.provider-picker-list .provider-picker-item[data-provider="opencode"]').click();
      await page.waitForTimeout(500);

      await expect(page.locator('.provider-picker-list')).not.toBeVisible();
      await expect(page.locator('.model-picker-list')).toBeVisible();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('back button returns to provider picker from model picker', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test', folder: '/tmp' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.evaluate(() => {
        const api = (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI;
        (api as { getOpenCodeModels: () => Promise<unknown> }).getOpenCodeModels = async () => [
          { id: 'opencode-go/glm-5.1', label: 'GLM 5.1 Go' },
        ];
      });

      await page.locator('.activity-btn').first().click();
      await page.waitForTimeout(200);

      const editor = page.locator('.editor-textarea');
      await editor.fill('test');

      const launchItem = page.locator('.launch-list-item').first();
      await launchItem.dblclick();
      await page.waitForTimeout(500);

      await page.locator('.provider-picker-list .provider-picker-item[data-provider="opencode"]').click();
      await page.waitForTimeout(500);

      await expect(page.locator('.model-picker-back-btn')).toBeVisible();
      await page.locator('.model-picker-back-btn').click();
      await page.waitForTimeout(300);

      await expect(page.locator('.provider-picker-list')).toBeVisible();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('numeric key 2 opens model picker for copilot (it has a model API)', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test', folder: '/tmp' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api = (window as any).electronAPI;
        api.getCopilotModels = async () => [
          { id: 'gpt-5', label: 'GPT-5' },
          { id: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
        ];
      });

      await page.locator('.editor-textarea').fill('test prompt');
      await page.waitForTimeout(100);

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('2');
      await page.waitForTimeout(500);

      // Copilot has a model picker, so the overlay stays visible with the model list
      await expect(page.locator('.model-picker-list')).toBeVisible();
      await expect(page.locator('.provider-picker-list')).not.toBeVisible();

      // No launch call should have happened yet (still in model picker)
      const calls = readLaunchCalls(testDir);
      expect(calls).toHaveLength(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('numeric key 3 launches claude-code directly (no model picker)', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test', folder: '/tmp' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.editor-textarea').fill('test prompt');
      await page.waitForTimeout(100);

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      // Press "3" -> claude-code -> direct launch
      await page.keyboard.press('3');
      await page.waitForTimeout(500);

      await expect(page.locator('.model-picker-overlay')).not.toBeVisible();

      const calls = readLaunchCalls(testDir);
      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('claude-code');
      expect(calls[0].prompt).toBe('test prompt');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('numeric key 4 launches codex directly without model picker', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test', folder: '/tmp' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.editor-textarea').fill('test prompt');
      await page.waitForTimeout(100);

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('4');
      await page.waitForTimeout(500);

      await expect(page.locator('.model-picker-overlay')).not.toBeVisible();

      const calls = readLaunchCalls(testDir);
      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('codex');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('numeric key 5 opens model picker for antigravity (it has a model API)', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test', folder: '/tmp' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.evaluate(() => {
        const api = (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI;
        (api as { getAntigravityModels: () => Promise<unknown> }).getAntigravityModels = async () => [
          { id: 'Gemini 3.5 Flash (Medium)', label: 'Gemini 3.5 Flash (Medium)' },
          { id: 'Claude Sonnet 4.6 (Thinking)', label: 'Claude Sonnet 4.6 (Thinking)' },
        ];
      });

      await page.locator('.editor-textarea').fill('test prompt');
      await page.waitForTimeout(100);

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('5');
      await page.waitForTimeout(500);

      // Antigravity has a model picker, so the overlay stays visible with the model list
      await expect(page.locator('.model-picker-list')).toBeVisible();
      await expect(page.locator('.provider-picker-list')).not.toBeVisible();

      // No launch call should have happened yet (still in model picker)
      const calls = readLaunchCalls(testDir);
      expect(calls).toHaveLength(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('numeric key 1 opens model picker for opencode (it has a model API)', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test', folder: '/tmp' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const api = (window as any).electronAPI;
        api.getOpenCodeModels = async () => [
          { id: 'opencode-go/glm-5.1', label: 'GLM 5.1 Go' },
        ];
      });

      await page.locator('.editor-textarea').fill('test prompt');
      await page.waitForTimeout(100);

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('1');
      await page.waitForTimeout(500);

      // OpenCode has a model picker, so the overlay stays visible with the model list
      await expect(page.locator('.model-picker-list')).toBeVisible();
      await expect(page.locator('.provider-picker-list')).not.toBeVisible();

      // No launch call should have happened yet (still in model picker)
      const calls = readLaunchCalls(testDir);
      expect(calls).toHaveLength(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('arrow keys navigate provider selection, Enter activates it', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test', folder: '/tmp' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.editor-textarea').fill('test prompt');
      await page.waitForTimeout(100);

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      // Selected starts at index 0 (opencode). Press Down 3 times -> codex
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(100);

      // The fourth item (codex) should be selected
      const selected = page.locator('.provider-picker-item.selected');
      await expect(selected).toHaveAttribute('data-provider', 'codex');

      // Press Enter to confirm
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);

      await expect(page.locator('.model-picker-overlay')).not.toBeVisible();

      const calls = readLaunchCalls(testDir);
      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('codex');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Escape closes the provider picker without launching', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test', folder: '/tmp' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.editor-textarea').fill('test prompt');
      await page.waitForTimeout(100);

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      await expect(page.locator('.model-picker-overlay')).not.toBeVisible();

      const calls = readLaunchCalls(testDir);
      expect(calls).toHaveLength(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
