import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { buildOpenCodeShScript, buildOpenCodeWinScript } from '../electron/launcherScripts';

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

test.describe('OpenCode launch (OpenCode 2 architecture)', () => {
  test('standalone fallback script opens the interactive TUI with the model via OPENCODE_CONFIG temp file', async () => {
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

      // The test-mode capture keeps the standalone fallback script. The real
      // launch first creates a shared v2 session (covered by the OpenCode 2 API
      // suite) and only uses this script when no service is reachable.
      expect(script).toMatch(/\$env:OPENCODE_CONFIG = '[^']+pp-model\.json'/);
      expect(script).toContain("$ocArgs = @('--standalone', '--prompt', 'Read the file at");
      expect(script).toContain("Summary of the file content: v1 script test'");
      expect(script).toContain("& $opencodePath @ocArgs");
      expect(script).not.toContain("'attach'");
      expect(script).not.toContain("'serve'");
      expect(script).not.toContain("'run'");
      expect(script).not.toContain("@('--model'");
      expect(script).not.toMatch(/'[^']*"/);
    } finally {
      await cleanupTestDir(testDir);
    }
  });

  test('opencode launch seed message embeds a single-line excerpt of the prompt file content', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'Excerpt Test', folder: '/tmp' },
      ]));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');
      fs.writeFileSync(path.join(testDir, 'mock-opencode-models.json'), JSON.stringify([
        { id: 'opencode/glm-5.3-flash', label: 'GLM 5.3 Flash' },
      ]));

      const longPrompt = [
        'Fix the login timeout bug in auth service',
        '',
        'Steps to reproduce:',
        '1. Open the app',
        '2. Wait 30 minutes',
        '3. The session drops unexpectedly',
        'Please investigate the token refresh logic and add a regression test.',
      ].join('\n');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      // Playwright's fill() strips newlines on contenteditable, so set the text
      // through textContent (the same source the real editor reads) and dispatch
      // an input event so the app updates the tab content.
      await page.evaluate((text) => {
        const editor = document.querySelector('.editor-textarea') as HTMLElement;
        editor.textContent = text;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }, longPrompt);

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible();
      await page.keyboard.press('1');
      await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 5000 });
      await page.locator('.model-picker-item').first().click();
      await expect(page.locator('.model-picker-overlay')).not.toBeVisible();
      await page.waitForTimeout(500);

      await app.close();

      // The seed message lives in the payload file the script posts to the
      // shared server (pp-send-<id>.json inside the launch temp dir).
      const payloads = fs.readdirSync(os.tmpdir())
        .filter(f => f.startsWith('pp-launch-'))
        .map(f => path.join(os.tmpdir(), f))
        .map(d => fs.readdirSync(d).filter(f => f.startsWith('pp-send-') && f.endsWith('.json')).map(f => path.join(d, f)))
        .flat();
      expect(payloads.length).toBeGreaterThan(0);
      const payload = JSON.parse(fs.readFileSync(payloads.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0], 'utf-8'));
      const text = payload.parts[0].text;

      // The seed message must include a flattened excerpt of the prompt content
      // so the CLI session summary in its history describes the prompt, not a
      // generic "Read the file ..." string.
      expect(text).toContain('Summary of the file content: Fix the login timeout bug in auth service');
      // Newlines must be collapsed to spaces inside the excerpt
      expect(text).toContain('auth service Steps to reproduce: 1. Open the app 2. Wait 30 minutes');
      expect(text).not.toMatch(/Steps to reproduce:\n/);
    } finally {
      await cleanupTestDir(testDir);
    }
  });

  test('opencode launch seed message truncates very long prompts with an ellipsis', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'Truncate Test', folder: '/tmp' },
      ]));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');
      fs.writeFileSync(path.join(testDir, 'mock-opencode-models.json'), JSON.stringify([
        { id: 'opencode/glm-5.3-flash', label: 'GLM 5.3 Flash' },
      ]));

      const longPrompt = 'x'.repeat(500) + ' END-MARKER';

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.locator('.editor-textarea').fill(longPrompt);

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible();
      await page.keyboard.press('1');
      await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 5000 });
      await page.locator('.model-picker-item').first().click();
      await expect(page.locator('.model-picker-overlay')).not.toBeVisible();
      await page.waitForTimeout(500);

      await app.close();

      // Excerpt is capped (200 chars) and ends with an ellipsis; the tail of the
      // prompt must not leak into the seed message.
      const payloads = fs.readdirSync(os.tmpdir())
        .filter(f => f.startsWith('pp-launch-'))
        .map(f => path.join(os.tmpdir(), f))
        .map(d => fs.readdirSync(d).filter(f => f.startsWith('pp-send-') && f.endsWith('.json')).map(f => path.join(d, f)))
        .flat();
      expect(payloads.length).toBeGreaterThan(0);
      const payload = JSON.parse(fs.readFileSync(payloads.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0], 'utf-8'));
      const text = payload.parts[0].text;
      expect(text).toContain('Summary of the file content: xxx');
      expect(text).toMatch(/Summary of the file content: x{199}…/);
      expect(text).not.toContain('END-MARKER');
      // The model travels with the prompt too
      expect(payload.model).toEqual({ providerID: 'opencode', modelID: 'glm-5.3-flash' });
    } finally {
      await cleanupTestDir(testDir);
    }
  });

  test('opencode option 1 creates pp-model.json in launch directory with selected model', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'OC1 Model File Test', folder: '/tmp/oc1-model' },
      ]));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');
      fs.writeFileSync(path.join(testDir, 'mock-opencode-models.json'), JSON.stringify([
        { id: 'opencode-go/glm-5.3-flash', label: 'GLM 5.3 Flash Go' },
      ]));

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.locator('.editor-textarea').fill('model config file test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible();
      await page.keyboard.press('1');
      await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 5000 });
      await page.locator('.model-picker-item').first().click();
      await expect(page.locator('.model-picker-overlay')).not.toBeVisible();
      await page.waitForTimeout(500);

      await app.close();

      // Find the created pp-model.json in os.tmpdir
      const launchDirs = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('pp-launch-'));
      const modelFiles = launchDirs
        .map(d => path.join(os.tmpdir(), d, 'pp-model.json'))
        .filter(f => fs.existsSync(f));
      expect(modelFiles.length).toBeGreaterThan(0);
      const latestModelFile = modelFiles.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
      const modelContent = JSON.parse(fs.readFileSync(latestModelFile, 'utf-8'));
      expect(modelContent.model).toBe('opencode-go/glm-5.3-flash');
    } finally {
      await cleanupTestDir(testDir);
    }
  });

  test('legacy opencode2 pins and history entries load without offering the option', async () => {
    const testDir = getTestDir();
    try {
      // A settings file written by an older version may still carry opencode2 pins,
      // and an old history file may contain opencode2 entries. Neither should
      // break loading, and the provider picker must not offer opencode2 anymore.
      saveTestSettings(testDir, {
        pinnedModels: {
          opencode: ['opencode/minimax-m2.5-free'],
          opencode2: ['opencode-go/glm-5.3-flash'],
        },
      });
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'Legacy Pins Test', folder: '/tmp' },
      ]));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');
      fs.writeFileSync(path.join(testDir, 'launch-history.json'), JSON.stringify([
        { id: 'h1', launchId: 'l0', launchName: 'Old', tool: 'opencode2', model: 'opencode-go/glm-5.3-flash', prompt: 'legacy', timestamp: 1, folder: '/tmp' },
      ]));
      fs.writeFileSync(path.join(testDir, 'mock-opencode-models.json'), JSON.stringify([
        { id: 'opencode/minimax-m2.5-free', label: 'MiniMax M2.5 Free' },
        { id: 'opencode-go/glm-5.3-flash', label: 'GLM 5.3 Flash Go' },
      ]));

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.locator('.editor-textarea').fill('legacy pins test');
      await page.locator('.launch-list-item').first().dblclick();
      await expect(page.locator('.provider-picker-list')).toBeVisible();

      // The removed option is gone
      await expect(page.locator('.provider-picker-item[data-provider="opencode2"]')).toHaveCount(0);

      // OpenCode still shows its own pinned model
      await page.locator('.provider-picker-item[data-provider="opencode"]').click();
      await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.model-picker-item.pinned')).toHaveCount(1);

      await app.close();
      await new Promise(r => setTimeout(r, 500));

      // The legacy opencode2 pin is preserved as-is in settings (no data loss)
      const saved = JSON.parse(fs.readFileSync(path.join(testDir, 'settings.json'), 'utf-8'));
      expect(saved.pinnedModels?.opencode).toEqual(['opencode/minimax-m2.5-free']);
      expect(saved.pinnedModels?.opencode2).toEqual(['opencode-go/glm-5.3-flash']);
    } finally {
      await cleanupTestDir(testDir);
    }
  });

  test('opencode launch script passes --auto when yolo mode is enabled', () => {
    const script = buildOpenCodeWinScript({
      cli: 'opencode',
      workDir: 'C:\\test\\work',
      model: 'opencode/minimax-m2.5-free',
      message: 'test yolo message',
      yolo: true,
      promptPath: 'C:\\test\\prompt.txt',
      launchTmpDir: 'C:\\test\\launch-tmp',
    });

    expect(script).toContain("$ocArgs = @('--standalone', '--prompt', 'test yolo message', '--auto')");
    expect(script).toContain("$env:OPENCODE_CONFIG = 'C:\\test\\launch-tmp\\pp-model.json'");
  });

  test('buildOpenCodeShScript outputs OpenCode 2 standalone command with model config for opencode', () => {
    const shScript = buildOpenCodeShScript({
      cli: 'opencode',
      workDir: '/home/user/work',
      model: 'opencode/minimax-m2.5-free',
      message: 'sh test message',
      yolo: false,
      promptPath: '/tmp/prompt.txt',
      launchTmpDir: '/tmp/pp-launch-123',
    });

    expect(shScript).toContain('export OPENCODE_CONFIG="/tmp/pp-launch-123/pp-model.json"');
    expect(shScript).toContain('opencode --standalone --prompt "sh test message"');
    expect(shScript).not.toContain('--auto');
  });
});
