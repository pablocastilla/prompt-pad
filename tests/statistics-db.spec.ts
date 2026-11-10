import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');
const HOUR = 60 * 60 * 1000;

interface Sandbox { app: ElectronApplication; page: Page; dir: string }

// OneDrive sync is disabled so stats tests never touch real cloud data, and the
// database lives inside the temporary sandbox (never the personal opencode.db).
const test = base.extend<{ sandbox: Sandbox }>({
  sandbox: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-stats-'));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ language: 'en', theme: 'dark', useOneDrive: false }));
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: dir } });
    try {
      const page = await app.firstWindow();
      await expect(page.locator('.editor-textarea')).toBeVisible();
      await use({ app, page, dir });
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
});

// Real SQLite through Electron's own better-sqlite3 build, so WAL reads and the
// production driver are exercised instead of a mocked IPC layer.
async function sql(app: ElectronApplication, dir: string, statement: string, parameters: unknown[] = []) {
  await app.evaluate(({}, { dbPath, statement, parameters }) => {
    const require = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json');
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    try {
      db.pragma('journal_mode = WAL');
      if (parameters.length) db.prepare(statement).run(...parameters);
      else db.exec(statement);
    } finally { db.close(); }
  }, { dbPath: path.join(dir, 'opencode.db'), statement, parameters });
}

const V1_TABLE = `
  CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY, title TEXT, directory TEXT, parent_id TEXT,
    cost REAL, tokens_input INTEGER, tokens_output INTEGER, model TEXT,
    time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
`;
const V2_TABLE = `
  CREATE TABLE IF NOT EXISTS session_v2 (
    id TEXT PRIMARY KEY, title TEXT, directory TEXT, parent_id TEXT,
    cost REAL, tokens_input INTEGER, tokens_output INTEGER, model TEXT,
    time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
`;

async function insertV1(app: ElectronApplication, dir: string, id: string, time: number, cost = 0, tokensIn = 0, tokensOut = 0, model = '{"id":"legacy-model","providerID":"opencode"}') {
  await sql(app, dir, 'INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, id, 'C:\\work', null, cost, tokensIn, tokensOut, model, time, time, null]);
}

async function insertV2(app: ElectronApplication, dir: string, id: string, time: number, cost = 0, tokensIn = 0, tokensOut = 0, model = '{"id":"deepseek-v4.1-flash","providerID":"opencode-go"}') {
  await sql(app, dir, 'INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, id, 'C:\\work', null, cost, tokensIn, tokensOut, model, time, time, null]);
}

function localDateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

async function openStats(page: Page) {
  await page.locator('.activity-btn', { hasText: '📊' }).click();
  await expect(page.locator('.stats-panel')).toBeVisible();
  await expect(page.locator('.stats-loading')).toHaveCount(0);
}

test('OpenCode 2 sessions stored in session_v2 drive the dashboard', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await sql(app, dir, V1_TABLE + V2_TABLE);
  const today = startOfToday() + 2 * HOUR;
  await insertV2(app, dir, 'ses-v2-today', today, 1.5, 1000, 200);
  await insertV2(app, dir, 'ses-v2-yesterday', today - 24 * HOUR, 0.5, 500, 100);

  await openStats(page);

  const stats = await page.evaluate(() => window.electronAPI.getOpenCodeStats());
  expect(stats.totalSessions).toBe(2);
  expect(stats.totalCost).toBeCloseTo(2, 5);
  expect(stats.days.map(d => d.date)).toEqual([localDateKey(new Date(today - 24 * HOUR)), localDateKey(new Date(today))]);
  const todayRow = stats.days.find(d => d.date === localDateKey(new Date(today)))!;
  expect(todayRow.sessions).toBe(1);
  expect(todayRow.tokensIn).toBe(1000);
  expect(todayRow.tokensOut).toBe(200);
  expect(todayRow.models[0].modelId).toBe('deepseek-v4.1-flash');

  // UI: summary cards and a filled bar for today.
  await expect(page.locator('.stats-card-value').first()).toHaveText('$2.00');
  await expect(page.locator('.stats-card-value').nth(1)).toHaveText('2');
  const todayColumn = page.locator('.stats-bar-col-today');
  await expect(todayColumn.locator('.stats-bar-label')).toHaveText('Today');
  await expect(todayColumn.locator('.stats-bar-cost-label')).toHaveText('$1.50');
  const height = await todayColumn.locator('.stats-bar-cost').evaluate(el => (el as HTMLElement).style.height);
  expect(parseFloat(height)).toBeGreaterThan(2);
});

test('legacy session and session_v2 are merged without double counting', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await sql(app, dir, V1_TABLE + V2_TABLE);
  const time = startOfToday() + 12 * HOUR;
  // Migrated session: present in both tables with identical totals → count once
  // and keep the live session_v2 record (and its model).
  await insertV1(app, dir, 'ses-shared', time - 5 * HOUR, 1, 100, 10);
  await insertV2(app, dir, 'ses-shared', time - 5 * HOUR, 1, 100, 10);
  // A legacy-only session and a new OpenCode 2 session.
  await insertV1(app, dir, 'ses-legacy', time - 2 * HOUR, 0.5, 50, 5, '{"id":"legacy-model","providerID":"opencode"}');
  await insertV2(app, dir, 'ses-new', time, 2, 200, 20);

  await openStats(page);

  const stats = await page.evaluate(() => window.electronAPI.getOpenCodeStats());
  expect(stats.totalSessions).toBe(3);
  expect(stats.totalCost).toBeCloseTo(3.5, 5);
  await expect(page.locator('.stats-card-value').first()).toHaveText('$3.50');
  await expect(page.locator('.stats-card-value').nth(1)).toHaveText('3');
  // Two models on the same day, sorted by cost: the v2 model first.
  const day = stats.days[0];
  expect(day.models.map(m => m.modelId)).toEqual(['deepseek-v4.1-flash', 'legacy-model']);
});

test('v1-only databases keep working when session_v2 does not exist', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await sql(app, dir, V1_TABLE);
  await insertV1(app, dir, 'ses-v1', startOfToday() + HOUR, 0.25, 321, 45);

  await openStats(page);

  const stats = await page.evaluate(() => window.electronAPI.getOpenCodeStats());
  expect(stats.totalSessions).toBe(1);
  expect(stats.totalCost).toBeCloseTo(0.25, 5);
  expect(stats.days[0].tokensIn).toBe(321);
  await expect(page.locator('.stats-card-value').first()).toHaveText('$0.25');
});

test('older session schemas without cost, tokens or model columns are tolerated', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await sql(app, dir, `
    CREATE TABLE session_v2 (id TEXT PRIMARY KEY, title TEXT, time_created INTEGER, time_updated INTEGER);
  `);
  await sql(app, dir, 'INSERT INTO session_v2 VALUES (?, ?, ?, ?)',
    ['ses-minimal', 'No cost columns', startOfToday() + HOUR, Date.now()]);

  await openStats(page);

  const stats = await page.evaluate(() => window.electronAPI.getOpenCodeStats());
  expect(stats.totalSessions).toBe(1);
  expect(stats.totalCost).toBe(0);
  expect(stats.days[0].models[0].modelId).toBe('unknown');
  await expect(page.locator('.stats-error')).toHaveCount(0);
  await expect(page.locator('.stats-card-value').first()).toHaveText('$0.00');
});

test('database without statistics tables renders empty stats instead of an error', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await sql(app, dir, 'CREATE TABLE unrelated (id TEXT PRIMARY KEY);');

  await openStats(page);

  const stats = await page.evaluate(() => window.electronAPI.getOpenCodeStats());
  expect(stats.totalSessions).toBe(0);
  expect(stats.totalCost).toBe(0);
  expect(stats.dbPath).toBe(path.join(dir, 'opencode.db'));
  await expect(page.locator('.stats-error')).toHaveCount(0);
  await expect(page.locator('.stats-card-value').first()).toHaveText('$0.00');
});

test('missing OpenCode database shows the install hint', async ({ sandbox }) => {
  const { page } = sandbox;
  await openStats(page);

  await expect(page.locator('.stats-error')).toBeVisible();
  await expect(page.locator('.stats-error-hint')).toHaveText('OpenCode database not found. Make sure OpenCode is installed.');
});

test('sessions just after local midnight land in today, not in UTC tomorrow/yesterday', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await sql(app, dir, V1_TABLE + V2_TABLE);
  const todayStart = startOfToday();
  // 00:30 local: in UTC-negative zones this instant still belongs to the previous UTC day.
  await insertV2(app, dir, 'ses-midnight', todayStart + 30 * 60 * 1000, 0.5, 10, 1);
  await insertV2(app, dir, 'ses-yesterday', todayStart - 12 * HOUR, 1, 10, 1);

  await openStats(page);

  const stats = await page.evaluate(() => window.electronAPI.getOpenCodeStats());
  const todayKey = localDateKey(new Date());
  expect(stats.days.find(d => d.date === todayKey)?.cost).toBeCloseTo(0.5, 5);
  expect(stats.days.find(d => d.date === todayKey)?.sessions).toBe(1);
  const todayColumn = page.locator('.stats-bar-col-today');
  await expect(todayColumn).toHaveCount(1);
  await expect(todayColumn.locator('.stats-bar-cost-label')).toHaveText('$0.50');
});
