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

function writeTestSettings(testDir: string, extra: Record<string, unknown> = {}) {
  fs.writeFileSync(path.join(testDir, 'settings.json'), JSON.stringify({
    theme: 'light',
    language: 'en',
    useOneDrive: false,
    ...extra,
  }, null, 2), 'utf-8');
}

test.describe('OpenCode icon theme mapping', () => {
  test('uses the light-theme logo in light mode and dark-theme logo in dark mode', async () => {
    const testDir = getTestDir();

    try {
      writeTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'Test', folder: '/tmp' },
      ], null, 2));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(300);

      // Open Settings panel and select Light theme
      await page.locator('.activity-btn').nth(4).click();
      await page.locator('.theme-card').first().click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

      // Open provider picker to inspect OpenCode icon in light theme
      await page.locator('.activity-btn').first().click();
      await page.locator('.editor-textarea').fill('icon theme test');
      await page.locator('.launch-list-item').first().dblclick();
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      const lightIcon = page.locator('.provider-picker-item[data-provider="opencode"] .tool-icon-image');
      await expect(lightIcon).toBeVisible();
      const lightThemeSrc = await lightIcon.getAttribute('src');
      expect(lightThemeSrc).toBeTruthy();

      // Close picker, switch to Dark theme, reopen picker
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      await page.locator('.activity-btn').nth(4).click();
      await page.locator('.theme-card').nth(1).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

      await page.locator('.activity-btn').first().click();
      await page.locator('.editor-textarea').fill('icon theme test dark');
      await page.locator('.launch-list-item').first().dblclick();
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      const darkIcon = page.locator('.provider-picker-item[data-provider="opencode"] .tool-icon-image');
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
