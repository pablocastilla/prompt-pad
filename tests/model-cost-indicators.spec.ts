import { test, expect, _electron as electron, Page } from '@playwright/test';
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

function saveLaunches(testDir: string, launches: unknown[]) {
  fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify(launches, null, 2));
}

function savePhrases(testDir: string, phrases: unknown[]) {
  fs.writeFileSync(path.join(testDir, 'phrases.json'), JSON.stringify(phrases, null, 2));
}

function saveTestSettings(testDir: string) {
  fs.writeFileSync(path.join(testDir, 'settings.json'), JSON.stringify({
    theme: 'light',
    language: 'en',
    useOneDrive: false,
    showGoModelsOnly: { opencode: false },
  }, null, 2));
}

/**
 * Reads every cost indicator on the page and returns a sorted set of tiers
 * that are present. The free tier is reported as `'free'`.
 */
async function readTiersFromPicker(page: Page): Promise<Set<string | number>> {
  const tiers = new Set<string | number>();
  const freeCount = await page.locator('.model-cost-badge.model-cost-free').count();
  if (freeCount > 0) tiers.add('free');

  const bars = page.locator('.model-cost-bars');
  const barCount = await bars.count();
  for (let i = 0; i < barCount; i++) {
    const text = (await bars.nth(i).textContent()) ?? '';
    const filled = (text.match(/▮/g) || []).length;
    if (filled > 0) tiers.add(filled);
  }
  return tiers;
}

test.describe('Model Cost Indicators', () => {
  test('shows free badge for free models in model picker', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test', folder: '/tmp/a' },
      ]);
      savePhrases(testDir, []);

      fs.writeFileSync(
        path.join(testDir, 'mock-opencode-models.json'),
        JSON.stringify([
          { id: 'opencode/minimax-m2.5-free', label: 'MiniMax M2.5 Free' },
          { id: 'opencode/gpt-5-nano', label: 'GPT 5 Nano' },
          { id: 'opencode/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
          { id: 'opencode/claude-opus-4.7', label: 'Claude Opus 4.7' },
        ], null, 2),
        'utf-8'
      );

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('test');
      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();
      await selectOpenCodeProvider(page);

      // Toggle "Show Go models only" off to see all models
      const goToggle = page.locator('.model-picker-go-toggle').first();
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

  test('cost indicators show on all model items with real CLI data', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test', folder: '/tmp/a' },
      ]);
      savePhrases(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('test');
      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();
      await selectOpenCodeProvider(page);

      await page.waitForTimeout(3000);

      const goToggle = page.locator('.model-picker-go-toggle').first();
      await expect(goToggle).toBeVisible({ timeout: 3000 });
      const isChecked = await goToggle.locator('input[type="checkbox"]').isChecked();
      if (isChecked) {
        await goToggle.click();
        await page.waitForTimeout(500);
      }

      const items = page.locator('.model-picker-item');
      const itemCount = await items.count();
      console.log(`Model items (Go filter off): ${itemCount}`);
      expect(itemCount).toBeGreaterThan(0);

      const indicatorCount = await page.locator('.model-cost-badge, .model-cost-bars').count();
      console.log(`Cost indicators: ${indicatorCount}`);
      expect(indicatorCount).toBeGreaterThan(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('cost indicator tooltips show pricing info on hover', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test', folder: '/tmp/a' },
      ]);
      savePhrases(testDir, []);

      fs.writeFileSync(
        path.join(testDir, 'mock-opencode-models.json'),
        JSON.stringify([
          { id: 'opencode/minimax-m2.5-free', label: 'MiniMax M2.5 Free' },
          { id: 'opencode/gpt-5-nano', label: 'GPT 5 Nano' },
        ], null, 2),
        'utf-8'
      );

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('test');
      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();
      await selectOpenCodeProvider(page);

      const goToggle = page.locator('.model-picker-go-toggle').first();
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

  // ─── Price-based distribution: every tier (1-5) must be populated ─────
  // The Go/Zen catalog has prices that span from $0.28/M to $180.00/M output
  // tokens. The cost indicator assigns each model to one of 5 tiers based on
  // its per-token price. If all 5 bars never appear, the distribution is
  // wrong. This test exercises the catalog end-to-end.
  test('all five cost tiers are populated by Go and Zen catalog', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      saveLaunches(testDir, [{ id: 'l1', name: 'Tiers', folder: '/tmp/a' }]);
      savePhrases(testDir, []);

      fs.writeFileSync(
        path.join(testDir, 'mock-opencode-models.json'),
        JSON.stringify([
          // Free
          { id: 'opencode/big-pickle', label: 'Big Pickle' },
          { id: 'opencode/deepseek-v4-flash-free', label: 'DeepSeek V4 Flash Free' },
          // Tier 1
          { id: 'opencode-go/deepseek-v4-flash', label: 'Deepseek V4 Flash' },
          { id: 'opencode-go/mimo-v2.5', label: 'MiMo V2.5' },
          { id: 'opencode-go/minimax-m2.5', label: 'Minimax M2.5' },
          { id: 'opencode/minimax-m2.5', label: 'Minimax M2.5 Zen' },
          { id: 'opencode/gpt-5-nano', label: 'GPT 5 Nano' },
          // Tier 2
          { id: 'opencode-go/qwen3.7-plus', label: 'Qwen3.7 Plus' },
          { id: 'opencode-go/minimax-m3', label: 'Minimax M3' },
          { id: 'opencode/kimi-k2.5', label: 'Kimi K2.5' },
          { id: 'opencode/grok-build-0.1', label: 'Grok Build 0.1' },
          // Tier 3
          { id: 'opencode-go/kimi-k2.6', label: 'Kimi K2.6' },
          { id: 'opencode-go/glm-5.1', label: 'GLM 5.1' },
          { id: 'opencode/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
          { id: 'opencode/gpt-5.1', label: 'GPT 5.1' },
          // Tier 4
          { id: 'opencode/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
          { id: 'opencode/gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
          { id: 'opencode/gpt-5.4', label: 'GPT 5.4' },
          // Tier 5
          { id: 'opencode/claude-opus-4.7', label: 'Claude Opus 4.7' },
          { id: 'opencode/claude-opus-4.8', label: 'Claude Opus 4.8' },
          { id: 'opencode/gpt-5.5', label: 'GPT 5.5' },
          { id: 'opencode/gpt-5.5-pro', label: 'GPT 5.5 Pro' },
        ], null, 2),
        'utf-8'
      );

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('tier distribution test');
      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();
      await selectOpenCodeProvider(page);

      // Wait for the model list to render.
      await page.locator('.model-picker-item').first().waitFor({ state: 'visible', timeout: 15000 });

      // Turn off the Go filter so Zen models show too.
      const goToggle = page.locator('.model-picker-go-toggle').first();
      await expect(goToggle).toBeVisible({ timeout: 3000 });
      if (await goToggle.locator('input[type="checkbox"]').isChecked()) {
        await goToggle.click();
        await page.waitForTimeout(500);
      }

      const tiers = await readTiersFromPicker(page);
      console.log(`Tiers present: ${[...tiers].sort().join(', ')}`);

      expect(tiers.has('free')).toBe(true);
      expect(tiers.has(1)).toBe(true);
      expect(tiers.has(2)).toBe(true);
      expect(tiers.has(3)).toBe(true);
      expect(tiers.has(4)).toBe(true);
      expect(tiers.has(5)).toBe(true);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // Specific known tiers for representative models. We use the real CLI
  // output (the renderer-side mock is not reliable here because the main
  // process caches the IPC result on first call) and only assert on models
  // whose visible label is unique in the picker, so we never accidentally
  // hit the Go and Zen rows of the same bare name.
  test('specific Go/Zen models get their expected price-based tier', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      saveLaunches(testDir, [{ id: 'l1', name: 'Specific', folder: '/tmp/a' }]);
      savePhrases(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Each row uses the unique visible label of a model whose price is
      // catalogued. Duplicated labels (e.g. "Deepseek V4 Flash" appears for
      // both `opencode/deepseek-v4-flash` and `opencode-go/deepseek-v4-flash`)
      // are intentionally avoided.
      const cases: Array<[string, number | 'free']> = [
        ['Big Pickle',         'free'],
        ['Gpt 5 Nano',         1],
        ['Gpt 5.1',            3],
        ['Gpt 5.4',            4],
        ['Gpt 5.5',            5],
        ['Gpt 5.5 Pro',        5],
        ['Claude Opus 4 7',    5],
        ['Claude Sonnet 4 6',  4],
        ['Gemini 3.1 Pro',     4],
        ['Deepseek V4 Flash Free', 'free'],
      ];

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('specific tier test');
      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();
      await selectOpenCodeProvider(page);

      await page.locator('.model-picker-item').first().waitFor({ state: 'visible', timeout: 15000 });

      // Turn off the Go filter so Zen models show too.
      const goToggle = page.locator('.model-picker-go-toggle').first();
      await expect(goToggle).toBeVisible({ timeout: 3000 });
      if (await goToggle.locator('input[type="checkbox"]').isChecked()) {
        await goToggle.click();
        await page.waitForTimeout(500);
      }

      await page.waitForFunction(() => {
        return document.querySelectorAll('.model-picker-item').length >= 16;
      }, { timeout: 10000 });

      const visibleLabels = await page.locator('.model-picker-item-label').allTextContents();
      console.log(`Specific test: ${visibleLabels.length} items visible`);

      for (const [label, expected] of cases) {
        // Match the row by its label span text only — the row also contains
        // the cost indicator, so anchoring on the full row text won't work.
        const item = page.locator('.model-picker-item', {
          has: page.locator('.model-picker-item-label', { hasText: new RegExp('^' + escapeRegex(label) + '$', 'i') }),
        }).first();
        const exists = await item.count();
        if (exists === 0) {
          // Skip models that the real CLI doesn't ship in this environment.
          console.log(`Skipping "${label}" — not present in real CLI output`);
          continue;
        }
        await expect(item, `model row for "${label}"`).toBeVisible({ timeout: 3000 });

        if (expected === 'free') {
          const freeBadge = item.locator('.model-cost-badge.model-cost-free');
          await expect(freeBadge, `free badge for "${label}"`).toBeVisible();
        } else {
          const bars = item.locator('.model-cost-bars');
          const text = ((await bars.textContent()) ?? '').trim();
          const filled = (text.match(/▮/g) || []).length;
          expect(filled, `expected ${expected} bars for "${label}", got ${filled} (text=${JSON.stringify(text)})`).toBe(expected);
        }
      }

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // Tier 4 and 5 models must always trigger the expensive-model
  // confirmation dialog when launched. We pick "Gpt 5.5 Pro" (tier 5) from
  // the real CLI list because it is the most expensive model in the Zen
  // catalog and ships with a unique visible label.
  test('tier 4-5 models trigger the expensive-model confirmation dialog', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      saveLaunches(testDir, [{ id: 'l1', name: 'Confirm', folder: '/tmp/a', shortcut: '1' }]);
      savePhrases(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('expensive confirm test');
      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.model-picker-overlay')).toBeVisible();
      await selectOpenCodeProvider(page);

      await page.locator('.model-picker-item').first().waitFor({ state: 'visible', timeout: 15000 });
      const goToggle = page.locator('.model-picker-go-toggle').first();
      await expect(goToggle).toBeVisible({ timeout: 3000 });
      if (await goToggle.locator('input[type="checkbox"]').isChecked()) {
        await goToggle.click();
        await page.waitForTimeout(500);
      }

      await page.waitForFunction(() => {
        return document.querySelectorAll('.model-picker-item').length >= 1;
      }, { timeout: 5000 });

      // The most expensive Zen model — 5 filled bars, definitely tier 5.
      const item = page.locator('.model-picker-item', {
        has: page.locator('.model-picker-item-label', { hasText: /^Gpt 5\.5 Pro$/i }),
      }).first();
      const exists = await item.count();
      if (exists === 0) {
        // Fall back to any other known tier-5 model from the catalog.
        const fallback = page.locator('.model-picker-item', {
          has: page.locator('.model-picker-item-label', { hasText: /^Claude Opus 4 7$/i }),
        }).first();
        await expect(fallback, 'fallback tier-5 model').toBeVisible();
        await fallback.click();
      } else {
        await expect(item).toBeVisible();
        await item.click();
      }
      await expect(page.locator('.model-picker-confirm-overlay')).toBeVisible({ timeout: 3000 });
      await expect(page.locator('.model-picker-confirm-launch')).toBeVisible();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('Ctrl+Shift+0 Shortcut', () => {
  test('launch shortcut 0 opens provider picker with Digit0 key', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Zero Launch', folder: '/tmp/a', shortcut: '0' },
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
      await expect(page.locator('.provider-picker-list')).toBeVisible();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('migration assigns shortcut 0 to 10th launch when unspecified', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      const launches = Array.from({ length: 10 }, (_, i) => ({
        id: `l${i}`,
        name: `Launch ${i + 1}`,
        folder: '/tmp',
      }));
      saveLaunches(testDir, launches);
      savePhrases(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      let saved: any[] = [];
      for (let i = 0; i < 30; i++) {
        saved = JSON.parse(fs.readFileSync(path.join(testDir, 'launches.json'), 'utf-8'));
        if (saved[9] && saved[9].shortcut !== undefined) {
          break;
        }
        await page.waitForTimeout(200);
      }
      expect(saved[9].shortcut).toBe('0');

      await page.locator('.editor-textarea').fill('test prompt for shortcut 0');

      await page.keyboard.press('Control+Shift+0');
      await page.waitForTimeout(500);
      await expect(page.locator('.model-picker-overlay')).toBeVisible();
      await expect(page.locator('.provider-picker-list')).toBeVisible();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Ctrl+Shift+0 does nothing when no launch has shortcut 0', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Launch 1', folder: '/tmp/a', shortcut: '1' },
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
