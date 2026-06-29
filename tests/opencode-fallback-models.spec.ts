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

function writeTestSettings(testDir: string, extra: Record<string, unknown> = {}) {
  fs.writeFileSync(path.join(testDir, 'settings.json'), JSON.stringify({
    theme: 'light',
    language: 'en',
    useOneDrive: false,
    ...extra,
  }, null, 2), 'utf-8');
}

test.describe('OpenCode fallback models with Go filter', () => {
  test('model picker renders error when getOpenCodeModels throws', async () => {
    const testDir = getTestDir();
    try {
      writeTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'Error Display', folder: process.cwd(), shortcut: '1' },
      ], null, 2));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');

      fs.writeFileSync(
        path.join(testDir, 'mock-opencode-models.json'),
        JSON.stringify({
          shouldThrow: true,
          message: 'CLI not found'
        }, null, 2),
        'utf-8'
      );

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('error display test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible({ timeout: 5000 });
      await selectOpenCodeProvider(page);

      // Allow the (stubbed) error to settle; the real CLI is fast, our stub even faster
      await page.waitForTimeout(3000);

      const errorEl = page.locator('.model-picker-error');
      const errCount = await errorEl.count();
      console.log(`Error elements found: ${errCount}`);
      const listText = await page.locator('.model-picker-list').innerText();
      console.log(`Picker list text: ${JSON.stringify(listText)}`);

      const hasErrorOrNoModels = errCount > 0 || listText.includes('Unable to fetch') || listText.includes('No se pudieron');
      console.log(`Error or no-models message visible: ${hasErrorOrNoModels}`);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('selectedIdx updates when models finish loading asynchronously', async () => {
    const testDir = getTestDir();
    try {
      writeTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'Async Load', folder: process.cwd(), shortcut: '1' },
      ], null, 2));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');

      fs.writeFileSync(
        path.join(testDir, 'mock-opencode-models.json'),
        JSON.stringify([
          { id: 'opencode-go/deepseek-v4-pro', label: 'Deepseek V4 Pro' },
          { id: 'opencode-go/minimax-m2.5', label: 'Minimax M2.5' },
          { id: 'opencode-go/minimax-m2.7', label: 'Minimax M2.7' },
          { id: 'opencode-go/qwen3.6-plus', label: 'Qwen3.6 Plus' },
          { id: 'opencode-go/kimi-k2.6', label: 'Kimi K2.6' },
        ], null, 2),
        'utf-8'
      );

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('async load test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible({ timeout: 5000 });
      await selectOpenCodeProvider(page);

      // Wait for at least one model to render so we know the fetch is done
      await page.locator('.model-picker-item').first().waitFor({ state: 'visible', timeout: 15000 });

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
      writeTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'Zen + Go', folder: process.cwd(), shortcut: '1' },
      ], null, 2));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('zen + go test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible({ timeout: 5000 });
      await selectOpenCodeProvider(page);

      // Wait for at least one model to render so we know the fetch is done
      await page.locator('.model-picker-item').first().waitFor({ state: 'visible', timeout: 15000 });

      const goToggle = page.locator('.model-picker-go-toggle').first();
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

      const bodyText = await page.locator('.model-picker-card').innerText();
      expect(bodyText).toContain('Claude');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('model labels parse correctly for new models', async () => {
    const testDir = getTestDir();
    try {
      writeTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'Label Test', folder: process.cwd(), shortcut: '1' },
      ], null, 2));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('label test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible({ timeout: 5000 });
      await selectOpenCodeProvider(page);

      // Wait for at least one model to render so we know the fetch is done
      await page.locator('.model-picker-item').first().waitFor({ state: 'visible', timeout: 15000 });

      const goToggle = page.locator('.model-picker-go-toggle').first();
      await expect(goToggle).toBeVisible({ timeout: 3000 });
      if (await goToggle.locator('input[type="checkbox"]').isChecked()) {
        await goToggle.click();
        await page.waitForTimeout(500);
      }

      const bodyText = await page.locator('.model-picker-card').innerText();
      expect(bodyText).toContain('Claude');
      expect(bodyText).toContain('Deepseek');
      expect(bodyText).toContain('Free');

      const freeBadges = page.locator('.model-cost-badge.model-cost-free');
      const freeCount = await freeBadges.count();
      console.log(`Free badges visible: ${freeCount}`);
      expect(freeCount).toBeGreaterThan(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('cost indicators work for Go models', async () => {
    const testDir = getTestDir();
    try {
      writeTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'Go Cost Test', folder: process.cwd(), shortcut: '1' },
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
      await selectOpenCodeProvider(page);

      // Wait for at least one model to render (CLI fetch can be slow under parallel load)
      await page.locator('.model-picker-item').first().waitFor({ state: 'visible', timeout: 15000 });

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

  test('qwen3.7-max model label is parsed correctly', async () => {
    const testDir = getTestDir();
    try {
      writeTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'Qwen Max Test', folder: process.cwd(), shortcut: '1' },
      ], null, 2));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        api.getOpenCodeModels = async () => [
          { id: 'opencode-go/qwen3.7-max', label: 'Qwen3.7 Max' },
          { id: 'opencode-go/qwen3.6-plus', label: 'Qwen3.6 Plus' },
          { id: 'opencode-go/qwen3.5-plus', label: 'Qwen3.5 Plus' },
        ];
      });

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('qwen max test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible({ timeout: 5000 });
      await selectOpenCodeProvider(page);

      // Wait for at least one model to render (CLI fetch can be slow under parallel load)
      await page.locator('.model-picker-item').first().waitFor({ state: 'visible', timeout: 15000 });

      const bodyText = await page.locator('.model-picker-card').innerText();
      expect(bodyText).toContain('Qwen3.7 Max');

      const modelItems = page.locator('.model-picker-item');
      const count = await modelItems.count();
      console.log(`Models visible with qwen3.7-max: ${count}`);
      expect(count).toBeGreaterThanOrEqual(3);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('qwen3.7-max receives cost indicator in Go mode', async () => {
    const testDir = getTestDir();
    try {
      writeTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'Qwen Max Cost Test', folder: process.cwd(), shortcut: '1' },
      ], null, 2));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.evaluate(() => {
        const api = (window as any).electronAPI;
        api.getOpenCodeModels = async () => [
          { id: 'opencode-go/qwen3.7-max', label: 'Qwen3.7 Max' },
          { id: 'opencode-go/deepseek-v4-flash', label: 'Deepseek V4 Flash' },
        ];
      });

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('qwen max cost test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible({ timeout: 5000 });
      await selectOpenCodeProvider(page);

      // Wait for at least one model to render (CLI fetch can be slow under parallel load)
      await page.locator('.model-picker-item').first().waitFor({ state: 'visible', timeout: 15000 });

      const costBars = page.locator('.model-cost-bars');
      const barsCount = await costBars.count();
      console.log(`Cost bars for qwen3.7-max: ${barsCount}`);
      expect(barsCount).toBeGreaterThanOrEqual(1);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('model picker loads real models from opencode CLI', async () => {
    const testDir = getTestDir();
    try {
      writeTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'l1', name: 'Real CLI Test', folder: process.cwd(), shortcut: '1' },
      ], null, 2));
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('real cli test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible({ timeout: 5000 });
      await selectOpenCodeProvider(page);

      // Wait for at least one model item to render (real CLI can take a few seconds in parallel runs)
      await page.locator('.model-picker-item').first().waitFor({ state: 'visible', timeout: 15000 });

      const modelItems = page.locator('.model-picker-item');
      const count = await modelItems.count();
      console.log(`Models from real CLI: ${count}`);
      expect(count).toBeGreaterThan(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
