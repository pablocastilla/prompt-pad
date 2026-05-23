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

function savePhrases(testDir: string, phrases: unknown[]) {
  fs.writeFileSync(path.join(testDir, 'phrases.json'), JSON.stringify(phrases, null, 2));
}

function saveLaunches(testDir: string, launches: unknown[]) {
  fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify(launches, null, 2));
}

function saveSettings(testDir: string) {
  const p = path.join(testDir, 'settings.json');
  fs.writeFileSync(p, JSON.stringify({ theme: 'light', language: 'auto', useOneDrive: false }, null, 2));
}

test.describe('Tab persistence after launch', () => {
  test('tab is not closed after launching a prompt', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test Launch', tool: 'opencode', folder: '/tmp/a', yolo: true, mode: 'interactive', shortcut: 1 },
      ]);
      savePhrases(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      const editor = page.locator('.editor-textarea');
      await editor.fill('test prompt content');
      await page.waitForTimeout(100);

      const tabsBefore = page.locator('.tab');
      await expect(tabsBefore).toHaveCount(1);

      await page.keyboard.press('Control+Shift+1');
      await page.waitForTimeout(500);
      await expect(page.locator('.model-picker-overlay')).toBeVisible();

      const firstModelItem = page.locator('.model-picker-item').first();
      await firstModelItem.click();
      await page.waitForTimeout(500);

      const tabsAfter = page.locator('.tab');
      await expect(tabsAfter).toHaveCount(1);
      await expect(editor).toHaveValue('test prompt content');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('tab with multiple tabs is preserved after launch', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test Launch', tool: 'opencode', folder: '/tmp/a', yolo: true, mode: 'interactive', shortcut: 1 },
      ]);
      savePhrases(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      const editor = page.locator('.editor-textarea');
      await editor.fill('first tab content');
      await page.waitForTimeout(100);

      await page.locator('.tab-add').click();
      await page.waitForTimeout(200);

      const tabsBefore = page.locator('.tab');
      await expect(tabsBefore).toHaveCount(2);

      await page.locator('.tab').nth(1).click();
      await page.waitForTimeout(100);
      const secondEditor = page.locator('.editor-textarea');
      await secondEditor.fill('second tab content');
      await page.waitForTimeout(100);

      await page.keyboard.press('Control+Shift+1');
      await page.waitForTimeout(500);
      await expect(page.locator('.model-picker-overlay')).toBeVisible();

      const firstModelItem = page.locator('.model-picker-item').first();
      await firstModelItem.click();
      await page.waitForTimeout(500);

      const tabsAfter = page.locator('.tab');
      await expect(tabsAfter).toHaveCount(2);

      await page.locator('.tab').first().click();
      await page.waitForTimeout(100);
      await expect(editor).toHaveValue('first tab content');

      await page.locator('.tab').nth(1).click();
      await page.waitForTimeout(100);
      await expect(secondEditor).toHaveValue('second tab content');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});