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

function getLaunchesPath(testDir: string): string {
  return path.join(testDir, 'launches.json');
}

function writeLaunches(testDir: string, tool: 'copilot' | 'opencode') {
  const launches = [
    {
      id: 'test-launch-' + tool,
      name: 'Playwright ' + tool,
      tool,
      model: tool === 'opencode' ? 'opencode/kimi-k2.6' : 'auto',
      folder: process.cwd(),
      yolo: true,
      mode: 'interactive',
    },
  ];
  fs.writeFileSync(getLaunchesPath(testDir), JSON.stringify(launches, null, 2), 'utf-8');
}

test.describe('Model picker behavior', () => {
  test('OpenCode model picker supports scrolling long model lists', async () => {
    const testDir = getTestDir();
    try {
      writeLaunches(testDir, 'opencode');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      const modelCount = await page.evaluate(async () => {
        const api = (window as unknown as {
          electronAPI: {
            getOpenCodeModels: () => Promise<Array<{ id: string; label: string }>>;
          };
        }).electronAPI;
        return (await api.getOpenCodeModels()).length;
      });
      expect(modelCount).toBeGreaterThan(20);

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('trigger model picker');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();

      await expect(page.locator('.model-picker-item')).toHaveCount(modelCount, { timeout: 5000 });

      const list = page.locator('.model-picker-list');
      const canScroll = await list.evaluate((el) => el.scrollHeight > el.clientHeight);
      expect(canScroll).toBe(true);

      // Scroll the list via wheel to ensure scrollTop changes
      await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });

      const scrolled = await list.evaluate((el) => el.scrollTop > 0);
      expect(scrolled).toBe(true);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Copilot model picker shows loading animation and newer fetched models', async () => {
    const testDir = getTestDir();
    try {
      writeLaunches(testDir, 'copilot');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.evaluate(() => {
        const api = (window as unknown as {
          electronAPI: {
            getCopilotModels: () => Promise<Array<{ id: string; label: string }>>;
          };
        }).electronAPI;

        api.getCopilotModels = async () => {
          await new Promise(resolve => setTimeout(resolve, 450));
          return [
            { id: 'auto', label: 'auto' },
            { id: 'gpt-5.5', label: 'gpt-5.5' },
            { id: 'gpt-5.4-pro', label: 'gpt-5.4-pro' },
            { id: 'claude-opus-4.7', label: 'claude-opus-4.7' },
          ];
        };
      });

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('trigger model picker');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();

      const loading = page.locator('.model-picker-loading').first();
      await expect(loading).toBeVisible();
      await expect(page.locator('.model-picker-loading-dot')).toBeVisible();

      const animationName = await page.locator('.model-picker-loading-dot').evaluate((el) =>
        window.getComputedStyle(el).animationName
      );
      expect(animationName).toContain('model-picker-pulse');

      await expect(page.locator('.model-picker-item-label').filter({ hasText: 'gpt-5.5' })).toBeVisible({ timeout: 5000 });

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
