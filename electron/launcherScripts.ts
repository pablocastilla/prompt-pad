import * as path from 'path';

export function escapeSingleQuotePS(s: string): string {
  return s.replace(/'/g, "''");
}

interface OpenCodeScriptBase {
  cli: 'opencode';
  workDir: string;
  yolo: boolean;
  launchTmpDir: string;
}

// Shared-server launch: Prompt Pad already created the session and delivered the
// prompt through the OpenCode API, so the terminal only attaches to that exact
// session. On OpenCode 2 the session lives on the background service and is
// opened with `--session`; OpenCode 1 attaches to the HTTP server with `attach`.
export interface OpenCodeAttachScriptOptions extends OpenCodeScriptBase {
  sessionId: string;
  // OpenCode 1 only: the shared server URL and optional Basic-Auth password.
  serverUrl?: string;
  password?: string;
}

// Standalone fallback (no API server available): the model travels in a
// temporary config file referenced by OPENCODE_CONFIG and the prompt is passed
// on the command line to a private TUI server.
export interface OpenCodeStandaloneScriptOptions extends OpenCodeScriptBase {
  model: string;
  message: string;
  promptPath: string;
  serveAuthPath?: string;
  createPath?: string;
  sendPath?: string;
  title?: string;
}

export type OpenCodeScriptOptions = OpenCodeAttachScriptOptions | OpenCodeStandaloneScriptOptions;

function isAttach(options: OpenCodeScriptOptions): options is OpenCodeAttachScriptOptions {
  return typeof (options as OpenCodeAttachScriptOptions).sessionId === 'string' &&
    (options as OpenCodeAttachScriptOptions).sessionId.length > 0;
}

// npm installs .ps1/.cmd shims at the top level; the real exe lives deeper in
// node_modules. PowerShell resolves `opencode` to the .ps1 first, so both
// extension types must be handled when locating the real binary.
// We check the standard package paths for @opencode/cli, @opencode-ai/cli and opencode-ai.
function resolveExecutableLines(cli: 'opencode'): string[] {
  return [
    "$opencodePath = (Get-Command " + cli + ".exe -ErrorAction SilentlyContinue).Source",
    "if (-not $opencodePath) {",
    "  $opencodeCommand = Get-Command " + cli + " -ErrorAction SilentlyContinue",
    "  if ($opencodeCommand) {",
    "    $shimSource = @($opencodeCommand)[0].Source",
    "    if ($shimSource -like '*.cmd' -or $shimSource -like '*.ps1') {",
    "      $bootstrapDir = Split-Path $shimSource -Parent",
    "      $candidates = @(",
    "        Join-Path $bootstrapDir ('node_modules\\@opencode\\cli\\bin\\' + '" + cli + ".exe'),",
    "        Join-Path $bootstrapDir ('node_modules\\@opencode-ai\\cli\\bin\\' + '" + cli + ".exe'),",
    "        Join-Path $bootstrapDir ('node_modules\\opencode-ai\\bin\\' + '" + cli + ".exe')",
    "      )",
    "      $found = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1",
    "      if ($found) {",
    "        $opencodePath = $found",
    "      } else {",
    "        $opencodePath = $shimSource",
    "      }",
    "    } else {",
    "      $opencodePath = $shimSource",
    "    }",
    "  } else {",
    "    $opencodePath = '" + cli + "'",
    "  }",
    "}",
  ];
}

// Build the Windows PowerShell script that launches OpenCode.
export function buildOpenCodeWinScript(opts: OpenCodeScriptOptions): string {
  const { cli, workDir, yolo, launchTmpDir } = opts;
  const safeDir    = escapeSingleQuotePS(workDir);
  const safeTmpDir = escapeSingleQuotePS(launchTmpDir);

  if (isAttach(opts)) {
    const safeSession = escapeSingleQuotePS(opts.sessionId);
    if (opts.serverUrl) {
      // OpenCode 1: attach to the shared HTTP server. `attach` does not accept
      // --auto (that flag belongs to run/prompt), so approvals stay in the TUI.
      const safeUrl = escapeSingleQuotePS(opts.serverUrl);
      const passwordArg = opts.password ? ", '-p', '" + escapeSingleQuotePS(opts.password) + "'" : '';
      return [
        "Set-Location -LiteralPath '" + safeDir + "'",
        ...resolveExecutableLines(cli),
        "$ocArgs = @('attach', '" + safeUrl + "', '-s', '" + safeSession + "'" + passwordArg + ")",
        "& $opencodePath @ocArgs",
        "Remove-Item -LiteralPath '" + safeTmpDir + "' -Recurse -Force -ErrorAction SilentlyContinue",
      ].join('\n');
    }
    return [
      "Set-Location -LiteralPath '" + safeDir + "'",
      ...resolveExecutableLines(cli),
      "$ocArgs = @('--session', '" + safeSession + "'" + (yolo ? ", '--auto'" : '') + ")",
      "& $opencodePath @ocArgs",
      "Remove-Item -LiteralPath '" + safeTmpDir + "' -Recurse -Force -ErrorAction SilentlyContinue",
    ].join('\n');
  }

  const safeMsg = escapeSingleQuotePS(opts.message);
  const modelFile = path.join(launchTmpDir, 'pp-model.json');
  const modelConfig = "$env:OPENCODE_CONFIG = '" + escapeSingleQuotePS(modelFile) + "'";
  const ocArgs = "@('--standalone', '--prompt', '" + safeMsg + "'"
    + (yolo ? ", '--auto'" : '')
    + ")";
  return [
    "Set-Location -LiteralPath '" + safeDir + "'",
    ...resolveExecutableLines(cli),
    modelConfig,
    "$ocArgs = " + ocArgs,
    "& $opencodePath @ocArgs",
    "Remove-Item -LiteralPath '" + safeTmpDir + "' -Recurse -Force -ErrorAction SilentlyContinue",
  ].join('\n');
}

// Build the Linux/macOS shell script that launches OpenCode.
export function buildOpenCodeShScript(opts: OpenCodeScriptOptions): string {
  const { cli, workDir, yolo, launchTmpDir } = opts;
  const posixTmpDir = launchTmpDir.replace(/\\/g, '/');
  if (isAttach(opts)) {
    if (opts.serverUrl) {
      const passwordArg = opts.password ? ' -p ' + JSON.stringify(opts.password) : '';
      const launchLine = cli + ' attach ' + JSON.stringify(opts.serverUrl) +
        ' -s ' + JSON.stringify(opts.sessionId) + passwordArg;
      return [
        '#!/bin/bash',
        'cd ' + JSON.stringify(workDir.replace(/\\/g, '/')),
        launchLine,
        'rm -rf ' + JSON.stringify(posixTmpDir),
        'rm -f "$0"',
      ].join('\n');
    }
    const launchLine = cli + ' --session ' + JSON.stringify(opts.sessionId) + (yolo ? ' --auto' : '');
    return [
      '#!/bin/bash',
      'cd ' + JSON.stringify(workDir.replace(/\\/g, '/')),
      launchLine,
      'rm -rf ' + JSON.stringify(posixTmpDir),
      'rm -f "$0"',
    ].join('\n');
  }

  const modelFile = path.posix.join(posixTmpDir, 'pp-model.json');
  const modelExport = 'export OPENCODE_CONFIG=' + JSON.stringify(modelFile);
  const launchLine = cli + ' --standalone --prompt ' + JSON.stringify(opts.message) + (yolo ? ' --auto' : '');
  return [
    '#!/bin/bash',
    'cd ' + JSON.stringify(workDir.replace(/\\/g, '/')),
    modelExport,
    launchLine,
    'rm -rf ' + JSON.stringify(posixTmpDir),
    'rm -f "$0"',
  ].join('\n');
}

// ── Claude Code ──────────────────────────────────────────────────────────────
// Current CLI (Claude Code 2.x): `claude [--model <alias|id>] [--permission-mode
// bypassPermissions] [--print] "<prompt>"`. `--dangerously-skip-permissions` is
// still accepted as an equivalent of `bypassPermissions`, but the explicit
// permission mode is the supported spelling and works on both current and
// recent versions. The prompt is passed as the trailing positional argument;
// the seed message is quote-free and the whole prompt lives in a temp file.
export interface ClaudeCodeScriptOptions {
  workDir: string;
  model: string;
  message: string;
  yolo: boolean;
  interactive: boolean;
  launchTmpDir: string;
}

function claudeCodeArgs(opts: ClaudeCodeScriptOptions): string[] {
  const args: string[] = [];
  if (opts.model && opts.model !== 'default') args.push('--model', opts.model);
  if (opts.yolo) args.push('--permission-mode', 'bypassPermissions');
  if (!opts.interactive) args.push('--print');
  args.push(opts.message);
  return args;
}

export function buildClaudeCodeWinScript(opts: ClaudeCodeScriptOptions): string {
  const safeDir = escapeSingleQuotePS(opts.workDir);
  const safeTmpDir = escapeSingleQuotePS(opts.launchTmpDir);
  const args = claudeCodeArgs(opts)
    .map(arg => "'" + escapeSingleQuotePS(arg) + "'")
    .join(', ');
  return [
    "Set-Location -LiteralPath '" + safeDir + "'",
    '$claudeArgs = @(' + args + ')',
    '& claude @claudeArgs',
    "Remove-Item -LiteralPath '" + safeTmpDir + "' -Recurse -Force -ErrorAction SilentlyContinue",
  ].join('\n');
}

export function buildClaudeCodeShScript(opts: ClaudeCodeScriptOptions): string {
  const launchLine = ['claude', ...claudeCodeArgs(opts).map(arg => JSON.stringify(arg))].join(' ');
  return [
    '#!/bin/bash',
    'cd ' + JSON.stringify(opts.workDir.replace(/\\/g, '/')),
    launchLine,
    'rm -rf ' + JSON.stringify(opts.launchTmpDir.replace(/\\/g, '/')),
    'rm -f "$0"',
  ].join('\n');
}

// ── OpenAI Codex ─────────────────────────────────────────────────────────────
// Current CLI (Codex 0.14x+): `codex [exec] [-m <model>] [--yolo] "<prompt>"`.
// `--full-auto` was removed in 0.147.0, so Prompt Pad uses the long
// `--dangerously-bypass-approvals-and-sandbox` spelling (alias `--yolo`), which
// still exists in current releases. `exec` is the non-interactive mode.
export interface CodexScriptOptions {
  workDir: string;
  model: string;
  message: string;
  yolo: boolean;
  interactive: boolean;
  launchTmpDir: string;
}

function codexArgs(opts: CodexScriptOptions): string[] {
  const args: string[] = [];
  if (!opts.interactive) args.push('exec');
  if (opts.model && opts.model !== 'default') args.push('--model', opts.model);
  if (opts.yolo) args.push('--dangerously-bypass-approvals-and-sandbox');
  args.push(opts.message);
  return args;
}

export function buildCodexWinScript(opts: CodexScriptOptions): string {
  const safeDir = escapeSingleQuotePS(opts.workDir);
  const safeTmpDir = escapeSingleQuotePS(opts.launchTmpDir);
  const args = codexArgs(opts)
    .map(arg => "'" + escapeSingleQuotePS(arg) + "'")
    .join(', ');
  return [
    "Set-Location -LiteralPath '" + safeDir + "'",
    '$codexArgs = @(' + args + ')',
    '& codex @codexArgs',
    "Remove-Item -LiteralPath '" + safeTmpDir + "' -Recurse -Force -ErrorAction SilentlyContinue",
  ].join('\n');
}

export function buildCodexShScript(opts: CodexScriptOptions): string {
  const launchLine = ['codex', ...codexArgs(opts).map(arg => JSON.stringify(arg))].join(' ');
  return [
    '#!/bin/bash',
    'cd ' + JSON.stringify(opts.workDir.replace(/\\/g, '/')),
    launchLine,
    'rm -rf ' + JSON.stringify(opts.launchTmpDir.replace(/\\/g, '/')),
    'rm -f "$0"',
  ].join('\n');
}
