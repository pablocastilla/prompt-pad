import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');

const PHRASE_TEXT = 'Eres un experto en QA automatizado y Electron.\nReglas del proyecto: usa siempre Playwright para las pruebas.';
const TASK_TEXT = 'Arregla el bug del contador de sesiones del panel lateral';

function getTestDir(): string {
  const dir = path.join(os.tmpdir(), `pp-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Always force English + no OneDrive sync so tests are deterministic and never
// touch the user's OneDrive.
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

function readLaunchCalls(testDir: string): Array<Record<string, unknown>> {
  const files = fs.readdirSync(testDir).filter(f => f.startsWith('launch-call-') && f.endsWith('.json'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(testDir, f), 'utf-8')));
}

function readLaunchScripts(testDir: string): string[] {
  const files = fs.readdirSync(testDir).filter(f => f.startsWith('launch-script-') && f.endsWith('.ps1'));
  return files.map(f => fs.readFileSync(path.join(testDir, f), 'utf-8'));
}

// Electron can keep file handles briefly after app.close(); retry so a slow
// handle release never fails the test.
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

// Prepare a test dir with one saved phrase (Ctrl+1), one launch config and a
// stubbed OpenCode model catalog, then launch the app.
async function launchAppWithPhrase(testDir: string) {
  saveTestSettings(testDir);
  fs.writeFileSync(path.join(testDir, 'phrases.json'), JSON.stringify([
    { id: 'p1', name: 'Cabecera QA', content: PHRASE_TEXT, shortcut: '1' },
  ]));
  fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
    { id: 'l1', name: 'Test', folder: '/tmp/phrase-ranges' },
  ]));
  fs.writeFileSync(path.join(testDir, 'mock-opencode-models.json'), JSON.stringify([
    { id: 'opencode/glm-5.3-flash', label: 'GLM 5.3 Flash' },
  ]));

  const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);

  // Start from an empty editor and insert the saved phrase at the caret (Ctrl+1)
  const editor = page.locator('.editor-textarea');
  await editor.click();
  await page.keyboard.press('Control+1');
  await page.waitForTimeout(300);
  await expect(editor.locator('.phrase-text')).toContainText('Eres un experto en QA automatizado');

  // Type the actual task right after the phrase
  await page.keyboard.type('\n\n' + TASK_TEXT);
  await page.waitForTimeout(200);

  // Launch with OpenCode (provider 1, first stubbed model)
  await page.keyboard.press('Control+Shift+1');
  await expect(page.locator('.provider-picker-list')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 5000 });
  await page.locator('.model-picker-item').first().click();
  await expect(page.locator('.model-picker-overlay')).not.toBeVisible();
  await page.waitForTimeout(500);

  return { app, page };
}

test.describe('Session summary excludes saved phrases', () => {
  test('launch passes phraseRanges and the seed summary skips the inserted phrase', async () => {
    const testDir = getTestDir();
    try {
      const { app } = await launchAppWithPhrase(testDir);
      await app.close();

      // The launch call carries the phrase spans tracked by the editor
      const calls = readLaunchCalls(testDir);
      expect(calls).toHaveLength(1);
      const ranges = calls[0].phraseRanges as Array<{ start: number; end: number }>;
      expect(Array.isArray(ranges)).toBe(true);
      expect(ranges).toHaveLength(1);
      expect(ranges[0]).toEqual({ start: 0, end: PHRASE_TEXT.length });

      // The launch happens in test mode: the exact PS1 seed script is captured.
      // The summary must describe the task, never the phrase content.
      const scripts = readLaunchScripts(testDir);
      expect(scripts).toHaveLength(1);
      const script = scripts[0];
      expect(script).toContain(`Summary of the file content: ${TASK_TEXT}`);
      expect(script).not.toContain('Eres un experto en QA automatizado');
      expect(script).not.toContain('Reglas del proyecto');
    } finally {
      await cleanupTestDir(testDir);
    }
  });

  test('prompt written for the AI still keeps the full content (phrase included)', async () => {
    const testDir = getTestDir();
    try {
      const { app } = await launchAppWithPhrase(testDir);
      await app.close();

      // The AI still receives the whole prompt (phrases are part of it);
      // only the session-name summary excludes them.
      const calls = readLaunchCalls(testDir);
      expect(calls).toHaveLength(1);
      const prompt = String(calls[0].prompt);
      expect(prompt).toContain('Eres un experto en QA automatizado');
      expect(prompt).toContain(TASK_TEXT);
    } finally {
      await cleanupTestDir(testDir);
    }
  });
});
