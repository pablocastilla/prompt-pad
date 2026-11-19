import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { removeTestDir } from './helpers';

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

function saveLaunches(testDir: string) {
  fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
    { id: 'l1', name: 'Claude and Codex', folder: path.join(testDir, 'project') },
  ], null, 2));
  fs.mkdirSync(path.join(testDir, 'project'), { recursive: true });
}

function readLaunchCalls(testDir: string): Array<Record<string, unknown>> {
  return fs.readdirSync(testDir)
    .filter(f => f.startsWith('launch-call-') && f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(testDir, f), 'utf-8')))
    .sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')));
}

function readLastLaunchScript(testDir: string): string {
  const scripts = fs.readdirSync(testDir)
    .filter(f => f.startsWith('launch-script-') && f.endsWith('.ps1'))
    .sort();
  expect(scripts.length).toBeGreaterThan(0);
  return fs.readFileSync(path.join(testDir, scripts[scripts.length - 1]), 'utf-8');
}

function readLastLaunchMeta(testDir: string): { model: string; message: string; promptPath: string; interactive: boolean } {
  const metas = fs.readdirSync(testDir)
    .filter(f => f.startsWith('launch-meta-') && f.endsWith('.json'))
    .sort();
  expect(metas.length).toBeGreaterThan(0);
  return JSON.parse(fs.readFileSync(path.join(testDir, metas[metas.length - 1]), 'utf-8'));
}

function cleanupPromptDirs(testDir: string) {
  for (const file of fs.readdirSync(testDir)) {
    if (!file.startsWith('launch-meta-') || !file.endsWith('.json')) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(testDir, file), 'utf-8'));
      if (meta?.promptPath) fs.rmSync(path.dirname(meta.promptPath), { recursive: true, force: true });
    } catch { /* best effort */ }
  }
}

async function openProviderPicker(page: import('@playwright/test').Page) {
  await page.locator('.activity-btn').first().click();
  await page.waitForTimeout(200);
  await page.locator('.editor-textarea').fill('Refactor the launch scripts.');
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+Shift+1');
  await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });
}

test.describe('Claude Code model picker and launch', () => {
  test('lists the current Claude aliases and launches the chosen model', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      saveLaunches(testDir);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await openProviderPicker(page);
      await page.locator('.provider-picker-item[data-provider="claude-code"]').click();
      await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 5000 });

      const labels = await page.locator('.model-picker-item-label').allTextContents();
      expect(labels).toContain('Default (Claude Code setting)');
      expect(labels).toContain('Fable (latest)');
      expect(labels).toContain('Opus (latest)');
      expect(labels).toContain('Sonnet (latest)');
      expect(labels).toContain('Haiku (latest)');

      await page.locator('.model-picker-item-label', { hasText: /^Haiku \(latest\)$/ }).click();
      await expect(page.locator('.model-picker-overlay')).not.toBeVisible({ timeout: 5000 });

      const calls = readLaunchCalls(testDir);
      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('claude-code');
      expect(calls[0].model).toBe('haiku');

      const script = readLastLaunchScript(testDir);
      expect(script).toContain("$claudeArgs = @('--model', 'haiku', '--permission-mode', 'bypassPermissions'");
      expect(script).not.toContain("'--print'");
      expect(script).not.toContain('--dangerously-skip-permissions');

      const meta = readLastLaunchMeta(testDir);
      expect(meta.model).toBe('haiku');
      expect(meta.interactive).toBe(true);
      expect(meta.message).toContain('Summary of the file content:');
      expect(fs.readFileSync(meta.promptPath, 'utf-8')).toBe('Refactor the launch scripts.');

      await app.close();
    } finally {
      cleanupPromptDirs(testDir);
      removeTestDir(testDir);
    }
  });

  test('back button returns to the provider picker', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      saveLaunches(testDir);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await openProviderPicker(page);
      await page.locator('.provider-picker-item[data-provider="claude-code"]').click();
      await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 5000 });

      await page.locator('.model-picker-back-btn').click();
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });
      expect(readLaunchCalls(testDir)).toHaveLength(0);

      await app.close();
    } finally {
      cleanupPromptDirs(testDir);
      removeTestDir(testDir);
    }
  });
});

test.describe('OpenAI Codex model picker and launch', () => {
  test('default entry omits --model and keeps the current yolo flag', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      saveLaunches(testDir);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await openProviderPicker(page);
      await page.locator('.provider-picker-item[data-provider="codex"]').click();
      await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 5000 });

      const labels = await page.locator('.model-picker-item-label').allTextContents();
      expect(labels).toContain('Default (Codex config)');
      expect(labels).toContain('GPT-6.2 Sol');
      expect(labels).toContain('GPT-5.4');

      await page.locator('.model-picker-item-label', { hasText: /^Default \(Codex config\)$/ }).click();
      await expect(page.locator('.model-picker-overlay')).not.toBeVisible({ timeout: 5000 });

      const calls = readLaunchCalls(testDir);
      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('codex');
      expect(calls[0].model).toBe('default');

      const script = readLastLaunchScript(testDir);
      expect(script).toContain("$codexArgs = @('--dangerously-bypass-approvals-and-sandbox'");
      expect(script).not.toContain('--model');
      expect(script).not.toContain('--full-auto');
      expect(script).not.toContain("'exec'");

      await app.close();
    } finally {
      cleanupPromptDirs(testDir);
      removeTestDir(testDir);
    }
  });

  test('Launches the selected Codex model through -m/--model', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      saveLaunches(testDir);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await openProviderPicker(page);
      await page.locator('.provider-picker-item[data-provider="codex"]').click();
      await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 5000 });

      await page.locator('.model-picker-item-label', { hasText: /^GPT-5\.4$/ }).click();
      await page.waitForTimeout(200);
      if (await page.locator('.model-picker-confirm-overlay').isVisible()) {
        await page.locator('.model-picker-confirm-launch').click();
      }
      await expect(page.locator('.model-picker-overlay')).not.toBeVisible({ timeout: 5000 });

      const calls = readLaunchCalls(testDir);
      expect(calls).toHaveLength(1);
      expect(calls[0].tool).toBe('codex');
      expect(calls[0].model).toBe('gpt-5.4');

      const script = readLastLaunchScript(testDir);
      expect(script).toContain("$codexArgs = @('--model', 'gpt-5.4', '--dangerously-bypass-approvals-and-sandbox'");

      await app.close();
    } finally {
      cleanupPromptDirs(testDir);
      removeTestDir(testDir);
    }
  });
});
