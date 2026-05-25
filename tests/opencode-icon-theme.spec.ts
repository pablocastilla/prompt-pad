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

async function openLaunchPanel(page: import('@playwright/test').Page) {
  await page.locator('.activity-btn').first().click();
  await expect(page.locator('.launch-panel')).toBeVisible();
}

async function openNewLaunchForm(page: import('@playwright/test').Page) {
  await page.locator('.panel-section-actions .btn-icon').last().click();
  await expect(page.locator('.launch-form')).toBeVisible();
}

function envWithSandbox(testDir: string) {
  return {
    ...process.env,
    PROMPT_PAD_TEST_DIR: testDir,
  };
}

test.describe('OpenCode icon theme mapping', () => {
  test('uses the light-theme logo in light mode and dark-theme logo in dark mode', async () => {
    const testDir = getTestDir();

    try {
      const app = await electron.launch({ args: [MAIN_JS], env: envWithSandbox(testDir) });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('.activity-btn').nth(3).click();
      await page.locator('.theme-card').first().click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

      await openLaunchPanel(page);
      await openNewLaunchForm(page);

      await page.locator('.tool-btn').filter({ hasText: 'OpenCode' }).first().click();
      const lightIcon = page.locator('.tool-btn.active .tool-icon-image').first();

      await expect(lightIcon).toBeVisible();
      const lightThemeSrc = await lightIcon.getAttribute('src');
      expect(lightThemeSrc).toBeTruthy();

      await page.locator('.activity-btn').nth(3).click();
      await page.locator('.theme-card').nth(1).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

      await page.locator('.activity-btn').first().click();
      await openNewLaunchForm(page);
      await page.locator('.tool-btn').filter({ hasText: 'OpenCode' }).first().click();
      const darkIcon = page.locator('.tool-btn.active .tool-icon-image').first();
      await expect(darkIcon).toBeVisible();
      const darkThemeSrc = await darkIcon.getAttribute('src');
      expect(darkThemeSrc).toBeTruthy();
      expect(darkThemeSrc).not.toBe(lightThemeSrc);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
