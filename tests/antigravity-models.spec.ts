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

function writeTestSettings(testDir: string, extra: Record<string, unknown> = {}) {
  fs.writeFileSync(path.join(testDir, 'settings.json'), JSON.stringify({
    theme: 'light',
    language: 'en',
    useOneDrive: false,
    ...extra,
  }, null, 2), 'utf-8');
}

test.describe('Antigravity Models Feature', () => {
  test('getAntigravityModels IPC returns models without tab characters in id or label', async () => {
    const testDir = getTestDir();
    try {
      const app = await launchWithTestDir(testDir);
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      const models = await page.evaluate(async () => {
        return (window as unknown as {
          electronAPI: { getAntigravityModels: () => Promise<{ id: string; label: string }[]> }
        }).electronAPI.getAntigravityModels();
      });

      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      for (const m of models) {
        expect(m).toHaveProperty('id');
        expect(m).toHaveProperty('label');
        expect(typeof m.id).toBe('string');
        expect(typeof m.label).toBe('string');
        expect(m.id.length).toBeGreaterThan(0);
        expect(m.label.length).toBeGreaterThan(0);
        expect(m.id).not.toContain('\t');
        expect(m.label).not.toContain('\t');
        expect(m.id.toLowerCase()).not.toContain('fetching');
        expect(m.label.toLowerCase()).not.toContain('fetching');
      }

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('mock-antigravity-models.json is respected in test mode', async () => {
    const testDir = getTestDir();
    try {
      const customModels = [
        { id: 'gemini-test-custom', label: 'Gemini Test Custom' },
        { id: 'claude-test-custom', label: 'Claude Test Custom' },
      ];
      fs.writeFileSync(
        path.join(testDir, 'mock-antigravity-models.json'),
        JSON.stringify(customModels, null, 2),
        'utf-8'
      );

      const app = await launchWithTestDir(testDir);
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      const models = await page.evaluate(async () => {
        return (window as unknown as {
          electronAPI: { getAntigravityModels: () => Promise<{ id: string; label: string }[]> }
        }).electronAPI.getAntigravityModels();
      });

      expect(models).toEqual(customModels);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('ModelPicker opens for Antigravity via numeric key 5 and displays models', async () => {
    const testDir = getTestDir();
    try {
      writeTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'ag-launch', name: 'AG Launch', folder: process.cwd(), shortcut: '1' },
      ], null, 2), 'utf-8');
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]', 'utf-8');

      const app = await launchWithTestDir(testDir);
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('test prompt for agy');

      // Open provider picker
      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      // Select Antigravity (key 5)
      await page.keyboard.press('5');
      await expect(page.locator('.provider-picker-list')).not.toBeVisible({ timeout: 5000 });
      await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 10000 });

      // Ensure model items are rendered
      await expect(page.locator('.model-picker-item').first()).toBeVisible({ timeout: 10000 });
      const itemCount = await page.locator('.model-picker-item').count();
      expect(itemCount).toBeGreaterThan(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('ModelPicker search box filters Antigravity models', async () => {
    const testDir = getTestDir();
    try {
      writeTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'ag-search-launch', name: 'AG Search Launch', folder: process.cwd(), shortcut: '1' },
      ], null, 2), 'utf-8');
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]', 'utf-8');

      const app = await launchWithTestDir(testDir);
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('test prompt');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('5');
      await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.model-picker-item').first()).toBeVisible({ timeout: 10000 });

      const initialCount = await page.locator('.model-picker-item').count();
      expect(initialCount).toBeGreaterThan(1);

      // Search for Claude
      const searchInput = page.locator('[data-testid="model-search-input"]');
      await searchInput.fill('Claude');
      await page.waitForTimeout(300);

      const filteredCount = await page.locator('.model-picker-item').count();
      expect(filteredCount).toBeGreaterThan(0);
      expect(filteredCount).toBeLessThan(initialCount);

      // Verify filtered models contain Claude
      const firstText = await page.locator('.model-picker-item .model-picker-item-label').first().innerText();
      expect(firstText.toLowerCase()).toContain('claude');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Antigravity models always refresh when provider is opened', async () => {
    const testDir = getTestDir();
    try {
      writeTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'ag-refresh-launch', name: 'AG Always Refresh', folder: process.cwd(), shortcut: '1' },
      ], null, 2), 'utf-8');
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]', 'utf-8');

      // Start with initial mock models
      const initialModels = [{ id: 'gemini-v1', label: 'Gemini V1 Initial' }];
      fs.writeFileSync(
        path.join(testDir, 'mock-antigravity-models.json'),
        JSON.stringify(initialModels, null, 2),
        'utf-8'
      );

      const app = await launchWithTestDir(testDir);
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('test prompt');

      // Open provider picker and choose Antigravity
      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('5');
      await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 10000 });

      // First check: initial model is shown
      await expect(page.locator('.model-picker-item-label', { hasText: 'Gemini V1 Initial' })).toBeVisible({ timeout: 5000 });

      // Close the model picker with Escape
      await page.keyboard.press('Escape'); // Back to provider picker
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Escape'); // Close overlay completely
      await expect(page.locator('.model-picker-overlay')).not.toBeVisible({ timeout: 5000 });

      // Update the mock file with new models (simulating CLI returning new models)
      const updatedModels = [
        { id: 'gemini-v2-refreshed', label: 'Gemini V2 Refreshed' },
      ];
      fs.writeFileSync(
        path.join(testDir, 'mock-antigravity-models.json'),
        JSON.stringify(updatedModels, null, 2),
        'utf-8'
      );

      // Re-open launch dialog and choose Antigravity again
      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('5');
      await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 10000 });

      // It must ALWAYS refresh and show the updated models!
      await expect(page.locator('.model-picker-item-label', { hasText: 'Gemini V2 Refreshed' })).toBeVisible({ timeout: 5000 });

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('refresh button reloads models in Antigravity model picker', async () => {
    const testDir = getTestDir();
    try {
      writeTestSettings(testDir);
      fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify([
        { id: 'ag-btn-refresh', name: 'AG Button Refresh', folder: process.cwd(), shortcut: '1' },
      ], null, 2), 'utf-8');
      fs.writeFileSync(path.join(testDir, 'phrases.json'), '[]', 'utf-8');

      const initial = [{ id: 'gemini-initial', label: 'Gemini Initial 1' }];
      fs.writeFileSync(path.join(testDir, 'mock-antigravity-models.json'), JSON.stringify(initial), 'utf-8');

      const app = await launchWithTestDir(testDir);
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('.activity-btn').first().click();
      await page.locator('.launch-list-item').first().click();
      await page.locator('.editor-textarea').fill('test');

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('5');
      await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.model-picker-item-label', { hasText: 'Gemini Initial 1' })).toBeVisible({ timeout: 5000 });

      // Update mock file with new data
      const updated = [{ id: 'gemini-clicked-refresh', label: 'Gemini Clicked Refresh' }];
      fs.writeFileSync(path.join(testDir, 'mock-antigravity-models.json'), JSON.stringify(updated), 'utf-8');

      // Click the refresh button
      const refreshBtn = page.locator('.model-picker-refresh-btn');
      await expect(refreshBtn).toBeVisible({ timeout: 5000 });
      await refreshBtn.click();

      // Expect new model to appear
      await expect(page.locator('.model-picker-item-label', { hasText: 'Gemini Clicked Refresh' })).toBeVisible({ timeout: 10000 });

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('OneDrive sync remains completely untouched during Antigravity model operations', async () => {
    const testDir = getTestDir();
    try {
      writeTestSettings(testDir, { useOneDrive: false });
      const app = await launchWithTestDir(testDir);
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.evaluate(async () => {
        return (window as unknown as {
          electronAPI: { getAntigravityModels: () => Promise<{ id: string; label: string }[]> }
        }).electronAPI.getAntigravityModels();
      });

      const settingsRaw = fs.readFileSync(path.join(testDir, 'settings.json'), 'utf-8');
      const settings = JSON.parse(settingsRaw);
      expect(settings.useOneDrive).toBe(false);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
