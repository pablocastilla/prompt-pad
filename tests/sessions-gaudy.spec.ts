import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');

interface Sandbox { app: ElectronApplication; page: Page; dir: string }

/** Gaudy sandbox: OneDrive sync disabled so tests never touch real cloud data. */
const test = base.extend<{ sandbox: Sandbox }>({
  sandbox: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-gaudy-sessions-'));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ language: 'en', theme: 'gaudy', useOneDrive: false }));
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: dir } });
    try {
      const page = await app.firstWindow();
      await expect(page.locator('.editor-textarea')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'gaudy');
      await use({ app, page, dir });
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
});

/** Dark sandbox to prove other themes stay sober. */
const testDark = test.extend<{ darkSandbox: Sandbox }>({
  darkSandbox: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-dark-sessions-'));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ language: 'en', theme: 'dark', useOneDrive: false }));
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
  `);
}

async function seed(app: ElectronApplication, dir: string, id: string, options: { completed?: boolean; error?: boolean } = {}) {
  const time = Date.now();
  await sql(app, dir, 'INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, `Project ${id}`, `C:\\projects\\${id}`, null, time - 1000, time, null]);
  await sql(app, dir, 'INSERT INTO message VALUES (?, ?, ?, ?, ?)', [id + '-user', id, time - 1000, time - 1000,
    JSON.stringify({ role: 'user', time: { created: time - 1000 }, model: { providerID: 'opencode', modelID: 'test-model' } })]);
  await sql(app, dir, 'INSERT INTO message VALUES (?, ?, ?, ?, ?)', [id + '-assistant', id, time, time, JSON.stringify({
    role: 'assistant', time: { created: time, ...(options.completed ? { completed: time } : {}) },
    modelID: 'test-model', providerID: 'opencode', finish: 'stop',
    ...(options.error ? { error: { name: 'MessageAbortedError', data: { message: 'Cancelled by user' } } } : {}),
  })]);
  await sql(app, dir, 'INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)', [id + '-text', id + '-assistant', id, time, time,
    JSON.stringify({ type: 'text', text: 'Working on ' + id })]);
}

async function finish(app: ElectronApplication, dir: string, id: string, options: { error?: boolean } = {}) {
  const completed = Date.now();
  await sql(app, dir, 'UPDATE message SET data = ?, time_updated = ? WHERE id = ?', [JSON.stringify({
    role: 'assistant', time: { created: completed - 1000, completed }, modelID: 'test-model', providerID: 'opencode', finish: 'stop',
    ...(options.error ? { error: { name: 'MessageAbortedError', data: { message: 'Cancelled by user' } } } : {}),
  }), completed, id + '-assistant']);
}

async function open(page: Page) {
  await page.locator('[data-tour-id="sessions"]').click();
  await expect(page.locator('.sessions-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
}

const column = (page: Page, id: string) => page.locator(`[data-session-id="${id}"]`);

test('gaudy board runs its kitsch animations that other themes never get', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await schema(app, dir);
  await seed(app, dir, 'disco');
  await seed(app, dir, 'gold', { completed: true });
  await seed(app, dir, 'drama', { error: true });
  await open(page);

  // Working column breathes with neon; its header runs the disco marquee.
  const workingAnimation = await column(page, 'disco').evaluate(el => getComputedStyle(el).animationName);
  expect(workingAnimation).toBe('gaudy-session-breathe');
  const workingHeaderAnimation = await column(page, 'disco').locator('.session-column-header').evaluate(el => getComputedStyle(el).animationName);
  expect(workingHeaderAnimation).toBe('gaudy-sessions-rollback');

  // Finished column gets the golden shine sweep; error column the dramatic shake.
  const finishedAnimation = await column(page, 'gold').locator('.session-column-header').evaluate(el => getComputedStyle(el, '::after').animationName);
  expect(finishedAnimation).toBe('gaudy-session-shine');
  const errorAnimation = await column(page, 'drama').evaluate(el => getComputedStyle(el).animationName);
  expect(errorAnimation).toBe('gaudy-session-drama');

  // The panel title rolls the rainbow gradient.
  const titleAnimation = await page.locator('.sessions-toolbar h2').evaluate(el => getComputedStyle(el).animationName);
  expect(titleAnimation).toBe('gaudy-sessions-rollback');
});

testDark('light, dark and cyberpunk boards stay sober: no gaudy animations leak in', async ({ darkSandbox }) => {
  const { app, page, dir } = darkSandbox;
  await schema(app, dir);
  await seed(app, dir, 'sober');
  await open(page);
  const workingAnimation = await column(page, 'sober').evaluate(el => getComputedStyle(el).animationName);
  expect(workingAnimation).toBe('none');
  const headerAnimation = await column(page, 'sober').locator('.session-column-header').evaluate(el => getComputedStyle(el, '::before').animationName);
  expect(headerAnimation).toBe('none');
  const titleAnimation = await page.locator('.sessions-toolbar h2').evaluate(el => getComputedStyle(el).animationName);
  expect(titleAnimation).toBe('none');
});

test('gaudy board erupts in kitschy toasts when a watched turn finishes or errors', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await schema(app, dir);
  await seed(app, dir, 'star');
  await seed(app, dir, 'flop');
  await open(page);
  await page.waitForTimeout(4000); // Let a poll observe the initial statuses first.

  await finish(app, dir, 'star');
  await finish(app, dir, 'flop', { error: true });
  await expect(page.locator('.gaudy-toast')).toHaveCount(2, { timeout: 12000 });
  await expect(page.locator('.gaudy-toast').filter({ hasText: 'CONFETTI' })).toHaveCount(1);
  await expect(page.locator('.gaudy-toast').filter({ hasText: 'GLITTER' })).toHaveCount(1);

  // Toasts auto-dismiss after 3s and repeated polls must not re-announce the same turn.
  await page.waitForTimeout(4000);
  expect(await page.locator('.gaudy-toast').count()).toBe(0);
  await page.waitForTimeout(4000);
  expect(await page.locator('.gaudy-toast').count()).toBe(0);
});

testDark('dark board keeps silent: no gaudy toasts on the same transitions', async ({ darkSandbox }) => {
  const { app, page, dir } = darkSandbox;
  await schema(app, dir);
  await seed(app, dir, 'quiet');
  await open(page);
  await page.waitForTimeout(4000);
  await finish(app, dir, 'quiet');
  await page.waitForTimeout(6000);
  expect(await page.locator('.gaudy-toast').count()).toBe(0);
});
