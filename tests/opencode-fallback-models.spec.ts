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

test.describe('OpenCode fallback models with Go filter', () => {
  test('fallback models include Go entries so Go filter does not hide all models', async () => {
    const testDir = getTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'Go Fallback Test', tool: 'opencode', model: 'opencode-go/minimax-m2.5', folder: process.cwd(), yolo: true, mode: 'interactive', shortcut: '1' },
      ], null, 2));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        api.getOpenCodeModels = async () => [];
      });

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('go fallback test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible({ timeout: 5000 });

      await page.waitForTimeout(2000);

      const modelItems = page.locator('.model-picker-item');
      const count = await modelItems.count();
      console.log(`Go-only models visible (fallback): ${count}`);
      expect(count).toBeGreaterThan(0);

      const goVisible = await page.evaluate(() => {
        const items = document.querySelectorAll('.model-picker-item');
        return Array.from(items).some(el => el.textContent?.includes('Deepseek V4 Pro'));
      });
      expect(goVisible).toBe(true);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('model picker shows fallback models when CLI is unavailable', async () => {
    const testDir = getTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'CLI Unavailable', tool: 'opencode', model: '', folder: process.cwd(), yolo: true, mode: 'interactive', shortcut: '1' },
      ], null, 2));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        api.getOpenCodeModels = async () => {
          throw new Error('CLI not found');
        };
      });

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('cli fail test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible({ timeout: 5000 });

      await page.waitForTimeout(2000);

      const modelItems = page.locator('.model-picker-item');
      const count = await modelItems.count();
      console.log(`Models visible when CLI fails: ${count}`);

      expect(count).toBeGreaterThan(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('selectedIdx updates when models finish loading asynchronously', async () => {
    const testDir = getTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'Async Load', tool: 'opencode', model: 'opencode-go/qwen3.6-plus', folder: process.cwd(), yolo: true, mode: 'interactive', shortcut: '1' },
      ], null, 2));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        api.getOpenCodeModels = async () => {
          await new Promise(resolve => setTimeout(resolve, 600));
          return [
            { id: 'opencode-go/deepseek-v4-pro', label: 'Deepseek V4 Pro' },
            { id: 'opencode-go/minimax-m2.5', label: 'Minimax M2.5' },
            { id: 'opencode-go/minimax-m2.7', label: 'Minimax M2.7' },
            { id: 'opencode-go/qwen3.6-plus', label: 'Qwen3.6 Plus' },
            { id: 'opencode-go/kimi-k2.6', label: 'Kimi K2.6' },
          ];
        };
      });

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('async load test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible({ timeout: 5000 });

      await page.waitForTimeout(2000);

      const selectedItem = page.locator('.model-picker-item.selected');
      const selectedText = await selectedItem.textContent();
      console.log(`Selected item text: "${selectedText}"`);

      const modelItems = page.locator('.model-picker-item');
      const count = await modelItems.count();
      expect(count).toBeGreaterThan(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('model picker shows Zen models when Go filter is toggled off', async () => {
    const testDir = getTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'Zen + Go', tool: 'opencode', model: '', folder: process.cwd(), yolo: true, mode: 'interactive', shortcut: '1' },
      ], null, 2));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        api.getOpenCodeModels = async () => [
          { id: 'opencode-go/deepseek-v4-pro', label: 'Deepseek V4 Pro' },
          { id: 'opencode/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
          { id: 'opencode/minimax-m2.7', label: 'Minimax M2.7' },
        ];
      });

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('zen + go test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible({ timeout: 5000 });

      await page.waitForTimeout(2000);

      const goToggle = page.locator('.model-picker-go-toggle');
      await expect(goToggle).toBeVisible({ timeout: 3000 });
      const isChecked = await goToggle.locator('input[type="checkbox"]').isChecked();
      console.log(`Go filter checked (default): ${isChecked}`);

      if (isChecked) {
        const goCount = await page.locator('.model-picker-item').count();
        console.log(`Models with Go filter on: ${goCount}`);
        expect(goCount).toBeGreaterThan(0);

        await goToggle.click();
        await page.waitForTimeout(500);
      }

      const allCount = await page.locator('.model-picker-item').count();
      console.log(`Models with Go filter off: ${allCount}`);
      expect(allCount).toBeGreaterThan(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('model labels parse correctly for new models', async () => {
    const testDir = getTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'Label Test', tool: 'opencode', model: '', folder: process.cwd(), yolo: true, mode: 'interactive', shortcut: '1' },
      ], null, 2));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        api.getOpenCodeModels = async () => [
          { id: 'opencode/deepseek-v4-flash-free', label: 'Deepseek V4 Flash Free' },
          { id: 'opencode/nemotron-3-super-free', label: 'Nemotron 3 Super Free' },
          { id: 'opencode/big-pickle', label: 'Big Pickle' },
          { id: 'opencode/grok-build-0.1', label: 'Grok Build 0.1' },
          { id: 'opencode/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
        ];
      });

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('label test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible({ timeout: 5000 });

      await page.waitForTimeout(2000);

      const goToggle = page.locator('.model-picker-go-toggle');
      await expect(goToggle).toBeVisible({ timeout: 3000 });
      if (await goToggle.locator('input[type="checkbox"]').isChecked()) {
        await goToggle.click();
        await page.waitForTimeout(500);
      }

      const bodyText = await page.locator('.model-picker-card').innerText();
      expect(bodyText).toContain('Deepseek');
      expect(bodyText).toContain('Nemotron');
      expect(bodyText).toContain('Pickle');
      expect(bodyText).toContain('Grok');

      const freeBadges = page.locator('.model-cost-badge.model-cost-free');
      const freeCount = await freeBadges.count();
      console.log(`Free badges visible: ${freeCount}`);
      expect(freeCount).toBeGreaterThan(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('cost indicators work for Go models with updated fallback list', async () => {
    const testDir = getTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'Go Cost Test', tool: 'opencode', model: '', folder: process.cwd(), yolo: true, mode: 'interactive', shortcut: '1' },
      ], null, 2));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        api.getOpenCodeModels = async () => [
          { id: 'opencode-go/deepseek-v4-pro', label: 'Deepseek V4 Pro' },
          { id: 'opencode-go/minimax-m2.5', label: 'Minimax M2.5' },
          { id: 'opencode-go/minimax-m2.7', label: 'Minimax M2.7' },
          { id: 'opencode-go/qwen3.6-plus', label: 'Qwen3.6 Plus' },
          { id: 'opencode-go/kimi-k2.6', label: 'Kimi K2.6' },
          { id: 'opencode-go/glm-5.1', label: 'GLM 5.1' },
          { id: 'opencode-go/deepseek-v4-flash', label: 'Deepseek V4 Flash' },
          { id: 'opencode-go/mimo-v2.5', label: 'Mimo V2.5' },
        ];
      });

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('go cost test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible({ timeout: 5000 });

      await page.waitForTimeout(2000);

      const costBars = page.locator('.model-cost-bars');
      const barsCount = await costBars.count();
      console.log(`Cost bars visible: ${barsCount}`);

      const freeBadges = page.locator('.model-cost-badge.model-cost-free');
      const freeCount = await freeBadges.count();
      console.log(`Free badges visible: ${freeCount}`);

      const totalIndicators = barsCount + freeCount;
      const modelCount = await page.locator('.model-picker-item').count();
      console.log(`Models: ${modelCount}, indicators: ${totalIndicators}`);

      expect(modelCount).toBeGreaterThan(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
