import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { createHash } from 'crypto';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');
const MONITOR_JS = path.join(__dirname, '..', 'dist-electron', 'opencodeSessions.js');
const MINUTE = 60_000;

const test = base.extend<{ sandbox: { app: ElectronApplication; page: Page; dir: string } }>({
  sandbox: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-sessions-'));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ language: 'en', theme: 'dark', useOneDrive: true }));
    fs.writeFileSync(path.join(dir, 'phrases.json'), JSON.stringify([{ id: 'phrase', name: 'Phrase', content: 'Do not insert into dashboard', shortcut: '1' }]));
    fs.writeFileSync(path.join(dir, 'launches.json'), JSON.stringify([{ id: 'launch', name: 'Test launcher', folder: dir, shortcut: '1' }]));
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: dir } });
    try {
      const page = await app.firstWindow();
      await expect(page.locator('.editor-textarea')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await use({ app, page, dir });
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
});

// Use Electron's native SQLite module, exercising the same ABI and real WAL reads as production.
async function sql(app: ElectronApplication, dir: string, statement: string, parameters: unknown[] = []) {
  await app.evaluate(({}, { dbPath, statement, parameters }) => {
    const require = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json');
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    try {
      if (parameters.length) db.prepare(statement).run(...parameters);
      else db.exec(statement);
    } finally { db.close(); }
  }, { dbPath: path.join(dir, 'opencode.db'), statement, parameters });
}

async function schema(app: ElectronApplication, dir: string) {
  await sql(app, dir, `
    PRAGMA journal_mode = WAL;
    CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, parent_id TEXT,
      time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE INDEX message_session_time_created_id_idx ON message(session_id, time_created, id);
    CREATE INDEX part_message_id_id_idx ON part(message_id, id);
  `);
}

async function seed(app: ElectronApplication, dir: string, id: string, options: {
  title?: string; age?: number; finish?: string; completed?: boolean; error?: boolean;
  role?: string; parent?: string; archived?: boolean;
} = {}) {
  const time = Date.now() - (options.age || 0);
  await sql(app, dir, 'INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, options.title || `Project ${id}`, `C:\\projects\\${id}`, options.parent || null, time - 1000, time, options.archived ? time : null]);
  await sql(app, dir, 'INSERT INTO message VALUES (?, ?, ?, ?, ?)', [id + '-user', id, time - 1000, time - 1000,
    JSON.stringify({ role: 'user', time: { created: time - 1000 }, model: { providerID: 'opencode', modelID: 'test-model' } })]);
  await sql(app, dir, 'INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)', [id + '-prompt', id + '-user', id, time - 1000, time - 1000,
    JSON.stringify({ type: 'text', text: 'Please check ' + id })]);
  if (options.role === 'user') return;
  await sql(app, dir, 'INSERT INTO message VALUES (?, ?, ?, ?, ?)', [id + '-assistant', id, time, time, JSON.stringify({
    role: 'assistant', time: { created: time, ...(options.completed ? { completed: time } : {}) },
    modelID: 'test-model', providerID: 'opencode', finish: options.finish,
    ...(options.error ? { error: { name: 'MessageAbortedError', data: { message: 'Cancelled by user' } } } : {}),
  })]);
  await sql(app, dir, 'INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)', [id + '-text', id + '-assistant', id, time, time,
    JSON.stringify({ type: 'text', text: 'Working on ' + id })]);
}

async function open(page: Page) {
  await page.locator('[data-tour-id="sessions"]').click();
  await expect(page.locator('.sessions-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
}

const column = (page: Page, id: string) => page.locator(`[data-session-id="${id}"]`);

test('real SQLite sessions appear as independent columns with tools and accurate turn states', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await schema(app, dir);
  await seed(app, dir, 'active');
  await seed(app, dir, 'tools', { completed: true, finish: 'tool-calls', parent: 'active' });
  await seed(app, dir, 'done', { completed: true, finish: 'stop' });
  await seed(app, dir, 'expired', { completed: true, finish: 'stop', age: 31 * MINUTE });
  await seed(app, dir, 'waiting', { role: 'user' });
  await seed(app, dir, 'uncertain', { age: 60 * MINUTE });
  await seed(app, dir, 'aborted', { error: true });
  await seed(app, dir, 'archived', { archived: true });
  await sql(app, dir, 'INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)', ['tools-tool', 'tools-assistant', 'tools', Date.now(), Date.now(),
    JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'running', title: 'Running tests' } })]);
  await open(page);
  await expect(page.locator('.session-column')).toHaveCount(6);
  for (const [id, status] of Object.entries({ active: 'working', tools: 'working', done: 'completed', waiting: 'waiting', uncertain: 'unknown', aborted: 'error' })) {
    await expect(column(page, id)).toHaveAttribute('data-status', status);
  }
  await expect(column(page, 'tools')).toContainText('Running tests');
  await expect(column(page, 'tools')).toContainText('Sub-session');
  await expect(column(page, 'active')).toContainText('opencode/test-model');
  await expect(column(page, 'active')).toContainText('Please check active');
  await expect(column(page, 'aborted')).toContainText('Cancelled by user');
  await expect(column(page, 'done')).toContainText('Closes in 30 min');
  await expect(page.locator('.session-column').first()).toHaveAttribute('data-status', 'working');
  const boxes = await page.locator('.session-column').evaluateAll(nodes => nodes.map(n => ({ x: n.getBoundingClientRect().x, y: n.getBoundingClientRect().y })));
  expect(boxes.every(b => b.y === boxes[0].y)).toBe(true);
  expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
  await expect(page.locator('[data-tour-id="sessions"]')).toHaveClass(/active/);
});

test('polling streams new activity, detects finalization and removes exactly at the 30-minute boundary', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await schema(app, dir);
  await seed(app, dir, 'live');
  await open(page);
  await expect(column(page, 'live')).toHaveAttribute('data-status', 'working');
  await sql(app, dir, 'UPDATE part SET data = ?, time_updated = ? WHERE id = ?',
    [JSON.stringify({ type: 'text', text: 'Fresh streamed output' }), Date.now(), 'live-text']);
  await expect(column(page, 'live')).toContainText('Fresh streamed output', { timeout: 8000 });
  const completed = Date.now();
  await sql(app, dir, 'UPDATE message SET data = ?, time_updated = ? WHERE id = ?', [JSON.stringify({
    role: 'assistant', finish: 'stop', time: { created: completed - 1000, completed }, modelID: 'test-model', providerID: 'opencode',
  }), completed, 'live-assistant']);
  await expect(column(page, 'live')).toHaveAttribute('data-status', 'completed', { timeout: 8000 });
  const boundary = await app.evaluate(({}, { modulePath, dir, completed }) => {
    const require = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json');
    const { OpenCodeSessionMonitor } = require(modulePath);
    const monitor = new OpenCodeSessionMonitor(() => require('path').join(dir, 'opencode.db'), require('path').join(dir, 'hidden.json'));
    return [monitor.read(completed + 30 * 60000 - 1).sessions.length, monitor.read(completed + 30 * 60000).sessions.length];
  }, { modulePath: MONITOR_JS, dir, completed });
  expect(boundary).toEqual([1, 0]);
  await app.evaluate(({}, now) => { Date.now = () => now; }, completed + 30 * MINUTE);
  await expect(column(page, 'live')).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator('.sessions-empty')).toContainText('No visible active');
});

test('manual closure survives streaming, reopening the tab and app restart; new prompts restore the session', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await schema(app, dir);
  await seed(app, dir, 'hidden');
  const hash = () => createHash('sha256').update(fs.readFileSync(path.join(dir, 'opencode.db'))).digest('hex');
  const before = hash();
  await open(page);
  await column(page, 'hidden').getByRole('button', { name: 'Close column: Project hidden' }).click();
  await expect(column(page, 'hidden')).toHaveCount(0);
  expect(hash()).toBe(before); // The monitor and close action never mutate OpenCode's database.
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'opencode-sessions-hidden.json'), 'utf8'))).toEqual({ hidden: 'hidden-user' });
  await sql(app, dir, 'UPDATE part SET time_updated = ? WHERE id = ?', [Date.now(), 'hidden-text']);
  await page.locator('.tab.active .tab-close').click();
  await open(page);
  await expect(column(page, 'hidden')).toHaveCount(0);
  await app.close();
  const restarted = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: dir } });
  try {
    const nextPage = await restarted.firstWindow();
    await expect(nextPage.locator('.editor-textarea')).toBeVisible();
    await open(nextPage);
    await expect(column(nextPage, 'hidden')).toHaveCount(0);
    await expect(nextPage.getByRole('button', { name: 'Restore hidden (1)' })).toBeVisible();
    await sql(restarted, dir, 'INSERT INTO message VALUES (?, ?, ?, ?, ?)', ['new-user', 'hidden', Date.now() + 100, Date.now(), JSON.stringify({ role: 'user' })]);
    await expect(column(nextPage, 'hidden')).toHaveAttribute('data-status', 'waiting', { timeout: 8000 });
  } finally { await restarted.close(); }
});

test('restore hidden and search by title, model and directory', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await schema(app, dir);
  await seed(app, dir, 'alpha', { title: 'Fix café rendering' });
  await seed(app, dir, 'beta');
  await open(page);
  await column(page, 'alpha').locator('.session-close').click();
  await expect(column(page, 'alpha')).toHaveCount(0);
  await page.getByRole('button', { name: 'Restore hidden (1)' }).click();
  await expect(column(page, 'alpha')).toBeVisible();
  const search = page.getByRole('searchbox');
  await search.fill('CAFÉ');
  await expect(page.locator('.session-column')).toHaveCount(1);
  await expect(column(page, 'alpha')).toBeVisible();
  await search.fill('projects\\beta');
  await expect(page.locator('.session-column')).toHaveCount(1);
  await expect(column(page, 'beta')).toBeVisible();
  await search.fill('test-model');
  await expect(page.locator('.session-column')).toHaveCount(2);
  await search.fill('nonexistent');
  await expect(page.locator('.sessions-empty')).toContainText('No matching sessions');
  await search.fill('');
  await expect(page.locator('.session-column')).toHaveCount(2);
});

test('missing database is isolated and automatically discovered when created', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await open(page);
  await expect(page.locator('.sessions-empty')).toContainText('database not found');
  expect(await page.evaluate(() => window.electronAPI.getOpenCodeSessions())).toMatchObject({ dbPath: null, sessions: [] });
  await schema(app, dir);
  await seed(app, dir, 'new');
  await expect(column(page, 'new')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.sessions-source')).toContainText(dir);
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(path.join(dir, 'electron-profile'));
  const settings = await page.evaluate(() => window.electronAPI.loadSettings());
  expect(settings.useOneDrive).toBe(true); // Even enabled sync cannot escape the test sandbox.
});

test('schema errors surface and recover automatically; older schemas and malformed rows stay usable', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await sql(app, dir, 'CREATE TABLE session (id TEXT)');
  await open(page);
  await expect(page.getByRole('alert')).toContainText('Unsupported OpenCode session schema');
  await sql(app, dir, 'DROP TABLE session');
  await schema(app, dir);
  await seed(app, dir, 'valid');
  await seed(app, dir, 'malformed');
  await sql(app, dir, 'UPDATE message SET data = ? WHERE id = ?', ['not-json', 'malformed-assistant']);
  await sql(app, dir, 'ALTER TABLE session DROP COLUMN parent_id; ALTER TABLE session DROP COLUMN time_archived;');
  await expect(column(page, 'valid')).toBeVisible({ timeout: 8000 });
  await expect(column(page, 'malformed')).toHaveAttribute('data-status', 'unknown');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('WAL reads see committed data during a writer transaction and recover after commit', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await schema(app, dir);
  await seed(app, dir, 'wal');
  await open(page);
  await app.evaluate(({}, dir) => {
    const require = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json');
    const db = new (require('better-sqlite3'))(require('path').join(dir, 'opencode.db'));
    (globalThis as any).testWriter = db;
    db.exec("BEGIN IMMEDIATE; UPDATE session SET title = 'Committed after poll' WHERE id = 'wal'");
  }, dir);
  try {
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    await expect(column(page, 'wal')).toContainText('Project wal');
    await app.evaluate(() => { (globalThis as any).testWriter.exec('COMMIT'); });
    await expect(column(page, 'wal')).toContainText('Committed after poll', { timeout: 8000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { await app.evaluate(() => { (globalThis as any).testWriter.close(); }); }
});

test('dashboard tabs are singleton, excluded from autosave and protected against prompt actions', async ({ sandbox }) => {
  const { page, dir } = sandbox;
  await page.locator('.editor-textarea').fill('Keep my draft');
  await open(page);
  await page.locator('[data-tour-id="sessions"]').click();
  await expect(page.locator('.tab')).toHaveCount(2);
  await expect(page.locator('.header-btn[title="Copy prompt"]')).toBeDisabled();
  await expect(page.locator('.header-btn[title="Save"]')).toBeDisabled();
  await page.keyboard.press('Control+s');
  await page.keyboard.press('Control+1');
  await page.keyboard.press('Control+Shift+1');
  await expect(page.locator('.model-picker-overlay')).toHaveCount(0);
  await expect.poll(async () => (await page.evaluate(() => window.electronAPI.loadSession()))?.tabs.map(t => t.content)).toEqual(['Keep my draft']);
  await page.locator('.tab.active .tab-close').click();
  await expect(page.locator('.editor-textarea')).toHaveText('Keep my draft');
  await open(page);
  await page.locator('.tab').first().locator('.tab-close').click();
  await expect(page.locator('.tab')).toHaveCount(1);
  await page.locator('.tab.active .tab-close').click();
  await expect(page.locator('.editor-textarea')).toBeVisible();
  await expect(page.locator('.tab')).toHaveCount(1);
});

test('Spanish copy and all themes render at narrow width with horizontally scrollable columns', async ({ sandbox }, testInfo) => {
  const { app, page, dir } = sandbox;
  await schema(app, dir);
  for (const id of ['one', 'two', 'three']) await seed(app, dir, id);
  await page.locator('[data-tour-id="settings"]').click();
  await page.locator('.settings-panel select').first().selectOption('es');
  await page.locator('[data-tour-id="sessions"]').click();
  await expect(page.locator('.sessions-toolbar h2')).toContainText('Sesiones de OpenCode');
  await expect(column(page, 'one')).toContainText('Trabajando');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 600));
  for (const theme of ['light', 'dark', 'cyberpunk', 'gaudy']) {
    await page.locator('[data-tour-id="settings"]').click();
    await page.locator('.theme-card', { has: page.locator(`.theme-preview-${theme}`) }).click();
    await page.locator('[data-tour-id="settings"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const dimensions = await page.locator('.sessions-board').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, height: el.clientHeight }));
    expect(dimensions.scroll).toBeGreaterThan(dimensions.width);
    expect(dimensions.height).toBeGreaterThan(150);
    await column(page, 'three').locator('.session-close').scrollIntoViewIfNeeded();
    await expect(column(page, 'three').locator('.session-close')).toBeInViewport();
  }
  await page.screenshot({ path: testInfo.outputPath('sessions-spanish-gaudy.png') });
});

test('XDG and explicit database paths work; test mode never falls back to personal data', async ({ sandbox }) => {
  const { app, dir } = sandbox;
  const xdg = path.join(dir, 'xdg');
  const xdgDb = path.join(xdg, 'opencode', 'opencode.db');
  const custom = path.join(dir, 'custom.db');
  fs.mkdirSync(path.dirname(xdgDb), { recursive: true });
  fs.writeFileSync(xdgDb, '');
  fs.writeFileSync(custom, '');
  const result = await app.evaluate(({}, { modulePath, dir, xdg, custom }) => {
    const require = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json');
    const { findOpenCodeDb } = require(modulePath);
    const savedXdg = process.env.XDG_DATA_HOME;
    const savedCustom = process.env.PROMPT_PAD_OPENCODE_DB;
    try {
      process.env.XDG_DATA_HOME = xdg;
      delete process.env.PROMPT_PAD_OPENCODE_DB;
      const standard = findOpenCodeDb();
      process.env.PROMPT_PAD_OPENCODE_DB = custom;
      return [standard, findOpenCodeDb(), findOpenCodeDb(dir)];
    } finally {
      if (savedXdg === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = savedXdg;
      if (savedCustom === undefined) delete process.env.PROMPT_PAD_OPENCODE_DB; else process.env.PROMPT_PAD_OPENCODE_DB = savedCustom;
    }
  }, { modulePath: MONITOR_JS, dir, xdg, custom });
  expect(result).toEqual([xdgDb, custom, null]);
});

test('fresh tool activity keeps old messages active; scrolling up is respected while output streams', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await schema(app, dir);
  await seed(app, dir, 'long', { age: 60 * MINUTE });
  await sql(app, dir, 'INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)', ['long-tool', 'long-assistant', 'long', Date.now(), Date.now(),
    JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'running', title: 'Long-running task' } })]);
  await sql(app, dir, 'UPDATE part SET data = ? WHERE id = ?', [JSON.stringify({ type: 'text', text: 'Progress line\n'.repeat(100) }), 'long-text']);
  await open(page);
  await expect(column(page, 'long')).toHaveAttribute('data-status', 'working');
  const activity = column(page, 'long').locator('.session-activity');
  await expect.poll(() => activity.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(40);
  await activity.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  await sql(app, dir, 'UPDATE part SET data = ?, time_updated = ? WHERE id = ?', [JSON.stringify({ type: 'text', text: 'New streamed progress\n'.repeat(130) }), Date.now(), 'long-text']);
  await expect(activity).toContainText('New streamed progress', { timeout: 8000 });
  expect(await activity.evaluate(el => el.scrollTop)).toBe(0);
  await activity.evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
  await sql(app, dir, 'UPDATE part SET data = ?, time_updated = ? WHERE id = ?', [JSON.stringify({ type: 'text', text: 'Following again\n'.repeat(150) }), Date.now(), 'long-text']);
  await expect(activity).toContainText('Following again', { timeout: 8000 });
  await expect.poll(() => activity.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(40);
});
