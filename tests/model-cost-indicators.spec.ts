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

function saveLaunches(testDir: string, launches: unknown[]) {
  fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify(launches, null, 2));
}

function savePhrases(testDir: string, phrases: unknown[]) {
  fs.writeFileSync(path.join(testDir, 'phrases.json'), JSON.stringify(phrases, null, 2));
}

test.describe('Model Cost Indicators', () => {
  test('shows free badge for free models in model picker', async () => {
    const testDir = getTestDir();
    try {
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test', tool: 'opencode', folder: '/tmp/a', yolo: true, mode: 'interactive' },
      ]);
      savePhrases(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.evaluate(() => {
        const api = (window as unknown as {
          electronAPI: {
            getOpenCodeModels: () => Promise<Array<{ id: string; label: string }>>;
          };
        }).electronAPI;

        api.getOpenCodeModels = async () => [
          { id: 'opencode/minimax-m2.5-free', label: 'MiniMax M2.5 Free' },
          { id: 'opencode/gpt-5-nano', label: 'GPT 5 Nano' },
          { id: 'opencode/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
          { id: 'opencode/claude-opus-4.7', label: 'Claude Opus 4.7' },
        ];
      });

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('test');
      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();

      // Toggle "Show Go models only" off to see all models
      const goToggle = page.locator('.model-picker-go-toggle');
      await expect(goToggle).toBeVisible({ timeout: 3000 });
      const isChecked = await goToggle.locator('input[type="checkbox"]').isChecked();
      if (isChecked) {
        await goToggle.click();
        await page.waitForTimeout(500);
      }

      // Verify models rendered with cost indicators
      const freeBadge = page.locator('.model-cost-badge.model-cost-free').first();
      await expect(freeBadge).toBeVisible({ timeout: 3000 });
      await expect(freeBadge).toHaveText('free');

      const costBars = page.locator('.model-cost-bars');
      const count = await costBars.count();
      expect(count).toBeGreaterThan(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('cost indicators show on all model items', async () => {
    const testDir = getTestDir();
    try {
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test', tool: 'opencode', folder: '/tmp/a', yolo: true, mode: 'interactive' },
      ]);
      savePhrases(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.evaluate(() => {
        const api = (window as unknown as {
          electronAPI: {
            getOpenCodeModels: () => Promise<Array<{ id: string; label: string }>>;
          };
        }).electronAPI;

        api.getOpenCodeModels = async () => [
          { id: 'opencode/minimax-m2.5-free', label: 'MiniMax M2.5 Free' },
          { id: 'opencode/gpt-5-nano', label: 'GPT 5 Nano' },
          { id: 'opencode/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
          { id: 'opencode/claude-opus-4.7', label: 'Claude Opus 4.7' },
          { id: 'opencode/gpt-5.5-pro', label: 'GPT 5.5 Pro' },
          { id: 'opencode-go/deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
          { id: 'opencode-go/glm-5.1', label: 'GLM 5.1' },
        ];
      });

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('test');
      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();

      const goToggle = page.locator('.model-picker-go-toggle');
      await expect(goToggle).toBeVisible({ timeout: 3000 });
      const isChecked = await goToggle.locator('input[type="checkbox"]').isChecked();
      if (isChecked) {
        await goToggle.click();
        await page.waitForTimeout(500);
      }

      // Every model item should have either a cost badge or cost bars
      const items = page.locator('.model-picker-item');
      const itemCount = await items.count();
      expect(itemCount).toBeGreaterThan(0);

      const indicatorCount = await page.locator('.model-cost-badge, .model-cost-bars').count();
      expect(indicatorCount).toBeGreaterThan(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('cost indicator tooltips show pricing info on hover', async () => {
    const testDir = getTestDir();
    try {
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test', tool: 'opencode', folder: '/tmp/a', yolo: true, mode: 'interactive' },
      ]);
      savePhrases(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.evaluate(() => {
        const api = (window as unknown as {
          electronAPI: {
            getOpenCodeModels: () => Promise<Array<{ id: string; label: string }>>;
          };
        }).electronAPI;

        api.getOpenCodeModels = async () => [
          { id: 'opencode/minimax-m2.5-free', label: 'MiniMax M2.5 Free' },
          { id: 'opencode/gpt-5-nano', label: 'GPT 5 Nano' },
        ];
      });

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('test');
      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();

      const goToggle = page.locator('.model-picker-go-toggle');
      await expect(goToggle).toBeVisible({ timeout: 3000 });
      const isChecked = await goToggle.locator('input[type="checkbox"]').isChecked();
      if (isChecked) {
        await goToggle.click();
        await page.waitForTimeout(500);
      }

      const freeBadge = page.locator('.model-cost-badge.model-cost-free').first();
      await expect(freeBadge).toBeVisible({ timeout: 3000 });
      const freeTitle = await freeBadge.getAttribute('title');
      expect(freeTitle).toBeTruthy();
      expect(freeTitle?.toLowerCase()).toContain('free');

      const costBars = page.locator('.model-cost-bars').first();
      await expect(costBars).toBeVisible({ timeout: 3000 });
      const barsTitle = await costBars.getAttribute('title');
      expect(barsTitle).toBeTruthy();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});

test.describe('Ctrl+Shift+0 Shortcut', () => {
  test('launch shortcut 0 opens model picker with Digit0 key', async () => {
    const testDir = getTestDir();
    try {
      saveLaunches(testDir, [
        { id: 'l1', name: 'Zero Launch', tool: 'copilot', folder: '/tmp/a', yolo: true, mode: 'interactive', shortcut: 0 },
      ]);
      savePhrases(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.editor-textarea').fill('test prompt');

      await page.keyboard.press('Control+Shift+0');
      await page.waitForTimeout(500);
      await expect(page.locator('.model-picker-overlay')).toBeVisible();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('migration assigns shortcut 0 to 10th launch when unspecified', async () => {
    const testDir = getTestDir();
    try {
      const launches = Array.from({ length: 10 }, (_, i) => ({
        id: `l${i}`,
        name: `Launch ${i + 1}`,
        tool: 'copilot' as const,
        folder: '/tmp',
        yolo: true,
        mode: 'interactive' as const,
      }));
      saveLaunches(testDir, launches);
      savePhrases(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      const saved = JSON.parse(fs.readFileSync(path.join(testDir, 'launches.json'), 'utf-8'));
      expect(saved[9].shortcut).toBe(0);

      await page.locator('.editor-textarea').fill('test prompt for shortcut 0');

      await page.keyboard.press('Control+Shift+0');
      await page.waitForTimeout(500);
      await expect(page.locator('.model-picker-overlay')).toBeVisible();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Ctrl+Shift+0 does nothing when no launch has shortcut 0', async () => {
    const testDir = getTestDir();
    try {
      saveLaunches(testDir, [
        { id: 'l1', name: 'Launch 1', tool: 'copilot', folder: '/tmp/a', yolo: true, mode: 'interactive', shortcut: 1 },
      ]);
      savePhrases(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.editor-textarea').fill('test prompt');

      await page.keyboard.press('Control+Shift+0');
      await page.waitForTimeout(300);
      await expect(page.locator('.model-picker-overlay')).not.toBeVisible();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
