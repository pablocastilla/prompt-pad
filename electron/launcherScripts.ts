import * as path from 'path';

export function escapeSingleQuotePS(s: string): string {
  return s.replace(/'/g, "''");
}

// Build the Windows PowerShell script that launches OpenCode or OpenCode 2.
// OpenCode 2 is now the standard for both option 1 (cli: 'opencode') and
// option 6 (cli: 'opencode2'): the selected model is written to a temporary
// config file referenced by OPENCODE_CONFIG; --standalone runs a private
// session that reads that config and opens the interactive TUI with --prompt.
export function buildOpenCodeWinScript(opts: {
  cli: 'opencode' | 'opencode2';
  workDir: string; model: string; message: string;
  yolo: boolean; promptPath: string; launchTmpDir: string;
  serveAuthPath?: string; createPath?: string; sendPath?: string; title?: string;
}): string {
  const { cli, workDir, message, yolo, launchTmpDir } = opts;
  const safeDir    = escapeSingleQuotePS(workDir);
  const safeMsg    = escapeSingleQuotePS(message);
  const safeTmpDir = escapeSingleQuotePS(launchTmpDir);

  // npm installs .ps1/.cmd shims at the top level; the real exe lives deeper in
  // node_modules. PowerShell resolves `opencode` to the .ps1 first, so both
  // extension types must be handled when locating the real binary.
  // We check the standard package paths for @opencode/cli, @opencode-ai/cli and opencode-ai.
  const resolveLines = [
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

  const modelFile = path.join(launchTmpDir, 'pp-model.json');
  const modelConfig = "$env:OPENCODE_CONFIG = '" + escapeSingleQuotePS(modelFile) + "'";
  const ocArgs = "@('--standalone', '--prompt', '" + safeMsg + "'"
    + (yolo ? ", '--auto'" : '')
    + ")";
  return [
    "Set-Location -LiteralPath '" + safeDir + "'",
    ...resolveLines,
    modelConfig,
    "$ocArgs = " + ocArgs,
    "& $opencodePath @ocArgs",
    "Remove-Item -LiteralPath '" + safeTmpDir + "' -Recurse -Force -ErrorAction SilentlyContinue",
  ].join('\n');
}

// Build the Linux/macOS shell script that launches OpenCode or OpenCode 2.
// Uses the temporary config file + --standalone with interactive TUI prompt.
export function buildOpenCodeShScript(opts: {
  cli: 'opencode' | 'opencode2';
  workDir: string; model: string; message: string;
  yolo: boolean; promptPath: string; launchTmpDir: string;
  serveAuthPath?: string; createPath?: string; sendPath?: string;
}): string {
  const { cli, workDir, message, yolo, launchTmpDir } = opts;
  const posixTmpDir = launchTmpDir.replace(/\\/g, '/');
  const modelFile = path.posix.join(posixTmpDir, 'pp-model.json');
  const modelExport = 'export OPENCODE_CONFIG=' + JSON.stringify(modelFile);
  const launchLine = cli + ' --standalone --prompt ' + JSON.stringify(message) + (yolo ? ' --auto' : '');
  return [
    '#!/bin/bash',
    'cd ' + JSON.stringify(workDir.replace(/\\/g, '/')),
    modelExport,
    launchLine,
    'rm -rf ' + JSON.stringify(posixTmpDir),
    'rm -f "$0"',
  ].join('\n');
}
