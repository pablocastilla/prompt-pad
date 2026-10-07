import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');

/** Sessions sandbox: OneDrive disabled so tests never touch real cloud data. */
const test = base.extend<{ sandbox: { app: ElectronApplication; page: Page; dir: string } }>({
  sandbox: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-sessions-interactions-'));
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

async function seedTextPart(app: ElectronApplication, dir: string, id: string, text: string) {
  const time = Date.now();
  await sql(app, dir, 'INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, `Project ${id}`, `C:\\projects\\${id}`, null, time - 2000, time, null]);
  await sql(app, dir, 'INSERT INTO message VALUES (?, ?, ?, ?, ?)',
    [id + '-user', id, time - 2000, time - 2000, JSON.stringify({ role: 'user', time: { created: time - 2000 } })]);
  await sql(app, dir, 'INSERT INTO message VALUES (?, ?, ?, ?, ?)', [id + '-assistant', id, time - 1000, time - 1000, JSON.stringify({
    role: 'assistant', time: { created: time - 1000 }, modelID: 'test-model', providerID: 'opencode',
  })]);
  await sql(app, dir, 'INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)',
    [id + '-text', id + '-assistant', id, time - 1000, time - 1000, JSON.stringify({ type: 'text', text })]);
}

async function open(page: Page) {
  await page.locator('[data-tour-id="sessions"]').click();
  await expect(page.locator('.sessions-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
}

const column = (page: Page, id: string) => page.locator(`[data-session-id="${id}"]`);

test('the board shows and answers OpenCode questions and permission requests', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await schema(app, dir);
  await seedTextPart(app, dir, 'q1', 'Waiting for your decision.');

  // The live interactions live in the OpenCode server; stub the IPC surface so
  // the board renders a pending question and a pending permission request.
  await app.evaluate(({ ipcMain }) => {
    const store = (globalThis as unknown as { __ppReplies: { questions: unknown[]; permissions: unknown[] } }).__ppReplies =
      { questions: [], permissions: [] };
    ipcMain.removeHandler('opencode-interactions:list');
    ipcMain.handle('opencode-interactions:list', () => ({
      permissions: [{ id: 'per_test1', sessionID: 'q1', permission: 'bash', patterns: ['rm -rf build'], always: [], metadata: {} }],
      questions: [{
        id: 'que_test1', sessionID: 'q1',
        questions: [{
          question: 'Which database should I use?', header: 'Storage',
          options: [{ label: 'Postgres', description: 'Relational' }, { label: 'Mongo', description: 'Document' }],
          custom: true,
        }],
      }],
    }));
    ipcMain.removeHandler('opencode-interactions:question-reply');
    ipcMain.handle('opencode-interactions:question-reply', (_e, requestId: string, answers: unknown) => {
      store.questions.push({ requestId, answers });
      return { ok: true };
    });
    ipcMain.removeHandler('opencode-interactions:permission-reply');
    ipcMain.handle('opencode-interactions:permission-reply', (_e, requestId: string, reply: string) => {
      store.permissions.push({ requestId, reply });
      return { ok: true };
    });
  });

  await open(page);
  const col = column(page, 'q1');

  // Question renders with its options and a custom answer box.
  const question = col.locator('.session-interaction-question');
  await expect(question).toBeVisible();
  await expect(question.locator('.session-interaction-text')).toHaveText('Which database should I use?');
  await expect(question.locator('.session-question-option')).toHaveCount(2);
  await expect(question.locator('.session-question-custom')).toBeVisible();

  await question.locator('.session-question-option', { hasText: 'Postgres' }).click();
  await question.getByRole('button', { name: 'Answer' }).click();
  await expect.poll(async () => app.evaluate(() =>
    (globalThis as unknown as { __ppReplies: { questions: { requestId: string; answers: string[][] }[] } }).__ppReplies.questions.length
  )).toBe(1);
  const questionReply = await app.evaluate(() =>
    (globalThis as unknown as { __ppReplies: { questions: { requestId: string; answers: string[][] }[] } }).__ppReplies.questions[0]
  );
  expect(questionReply.requestId).toBe('que_test1');
  expect(questionReply.answers).toEqual([['Postgres']]);

  // Permission renders its command and replies with the chosen option.
  const permission = column(page, 'q1').locator('.session-interaction-permission');
  await expect(permission).toBeVisible();
  await expect(permission.locator('.session-interaction-command')).toContainText('bash');
  await expect(permission.locator('.session-interaction-command')).toContainText('rm -rf build');
  await permission.getByRole('button', { name: 'Allow always' }).click();
  await expect.poll(async () => app.evaluate(() =>
    (globalThis as unknown as { __ppReplies: { permissions: { requestId: string; reply: string }[] } }).__ppReplies.permissions.length
  )).toBe(1);
  const permissionReply = await app.evaluate(() =>
    (globalThis as unknown as { __ppReplies: { permissions: { requestId: string; reply: string }[] } }).__ppReplies.permissions[0]
  );
  expect(permissionReply).toEqual({ requestId: 'per_test1', reply: 'always' });
});

test('a vertical wheel outside a column scrolls the board horizontally', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await schema(app, dir);
  await seedTextPart(app, dir, 'scroll-one', 'First');
  await seedTextPart(app, dir, 'scroll-two', 'Second');
  await open(page);

  const board = page.locator('.sessions-board');
  await expect(board).toBeVisible();
  const before = await board.evaluate(el => el.scrollLeft);
  expect(before).toBe(0);

  // A wheel event over the board background (not inside a column's scrollable
  // activity) is translated into horizontal movement.
  await board.dispatchEvent('wheel', { deltaY: 240, deltaX: 0 });
  await expect.poll(async () => board.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);

  // A wheel inside a column's activity keeps its default vertical behaviour and
  // must not move the board.
  await board.evaluate(el => { el.scrollLeft = 0; });
  await column(page, 'scroll-one').locator('.session-activity').dispatchEvent('wheel', { deltaY: 120, deltaX: 0 });
  const after = await board.evaluate(el => el.scrollLeft);
  expect(after).toBe(0);
  void app; void dir;
});

test('the mobile page follows the selected theme and cannot ask without an active session', async ({ sandbox }) => {
  const { app, dir } = sandbox;
  await schema(app, dir);
  await seedTextPart(app, dir, 'mob-theme', 'Hello');

  const result = await app.evaluate(async ({}, { modulePath, dbPath }) => {
    const require = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json');
    const { dirname } = require('path');
    const { RemoteSessionsServer, renderIndexHtml } = require(modulePath);
    const { OpenCodeSessionMonitor } = require(dirname(modulePath) + '/opencodeSessions.js');
    const monitor = new OpenCodeSessionMonitor(() => dbPath, dirname(dbPath) + '/hidden.json');
    const server = new RemoteSessionsServer(monitor, undefined);
    server.setTheme('cyberpunk');
    const port = await server.start(0, '127.0.0.1');
    const key = server.accessToken;
    const html = await (await fetch(`http://127.0.0.1:${port}/?key=${key}`)).text();
    const sessions = await (await fetch(`http://127.0.0.1:${port}/api/sessions?key=${key}`)).json();
    const sendRes = await fetch(`http://127.0.0.1:${port}/api/send?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hello' }),
    });
    const sendBody = await sendRes.json();
    server.stop();
    return {
      html,
      theme: sessions.theme,
      sendStatus: sendRes.status,
      sendError: sendBody.error,
      gaudyHtml: renderIndexHtml('gaudy'),
      lightHtml: renderIndexHtml('light'),
    };
  }, { modulePath: path.join(__dirname, '..', 'dist-electron', 'remoteServer.js'), dbPath: path.join(dir, 'opencode.db') });

  // The served page carries the selected theme and its accent colour.
  expect(result.theme).toBe('cyberpunk');
  expect(result.html).toContain('data-theme="cyberpunk"');
  expect(result.html).toContain('--accent: #47e9ff');
  // Every theme renders without falling back.
  expect(result.gaudyHtml).toContain('data-theme="gaudy"');
  expect(result.lightHtml).toContain('data-theme="light"');

  // No global "new session" composer: asking is only possible inside a session.
  expect(result.html).not.toContain('id="promptForm"');
  expect(result.html).not.toContain('new session');
  expect(result.sendStatus).toBe(400);
  expect(result.sendError).toMatch(/active session/i);
});

test('the mobile page renders and answers questions and permissions', async ({ sandbox }) => {
  const { app, dir } = sandbox;
  await schema(app, dir);

  // Serve the real mobile page from a local port and open it in a real window so
  // its scripts (not just the HTML string) are exercised.
  const started = await app.evaluate(async ({ BrowserWindow }, { modulePath, dbPath }) => {
    const require = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json');
    const { dirname } = require('path');
    const { RemoteSessionsServer } = require(modulePath);
    const { OpenCodeSessionMonitor } = require(dirname(modulePath) + '/opencodeSessions.js');
    const monitor = new OpenCodeSessionMonitor(() => dbPath, dirname(dbPath) + '/hidden.json');
    const server = new RemoteSessionsServer(monitor, undefined);
    const port = await server.start(0, '127.0.0.1');
    const win = new BrowserWindow({ show: false, width: 420, height: 820 });
    (globalThis as unknown as { __ppWin: unknown; __ppServer: unknown }).__ppWin = win;
    (globalThis as unknown as { __ppWin: unknown; __ppServer: unknown }).__ppServer = server;
    await win.loadURL(`http://127.0.0.1:${port}/?key=${server.accessToken}`);
    return { port };
  }, { modulePath: path.join(__dirname, '..', 'dist-electron', 'remoteServer.js'), dbPath: path.join(dir, 'opencode.db') });

  let mobile: Page | undefined;
  await expect.poll(() => {
    mobile = app.windows().find(p => p.url().includes(`127.0.0.1:${started.port}`));
    return !!mobile;
  }).toBe(true);
  await mobile!.waitForLoadState('domcontentloaded');

  // Feed a fake session with a question and a permission, and capture replies.
  await mobile!.evaluate(() => {
    const w = window as unknown as {
      eval: (code: string) => { sessions: unknown[]; sendEnabled: boolean; open: Set<string> };
      render: () => void;
      fetch: unknown;
      __replies?: unknown[];
    };
    // `const state` in the page script is a global lexical binding, not a
    // window property, so read it through an indirect eval.
    const state = w.eval('state');
    w.fetch = async (url: string, opts?: { body?: string }) => {
      if (String(url).includes('/api/interaction/reply')) {
        w.__replies = w.__replies || [];
        w.__replies.push(JSON.parse(opts?.body || '{}'));
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (String(url).includes('/api/sessions')) {
        return { ok: true, json: async () => ({ sessions: state.sessions, theme: 'dark', sendEnabled: true }) };
      }
      return { ok: true, json: async () => ({}) };
    };
    state.sessions = [{
      id: 'm1', title: 'Mobile one', directory: 'C:\\m1', model: 'test-model', status: 'working',
      updatedAt: Date.now(), createdAt: Date.now(), source: 'opencode', activity: [],
      questions: [{ id: 'que_m1', sessionID: 'm1', questions: [{
        question: 'Pick a database', header: 'Storage',
        options: [{ label: 'Postgres', description: 'Relational' }, { label: 'Mongo', description: 'Document' }], custom: true,
      }] }],
      permissions: [{ id: 'per_m1', sessionID: 'm1', permission: 'bash', patterns: ['rm -rf build'], always: [] }],
    }];
    w.render();
  });

  const question = mobile!.locator('.interaction.question');
  await expect(question).toBeVisible();
  await expect(question.locator('.q-text')).toHaveText('Pick a database');
  await question.locator('.q-opt input').first().check();
  await question.getByRole('button', { name: 'Answer' }).click();

  const permission = mobile!.locator('.interaction.permission');
  await expect(permission).toBeVisible();
  await expect(permission.locator('.event-code')).toContainText('rm -rf build');
  await permission.getByRole('button', { name: 'Allow once' }).click();

  await expect.poll(() => mobile!.evaluate(() =>
    ((window as unknown as { __replies: unknown[] }).__replies || []).length
  )).toBe(2);
  const replies = await mobile!.evaluate(() => (window as unknown as { __replies: unknown[] }).__replies);
  expect(replies).toContainEqual({ kind: 'question', requestId: 'que_m1', answers: [['Postgres']] });
  expect(replies).toContainEqual({ kind: 'permission', requestId: 'per_m1', reply: 'once' });

  await app.evaluate(() => {
    const g = globalThis as unknown as { __ppWin?: { destroy: () => void }; __ppServer?: { stop: () => void } };
    g.__ppWin?.destroy();
    g.__ppServer?.stop();
  });
});

