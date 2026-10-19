import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');
const MONITOR_JS = path.join(__dirname, '..', 'dist-electron', 'opencodeSessions.js');
const MINUTE = 60_000;

/** Sessions sandbox: OneDrive disabled so tests never touch real cloud data. */
const test = base.extend<{ sandbox: { app: ElectronApplication; page: Page; dir: string } }>({
  sandbox: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-subagents-'));
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

// Legacy tables are still required by the reader's schema guard; the v2 tables
// are where OpenCode (provider 1) writes today.
async function schema(app: ElectronApplication, dir: string) {
  await sql(app, dir, `
    PRAGMA journal_mode = WAL;
    CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, parent_id TEXT, agent TEXT,
      time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE TABLE session_v2 (id TEXT PRIMARY KEY, slug TEXT, title TEXT, directory TEXT, parent_id TEXT,
      agent TEXT, model TEXT, time_created INTEGER, time_updated INTEGER, time_idle INTEGER, time_archived INTEGER);
    CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER,
      time_created INTEGER, time_updated INTEGER, data TEXT);
  `);
}

interface V2Session {
  id: string; title?: string; parent?: string | null; agent?: string | null;
  created?: number; updated?: number; idle?: number | null;
}

async function seedSession(app: ElectronApplication, dir: string, session: V2Session) {
  const created = session.created ?? Date.now();
  const updated = session.updated ?? created;
  await sql(app, dir, 'INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    session.id, session.id, session.title || `Session ${session.id}`, `C:\\projects\\${session.id}`,
    session.parent || null, session.agent || null,
    JSON.stringify({ id: 'subagent-model', providerID: 'test-provider' }),
    created, updated, session.idle ?? null, null,
  ]);
}

async function seedMessage(app: ElectronApplication, dir: string, sessionId: string, seq: number, type: string,
  data: Record<string, unknown>, time = Date.now()) {
  await sql(app, dir, 'INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?, ?)',
    [`${sessionId}-msg-${seq}`, sessionId, type, seq, time, time, JSON.stringify(data)]);
}

async function open(page: Page) {
  await page.locator('[data-tour-id="sessions"]').click();
  await expect(page.locator('.sessions-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
}

const column = (page: Page, id: string) => page.locator(`[data-session-id="${id}"]`);

/** A parent turn waiting on a subagent plus the child session it spawned. */
async function seedSubagentPair(app: ElectronApplication, dir: string) {
  const now = Date.now();
  await seedSession(app, dir, { id: 'parent', title: 'Parent turn', agent: 'build', created: now - 20_000, updated: now });
  await seedSession(app, dir, { id: 'child', title: 'Critique PR 1787', parent: 'parent', agent: 'pr-critic', created: now - 15_000, updated: now - 1000 });
  await seedMessage(app, dir, 'parent', 1, 'user', { text: 'Launch the reviewer', time: { created: now - 19_000 } }, now - 19_000);
  await seedMessage(app, dir, 'parent', 2, 'assistant', {
    agent: 'build',
    model: { id: 'subagent-model', providerID: 'test-provider' },
    content: [
      { type: 'text', text: 'Launching the reviewer now.' },
      { type: 'tool', name: 'subagent', state: { status: 'running', input: {
        agent: 'pr-critic', description: 'Critique PR 1787', prompt: 'SECRET INSTRUCTIONS THAT MUST NOT FILL THE COLUMN',
      } } },
    ],
  }, now - 12_000);
  await seedMessage(app, dir, 'child', 1, 'user', { text: 'Review the PR diff', time: { created: now - 14_000 } }, now - 14_000);
  await seedMessage(app, dir, 'child', 2, 'assistant', {
    agent: 'pr-critic',
    model: { id: 'subagent-model', providerID: 'test-provider' },
    content: [
      { type: 'reasoning', text: 'REASONING THAT SHOULD STAY HIDDEN' },
      { type: 'tool', name: 'shell', state: {
        status: 'completed', input: { command: 'gh pr diff 1787' },
        content: [{ type: 'text', text: 'diff --git a/hourly.py b/hourly.py' }],
      } },
    ],
  }, now - 10_000);
  await seedMessage(app, dir, 'child', 3, 'assistant', {
    agent: 'pr-critic',
    model: { id: 'subagent-model', providerID: 'test-provider' },
    content: [{ type: 'text', text: '## Verdict\n- **BLOCK** the unbounded probe stays.' }],
  }, now - 5_000);
  await seedMessage(app, dir, 'child', 4, 'idle', { time: { created: now - 1000 }, outcome: 'succeeded' }, now - 1000);
  void now;
}

test('OpenCode 2 subagent sessions render their tools, text and agent badge', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await schema(app, dir);
  await seedSubagentPair(app, dir);
  await open(page);

  const child = column(page, 'child');
  await expect(child).toHaveAttribute('data-status', 'completed');
  await expect(child).toContainText('Sub-session');
  await expect(child).toContainText('pr-critic');
  await expect(child).toContainText('Review the PR diff');
  await expect(child).toContainText('gh pr diff 1787');
  await expect(child).toContainText('diff --git a/hourly.py b/hourly.py');
  await expect(child).toContainText('BLOCK');
  // Reasoning is internal; tool calls are what a subagent is actually doing.
  await expect(child).not.toContainText('REASONING THAT SHOULD STAY HIDDEN');

  const parent = column(page, 'parent');
  await expect(parent).toHaveAttribute('data-status', 'working');
  await expect(parent).toContainText('Launching the reviewer now.');
  await expect(parent).toContainText('pr-critic · Critique PR 1787');
  await expect(parent).not.toContainText('SECRET INSTRUCTIONS');
  const link = parent.locator('.session-subagent-link');
  await expect(link).toHaveAttribute('data-child-session', 'child');
  await link.click();
  await expect(child).toHaveClass(/session-column-focus/);
});

test('subagent write-backs appear once, with the agent name as the message label', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await schema(app, dir);
  const now = Date.now();
  await seedSession(app, dir, { id: 'parent', title: 'Parent with result', agent: 'build', created: now - 20_000, updated: now });
  await seedSession(app, dir, { id: 'child', title: 'Critique PR 1787', parent: 'parent', agent: 'pr-critic', created: now - 15_000, updated: now });
  await seedMessage(app, dir, 'parent', 1, 'user', { text: 'Review it', time: { created: now - 19_000 } }, now - 19_000);
  await seedMessage(app, dir, 'parent', 2, 'assistant', {
    agent: 'build',
    model: { id: 'subagent-model', providerID: 'test-provider' },
    content: [{ type: 'tool', name: 'subagent', state: {
      status: 'completed',
      input: { agent: 'pr-critic', description: 'Critique PR 1787', prompt: 'Long prompt' },
      metadata: { sessionID: 'child' },
      content: [{ type: 'text', text: '<subagent sessionID="child" state="completed">Review posted. Final verdict: BLOCK.</subagent>' }],
    } }],
  }, now - 10_000);
  await seedMessage(app, dir, 'parent', 3, 'synthetic', {
    metadata: { source: 'subagent', childID: 'child', agent: 'pr-critic', state: 'completed' },
    text: '<subagent sessionID="child" state="completed">Review posted. Final verdict: BLOCK.</subagent>',
    time: { created: now - 9_000 },
  }, now - 9_000);

  await open(page);
  const parent = column(page, 'parent');
  await expect(parent.locator('.session-event-output')).toContainText('Review posted. Final verdict: BLOCK.');
  // The tool result is shown; the duplicate synthetic echo is suppressed.
  await expect(parent.locator('.session-event-output')).toHaveCount(1);
  await expect(parent.locator('.session-event-text', { hasText: 'Review posted' })).toHaveCount(0);
  await expect(parent.locator('.session-subagent-link')).toHaveAttribute('data-child-session', 'child');
});

test('idle markers finish turns as completed or error and keep the 30-minute boundary', async ({ sandbox }) => {
  const { app, dir } = sandbox;
  await schema(app, dir);
  const now = Date.now();
  await seedSession(app, dir, { id: 'ok', title: 'Succeeded turn', created: now - 60_000, updated: now - 30_000, idle: now - 30_000 });
  await seedMessage(app, dir, 'ok', 1, 'assistant', { agent: 'build', content: [{ type: 'text', text: 'All good' }] }, now - 40_000);
  await seedMessage(app, dir, 'ok', 2, 'idle', { time: { created: now - 30_000 }, outcome: 'succeeded' }, now - 30_000);
  await seedSession(app, dir, { id: 'bad', title: 'Interrupted turn', created: now - 60_000, updated: now - 20_000 });
  await seedMessage(app, dir, 'bad', 1, 'assistant', { agent: 'build', content: [{ type: 'text', text: 'Stopped' }] }, now - 40_000);
  await seedMessage(app, dir, 'bad', 2, 'idle', { time: { created: now - 20_000 }, outcome: 'interrupted' }, now - 20_000);

  const result = await app.evaluate(({}, { modulePath, dbPath, now }) => {
    const require = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json');
    const { dirname } = require('path');
    const { OpenCodeSessionMonitor } = require(modulePath);
    const monitor = new OpenCodeSessionMonitor(() => dbPath, dirname(dbPath) + '/hidden-idle.json');
    const at = (offset: number) => {
      const snapshot = monitor.read(now + offset);
      return Object.fromEntries(snapshot.sessions.map((s: { id: string; status: string }) => [s.id, s.status]));
    };
    return { fresh: at(0), before: at(29 * 60000), atBoundary: at(30 * 60000) };
  }, { modulePath: MONITOR_JS, dbPath: path.join(dir, 'opencode.db'), now });

  expect(result.fresh).toEqual({ ok: 'completed', bad: 'error' });
  expect(result.before).toEqual({ ok: 'completed', bad: 'error' });
  expect(result.atBoundary).toEqual({});
});

test('the mobile API exposes subagent sessions, agent names and child links', async ({ sandbox }) => {
  const { app, dir } = sandbox;
  await schema(app, dir);
  await seedSubagentPair(app, dir);
  const api = await app.evaluate(({}, { modulePath, dbPath }) => {
    const require = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json');
    const { dirname } = require('path');
    const { RemoteSessionsServer } = require(modulePath);
    const { OpenCodeSessionMonitor } = require(dirname(modulePath) + '/opencodeSessions.js');
    const monitor = new OpenCodeSessionMonitor(() => dbPath, dirname(dbPath) + '/hidden-mobile.json');
    return new Promise((resolve, reject) => {
      const server = new RemoteSessionsServer(monitor, undefined);
      server.start(0, '127.0.0.1').then(async port => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/sessions?key=${server.accessToken}`);
          resolve(await res.json());
        } catch (err) { reject(err); }
        finally { server.stop(); }
      }, reject);
    });
  }, { modulePath: path.join(__dirname, '..', 'dist-electron', 'remoteServer.js'), dbPath: path.join(dir, 'opencode.db') });

  const child = api.sessions.find((s: { id: string }) => s.id === 'child');
  expect(child.agent).toBe('pr-critic');
  expect(child.parentId).toBe('parent');
  const tool = child.activity.find((a: { type: string }) => a.type === 'tool');
  expect(tool.input).toBe('gh pr diff 1787');
  expect(tool.output).toContain('diff --git a/hourly.py b/hourly.py');
  const text = child.activity.find((a: { type: string; text?: string }) => a.type === 'text' && a.text.includes('Verdict'));
  expect(text.html).toContain('<h2>Verdict</h2>');
  const parent = api.sessions.find((s: { id: string }) => s.id === 'parent');
  const spawn = parent.activity.find((a: { tool?: string }) => a.tool === 'subagent');
  expect(spawn.childId).toBe('child');
  expect(spawn.input).toBe('pr-critic · Critique PR 1787');
});

test('a schema without agent/model columns still renders subagent activity', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await schema(app, dir);
  await sql(app, dir, 'ALTER TABLE session_v2 DROP COLUMN agent; ALTER TABLE session_v2 DROP COLUMN model;');
  const now = Date.now();
  await sql(app, dir, 'INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    'old-child', 'old-child', 'Older subagent', 'C:\\work', 'old-parent', now - 10_000, now, null, null,
  ]);
  await seedMessage(app, dir, 'old-child', 1, 'assistant', { content: [
    { type: 'tool', name: 'shell', state: { status: 'completed', input: { command: 'npm test' }, content: [{ type: 'text', text: '42 passing' }] } },
  ] }, now - 5_000);
  await open(page);
  const child = column(page, 'old-child');
  await expect(child).toBeVisible();
  await expect(child).toContainText('npm test');
  await expect(child).toContainText('42 passing');
  await expect(child).toContainText('Sub-session');
});

test('stale v2 subagent sessions are hidden after the 24-hour cap', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await schema(app, dir);
  const now = Date.now();
  await seedSession(app, dir, { id: 'old', title: 'Abandoned subagent', agent: 'pr-critic', created: now - 25 * 60 * MINUTE, updated: now - 25 * 60 * MINUTE });
  await seedMessage(app, dir, 'old', 1, 'assistant', { content: [{ type: 'text', text: 'never finished' }] }, now - 25 * 60 * MINUTE);
  await open(page);
  await expect(page.locator('.sessions-empty')).toContainText('No visible active');
});
