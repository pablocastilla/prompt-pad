import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');

interface Sandbox { app: ElectronApplication; page: Page; dir: string }

const test = base.extend<{ sandbox: Sandbox }>({
  sandbox: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-sound-'));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ language: 'en', theme: 'dark', useOneDrive: true, sessionSoundEnabled: true }));
    const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: dir } });
    try {
      const page = await app.firstWindow();
      await expect(page.locator('.editor-textarea')).toBeVisible();
      await page.waitForTimeout(1000); // Let the initial settings load settle before tests mutate them.
      await use({ app, page, dir });
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
});

// Use Electron's native SQLite module so the fixtures share the app's ABI.
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

async function seed(app: ElectronApplication, dir: string, id: string, options: { completed?: boolean; error?: boolean; finish?: string } = {}) {
  const time = Date.now();
  await sql(app, dir, 'INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, `Project ${id}`, `C:\\projects\\${id}`, null, time - 1000, time, null]);
  await sql(app, dir, 'INSERT INTO message VALUES (?, ?, ?, ?, ?)', [id + '-user', id, time - 1000, time - 1000,
    JSON.stringify({ role: 'user', time: { created: time - 1000 }, model: { providerID: 'opencode', modelID: 'test-model' } })]);
  await sql(app, dir, 'INSERT INTO message VALUES (?, ?, ?, ?, ?)', [id + '-assistant', id, time, time, JSON.stringify({
    role: 'assistant', time: { created: time, ...(options.completed ? { completed: time } : {}) },
    modelID: 'test-model', providerID: 'opencode', finish: options.finish,
    ...(options.error ? { error: { name: 'MessageAbortedError', data: { message: 'Cancelled by user' } } } : {}),
  })]);
}

async function finish(app: ElectronApplication, dir: string, id: string, options: { error?: boolean } = {}) {
  const completed = Date.now();
  await sql(app, dir, 'UPDATE message SET data = ?, time_updated = ? WHERE id = ?', [JSON.stringify({
    role: 'assistant', time: { created: completed - 1000, completed }, modelID: 'test-model', providerID: 'opencode', finish: 'stop',
    ...(options.error ? { error: { name: 'MessageAbortedError', data: { message: 'Cancelled by user' } } } : {}),
  }), completed, id + '-assistant']);
}

/** Replace AudioContext with a recorder so tests can count chime notes without real sound. */
async function installSoundSpy(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __soundStarts: number }).__soundStarts = 0;
    (window as unknown as { __soundFreqs: number[] }).__soundFreqs = [];
    class FakeParam {
      value = 0;
      setValueAtTime() { return this; }
      linearRampToValueAtTime() { return this; }
      exponentialRampToValueAtTime() { return this; }
    }
    class FakeNode { connect() { return this; } }
    class FakeGain extends FakeNode { gain = new FakeParam(); }
    class FakeOscillator extends FakeNode {
      type = 'sine';
      frequency = new FakeParam();
      start() {
        (window as unknown as { __soundStarts: number }).__soundStarts += 1;
        (window as unknown as { __soundFreqs: number[] }).__soundFreqs.push(this.frequency.value);
      }
      stop() {}
    }
    class FakeAudioContext {
      state = 'running';
      currentTime = 0;
      destination = new FakeNode();
      createGain() { return new FakeGain(); }
      createOscillator() { return new FakeOscillator(); }
      resume() { return Promise.resolve(); }
    }
    Object.defineProperty(window, 'AudioContext', { value: FakeAudioContext, configurable: true, writable: true });
  });
}

const soundStarts = (page: Page) => page.evaluate(() => (window as unknown as { __soundStarts: number }).__soundStarts);
const soundFreqs = (page: Page) => page.evaluate(() => (window as unknown as { __soundFreqs: number[] }).__soundFreqs);

/** Make the agent ask a question by adding an open `question` tool call to the latest assistant message. */
async function askQuestion(app: ElectronApplication, dir: string, id: string, suffix = '') {
  await sql(app, dir, 'INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)', [`${id}-question${suffix}`, `${id}-assistant`, id, Date.now(), Date.now(),
    JSON.stringify({ type: 'tool', tool: 'question', state: {
      status: 'running', title: 'Which option?', input: { questions: [{ header: 'Scope', question: 'Which option should I use?' }] },
    } })]);
}

async function answerQuestion(app: ElectronApplication, dir: string, id: string, suffix = '') {
  await sql(app, dir, 'UPDATE part SET data = ? WHERE id = ?', [JSON.stringify({
    type: 'tool', tool: 'question', state: { status: 'completed', title: 'Which option?', input: { questions: [{ header: 'Scope' }] }, output: 'Keep it' },
  }), `${id}-question${suffix}`]);
}

test('plays a soft chime when an observed session finishes', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await installSoundSpy(page);
  await schema(app, dir);
  await seed(app, dir, 'live');
  await page.waitForTimeout(4000); // Let the background poll observe the working turn.
  await finish(app, dir, 'live');
  await expect.poll(() => soundFreqs(page), { timeout: 12000 }).toContain(659.25);
});

test('plays a chime when a session errors or is interrupted', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await installSoundSpy(page);
  await schema(app, dir);
  await seed(app, dir, 'boom');
  await page.waitForTimeout(4000);
  await finish(app, dir, 'boom', { error: true });
  await expect.poll(() => soundFreqs(page), { timeout: 12000 }).toContain(659.25);
});

test('plays a distinct chime when the agent asks a question', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await installSoundSpy(page);
  await schema(app, dir);
  await seed(app, dir, 'ask');
  await page.waitForTimeout(4000); // Let the poll observe the working turn first.
  await askQuestion(app, dir, 'ask');
  await expect.poll(() => soundFreqs(page), { timeout: 12000 }).toContain(523.25);
  await answerQuestion(app, dir, 'ask');
  await page.waitForTimeout(5000);
  expect((await soundFreqs(page)).filter(f => f === 523.25)).toHaveLength(1);
});

test('plays the chime when a tool waits for approval', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await installSoundSpy(page);
  await schema(app, dir);
  await seed(app, dir, 'perm');
  await page.waitForTimeout(4000); // Let the poll observe the working turn first.
  await sql(app, dir, 'INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)', ['perm-tool', 'perm-assistant', 'perm', Date.now(), Date.now(),
    JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'pending', input: { command: 'rm -rf build' } } })]);
  await expect.poll(() => soundFreqs(page), { timeout: 15000 }).toContain(523.25);
});

test('stays silent for sessions already finished before startup', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await installSoundSpy(page);
  await schema(app, dir);
  await seed(app, dir, 'old', { completed: true, finish: 'stop' });
  await page.waitForTimeout(7000);
  expect(await soundStarts(page)).toBe(0);
});

test('the sessions board hosts the sound toggle and it controls the chime', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await installSoundSpy(page);
  await schema(app, dir);
  await seed(app, dir, 'board');
  await page.locator('[data-tour-id="sessions"]').click();
  await expect(page.locator('.sessions-panel')).toBeVisible();
  const toggle = page.locator('.sessions-sound input[type="checkbox"]');
  await expect(toggle).toBeChecked();
  await expect(page.locator('.sessions-sound')).toContainText('Sound');
  await toggle.uncheck();
  await expect.poll(() => page.evaluate(async () => (await window.electronAPI.loadSettings()).sessionSoundEnabled)).toBe(false);
  await page.waitForTimeout(4000); // Observe the working turn while muted.
  await finish(app, dir, 'board');
  await page.waitForTimeout(5000);
  expect(await soundStarts(page)).toBe(0);
  await toggle.check();
  await expect.poll(() => page.evaluate(async () => (await window.electronAPI.loadSettings()).sessionSoundEnabled)).toBe(true);
});

test('sound can be disabled from Settings and the choice persists', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await installSoundSpy(page);
  await schema(app, dir);
  await seed(app, dir, 'quiet');
  await page.locator('[data-tour-id="settings"]').click();
  const toggle = page.locator('.settings-section').filter({ hasText: /Play a sound/i }).locator('input[type="checkbox"]');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.waitForTimeout(4000); // Observe the working turn while muted.
  await finish(app, dir, 'quiet');
  await page.waitForTimeout(5000);
  expect(await soundStarts(page)).toBe(0);
  expect(await page.evaluate(() => window.electronAPI.loadSettings())).toMatchObject({ sessionSoundEnabled: false });
  await toggle.check();
  await expect.poll(() => page.evaluate(async () => (await window.electronAPI.loadSettings()).sessionSoundEnabled)).toBe(true);
});
