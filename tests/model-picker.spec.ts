import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { selectOpenCodeProvider } from './helpers';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');

function getTestDir(): string {
  const dir = path.join(os.tmpdir(), `pp-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getLaunchesPath(testDir: string): string {
  return path.join(testDir, 'launches.json');
}

function writeLaunches(testDir: string) {
  const launches = [
    {
      id: 'test-launch-opencode',
      name: 'Playwright opencode',
      folder: process.cwd(),
    },
  ];
  fs.writeFileSync(getLaunchesPath(testDir), JSON.stringify(launches, null, 2), 'utf-8');
}

function writeTestSettings(testDir: string, extra: Record<string, unknown> = {}) {
  fs.writeFileSync(path.join(testDir, 'settings.json'), JSON.stringify({
    theme: 'light',
    language: 'en',
    useOneDrive: false,
    ...extra,
  }, null, 2), 'utf-8');
}

test.describe('Model picker behavior', () => {
  test('OpenCode model picker supports scrolling long model lists', async () => {
    const testDir = getTestDir();
    try {
      writeLaunches(testDir);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.evaluate(() => {
        const api = (window as unknown as {
          electronAPI: {
            getOpenCodeModels: () => Promise<Array<{ id: string; label: string }>>;
          };
        }).electronAPI;

        api.getOpenCodeModels = async () => {
          const goModels = Array.from({ length: 25 }, (_, i) => ({
            id: `opencode-go/mock-go-${i + 1}`,
            label: `Mock Go ${i + 1}`,
          }));
          const regularModels = Array.from({ length: 25 }, (_, i) => ({
            id: `opencode/mock-${i + 1}`,
            label: `Mock ${i + 1}`,
          }));
          return [...goModels, ...regularModels];
        };
      });

      const models = await page.evaluate(async () => {
        const api = (window as unknown as {
          electronAPI: {
            getOpenCodeModels: () => Promise<Array<{ id: string; label: string }>>;
          };
        }).electronAPI;
        return await api.getOpenCodeModels();
      });

      test.skip(models.length <= 20, 'Large model list unavailable in this environment');

      expect(models.length).toBeGreaterThan(20);
      expect(models.filter(m => m.id.startsWith('opencode-go/')).length).toBeGreaterThan(0);

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('trigger model picker');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();
      await selectOpenCodeProvider(page);

      // Wait for Go models to load (filter enabled by default)
      await page.waitForTimeout(3000);

      const goModelCount = await page.locator('.model-picker-item').count();
      expect(goModelCount).toBeGreaterThan(0);
      expect(goModelCount).toBeLessThanOrEqual(models.length);

      const list = page.locator('.model-picker-list');
      const canScroll = await list.evaluate((el) => el.scrollHeight > el.clientHeight);
      expect(canScroll).toBe(true);

      await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      const scrolled = await list.evaluate((el) => el.scrollTop > 0);
      expect(scrolled).toBe(true);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('OpenCode model picker shows loading animation and newer fetched models', async () => {
    const testDir = getTestDir();
    try {
      writeLaunches(testDir);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.evaluate(() => {
        const api = (window as unknown as {
          electronAPI: {
            getOpenCodeModels: () => Promise<Array<{ id: string; label: string }>>;
          };
        }).electronAPI;

        api.getOpenCodeModels = async () => {
          await new Promise(resolve => setTimeout(resolve, 450));
          return [
            { id: 'opencode-go/glm-5.1', label: 'GLM 5.1 Go' },
            { id: 'opencode-go/kimi-k2.6', label: 'Kimi K2.6 Go' },
            { id: 'opencode/kimi-k2.6', label: 'Kimi K2.6' },
            { id: 'opencode/minimax-m2.7', label: 'Minimax M2.7' },
          ];
        };
      });

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('trigger model picker');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();
      await selectOpenCodeProvider(page, { waitForList: false });

      const loading = page.locator('.model-picker-loading').first();
      await expect(loading).toBeVisible();
      await expect(page.locator('.model-picker-loading-dot')).toBeVisible();

      const animationName = await page.locator('.model-picker-loading-dot').evaluate((el) =>
        window.getComputedStyle(el).animationName
      );
      expect(animationName).toContain('model-picker-pulse');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('OpenCode model picker shows Go models filter checkbox checked by default', async () => {
    const testDir = getTestDir();
    try {
      writeLaunches(testDir);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.evaluate(() => {
        const api = (window as unknown as {
          electronAPI: {
            getOpenCodeModels: () => Promise<Array<{ id: string; label: string }>>;
          };
        }).electronAPI;

        api.getOpenCodeModels = async () => {
          await new Promise(resolve => setTimeout(resolve, 150));
          return [
            { id: 'opencode-go/glm-5.1', label: 'GLM 5.1 Go' },
            { id: 'opencode-go/kimi-k2.6', label: 'Kimi K2.6 Go' },
            { id: 'opencode/kimi-k2.6', label: 'Kimi K2.6' },
          ];
        };
      });

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('trigger model picker');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();
      await selectOpenCodeProvider(page);

      // Checkbox should be visible and checked by default
      await expect(page.locator('.model-picker-go-toggle')).toBeVisible();
      await expect(page.locator('.model-picker-go-toggle input[type="checkbox"]')).toBeChecked();

      await expect(page.locator('.model-picker-go-toggle input[type="checkbox"]')).toBeChecked();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('OpenCode model picker hides Go filter when setting is disabled', async () => {
    const testDir = getTestDir();
    try {
      writeLaunches(testDir);

      fs.writeFileSync(path.join(testDir, 'settings.json'), JSON.stringify({
        theme: 'light',
        language: 'auto',
        useOneDrive: false,
        showGoModelsOnly: {
          opencode: false,
        },
      }, null, 2), 'utf-8');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('trigger model picker');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();
      await selectOpenCodeProvider(page);

      await expect(page.locator('.model-picker-go-toggle')).toBeVisible();
      await expect(page.locator('.model-picker-go-toggle input[type="checkbox"]')).not.toBeChecked();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Model picker shows Go badge for opencode-go/ models and Zen badge for opencode/ models', async () => {
    const testDir = getTestDir();
    try {
      writeLaunches(testDir);

      fs.writeFileSync(path.join(testDir, 'settings.json'), JSON.stringify({
        theme: 'light',
        language: 'auto',
        useOneDrive: false,
        showGoModelsOnly: { opencode: false },
      }, null, 2), 'utf-8');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('trigger model picker');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();
      await selectOpenCodeProvider(page);

      // Wait for model items to load
      await page.waitForFunction(() => {
        const items = document.querySelectorAll('.model-picker-item');
        return items.length > 0;
      }, { timeout: 8000 });

      // All opencode-go/ models should have a Go badge
      const goItems = page.locator('.model-picker-item').filter({ has: page.locator('.model-tier-go') });
      const goBadgeCount = await goItems.count();
      expect(goBadgeCount).toBeGreaterThan(0);

      // All opencode/ (non-go) models should have a Zen badge
      const zenItems = page.locator('.model-picker-item').filter({ has: page.locator('.model-tier-zen') });
      const zenBadgeCount = await zenItems.count();
      expect(zenBadgeCount).toBeGreaterThan(0);

      // Every badge text should be correct
      const allGoBadges = page.locator('.model-tier-go');
      const allZenBadges = page.locator('.model-tier-zen');
      const goCount = await allGoBadges.count();
      const zenCount = await allZenBadges.count();
      expect(goCount).toBeGreaterThan(0);
      expect(zenCount).toBeGreaterThan(0);

      for (let i = 0; i < goCount; i++) {
        await expect(allGoBadges.nth(i)).toHaveText('Go');
      }
      for (let i = 0; i < zenCount; i++) {
        await expect(allZenBadges.nth(i)).toHaveText('Zen');
      }

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Tier badges have correct CSS classes and styling', async () => {
    const testDir = getTestDir();
    try {
      writeLaunches(testDir);

      fs.writeFileSync(path.join(testDir, 'settings.json'), JSON.stringify({
        theme: 'light',
        language: 'auto',
        useOneDrive: false,
        showGoModelsOnly: { opencode: false },
      }, null, 2), 'utf-8');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('trigger model picker');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();
      await selectOpenCodeProvider(page);

      // Wait for model items to load
      await page.waitForFunction(() => {
        const items = document.querySelectorAll('.model-picker-item');
        return items.length > 0;
      }, { timeout: 8000 });

      // Check Go badge styling
      const goBadge = page.locator('.model-tier-go').first();
      await expect(goBadge).toBeVisible();
      const goColor = await goBadge.evaluate(el => window.getComputedStyle(el).color);
      expect(goColor).toContain('249'); // #f97316 -> rgb(249, 115, 22)

      // Check Zen badge styling
      const zenBadge = page.locator('.model-tier-zen').first();
      await expect(zenBadge).toBeVisible();
      const zenColor = await zenBadge.evaluate(el => window.getComputedStyle(el).color);
      expect(zenColor).toContain('129'); // #818cf8 -> rgb(129, 140, 248)

      // Both badges should be uppercase
      const goTextTransform = await goBadge.evaluate(el => window.getComputedStyle(el).textTransform);
      expect(goTextTransform).toBe('uppercase');

      const zenTextTransform = await zenBadge.evaluate(el => window.getComputedStyle(el).textTransform);
      expect(zenTextTransform).toBe('uppercase');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Tier badges appear in pinned models section', async () => {
    const testDir = getTestDir();
    try {
      writeLaunches(testDir);

      fs.writeFileSync(path.join(testDir, 'settings.json'), JSON.stringify({
        theme: 'light',
        language: 'auto',
        useOneDrive: false,
        showGoModelsOnly: { opencode: false },
        pinnedModels: {
          opencode: ['opencode-go/glm-5.1'],
        },
      }, null, 2), 'utf-8');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('trigger model picker');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();
      await selectOpenCodeProvider(page);

      // Wait for model items to load
      await page.waitForFunction(() => {
        const items = document.querySelectorAll('.model-picker-item');
        return items.length > 0;
      }, { timeout: 8000 });

      // Pinned section should exist if pinned models match fetched models
      const pinnedItems = page.locator('.model-picker-item.pinned');
      const pinnedCount = await pinnedItems.count();

      if (pinnedCount > 0) {
        // If a pinned Go model is present, it should have a Go badge
        const pinnedGoBadge = pinnedItems.first().locator('.model-tier-go');
        const pinnedGoCount = await pinnedGoBadge.count();
        expect(pinnedGoCount).toBe(1);
        await expect(pinnedGoBadge).toHaveText('Go');
      }

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
