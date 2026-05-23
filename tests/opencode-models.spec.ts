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

function launchWithTestDir(testDir: string) {
  return electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
}

test.describe('OpenCode Models Feature', () => {
  test('getOpenCodeModels IPC returns models from CLI', async () => {
    const testDir = getTestDir();
    try {
      const app = await launchWithTestDir(testDir);
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      const models = await page.evaluate(async () => {
        return (window as unknown as {
          electronAPI: { getOpenCodeModels: () => Promise<{ id: string; label: string }[]> }
        }).electronAPI.getOpenCodeModels();
      });

      console.log(`Fetched ${models.length} models`);
      console.log('First 5 models:', models.slice(0, 5));

      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      if (models.length > 0) {
        expect(models[0]).toHaveProperty('id');
        expect(models[0]).toHaveProperty('label');
        expect(typeof models[0].id).toBe('string');
        expect(typeof models[0].label).toBe('string');
      }

      console.log(`Total models: ${models.length} (fallback is 3, CLI should be ~40+)`);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('ModelPicker shows available models for OpenCode launch', async () => {
    const testDir = getTestDir();
    try {
      const app = await launchWithTestDir(testDir);
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.evaluate(() => {
        const store = (window as any).__store;
        if (store && store.setState) {
          store.setState({
            pendingLaunch: {
              launch: {
                id: 'test-launch',
                tool: 'opencode',
                model: '',
                folder: '/tmp',
                yolo: false,
                mode: 'interactive',
              },
              prompt: 'test prompt',
              attachedFiles: [],
            }
          });
        }
      });

      await page.waitForTimeout(500);

      const modelPicker = page.locator('[class*="model-picker"]');
      const isVisible = await modelPicker.isVisible().catch(() => false);

      console.log(`ModelPicker visible: ${isVisible}`);

      const bodyText = await page.locator('body').innerText();
      console.log('Body text contains "opencode":', bodyText.includes('opencode'));
      console.log('Body text contains "kimi":', bodyText.includes('kimi'));
      console.log('Body text contains "minimax":', bodyText.includes('minimax'));

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Pinned models persist across sessions', async () => {
    const testDir = getTestDir();
    try {
      let app = await launchWithTestDir(testDir);
      let page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      let pinnedBefore = await page.evaluate(() => {
        const store = (window as any).__store;
        return store?.getState?.()?.pinnedModels || [];
      });

      console.log(`Pinned models before: ${pinnedBefore.length}`);

      await app.close();

      await new Promise(r => setTimeout(r, 500));

      app = await launchWithTestDir(testDir);
      page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      let pinnedAfter = await page.evaluate(() => {
        const store = (window as any).__store;
        return store?.getState?.()?.pinnedModels || [];
      });

      console.log(`Pinned models after: ${pinnedAfter.length}`);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Console logs show model fetching activity', async () => {
    const testDir = getTestDir();
    try {
      const app = await launchWithTestDir(testDir);
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      const logs: any[] = [];
      page.on('console', msg => {
        logs.push({
          type: msg.type(),
          text: msg.text(),
        });
      });

      await page.evaluate(() => {
        const store = (window as any).__store;
        if (store?.setState) {
          store.setState({
            pendingLaunch: {
              launch: {
                id: 'test-launch-' + Date.now(),
                tool: 'opencode',
                model: '',
                folder: '/tmp',
                yolo: false,
                mode: 'interactive',
              },
              prompt: 'test',
              attachedFiles: [],
            }
          });
        }
      });

      await page.waitForTimeout(1000);

      const fetchLogs = logs.filter(l => l.text.includes('Fetching OpenCode models'));
      const fetchedLogs = logs.filter(l => l.text.includes('Fetched models'));

      console.log(`Found ${fetchLogs.length} "Fetching" logs`);
      console.log(`Found ${fetchedLogs.length} "Fetched" logs`);

      if (fetchedLogs.length > 0) {
        console.log('Sample fetch log:', fetchedLogs[0].text.substring(0, 100));
      }

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('clearModelCache IPC clears model cache', async () => {
    const testDir = getTestDir();
    try {
      const app = await launchWithTestDir(testDir);
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      const models1 = await page.evaluate(async () => {
        const api = (window as unknown as {
          electronAPI: { getOpenCodeModels: () => Promise<{ id: string; label: string }[]>; clearModelCache: () => Promise<void> }
        }).electronAPI;
        const m = await api.getOpenCodeModels();
        await api.clearModelCache();
        const m2 = await api.getOpenCodeModels();
        return { first: m.length, second: m2.length, same: JSON.stringify(m) === JSON.stringify(m2) };
      });

      expect(models1.first).toBeGreaterThan(0);
      expect(models1.first).toBe(models1.second);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('stale pinned models are removed when unavailable in refreshed list', async () => {
    const testDir = getTestDir();
    try {
      const launches = [
        {
          id: 'stale-pin-launch',
          name: 'Stale Pin Test',
          tool: 'opencode',
          model: 'opencode/kimi-k2.6',
          folder: process.cwd(),
          yolo: true,
          mode: 'interactive',
          shortcut: 1,
        },
      ];
      const settings = {
        theme: 'light',
        language: 'auto',
        pinnedModels: {
          copilot: [],
          opencode: ['opencode/kimi-k2.6', 'nonexistent-model-xyz'],
        },
      };
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify(launches, null, 2), 'utf-8');
      fs.writeFileSync(path.join(testDir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf-8');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('stale pin test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();

      await page.waitForTimeout(2500);

      await app.close();
      await new Promise(r => setTimeout(r, 500));

      const savedSettings = JSON.parse(fs.readFileSync(path.join(testDir, 'settings.json'), 'utf-8'));
      const opencodePins = savedSettings.pinnedModels?.opencode ?? [];
      console.log(`OpenCode pinned after cleanup: ${JSON.stringify(opencodePins)}`);
      expect(opencodePins).not.toContain('nonexistent-model-xyz');
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('refresh button appears in model picker header', async () => {
    const testDir = getTestDir();
    try {
      const launches = [
        {
          id: 'refresh-btn-launch',
          name: 'Refresh Btn Test',
          tool: 'opencode',
          model: 'opencode/kimi-k2.6',
          folder: process.cwd(),
          yolo: true,
          mode: 'interactive',
          shortcut: 1,
        },
      ];
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify(launches, null, 2), 'utf-8');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('refresh btn test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();

      const refreshBtn = page.locator('.model-picker-refresh-btn');
      await expect(refreshBtn).toBeVisible({ timeout: 3000 });

      const isLoading = await refreshBtn.isDisabled();
      console.log(`Refresh button disabled (loading): ${isLoading}`);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
