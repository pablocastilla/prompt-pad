import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');

const test = base.extend<{ sandbox: { app: ElectronApplication; page: Page; dir: string } }>({
  sandbox: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-agy-'));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ language: 'en', theme: 'dark', useOneDrive: true }));
    fs.writeFileSync(path.join(dir, 'phrases.json'), '[]');
    fs.writeFileSync(path.join(dir, 'launches.json'), '[]');
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

// Antigravity keeps a global summary database plus one SQLite database per
// conversation; Prompt Pad-launched conversations embed the pp-prompt marker
// in the tool steps. Fixtures are written through Electron's own better-sqlite3.
async function seedAntigravity(app: ElectronApplication, dir: string, conversations: Array<{
  id: string; title: string; ageMinutes: number; marked?: boolean;
}>) {
  await app.evaluate(({}, { dir, conversations }) => {
    const require = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json');
    const Database = require('better-sqlite3');
    const path = require('path');
    const fs = require('fs');
    const db = new Database(path.join(dir, 'conversation_summaries.db'));
    try {
      db.exec(`
        CREATE TABLE conversation_summaries (
          conversation_id text, title text NOT NULL DEFAULT "", preview text NOT NULL DEFAULT "",
          step_count integer NOT NULL DEFAULT 0, last_modified_time datetime NOT NULL,
          workspace_uris text NOT NULL, status text NOT NULL DEFAULT "", source text NOT NULL DEFAULT "",
          project_id text NOT NULL DEFAULT "", agent_name text NOT NULL DEFAULT "",
          parent_conversation_id text NOT NULL DEFAULT "", nesting_depth integer NOT NULL DEFAULT 0);
      `);
      const convDir = path.join(dir, 'conversations');
      fs.mkdirSync(convDir, { recursive: true });
      for (const conversation of conversations) {
        // 7-digit fraction exactly like Antigravity writes it
        const stamp = new Date(Date.now() - conversation.ageMinutes * 60000).toISOString()
          .replace('T', ' ').replace(/(\.\d{3})Z/, '$1000+00:00');
        db.prepare(`INSERT INTO conversation_summaries
          (conversation_id, title, preview, step_count, last_modified_time, workspace_uris, status, source, agent_name)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(conversation.id, conversation.title, conversation.title, 3, stamp,
            JSON.stringify(['file:///c%3A/projects/demo']), 'CASCADE_RUN_STATUS_IDLE', '', '');
        const conv = new Database(path.join(convDir, `${conversation.id}.db`));
        try {
          conv.exec(`
            CREATE TABLE trajectory_meta (trajectory_id text, cascade_id text, trajectory_type integer, source integer);
            CREATE TABLE steps (idx integer PRIMARY KEY, step_type integer NOT NULL DEFAULT 0, status integer NOT NULL DEFAULT 0,
              has_subtrajectory numeric NOT NULL DEFAULT false, metadata blob, error_details blob, permissions blob,
              task_details blob, render_info blob, step_payload blob, step_format integer NOT NULL DEFAULT 0);
            CREATE TABLE trajectory_metadata_blob (id text PRIMARY KEY, data blob);
          `);
          if (conversation.marked) {
            const marker = JSON.stringify({
              AbsolutePath: `C:\\tmp\\pp-launch-1\\pp-prompt-1.txt`,
              toolAction: 'Reading prompt file',
            });
            conv.prepare('INSERT INTO steps (idx, metadata) VALUES (?, ?)').run(2, Buffer.from(marker, 'utf8'));
          }
        } finally { conv.close(); }
      }
    } finally { db.close(); }
  }, { dir, conversations });
}

async function open(page: Page) {
  await page.locator('[data-tour-id="sessions"]').click();
  await expect(page.locator('.sessions-panel')).toBeVisible();
}

const column = (page: Page, id: string) => page.locator(`[data-session-id="${id}"]`);

test('antigravity conversations launched from Prompt Pad show in the sessions board', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await seedAntigravity(app, dir, [
    { id: 'agy-recent', title: 'Rendimiento cartera', ageMinutes: 12, marked: true },
    { id: 'agy-working', title: 'Long analysis', ageMinutes: 0, marked: true },
    { id: 'agy-ide', title: 'IDE conversation', ageMinutes: 5, marked: false },
    { id: 'agy-old', title: 'Yesterday run', ageMinutes: 25 * 60, marked: true },
  ]);
  await open(page);
  await expect(page.locator('.sessions-toolbar h2')).toHaveText(/Sessions/);
  await expect(column(page, 'agy-recent')).toBeVisible({ timeout: 8000 });
  await expect(column(page, 'agy-recent')).toHaveAttribute('data-status', 'completed');
  await expect(column(page, 'agy-recent')).toContainText('Antigravity');
  await expect(column(page, 'agy-recent')).toContainText('c:/projects/demo');
  await expect(column(page, 'agy-working')).toHaveAttribute('data-status', 'working');
  // Only Prompt Pad-launched conversations appear
  await expect(column(page, 'agy-ide')).toHaveCount(0);
  await expect(column(page, 'agy-old')).toHaveCount(0);
  await expect(page.locator('.session-source-badge')).toHaveCount(2);
  await expect(page.locator('.sessions-source')).toContainText('Antigravity ·');
});

test('antigravity columns can be hidden and restored independently of OpenCode', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await seedAntigravity(app, dir, [{ id: 'agy-hide', title: 'Hide me', ageMinutes: 2, marked: true }]);
  await open(page);
  await expect(column(page, 'agy-hide')).toBeVisible({ timeout: 8000 });
  await column(page, 'agy-hide').locator('.session-close').click();
  await expect(column(page, 'agy-hide')).toHaveCount(0);
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'antigravity-sessions-hidden.json'), 'utf8')))
    .toEqual({ 'agy-hide': 'agy-hide' });
  await page.getByRole('button', { name: 'Restore hidden (1)' }).click();
  await expect(column(page, 'agy-hide')).toBeVisible({ timeout: 8000 });
});

test('spanish board title is Sesiones', async ({ sandbox }) => {
  const { page } = sandbox;
  await page.locator('[data-tour-id="settings"]').click();
  await page.locator('.settings-panel select').first().selectOption('es');
  await open(page);
  await expect(page.locator('.sessions-toolbar h2')).toContainText('Sesiones');
});
