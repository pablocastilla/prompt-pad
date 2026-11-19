import { test, expect } from '@playwright/test';
import {
  buildClaudeCodeShScript,
  buildClaudeCodeWinScript,
  buildCodexShScript,
  buildCodexWinScript,
} from '../electron/launcherScripts';
import {
  CLAUDE_CODE_MODELS,
  CODEX_MODELS,
  DEFAULT_CLAUDE_CODE_MODEL,
  DEFAULT_CODEX_MODEL,
  normalizeClaudeCodeModel,
  normalizeCodexModel,
} from '../electron/providerModels';

const base = {
  workDir: 'C:\\projects\\demo',
  message: 'Read the file at C:\\temp\\pp-prompt.txt and treat its contents as my prompt.',
  yolo: true,
  interactive: true,
  launchTmpDir: 'C:\\temp\\pp-launch',
};

test.describe('Claude Code launcher script', () => {
  test('passes the selected model and current permission mode', () => {
    const script = buildClaudeCodeWinScript({ ...base, model: 'sonnet' });

    expect(script).toContain("Set-Location -LiteralPath 'C:\\projects\\demo'");
    expect(script).toContain("$claudeArgs = @('--model', 'sonnet', '--permission-mode', 'bypassPermissions', 'Read the file at");
    expect(script).toContain('& claude @claudeArgs');
    expect(script).not.toContain('--full-auto');
  });

  test('omits --model when the CLI default is selected', () => {
    const script = buildClaudeCodeWinScript({ ...base, model: 'default' });
    expect(script).not.toContain('--model');
    expect(script).toContain("'--permission-mode', 'bypassPermissions'");
  });

  test('supports non-interactive print mode and safe yolo=false', () => {
    const script = buildClaudeCodeWinScript({
      ...base,
      model: 'haiku',
      yolo: false,
      interactive: false,
    });
    expect(script).toContain("'--print'");
    expect(script).not.toContain('bypassPermissions');
  });

  test('shell script uses the same current flags and quotes the prompt', () => {
    const script = buildClaudeCodeShScript({ ...base, model: 'opus' });
    expect(script).toContain('claude "--model" "opus" "--permission-mode" "bypassPermissions"');
    expect(script).toContain('Read the file at C:\\\\temp\\\\pp-prompt.txt');
  });

  test('escapes apostrophes in Windows scripts', () => {
    const script = buildClaudeCodeWinScript({
      ...base,
      model: 'sonnet',
      message: "Read Miguel's prompt file and follow it.",
    });
    expect(script).toContain("Miguel''s prompt");
  });
});

test.describe('Codex launcher script', () => {
  test('passes the selected model and the current yolo flag', () => {
    const script = buildCodexWinScript({ ...base, model: 'gpt-5.4' });

    expect(script).toContain("$codexArgs = @('--model', 'gpt-5.4', '--dangerously-bypass-approvals-and-sandbox'");
    expect(script).toContain('& codex @codexArgs');
    // --full-auto was removed from current Codex releases.
    expect(script).not.toContain('--full-auto');
  });

  test('omits --model when the CLI default is selected', () => {
    const script = buildCodexWinScript({ ...base, model: 'default' });
    expect(script).not.toContain('--model');
    expect(script).toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  test('uses the exec subcommand for non-interactive runs', () => {
    const script = buildCodexWinScript({
      ...base,
      model: 'gpt-5.4',
      yolo: false,
      interactive: false,
    });
    expect(script).toContain("$codexArgs = @('exec', '--model', 'gpt-5.4'");
    expect(script).not.toContain('dangerously-bypass');
  });

  test('shell script uses exec and the model flag', () => {
    const script = buildCodexShScript({
      ...base,
      model: 'gpt-5.4',
      interactive: false,
    });
    expect(script).toContain('codex "exec" "--model" "gpt-5.4"');
  });
});

test.describe('Claude/Codex model catalog normalization', () => {
  test('the curated catalogs include a default entry and stay non-empty', () => {
    expect(CLAUDE_CODE_MODELS[0]).toEqual({
      id: DEFAULT_CLAUDE_CODE_MODEL,
      label: 'Default (Claude Code setting)',
    });
    expect(CODEX_MODELS[0]).toEqual({
      id: DEFAULT_CODEX_MODEL,
      label: 'Default (Codex config)',
    });
    expect(CLAUDE_CODE_MODELS.length).toBeGreaterThan(4);
    expect(CODEX_MODELS.length).toBeGreaterThan(5);
  });

  test('valid model ids pass through and unsafe values fall back to default', () => {
    expect(normalizeClaudeCodeModel('sonnet')).toBe('sonnet');
    expect(normalizeClaudeCodeModel('claude-opus-5-5')).toBe('claude-opus-5-5');
    expect(normalizeClaudeCodeModel("sonnet' ; Remove-Item C:\\ -Recurse")).toBe(DEFAULT_CLAUDE_CODE_MODEL);
    expect(normalizeClaudeCodeModel('')).toBe(DEFAULT_CLAUDE_CODE_MODEL);
    expect(normalizeClaudeCodeModel(undefined)).toBe(DEFAULT_CLAUDE_CODE_MODEL);

    expect(normalizeCodexModel('gpt-6.2-sol')).toBe('gpt-6.2-sol');
    expect(normalizeCodexModel('default')).toBe(DEFAULT_CODEX_MODEL);
    expect(normalizeCodexModel('gpt-5.4 & calc.exe')).toBe(DEFAULT_CODEX_MODEL);
  });
});
