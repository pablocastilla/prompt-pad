import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { startFakeOpenCode, type FakeOpenCodeServer, type FakeV2Form, type FakeV2Permission } from './fakeOpenCodeServer';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');
const SESSION_ID = 'ses_fake';

const form: FakeV2Form = {
  id: 'frm_1',
  sessionID: SESSION_ID,
  title: 'Storage choice',
  fields: [
    {
      key: 'db', type: 'string', title: 'Which database?', description: 'Pick one',
      options: [
        { value: 'pg', label: 'Postgres', description: 'Relational' },
        { value: 'mongo', label: 'Mongo', description: 'Document' },
      ],
      custom: true,
    },
    {
      key: 'extras', type: 'multiselect', title: 'Extras',
      options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }],
    },
  ],
};

const permission: FakeV2Permission = {
  id: 'per_1',
  sessionID: SESSION_ID,
  action: 'bash',
  resources: ['rm -rf build'],
  save: [],
};

/** Sessions sandbox pointed at a fake OpenCode 2 server (never OneDrive). */
const test = base.extend<{ sandbox: { app: ElectronApplication; page: Page; dir: string; fake: FakeOpenCodeServer } }>({
  sandbox: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-sessions-v2-api-'));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
      language: 'en', theme: 'dark', useOneDrive: false,
    }));
    const fake = await startFakeOpenCode({ flavor: 'v2', sessionID: SESSION_ID, forms: [form], permissions: [permission] });
    const app = await electron.launch({
      args: [MAIN_JS],
      env: {
        ...process.env,
        PROMPT_PAD_TEST_DIR: dir,
        PROMPT_PAD_OPENCODE_TEST_API: fake.url,
        PROMPT_PAD_DISABLE_SERVICE_START: '1',
      },
    });
    try {
      const page = await app.firstWindow();
      await expect(page.locator('.editor-textarea')).toBeVisible();
      await use({ app, page, dir, fake });
    } finally {
      await app.close().catch(() => {});
      await fake.close().catch(() => {});
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

async function seedWorkingSession(app: ElectronApplication, dir: string) {
  const now = Date.now();
  await sql(app, dir, `
    PRAGMA journal_mode = WAL;
    CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, parent_id TEXT,
      time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE TABLE session_v2 (id TEXT PRIMARY KEY, slug TEXT, title TEXT, directory TEXT, parent_id TEXT,
      agent TEXT, model TEXT, time_created INTEGER, time_updated INTEGER, time_idle INTEGER, time_archived INTEGER);
    CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, data TEXT, time_created INTEGER, seq INTEGER);
  `);
  await sql(app, dir,
    'INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [SESSION_ID, 'fake-session', 'Live v2 session', 'C:\\projects\\v2', null, 'build',
      JSON.stringify({ providerID: 'opencode', id: 'deepseek-v4.1-flash-free' }),
      now - 5_000, now, null, null]);
  await sql(app, dir, 'INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)', [
    SESSION_ID + '-user', SESSION_ID, 'user', JSON.stringify({ text: 'Write the release notes' }),
    now - 4_000, 1,
  ]);
  await sql(app, dir, 'INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)', [
    SESSION_ID + '-assistant', SESSION_ID, 'assistant', JSON.stringify({
      content: [{ type: 'text', text: 'Working on it.' }],
      model: { providerID: 'opencode', id: 'deepseek-v4.1-flash-free' },
    }),
    now - 1_000, 2,
  ]);
}

async function openBoard(page: Page) {
  await page.locator('[data-tour-id="sessions"]').click();
  await expect(page.locator('.sessions-panel')).toBeVisible();
}

test('the board sends and answers through the OpenCode 2 API', async ({ sandbox }) => {
  const { app, page, dir, fake } = sandbox;
  await seedWorkingSession(app, dir);
  await openBoard(page);

  const column = page.locator(`[data-session-id="${SESSION_ID}"]`);
  await expect(column).toBeVisible({ timeout: 15_000 });

  // Pending form + permission come from the session-scoped v2 endpoints.
  const question = column.locator('.session-interaction-question');
  await expect(question).toBeVisible({ timeout: 15_000 });
  const databaseQuestion = question.locator('.session-question').first();
  const extrasQuestion = question.locator('.session-question').nth(1);
  await expect(databaseQuestion.locator('.session-interaction-text')).toHaveText('Pick one');
  await expect(databaseQuestion.locator('.session-question-option')).toHaveCount(2);
  await expect(extrasQuestion.locator('.session-question-option')).toHaveCount(2);
  const permissionBlock = column.locator('.session-interaction-permission');
  await expect(permissionBlock).toBeVisible();
  await expect(permissionBlock.locator('.session-interaction-command')).toContainText('rm -rf build');

  // Send a board message: v2 prompt endpoint.
  await column.locator('.session-compose textarea').fill('please continue');
  await column.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => fake.last('POST', `/api/session/${SESSION_ID}/prompt`)?.body?.text).toBe('please continue');
  await expect(column.locator('.session-compose-note.ok')).toBeVisible();

  // Answer the form (option value + multiselect array).
  await databaseQuestion.locator('.session-question-option', { hasText: 'Postgres' }).click();
  await extrasQuestion.locator('.session-question-option', { hasText: 'Alpha' }).click();
  await question.getByRole('button', { name: 'Answer' }).click();
  await expect.poll(() => fake.last('POST', `/api/session/${SESSION_ID}/form/frm_1/reply`)?.body)
    .toEqual({ answer: { db: 'pg', extras: ['a'] } });

  // Reply to the permission request with the v2 decision body.
  await permissionBlock.getByRole('button', { name: 'Allow once' }).click();
  await expect.poll(() => fake.last('POST', `/api/session/${SESSION_ID}/permission/per_1/reply`)?.body)
    .toEqual({ decision: 'once' });
});

test('the sessions board keeps everything inside the sandbox directory', async ({ sandbox }) => {
  const { dir } = sandbox;
  expect(dir.startsWith(os.tmpdir())).toBe(true);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf-8'));
  expect(settings.useOneDrive).toBe(false);
});
