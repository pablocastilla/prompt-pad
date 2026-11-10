import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { removeTestDir } from './helpers';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');

function getTestDir(): string {
  const dir = path.join(os.tmpdir(), `pp-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Seed a real OpenCode 2 database so the dashboard has something to draw: the
// panel now tells the user when no database exists instead of showing an empty
// chart, so tests that assert chart content need real rows.
async function seedStatsDb(app: ElectronApplication, testDir: string) {
  await app.evaluate(({}, dbPath) => {
    const require = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json');
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, parent_id TEXT,
          cost REAL, tokens_input INTEGER, tokens_output INTEGER, model TEXT,
          time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
        CREATE TABLE IF NOT EXISTS session_v2 (id TEXT PRIMARY KEY, title TEXT, directory TEXT, parent_id TEXT,
          cost REAL, tokens_input INTEGER, tokens_output INTEGER, model TEXT,
          time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
      `);
      const now = Date.now();
      db.prepare('INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        'ses-stats', 'Stats fixture', 'C:\\work', null, 0.5, 1200, 300,
        '{"id":"deepseek-v4.1-flash","providerID":"opencode-go"}', now, now, null,
      );
    } finally { db.close(); }
  }, path.join(testDir, 'opencode.db'));
}

function cleanSession(testDir: string) {
  const sessionPath = path.join(testDir, 'session.json');
  if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { force: true });
}

function saveSettings(testDir: string) {
  const p = path.join(testDir, 'settings.json');
  fs.writeFileSync(p, JSON.stringify({
    theme: 'dark',
    language: 'auto',
    useOneDrive: false,
  }, null, 2));
}

test.describe('Statistics tab', () => {
  test('clicking statistics button opens stats tab with close button', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      cleanSession(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Click the statistics button (📊)
      await page.locator('.activity-btn', { hasText: '📊' }).click();
      await page.waitForTimeout(300);

      // Expect a tab with "📊 Statistics" title to be visible
      const statsTab = page.locator('.tab', { hasText: '📊 Statistics' });
      await expect(statsTab).toBeVisible();

      // Expect the stats panel content to be rendered
      await expect(page.locator('.stats-panel')).toBeVisible();

      // Expect the close button to be visible on the stats tab (even if it's the only tab)
      await expect(statsTab.locator('.tab-close')).toBeVisible();

      // Close the stats tab
      await statsTab.locator('.tab-close').click();
      await page.waitForTimeout(200);

      // Stats panel should no longer be visible
      await expect(page.locator('.stats-panel')).not.toBeVisible();

      // A new untitled tab should have been created
      await expect(page.locator('.tab')).toHaveCount(1);

      await app.close();
    } finally {
      removeTestDir(testDir);
    }
  });

  test('opening stats tab twice reuses the same tab', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      cleanSession(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Open stats
      await page.locator('.activity-btn', { hasText: '📊' }).click();
      await page.waitForTimeout(200);

      // Add a new tab
      await page.locator('.tab-add').click();
      await page.waitForTimeout(200);

      // Now we have 3 tabs (initial + stats + new)
      await expect(page.locator('.tab')).toHaveCount(3);

      // Click stats button again - should switch to existing stats tab without creating new one
      await page.locator('.activity-btn', { hasText: '📊' }).click();
      await page.waitForTimeout(200);

      // Should still be 3 tabs
      await expect(page.locator('.tab')).toHaveCount(3);

      await app.close();
    } finally {
      removeTestDir(testDir);
    }
  });

  test('stats panel renders side-by-side cost and token bars', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      cleanSession(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);
      await seedStatsDb(app, testDir);

      // Open stats
      await page.locator('.activity-btn', { hasText: '📊' }).click();
      await page.waitForTimeout(300);

      // Expect the token bars to be visible inside bar columns
      const tokenBars = page.locator('.stats-bar-tokens');
      await expect(tokenBars.first()).toBeVisible();

      // Expect the cost bars to be visible inside bar columns
      const costBars = page.locator('.stats-bar-cost');
      await expect(costBars.first()).toBeVisible();

      // Each bar column should have a wrapper containing both the cost and token bar groups
      const barCols = page.locator('.stats-bar-col');
      const count = await barCols.count();
      expect(count).toBeGreaterThanOrEqual(28); // at least 28 days visible

      // Each bar column should contain two .stats-bar-group elements (cost + tokens)
      const groups = page.locator('.stats-bar-group');
      const groupCount = await groups.count();
      expect(groupCount).toBeGreaterThanOrEqual(56); // at least 28 days × 2 groups

      // Verify bars have non-zero rendered height (regression check for percentage height resolution)
      const firstCostBar = costBars.first();
      const costBarBox = await firstCostBar.boundingBox();
      expect(costBarBox).not.toBeNull();
      expect(costBarBox!.height).toBeGreaterThan(0);

      const firstTokenBar = tokenBars.first();
      const tokenBarBox = await firstTokenBar.boundingBox();
      expect(tokenBarBox).not.toBeNull();
      expect(tokenBarBox!.height).toBeGreaterThan(0);

      await app.close();
    } finally {
      removeTestDir(testDir);
    }
  });

  test('stats tab is active when stats button is clicked', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      cleanSession(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Open stats
      await page.locator('.activity-btn', { hasText: '📊' }).click();
      await page.waitForTimeout(200);

      // Stats button should be active
      const statsBtn = page.locator('.activity-btn', { hasText: '📊' });
      await expect(statsBtn).toHaveClass(/active/);

      await app.close();
    } finally {
      removeTestDir(testDir);
    }
  });

  test('stats panel shows gh CLI hint', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      cleanSession(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);
      await seedStatsDb(app, testDir);

      // Open stats
      await page.locator('.activity-btn', { hasText: '📊' }).click();
      await page.waitForTimeout(300);

      // The gh CLI install hint should be present
      const hint = page.locator('.stats-cli-hint');
      await expect(hint).toBeVisible();
      await expect(hint).not.toBeEmpty();

      await app.close();
    } finally {
      removeTestDir(testDir);
    }
  });

  test('pr bars are not rendered when gh CLI is unavailable', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      cleanSession(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);
      await seedStatsDb(app, testDir);

      // Open stats
      await page.locator('.activity-btn', { hasText: '📊' }).click();
      await page.waitForTimeout(300);

      // PR bars should not be present since gh CLI is unavailable in test env
      await expect(page.locator('.stats-bar-prs')).toHaveCount(0);

      // Source text should NOT mention PRs since no PR data
      const source = page.locator('.stats-source');
      await expect(source).toBeVisible();
      await expect(source).not.toContainText('PR');

      await app.close();
    } finally {
      removeTestDir(testDir);
    }
  });
});
