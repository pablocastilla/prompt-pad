import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { removeTestDir } from './helpers';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');

function getTestDir(): string {
  const dir = path.join(os.tmpdir(), `pp-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveTestSettings(testDir: string) {
  fs.writeFileSync(path.join(testDir, 'settings.json'), JSON.stringify({
    theme: 'light',
    language: 'en',
    useOneDrive: false,
    phraseShortcutModifier: 'ctrl',
    launchShortcutModifier: 'ctrl+shift',
    openVsCodeShortcutModifier: 'ctrl+alt+shift',
  }, null, 2));
}

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function writeClaudeFixture(testDir: string, projectDir: string): string {
  const project = path.join(testDir, 'claude-projects', '-test-project');
  fs.mkdirSync(project, { recursive: true });
  const file = path.join(project, 'claude-session-1.jsonl');
  const lines = [
    {
      type: 'user', uuid: 'u1', parentUuid: null, timestamp: iso(-120000),
      sessionId: 'claude-session-1', cwd: projectDir, gitBranch: 'main',
      message: {
        role: 'user',
        content: `Read the file at C:\\temp\\pp-prompt-1.txt and treat its contents as my prompt. Summary of the file content: Add dark mode.`,
      },
    },
    {
      type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: iso(-110000),
      sessionId: 'claude-session-1', cwd: projectDir,
      message: {
        role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'tool_use',
        content: [
          { type: 'text', text: "I'll inspect the code." },
          { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'npm test' } },
        ],
      },
    },
    {
      type: 'user', uuid: 'u2', parentUuid: 'a1', timestamp: iso(-100000),
      sessionId: 'claude-session-1', cwd: projectDir,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: '12 passing', is_error: false }],
      },
    },
    {
      type: 'assistant', uuid: 'a2', parentUuid: 'u2', timestamp: iso(-90000),
      sessionId: 'claude-session-1', cwd: projectDir,
      message: {
        role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'All tests pass.' }],
      },
    },
  ];
  fs.writeFileSync(file, lines.map(line => JSON.stringify(line)).join('\n') + '\n', 'utf-8');
  return file;
}

function writeCodexFixture(testDir: string, projectDir: string): string {
  const day = path.join(testDir, 'codex-sessions', '2026', '11', '19');
  fs.mkdirSync(day, { recursive: true });
  const file = path.join(day, 'rollout-2026-11-19T10-00-00-codex-session-1.jsonl');
  const lines = [
    {
      timestamp: iso(-150000), type: 'session_meta',
      payload: {
        id: 'codex-session-1', timestamp: iso(-150000), cwd: projectDir,
        originator: 'codex_cli', cli_version: '0.159.0', model_provider: 'openai',
      },
    },
    {
      timestamp: iso(-140000), type: 'turn_context',
      payload: { cwd: projectDir, model: 'gpt-5.4', approval_policy: 'never' },
    },
    {
      timestamp: iso(-135000), type: 'response_item',
      payload: {
        type: 'message', role: 'user',
        content: [{ type: 'input_text', text: 'Read the file at C:\\temp\\pp-prompt-2.txt and treat its contents as my prompt. Summary of the file content: Fix the build.' }],
      },
    },
    {
      timestamp: iso(-130000), type: 'response_item',
      payload: {
        type: 'function_call', name: 'shell', call_id: 'call-1',
        arguments: JSON.stringify({ command: ['bash', '-lc', 'npm run build'] }),
      },
    },
    {
      timestamp: iso(-125000), type: 'response_item',
      payload: { type: 'function_call_output', call_id: 'call-1', output: 'build ok' },
    },
    {
      timestamp: iso(-120000), type: 'response_item',
      payload: {
        type: 'message', role: 'assistant',
        content: [{ type: 'output_text', text: 'Build fixed.' }],
      },
    },
    { timestamp: iso(-115000), type: 'event_msg', payload: { type: 'task_started' } },
    { timestamp: iso(-110000), type: 'event_msg', payload: { type: 'task_complete' } },
  ];
  fs.writeFileSync(file, lines.map(line => JSON.stringify(line)).join('\n') + '\n', 'utf-8');
  return file;
}

async function openSessions(page: import('@playwright/test').Page) {
  await page.locator('[data-tour-id="sessions"]').click();
  await expect(page.locator('.sessions-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
}

test.describe('Claude Code and Codex sessions on the board', () => {
  test('reads both transcript stores and renders messages, tools and badges', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      const projectDir = path.join(testDir, 'project');
      fs.mkdirSync(projectDir, { recursive: true });
      writeClaudeFixture(testDir, projectDir);
      writeCodexFixture(testDir, projectDir);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);
      await openSessions(page);

      const claude = page.locator('[data-session-id="claude-session-1"]');
      await expect(claude).toBeVisible({ timeout: 10000 });
      await expect(claude.locator('.session-source-badge')).toHaveText('Claude Code');
      await expect(claude.locator('.session-heading h3')).toHaveText('Add dark mode.');
      await expect(claude).toContainText("I'll inspect the code.");
      await expect(claude).toContainText('All tests pass.');
      await expect(claude.locator('.session-event-command')).toHaveText('npm test');
      await expect(claude.locator('.session-event-output')).toHaveText('12 passing');
      await expect(claude).toHaveAttribute('data-status', 'completed');

      const codex = page.locator('[data-session-id="codex-session-1"]');
      await expect(codex).toBeVisible({ timeout: 10000 });
      await expect(codex.locator('.session-source-badge')).toHaveText('Codex');
      await expect(codex.locator('.session-heading h3')).toHaveText('Fix the build.');
      await expect(codex).toContainText('Build fixed.');
      await expect(codex.locator('.session-event-command')).toHaveText('bash -lc npm run build');
      await expect(codex.locator('.session-event-output')).toHaveText('build ok');
      await expect(codex).toHaveAttribute('data-status', 'completed');

      const footer = page.locator('.sessions-source');
      await expect(footer).toContainText('Claude Code');
      await expect(footer).toContainText('claude-projects');
      await expect(footer).toContainText('Codex');
      await expect(footer).toContainText('codex-sessions');

      // OneDrive stays disabled and untouched in the sandbox.
      const settings = JSON.parse(fs.readFileSync(path.join(testDir, 'settings.json'), 'utf-8'));
      expect(settings.useOneDrive).toBe(false);

      await app.close();
    } finally {
      removeTestDir(testDir);
    }
  });

  test('a new transcript line appears after Refresh', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      const projectDir = path.join(testDir, 'project');
      fs.mkdirSync(projectDir, { recursive: true });
      const claudeFile = writeClaudeFixture(testDir, projectDir);
      writeCodexFixture(testDir, projectDir);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);
      await openSessions(page);

      const claude = page.locator('[data-session-id="claude-session-1"]');
      await expect(claude).toBeVisible({ timeout: 10000 });

      fs.appendFileSync(claudeFile, JSON.stringify({
        type: 'assistant', uuid: 'a3', parentUuid: 'a2', timestamp: iso(-1000),
        sessionId: 'claude-session-1', cwd: projectDir,
        message: {
          role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Follow-up answer arrived live.' }],
        },
      }) + '\n', 'utf-8');

      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(claude).toContainText('Follow-up answer arrived live.', { timeout: 10000 });

      await app.close();
    } finally {
      removeTestDir(testDir);
    }
  });

  test('columns can be dismissed and restored', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      const projectDir = path.join(testDir, 'project');
      fs.mkdirSync(projectDir, { recursive: true });
      writeClaudeFixture(testDir, projectDir);
      writeCodexFixture(testDir, projectDir);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);
      await openSessions(page);

      const claude = page.locator('[data-session-id="claude-session-1"]');
      await expect(claude).toBeVisible({ timeout: 10000 });
      await claude.locator('.session-close').click();
      await expect(claude).toHaveCount(0, { timeout: 10000 });

      const restore = page.getByRole('button', { name: /Restore hidden \(1\)/ });
      await expect(restore).toBeVisible({ timeout: 10000 });
      await restore.click();
      await expect(page.locator('[data-session-id="claude-session-1"]')).toBeVisible({ timeout: 10000 });

      await app.close();
    } finally {
      removeTestDir(testDir);
    }
  });
});
