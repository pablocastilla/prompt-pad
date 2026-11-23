import { test as base, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');

const test = base.extend<{ sandbox: { app: ElectronApplication; page: Page; dir: string } }>({
  sandbox: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-agy-'));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ language: 'en', theme: 'dark', useOneDrive: false }));
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
// in the tool steps or prompt payload. Fixtures are written through Electron's own better-sqlite3.
async function seedAntigravity(app: ElectronApplication, dir: string, conversations: Array<{
  id: string; title: string; ageMinutes: number; marked?: boolean; status?: string;
  payloadMarker?: boolean; parent?: string; agent?: string;
}>) {
  await app.evaluate(({}, { dir, conversations }) => {
    const require = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json');
    const Database = require('better-sqlite3');
    const path = require('path');
    const fs = require('fs');
    const db = new Database(path.join(dir, 'conversation_summaries.db'));
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS conversation_summaries (
          conversation_id text, title text NOT NULL DEFAULT "", preview text NOT NULL DEFAULT "",
          step_count integer NOT NULL DEFAULT 0, last_modified_time datetime NOT NULL,
          workspace_uris text NOT NULL, status text NOT NULL DEFAULT "", source text NOT NULL DEFAULT "",
          project_id text NOT NULL DEFAULT "", agent_name text NOT NULL DEFAULT "",
          parent_conversation_id text NOT NULL DEFAULT "", nesting_depth integer NOT NULL DEFAULT 0,
          not_fully_idle numeric NOT NULL DEFAULT false, killed numeric NOT NULL DEFAULT false);
      `);
      const convDir = path.join(dir, 'conversations');
      fs.mkdirSync(convDir, { recursive: true });
      for (const conversation of conversations) {
        // 7-digit fraction exactly like Antigravity writes it
        const stamp = new Date(Date.now() - conversation.ageMinutes * 60000).toISOString()
          .replace('T', ' ').replace(/(\.\d{3})Z/, '$1000+00:00');
        const status = conversation.status ?? (conversation.ageMinutes === 0 ? 'CASCADE_RUN_STATUS_RUNNING' : 'CASCADE_RUN_STATUS_IDLE');
        const notFullyIdle = status === 'CASCADE_RUN_STATUS_RUNNING' ? 1 : 0;
        db.prepare(`INSERT INTO conversation_summaries
          (conversation_id, title, preview, step_count, last_modified_time, workspace_uris, status, source, agent_name,
           parent_conversation_id, nesting_depth, not_fully_idle, killed)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(conversation.id, conversation.title, conversation.title, 3, stamp,
            JSON.stringify(['file:///c%3A/projects/demo']), status, '', conversation.agent || '',
            conversation.parent || '', conversation.parent ? 1 : 0, notFullyIdle, 0);
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
          } else if (conversation.payloadMarker) {
            const promptPayload = Buffer.from('Read the file at C:\\tmp\\pp-launch-2\\pp-prompt-2.txt as prompt', 'utf8');
            conv.prepare('INSERT INTO steps (idx, step_payload) VALUES (?, ?)').run(0, promptPayload);
          }
        } finally { conv.close(); }
      }
    } finally { db.close(); }
  }, { dir, conversations });
}

// Antigravity writes one JSON object per step to
// brain/<conversation>/.system_generated/logs/transcript.jsonl.
function writeTranscript(dir: string, id: string, entries: unknown[]) {
  const logDir = path.join(dir, 'brain', id, '.system_generated', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, 'transcript.jsonl'), entries.map(entry => JSON.stringify(entry)).join('\n'), 'utf8');
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

test('antigravity columns display console activity and tool events from transcript', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await seedAntigravity(app, dir, [{ id: 'agy-live', title: 'Activity session', ageMinutes: 5, marked: true }]);

  const logDir = path.join(dir, 'brain', 'agy-live', '.system_generated', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const transcriptLines = [
    JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'Fix the session activity display' }),
    JSON.stringify({
      step_index: 1,
      type: 'PLANNER_RESPONSE',
      content: '',
      tool_calls: [{ name: 'run_command', args: { CommandLine: 'git status', toolAction: 'Checking git status' } }],
    }),
    JSON.stringify({
      step_index: 2,
      type: 'GENERIC',
      status: 'DONE',
      content: 'Created At: 2026-01-01T00:00:00Z\nCompleted At: 2026-01-01T00:00:01Z\nThe command exited with code 0.\nOutput:\ngit status clean',
    }),
    JSON.stringify({
      step_index: 3,
      type: 'PLANNER_RESPONSE',
      content: 'Antigravity has finished analyzing the codebase.',
      tool_calls: [],
    }),
  ];
  fs.writeFileSync(path.join(logDir, 'transcript.jsonl'), transcriptLines.join('\n'), 'utf8');

  await open(page);
  await expect(column(page, 'agy-live')).toBeVisible({ timeout: 8000 });

  await expect(column(page, 'agy-live')).toContainText('Fix the session activity display');
  await expect(column(page, 'agy-live')).toContainText('run_command');
  await expect(column(page, 'agy-live')).toContainText('git status');
  await expect(column(page, 'agy-live')).toContainText('Antigravity has finished analyzing the codebase.');
  // The command that ran and its captured output are both shown.
  await expect(column(page, 'agy-live').locator('.session-event-command')).toHaveText('git status');
  await expect(column(page, 'agy-live').locator('.session-event-output')).toContainText('git status clean');
  await expect(column(page, 'agy-live').locator('.session-event-label').nth(0)).toContainText('You');
  await expect(column(page, 'agy-live').locator('.session-event-label').nth(1)).toContainText('run_command');
  await expect(column(page, 'agy-live').locator('.session-event-label').nth(2)).toContainText('Antigravity');
});

test('antigravity session actively running stays in working status beyond 90 seconds', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  // ageMinutes: 10 is well beyond the old 90s cutoff; with status CASCADE_RUN_STATUS_RUNNING it must remain working
  await seedAntigravity(app, dir, [
    { id: 'agy-long-run', title: 'Active long refactoring', ageMinutes: 10, marked: true, status: 'CASCADE_RUN_STATUS_RUNNING' },
    { id: 'agy-done-run', title: 'Quick finished task', ageMinutes: 1, marked: true, status: 'CASCADE_RUN_STATUS_IDLE' },
  ]);
  await open(page);
  await expect(column(page, 'agy-long-run')).toBeVisible({ timeout: 8000 });
  await expect(column(page, 'agy-long-run')).toHaveAttribute('data-status', 'working');
  await expect(column(page, 'agy-done-run')).toHaveAttribute('data-status', 'completed');
});

test('antigravity session detects prompt pad launch from step_payload at step 0', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  // Conversation only has step_payload in step 0, no metadata marker in step 2
  await seedAntigravity(app, dir, [
    { id: 'agy-step0', title: 'Early session', ageMinutes: 0, marked: false, payloadMarker: true, status: 'CASCADE_RUN_STATUS_RUNNING' },
  ]);
  await open(page);
  await expect(column(page, 'agy-step0')).toBeVisible({ timeout: 8000 });
  await expect(column(page, 'agy-step0')).toHaveAttribute('data-status', 'working');
});

test('antigravity user prompts drop machine metadata and show the model from the transcript', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await seedAntigravity(app, dir, [{ id: 'agy-prompt', title: 'Prompt cleanup', ageMinutes: 4, marked: true }]);
  writeTranscript(dir, 'agy-prompt', [
    {
      step_index: 0, type: 'USER_INPUT', status: 'DONE',
      content: '<USER_REQUEST>\nRead the file at C:\\tmp\\pp-launch-1\\pp-prompt-1.txt and treat its contents as my prompt. ' +
        'Summary of the file content: La tabla se desdobla en tres tablas\n</USER_REQUEST>\n' +
        '<ADDITIONAL_METADATA>\nThe current local time is: 2026-11-23T11:49:23+01:00.\n</ADDITIONAL_METADATA>\n' +
        '<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 4 Neon (High).\n</USER_SETTINGS_CHANGE>',
    },
    {
      step_index: 1, type: 'PLANNER_RESPONSE', status: 'DONE', model: 'gemini-4-neon-high',
      thinking: 'First read the file, then plan the migration.',
      content: 'Voy a revisar el repositorio antes de tocar nada.', tool_calls: [],
    },
    {
      step_index: 2, type: 'USER_INPUT', status: 'DONE',
      content: 'Continue with the migration\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-11-23T11:55:00+01:00.\n</ADDITIONAL_METADATA>',
    },
  ]);
  await open(page);
  const col = column(page, 'agy-prompt');
  await expect(col).toBeVisible({ timeout: 8000 });

  // Only what the user typed (here the Prompt Pad summary) reaches the board.
  await expect(col.locator('.session-event-role-user .session-event-text').first()).toHaveText('La tabla se desdobla en tres tablas');
  // Entries without the <USER_REQUEST> wrapper lose their metadata blocks too.
  await expect(col.locator('.session-event-role-user .session-event-text').nth(1)).toHaveText('Continue with the migration');
  await expect(col).not.toContainText('ADDITIONAL_METADATA');
  await expect(col).not.toContainText('The current local time');
  await expect(col).not.toContainText('USER_SETTINGS_CHANGE');
  // The assistant answer and the model come from the transcript, not agent_name.
  await expect(col).toContainText('Voy a revisar el repositorio antes de tocar nada.');
  await expect(col.locator('.session-model')).toHaveText('gemini-4-neon-high');
});

test('antigravity tool results drop repeated envelopes and long output starts folded', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await seedAntigravity(app, dir, [{ id: 'agy-output', title: 'Long output', ageMinutes: 5, marked: true }]);
  const longOutput = Array.from({ length: 40 }, (_, i) => `line ${i + 1} of the test run`).join('\n');
  writeTranscript(dir, 'agy-output', [
    { step_index: 0, type: 'USER_INPUT', content: '<USER_REQUEST>Run the suite</USER_REQUEST>' },
    { step_index: 1, type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'run_command', args: { CommandLine: '"pytest -q"', toolSummary: '"Run the tests"' } }] },
    {
      step_index: 2, type: 'GENERIC', status: 'DONE',
      content: 'Created At: 2026-11-23T11:49:26+01:00\nCompleted At: 2026-11-23T11:49:27+01:00\n' +
        'Created At: 2026-11-23T11:49:26+01:00\nCompleted At: 2026-11-23T11:49:27+01:00\n' +
        `Command exited with code 0.\n\nCommand output:\n${longOutput}`,
    },
    { step_index: 3, type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'run_command', args: { CommandLine: '"git status -s"' } }] },
    { step_index: 4, type: 'GENERIC', status: 'DONE', content: 'Created At: x\nCompleted At: y\n?? docs/new.md' },
  ]);
  await open(page);
  const col = column(page, 'agy-output');
  await expect(col).toBeVisible({ timeout: 8000 });

  await expect(col.locator('.session-event-command').first()).toHaveText('pytest -q');
  // The envelope never reaches the board, not even the duplicated pair.
  await expect(col).not.toContainText('Created At:');
  await expect(col).not.toContainText('Completed At:');
  // Two tool results exist: the long one is folded, the short one is inline.
  const output = col.locator('.session-event-output').first();
  await expect(output).toContainText('line 40 of the test run');
  await expect(output).toBeHidden();
  const fold = col.locator('.session-event-fold');
  await expect(fold).toHaveCount(1);
  await expect(fold).not.toHaveAttribute('open', '');
  await expect(fold.locator('summary')).toHaveText(/^Result · \d+ lines$/);
  await fold.locator('summary').click();
  await expect(output).toBeVisible();
  await expect(col.locator('.session-event-output')).toHaveCount(2);
});

test('antigravity reasoning is collapsed and the answer precedes its tool calls', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await seedAntigravity(app, dir, [{ id: 'agy-think', title: 'Reasoning', ageMinutes: 3, marked: true }]);
  writeTranscript(dir, 'agy-think', [
    { step_index: 0, type: 'USER_INPUT', content: '<USER_REQUEST>Analyze the code</USER_REQUEST>' },
    {
      step_index: 1, type: 'PLANNER_RESPONSE', thinking: 'The user wants a careful analysis of the repository.',
      content: 'Looking at the code now.', tool_calls: [{ name: 'read_file', args: { Path: 'C:\\repo\\a.py' } }],
    },
    { step_index: 2, type: 'GENERIC', status: 'DONE', content: 'Created At: x\nCompleted At: y\nprint("hello")' },
  ]);
  await open(page);
  const col = column(page, 'agy-think');
  await expect(col).toBeVisible({ timeout: 8000 });

  await expect(col.locator('.session-event-label').nth(0)).toContainText('You');
  await expect(col.locator('.session-event-label').nth(1)).toContainText('Antigravity');
  await expect(col.locator('.session-event-label').nth(2)).toContainText('read_file');
  await expect(col).toContainText('Looking at the code now.');

  const reasoning = col.locator('.session-event-reasoning');
  await expect(reasoning).toHaveCount(1);
  await expect(reasoning.locator('summary')).toHaveText('Reasoning');
  await expect(reasoning.locator('.session-event-text')).toBeHidden();
  await reasoning.locator('summary').click();
  await expect(reasoning.locator('.session-event-text')).toContainText('careful analysis of the repository');
});

test('antigravity subagent conversations join the board and link from the parent', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  const childId = 'ad068759-b00f-4046-81cf-65c2b7018d2b';
  await seedAntigravity(app, dir, [
    { id: 'agy-parent', title: 'Parent work', ageMinutes: 6, marked: true },
    { id: childId, title: '', ageMinutes: 5, parent: 'agy-parent', agent: 'pr-critic' },
  ]);
  writeTranscript(dir, 'agy-parent', [
    { step_index: 0, type: 'USER_INPUT', content: '<USER_REQUEST>Review the PR</USER_REQUEST>' },
    { step_index: 1, type: 'PLANNER_RESPONSE', content: 'Launching the reviewer now.', tool_calls: [{ name: 'invoke_subagent', args: { AgentName: 'pr-critic' } }] },
    {
      step_index: 2, type: 'INVOKE_SUBAGENT', status: 'DONE',
      content: 'Created At: x\nCompleted At: y\nCreated the following subagent:\n' +
        JSON.stringify({ conversationId: childId, logAbsoluteUri: `file:///C:/tmp/brain/${childId}` }),
    },
  ]);
  writeTranscript(dir, childId, [
    {
      step_index: 0, type: 'SYSTEM_MESSAGE', status: 'DONE',
      content: 'The following is a <SYSTEM_MESSAGE> not actually sent by the user. It is provided by the system as important information to pay attention to.\n\n' +
        '<SYSTEM_MESSAGE>\nAdversarially review PR #2109 and report findings.\n</SYSTEM_MESSAGE>',
    },
    { step_index: 1, type: 'PLANNER_RESPONSE', content: 'Verdict: BLOCK until the migration is tested.' },
  ]);
  await open(page);

  const child = column(page, childId);
  await expect(child).toBeVisible({ timeout: 8000 });
  await expect(child).toHaveAttribute('data-status', 'completed');
  await expect(child).toContainText('Sub-session');
  await expect(child).toContainText('pr-critic');
  // The subagent's own conversation: its task (cleaned) and its answer.
  await expect(child).toContainText('Adversarially review PR #2109 and report findings.');
  await expect(child).not.toContainText('not actually sent by the user');
  await expect(child).toContainText('Verdict: BLOCK until the migration is tested.');

  const parent = column(page, 'agy-parent');
  await expect(parent).toContainText('Launching the reviewer now.');
  const link = parent.locator('.session-subagent-link');
  await expect(link).toHaveAttribute('data-child-session', childId);
  await link.click();
  await expect(child).toHaveClass(/session-column-focus/);
});

test('antigravity keeps the original prompt when a long transcript is windowed', async ({ sandbox }) => {
  const { app, page, dir } = sandbox;
  await seedAntigravity(app, dir, [{ id: 'agy-long', title: 'Long run', ageMinutes: 8, marked: true }]);
  const entries: unknown[] = [
    { step_index: 0, type: 'USER_INPUT', content: '<USER_REQUEST>Migrate the measurements table</USER_REQUEST>' },
  ];
  for (let i = 1; i <= 250; i++) {
    entries.push({ step_index: i * 2 - 1, type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'run_command', args: { CommandLine: `"echo step ${i}"` } }] });
    entries.push({ step_index: i * 2, type: 'GENERIC', status: 'DONE', content: `Created At: x\nCompleted At: y\necho step ${i}` });
  }
  writeTranscript(dir, 'agy-long', entries);
  await open(page);
  const col = column(page, 'agy-long');
  await expect(col).toBeVisible({ timeout: 8000 });

  // The opening request survives the window, and the board stays bounded.
  await expect(col.locator('.session-event-role-user .session-event-text')).toHaveText('Migrate the measurements table');
  await expect(col).toContainText('echo step 250');
  const events = await col.locator('.session-event').count();
  expect(events).toBeLessThanOrEqual(80);
  expect(events).toBeGreaterThan(1);
});

test('the mobile page labels Antigravity messages, badges the source and folds results', async ({ sandbox }) => {
  const { app, dir } = sandbox;
  const started = await app.evaluate(async ({ BrowserWindow }, { modulePath, dbPath }) => {
    const require = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json');
    const { dirname } = require('path');
    const { RemoteSessionsServer } = require(modulePath);
    const { OpenCodeSessionMonitor } = require(dirname(modulePath) + '/opencodeSessions.js');
    const monitor = new OpenCodeSessionMonitor(() => dbPath, dirname(dbPath) + '/hidden.json');
    const server = new RemoteSessionsServer(monitor, undefined);
    const port = await server.start(0, '127.0.0.1');
    const win = new BrowserWindow({ show: false, width: 420, height: 820 });
    (globalThis as unknown as { __ppAgyWin: unknown; __ppAgyServer: unknown }).__ppAgyWin = win;
    (globalThis as unknown as { __ppAgyWin: unknown; __ppAgyServer: unknown }).__ppAgyServer = server;
    await win.loadURL(`http://127.0.0.1:${port}/?key=${server.accessToken}`);
    return { port };
  }, { modulePath: path.join(__dirname, '..', 'dist-electron', 'remoteServer.js'), dbPath: path.join(dir, 'opencode.db') });

  let mobile: Page | undefined;
  await expect.poll(() => {
    mobile = app.windows().find(candidate => candidate.url().includes(`127.0.0.1:${started.port}`));
    return !!mobile;
  }).toBe(true);
  await mobile!.waitForLoadState('domcontentloaded');

  await mobile!.evaluate(() => {
    const w = window as unknown as { eval: (code: string) => { sessions: unknown[] }; render: () => void };
    const state = w.eval('state');
    const longOutput = Array.from({ length: 24 }, (_, i) => `output line ${i + 1}`).join('\n');
    state.sessions = [{
      id: 'agy-phone', title: 'Phone conversation', directory: 'C:\\projects\\demo', model: 'gemini-4-neon-high',
      status: 'completed', updatedAt: Date.now(), createdAt: Date.now(), source: 'antigravity', permissions: [], questions: [],
      activity: [
        { id: 'p1', role: 'user', type: 'text', text: 'Hola', html: '<p>Hola</p>' },
        { id: 'p2', role: 'assistant', type: 'text', text: 'Pensando', html: '<p>Pensando</p>', reasoning: 'Internal thought', reasoningHtml: '<p>Internal thought</p>' },
        { id: 'p3', role: 'assistant', type: 'tool', tool: 'run_command', status: 'completed', input: 'pytest -q', output: longOutput },
      ],
    }];
    w.render();
  });

  const session = mobile!.locator('.session').first();
  await session.locator('.session-header').click();
  await expect(session.locator('.source-badge')).toHaveText('Antigravity');
  // Assistant messages carry the real product name, not "OpenCode".
  await expect(session.locator('.event-label').nth(1)).toHaveText('Antigravity');
  await expect(session).not.toContainText('OpenCode');

  const reasoning = session.locator('.event-reasoning');
  await expect(reasoning).toHaveCount(1);
  await expect(reasoning.locator('.event-text')).toBeHidden();
  await reasoning.locator('summary').click();
  await expect(reasoning.locator('.event-text')).toContainText('Internal thought');

  const fold = session.locator('.event-fold');
  await expect(fold).toHaveCount(1);
  await expect(fold.locator('summary')).toContainText('24 lines');
  await fold.locator('summary').click();
  await expect(session.locator('.event-output')).toContainText('output line 24');

  await app.evaluate(() => {
    const g = globalThis as unknown as { __ppAgyWin?: { destroy: () => void }; __ppAgyServer?: { stop: () => void } };
    g.__ppAgyWin?.destroy();
    g.__ppAgyServer?.stop();
  });
});


