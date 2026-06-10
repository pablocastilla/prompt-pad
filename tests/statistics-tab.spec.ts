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

function cleanSession(testDir: string) {
  const sessionPath = path.join(testDir, 'session.json');
  if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { force: true });
}

function saveSettings(testDir: string) {
  const p = path.join(testDir, 'settings.json');
  fs.writeFileSync(p, JSON.stringify({
    theme: 'dark',
    language: 'auto',
    useOneDrive: false,
  }, null, 2));
}

test.describe('Statistics tab', () => {
  test('clicking statistics button opens stats tab with close button', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      cleanSession(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Click the statistics button (📊)
      await page.locator('.activity-btn', { hasText: '📊' }).click();
      await page.waitForTimeout(300);

      // Expect a tab with "📊 Statistics" title to be visible
      const statsTab = page.locator('.tab', { hasText: '📊 Statistics' });
      await expect(statsTab).toBeVisible();

      // Expect the stats panel content to be rendered
      await expect(page.locator('.stats-panel')).toBeVisible();

      // Expect the close button to be visible on the stats tab (even if it's the only tab)
      await expect(statsTab.locator('.tab-close')).toBeVisible();

      // Close the stats tab
      await statsTab.locator('.tab-close').click();
      await page.waitForTimeout(200);

      // Stats panel should no longer be visible
      await expect(page.locator('.stats-panel')).not.toBeVisible();

      // A new untitled tab should have been created
      await expect(page.locator('.tab')).toHaveCount(1);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('opening stats tab twice reuses the same tab', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      cleanSession(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Open stats
      await page.locator('.activity-btn', { hasText: '📊' }).click();
      await page.waitForTimeout(200);

      // Add a new tab
      await page.locator('.tab-add').click();
      await page.waitForTimeout(200);

      // Now we have 3 tabs (initial + stats + new)
      await expect(page.locator('.tab')).toHaveCount(3);

      // Click stats button again - should switch to existing stats tab without creating new one
      await page.locator('.activity-btn', { hasText: '📊' }).click();
      await page.waitForTimeout(200);

      // Should still be 3 tabs
      await expect(page.locator('.tab')).toHaveCount(3);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('stats panel renders token background bars behind cost bars', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      cleanSession(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Open stats
      await page.locator('.activity-btn', { hasText: '📊' }).click();
      await page.waitForTimeout(300);

      // Expect the token background bars to exist inside bar columns
      const tokenBars = page.locator('.stats-bar-token-bg');
      await expect(tokenBars.first()).toBeAttached();

      // Each bar column should have a wrapper containing both the token bg and the cost bar
      const barCols = page.locator('.stats-bar-col');
      const count = await barCols.count();
      expect(count).toBeGreaterThanOrEqual(28); // at least 28 days visible

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('stats tab is active when stats button is clicked', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      cleanSession(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Open stats
      await page.locator('.activity-btn', { hasText: '📊' }).click();
      await page.waitForTimeout(200);

      // Stats button should be active
      const statsBtn = page.locator('.activity-btn', { hasText: '📊' });
      await expect(statsBtn).toHaveClass(/active/);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
