import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');
const APP_DIR = path.join(os.homedir(), '.prompt-pad');

function ensureAppDir() {
  if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true });
}

function detectOneDrivePath(): string | null {
  if (process.platform !== 'win32') return null;
  const candidates = [
    process.env.OneDriveConsumer,
    process.env.OneDrive,
    path.join(os.homedir(), 'OneDrive'),
  ].filter((value): value is string => Boolean(value));
  const found = candidates.find(candidate => fs.existsSync(candidate));
  return found ? path.join(found, 'Apps', 'PromptPad') : null;
}

function getLaunchesPath(): string {
  ensureAppDir();
  const oneDrivePath = detectOneDrivePath();
  if (oneDrivePath) {
    if (!fs.existsSync(oneDrivePath)) fs.mkdirSync(oneDrivePath, { recursive: true });
    return path.join(oneDrivePath, 'launches.json');
  }

  return path.join(APP_DIR, 'launches.json');
}

function writeLaunches(tool: 'copilot' | 'opencode') {
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
  fs.writeFileSync(getLaunchesPath(), JSON.stringify(launches, null, 2), 'utf-8');
}

test.describe('Model picker behavior', () => {
  test('OpenCode model picker supports scrolling long model lists', async () => {
    writeLaunches('opencode');

    const app = await electron.launch({ args: [MAIN_JS] });
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

    for (let i = 0; i < 45; i += 1) {
      await page.keyboard.press('ArrowDown');
    }

    const scrolled = await list.evaluate((el) => el.scrollTop > 0);
    expect(scrolled).toBe(true);

    await app.close();
  });

  test('Copilot model picker shows loading animation and newer fetched models', async () => {
    writeLaunches('copilot');

    const app = await electron.launch({ args: [MAIN_JS] });
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

    await expect(page.locator('.model-picker-item-label', { hasText: 'gpt-5.5' })).toBeVisible({ timeout: 5000 });

    await app.close();
  });
});
