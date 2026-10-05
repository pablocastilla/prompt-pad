import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');

/** Sessions sandbox: OneDrive disabled so tests never touch real cloud data. */
const test = base.extend<{ sandbox: { app: ElectronApplication; page: Page; dir: string } }>({
  sandbox: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-sessions-render-'));
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

async function seedTextPart(app: ElectronApplication, dir: string, id: string, text: string, role: 'assistant' | 'user' = 'assistant') {
  const time = Date.now();
  await sql(app, dir, 'INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, `Project ${id}`, `C:\\projects\\${id}`, null, time - 2000, time, null]);
  await sql(app, dir, 'INSERT INTO message VALUES (?, ?, ?, ?, ?)',
    [id + '-user', id, time - 2000, time - 2000, JSON.stringify({ role: 'user', time: { created: time - 2000 } })]);
  await sql(app, dir, 'INSERT INTO message VALUES (?, ?, ?, ?, ?)', [id + '-assistant', id, time - 1000, time - 1000, JSON.stringify({
    role, time: { created: time - 1000 }, modelID: 'test-model', providerID: 'opencode',
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

test('assistant messages render as markdown while tool titles stay plain text', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await schema(app, dir);
  await sql(app, dir, 'INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['md', 'Project md', 'C:\\projects\\md', null, Date.now() - 2000, Date.now(), null]);
  await sql(app, dir, 'INSERT INTO message VALUES (?, ?, ?, ?, ?)',
    ['md-user', 'md', Date.now() - 2000, Date.now() - 2000, JSON.stringify({ role: 'user', time: { created: Date.now() - 2000 } })]);
  await sql(app, dir, 'INSERT INTO message VALUES (?, ?, ?, ?, ?)', ['md-assistant', 'md', Date.now() - 1000, Date.now() - 1000, JSON.stringify({
    role: 'assistant', time: { created: Date.now() - 1000 }, modelID: 'test-model', providerID: 'opencode',
  })]);
  await sql(app, dir, 'INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)', ['md-tool', 'md-assistant', 'md', Date.now(), Date.now(),
    JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'running', title: 'Fix **module** readme' } })]);
  await sql(app, dir, 'INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)', ['md-text', 'md-assistant', 'md', Date.now(), Date.now(),
    JSON.stringify({ type: 'text', text: '## Plan\n- Fix the **auth** bug\n- Run `npm test`\n\n```js\nconst a = "<b>1</b>";\n```\n\nSee [docs](https://example.com/guide).' })]);
  await open(page);

  const text = column(page, 'md').locator('.session-event-text');
  await expect(text.locator('h2')).toHaveText('Plan');
  await expect(text.locator('li').filter({ hasText: 'auth' }).locator('strong')).toHaveText('auth');
  await expect(text.locator('li').filter({ hasText: 'npm test' }).locator('code')).toHaveText('npm test');
  await expect(text.locator('pre code')).toContainText('const a = "<b>1</b>";');
  // Raw HTML is escaped: no real <b> element from message content.
  await expect(text.locator('pre code b')).toHaveCount(0);
  const link = text.locator('a[href="https://example.com/guide"]');
  await expect(link).toHaveText('docs');

  // Tool events keep their literal title (no markdown inside the tool chip).
  await expect(column(page, 'md').locator('.session-event-tool p')).toHaveText('Fix **module** readme');
});

test('tool execution commands and results render as plain code blocks', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await schema(app, dir);
  await sql(app, dir, 'INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['cmd', 'Project cmd', 'C:\\projects\\cmd', null, Date.now() - 2000, Date.now(), null]);
  await sql(app, dir, 'INSERT INTO message VALUES (?, ?, ?, ?, ?)',
    ['cmd-user', 'cmd', Date.now() - 2000, Date.now() - 2000, JSON.stringify({ role: 'user', time: { created: Date.now() - 2000 } })]);
  await sql(app, dir, 'INSERT INTO message VALUES (?, ?, ?, ?, ?)', ['cmd-assistant', 'cmd', Date.now() - 1000, Date.now() - 1000, JSON.stringify({
    role: 'assistant', time: { created: Date.now() - 1000 }, modelID: 'test-model', providerID: 'opencode',
  })]);
  await sql(app, dir, 'INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)', ['cmd-tool', 'cmd-assistant', 'cmd', Date.now(), Date.now(),
    JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'python script.py' }, output: 'line one\nline two' } })]);
  await open(page);
  const col = column(page, 'cmd');
  await expect(col.locator('.session-event-command')).toHaveText('python script.py');
  await expect(col.locator('.session-event-output')).toHaveText('line one\nline two');
});

test('composer sends messages into the running session and reports delivery', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await schema(app, dir);
  await seedTextPart(app, dir, 'compose', 'Ready for your next instruction.');
  await open(page);

  // Sandbox: delivery is impossible without a real OpenCode server, so the
  // composer must surface the failure instead of silently doing nothing.
  const box = column(page, 'compose').locator('.session-compose textarea');
  await expect(box).toBeVisible();
  const send = column(page, 'compose').locator('.session-compose button');
  await expect(send).toBeDisabled();
  await box.fill('Hello from the board');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(column(page, 'compose').locator('.session-compose-note')).toContainText('Send failed', { timeout: 120000 });

  // The IPC surface validates its arguments even before reaching a server.
  await expect(page.evaluate(() => window.electronAPI.sendOpenCodeMessage('x', ''))).rejects.toThrow();
  // Antigravity columns get no composer.
  await expect(column(page, 'compose').locator('.session-compose')).toHaveCount(1);
});

test('columns are twice as wide and board keeps scrolling horizontally', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await schema(app, dir);
  await seedTextPart(app, dir, 'wide-one', 'First');
  await seedTextPart(app, dir, 'wide-two', 'Second');
  await open(page);
  const width = await column(page, 'wide-one').evaluate(el => el.getBoundingClientRect().width);
  expect(Math.round(width)).toBe(700);
  const board = await page.locator('.sessions-board').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
  expect(board.scroll).toBeGreaterThan(board.width);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(700, 600));
  const narrow = await column(page, 'wide-two').evaluate(el => ({
    basis: getComputedStyle(el).flexBasis,
    width: el.getBoundingClientRect().width,
  }));
  expect(narrow.basis).toBe('620px');
  expect(narrow.width).toBeGreaterThan(500);
});

test('markdown renderer never emits unescaped markup from message content', async ({ sandbox }) => {
  const { app } = sandbox;
  const cases = await app.evaluate(({}, modulePath) => {
    const require = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json');
    const { renderMarkdown } = require(modulePath);
    return {
      script: renderMarkdown('<script>alert(1)</script>'),
      img: renderMarkdown('<img src=x onerror=alert(1)>'),
      bold: renderMarkdown('**bold** and *italic* and `code`'),
      list: renderMarkdown('- a\n- b\n1. c\n2. d'),
      heading: renderMarkdown('## Title'),
      quote: renderMarkdown('> quoted'),
      fence: renderMarkdown('```\nline1\nline2\n```'),
      link: renderMarkdown('[x](https://example.com)'),
      autolink: renderMarkdown('see https://example.com/page now'),
    };
  }, path.join(__dirname, '..', 'dist-electron', 'markdown.js'));
  expect(cases.script).not.toContain('<script>');
  expect(cases.script).toContain('&lt;script&gt;');
  expect(cases.img).not.toContain('<img');
  expect(cases.bold).toBe('<p><strong>bold</strong> and <em>italic</em> and <code>code</code></p>');
  expect(cases.list).toBe('<ul><li>a</li><li>b</li></ul><ol start="1"><li>c</li><li>d</li></ol>');
  expect(cases.heading).toBe('<h2>Title</h2>');
  expect(cases.quote).toBe('<blockquote>quoted</blockquote>');
  expect(cases.fence).toContain('<pre><code>line1\nline2</code></pre>');
  expect(cases.link).toContain('<a href="https://example.com"');
  expect(cases.autolink).toContain('<a href="https://example.com/page"');
});

test('mobile page renders markdown HTML from the API and keeps tool titles plain', async ({ sandbox }) => {
  const { app, dir } = sandbox;
  await schema(app, dir);
  await sql(app, dir, 'INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['mob', 'Project mob', 'C:\\projects\\mob', null, Date.now() - 2000, Date.now(), null]);
  await sql(app, dir, 'INSERT INTO message VALUES (?, ?, ?, ?, ?)',
    ['mob-user', 'mob', Date.now() - 2000, Date.now() - 2000, JSON.stringify({ role: 'user', time: { created: Date.now() - 2000 } })]);
  await sql(app, dir, 'INSERT INTO message VALUES (?, ?, ?, ?, ?)', ['mob-assistant', 'mob', Date.now() - 1000, Date.now() - 1000, JSON.stringify({
    role: 'assistant', time: { created: Date.now() - 1000 }, modelID: 'test-model', providerID: 'opencode',
  })]);
  await sql(app, dir, 'INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)', ['mob-tool', 'mob-assistant', 'mob', Date.now(), Date.now(),
    JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'completed', title: 'Plain **title**', input: { command: 'python hi.py' }, output: 'hello world' } })]);
  await sql(app, dir, 'INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)', ['mob-text', 'mob-assistant', 'mob', Date.now(), Date.now(),
    JSON.stringify({ type: 'text', text: '### Summary\n- **done** item\n\n`code` and <b>raw</b>' })]);

  // Exercise the same route the phone polls, in-process (no ports opened).
  const api = await app.evaluate(({}, { modulePath, dbPath }) => {
    const require = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json');
    const { dirname } = require('path');
    const { RemoteSessionsServer } = require(modulePath);
    const { OpenCodeSessionMonitor } = require(dirname(modulePath) + '/opencodeSessions.js');
    const monitor = new OpenCodeSessionMonitor(() => dbPath, dirname(dbPath) + '/hidden.json');
    return new Promise((resolve, reject) => {
      const server = new RemoteSessionsServer(monitor, undefined);
      server.start(0, '127.0.0.1').then(async port => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/sessions?key=${server.accessToken}`);
          const body = await res.json();
          resolve(body);
        } catch (err) { reject(err); }
      }, reject);
    });
  }, { modulePath: path.join(__dirname, '..', 'dist-electron', 'remoteServer.js'), dbPath: path.join(dir, 'opencode.db') });

  const session = api.sessions.find((s: { id: string }) => s.id === 'mob');
  expect(session).toBeTruthy();
  const textEvent = session.activity.find((a: { id: string }) => a.id === 'mob-text');
  expect(textEvent.html).toContain('<h3>Summary</h3>');
  expect(textEvent.html).toContain('<strong>done</strong>');
  expect(textEvent.html).toContain('<code>code</code>');
  expect(textEvent.html).not.toContain('<b>raw</b>');
  expect(textEvent.html).toContain('&lt;b&gt;raw&lt;/b&gt;');
  const toolEvent = session.activity.find((a: { id: string }) => a.id === 'mob-tool');
  expect(toolEvent.html).toBe(''); // tool titles stay plain text
  expect(toolEvent.text).toBe('Plain **title**');
  expect(toolEvent.input).toBe('python hi.py');
  expect(toolEvent.output).toBe('hello world');
  void app; void dir;
});
