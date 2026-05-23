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

function cleanSettings(testDir: string) {
  const p = path.join(testDir, 'settings.json');
  if (fs.existsSync(p)) fs.rmSync(p, { force: true });
}

function saveLaunches(testDir: string, launches: unknown[]) {
  fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify(launches, null, 2));
}

function saveHistory(testDir: string, entries: unknown[]) {
  fs.writeFileSync(path.join(testDir, 'launch-history.json'), JSON.stringify(entries, null, 2));
}

function savePhrases(testDir: string, phrases: unknown[]) {
  fs.writeFileSync(path.join(testDir, 'phrases.json'), JSON.stringify(phrases, null, 2));
}

const SAMPLE_LAUNCHES = [
  { id: 'launch-1', name: 'My Project', tool: 'opencode', model: 'opencode/kimi-k2.6', folder: '/tmp/proj1', yolo: true, mode: 'interactive' },
  { id: 'launch-2', name: 'API Refactor', tool: 'opencode', model: 'opencode/kimi-k2.6', folder: '/tmp/proj2', yolo: false, mode: 'interactive' },
];

const SAMPLE_HISTORY = [
  { id: 'h1', launchId: 'launch-1', launchName: 'My Project', tool: 'opencode', model: 'opencode/googlegemini-2.5-flash', prompt: 'Refactor the auth module to use JWT tokens', timestamp: Date.now() - 60000, folder: '/tmp/proj1', yolo: true, mode: 'interactive' },
  { id: 'h2', launchId: 'launch-1', launchName: 'My Project', tool: 'opencode', model: 'opencode/kimi-k2.6', prompt: 'Add rate limiting to the API endpoints', timestamp: Date.now() - 120000, folder: '/tmp/proj1', yolo: true, mode: 'interactive' },
  { id: 'h3', launchId: 'launch-2', launchName: 'API Refactor', tool: 'opencode', model: 'opencode/kimi-k2.6', prompt: 'Rewrite the database layer with connection pooling', timestamp: Date.now() - 300000, folder: '/tmp/proj2', yolo: false, mode: 'interactive' },
];

test.describe('Launch History panel', () => {
  test('History button exists in activity bar', async () => {
    const testDir = getTestDir();
    try {
      cleanSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, SAMPLE_LAUNCHES);
      saveHistory(testDir, SAMPLE_HISTORY);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // History button is the 3rd activity button (index 2)
      const historyBtn = page.locator('.activity-btn').nth(2);
      await expect(historyBtn).toBeVisible();
      await expect(historyBtn).toHaveAttribute('title', /Launch History|Historial/i);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('History panel opens and shows grouped entries', async () => {
    const testDir = getTestDir();
    try {
      cleanSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, SAMPLE_LAUNCHES);
      saveHistory(testDir, SAMPLE_HISTORY);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Open history panel
      await page.locator('.activity-btn').nth(2).click();
      await expect(page.locator('.history-panel')).toBeVisible();

      // Should show 2 group headers (one per launch)
      const groupHeaders = page.locator('.history-group-header');
      await expect(groupHeaders).toHaveCount(2);

      // Groups should be collapsed by default (no entries visible)
      const entries = page.locator('.history-entry');
      await expect(entries).toHaveCount(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Clicking group header expands entries', async () => {
    const testDir = getTestDir();
    try {
      cleanSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, SAMPLE_LAUNCHES);
      saveHistory(testDir, SAMPLE_HISTORY);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Open history panel
      await page.locator('.activity-btn').nth(2).click();
      await expect(page.locator('.history-panel')).toBeVisible();

      // Click first group header to expand
      await page.locator('.history-group-header').first().click();
      await page.waitForTimeout(100);

      // Should now show entries for that group (2 entries for launch-1)
      const entries = page.locator('.history-entry');
      await expect(entries).toHaveCount(2);

      // Click again to collapse
      await page.locator('.history-group-header').first().click();
      await page.waitForTimeout(100);
      await expect(entries).toHaveCount(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Searching expands matching groups', async () => {
    const testDir = getTestDir();
    try {
      cleanSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, SAMPLE_LAUNCHES);
      saveHistory(testDir, SAMPLE_HISTORY);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Open history panel
      await page.locator('.activity-btn').nth(2).click();
      await expect(page.locator('.history-panel')).toBeVisible();

      // Initially no entries visible (all collapsed)
      await expect(page.locator('.history-entry')).toHaveCount(0);

      // Search for "auth" - should match one entry in launch-1 group
      const searchInput = page.locator('.history-search-input');
      await searchInput.fill('auth');
      await page.waitForTimeout(200);

      // Should now show matching entries (at least 1)
      const entries = page.locator('.history-entry');
      await expect(entries).toHaveCount(1);

      // Clear search - should collapse again
      await searchInput.fill('');
      await page.waitForTimeout(200);
      await expect(entries).toHaveCount(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Searching by tool name expands matching groups', async () => {
    const testDir = getTestDir();
    try {
      cleanSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, SAMPLE_LAUNCHES);
      saveHistory(testDir, SAMPLE_HISTORY);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Open history panel
      await page.locator('.activity-btn').nth(2).click();
      await expect(page.locator('.history-panel')).toBeVisible();

      // Search for a unique model token from one entry
      const searchInput = page.locator('.history-search-input');
      await searchInput.fill('googlegemini');
      await page.waitForTimeout(200);

      // Should show 1 entry from launch-2
      const entries = page.locator('.history-entry');
      await expect(entries).toHaveCount(1);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Double-click on history entry opens new tab with content', async () => {
    const testDir = getTestDir();
    try {
      cleanSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, SAMPLE_LAUNCHES);
      saveHistory(testDir, SAMPLE_HISTORY);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Open history panel
      await page.locator('.activity-btn').nth(2).click();
      await expect(page.locator('.history-panel')).toBeVisible();

      // Expand first group
      await page.locator('.history-group-header').first().click();
      await page.waitForTimeout(100);

      // Double-click first entry
      const firstEntry = page.locator('.history-entry').first();
      await firstEntry.dblclick();
      await page.waitForTimeout(200);

      // Should have 2 tabs now
      const tabs = page.locator('.tab');
      await expect(tabs).toHaveCount(2);

      // The new tab should contain the prompt text
      const editor = page.locator('.editor-textarea');
      const content = await editor.inputValue();
      expect(content).toContain('Refactor the auth module');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Deleting a launcher removes its history entries', async () => {
    const testDir = getTestDir();
    try {
      cleanSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, SAMPLE_LAUNCHES);
      saveHistory(testDir, SAMPLE_HISTORY);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Verify history file exists with 3 entries
      const historyPath = path.join(testDir, 'launch-history.json');
      const beforeData = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      expect(beforeData).toHaveLength(3);

      // Open launches panel
      await page.locator('.activity-btn').first().click();
      await page.waitForTimeout(100);

      // Delete first launch (My Project)
      // Hover over the first launch item to reveal delete button
      const firstLaunchItem = page.locator('.launch-list-item').first();
      await firstLaunchItem.hover();
      await page.waitForTimeout(100);

      const deleteBtn = firstLaunchItem.locator('.launch-list-item-actions .btn-icon').last();
      await deleteBtn.click();
      await page.waitForTimeout(200);

      // Verify history file was updated
      const afterData = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      expect(afterData).toHaveLength(1);
      expect(afterData[0].launchId).toBe('launch-2');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Empty history shows appropriate message', async () => {
    const testDir = getTestDir();
    try {
      cleanSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, SAMPLE_LAUNCHES);
      saveHistory(testDir, []);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Open history panel
      await page.locator('.activity-btn').nth(2).click();
      await expect(page.locator('.history-panel')).toBeVisible();

      // Should show empty state message
      const emptyMsg = page.locator('.history-empty');
      await expect(emptyMsg).toBeVisible();
      await expect(emptyMsg).toContainText(/No launches yet|Aún no hay/i);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
