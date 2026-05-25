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

function cleanSettings(testDir: string) {
  const p = path.join(testDir, 'settings.json');
  if (fs.existsSync(p)) fs.rmSync(p, { force: true });
}

function savePhrases(testDir: string, phrases: unknown[]) {
  fs.writeFileSync(path.join(testDir, 'phrases.json'), JSON.stringify(phrases, null, 2));
}

function saveLaunches(testDir: string, launches: unknown[]) {
  fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify(launches, null, 2));
}

test.describe('Launch Panel double-click', () => {
  test('double-click on launch item opens model picker', async () => {
    const testDir = getTestDir();
    try {
      cleanSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'My Project', tool: 'opencode', model: 'opencode/minimax-m2.5-free', folder: '/tmp/proj1', yolo: true, mode: 'interactive' },
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

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('single click selects launch but does not open model picker', async () => {
    const testDir = getTestDir();
    try {
      cleanSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'My Project', tool: 'opencode', model: 'opencode/minimax-m2.5-free', folder: '/tmp/proj1', yolo: true, mode: 'interactive' },
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
      cleanSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'My Project', tool: 'opencode', model: 'opencode/minimax-m2.5-free', folder: '/tmp/proj1', yolo: true, mode: 'interactive' },
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

  test('double-click selects launch and opens model picker with correct pending launch', async () => {
    const testDir = getTestDir();
    try {
      cleanSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Project Alpha', tool: 'opencode', model: 'opencode/minimax-m2.5-free', folder: '/tmp/alpha', yolo: true, mode: 'interactive' },
        { id: 'l2', name: 'Project Beta', tool: 'copilot', model: 'opencode/minimax-m2.5-free', folder: '/tmp/beta', yolo: false, mode: 'interactive' },
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
      const selectedIndicator = page.locator('.launch-list-item.selected');
      await expect(selectedIndicator).toHaveCount(1);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});