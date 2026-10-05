import * as path from 'path';

export function escapeSingleQuotePS(s: string): string {
  return s.replace(/'/g, "''");
}

// Build the Windows PowerShell script that launches OpenCode or OpenCode 2.
// OpenCode 1 now starts (or reuses) the shared headless server, delivers the
// prompt through its HTTP API and opens the TUI attached to that same session —
// so prompts fired from the phone continue the exact session the user watches.
// OpenCode 2 (preview) keeps its own flow: no top-level `--model` and its beta
// ignores OPENCODE_CONFIG_CONTENT, so the model is written to a temporary
// config file pointed at by OPENCODE_CONFIG; --standalone forces a private
// server that reads that config (the shared background service would ignore it).
export function buildOpenCodeWinScript(opts: {
  cli: 'opencode' | 'opencode2';
  workDir: string; model: string; message: string;
  yolo: boolean; promptPath: string; launchTmpDir: string;
  serveAuthPath: string; createPath: string; sendPath: string; title: string;
}): string {
  const { cli, workDir, model, message, yolo, launchTmpDir, serveAuthPath, createPath, sendPath } = opts;
  const safeDir    = escapeSingleQuotePS(workDir);
  const safeMsg    = escapeSingleQuotePS(message);
  const safeTmpDir = escapeSingleQuotePS(launchTmpDir);
  const bootstrapRelPath = cli === 'opencode2'
    ? 'node_modules\\@opencode-ai\\cli\\bin\\opencode2.exe'
    : 'node_modules\\opencode-ai\\bin\\opencode.exe';

  // npm installs .ps1/.cmd shims at the top level; the real exe lives deeper in
  // node_modules. PowerShell resolves `opencode` to the .ps1 first, so both
  // extension types must be handled when locating the real binary.
  const resolveLines = [
    "$opencodePath = (Get-Command " + cli + ".exe -ErrorAction SilentlyContinue).Source",
    "if (-not $opencodePath) {",
    "  $opencodeCommand = Get-Command " + cli + " -ErrorAction SilentlyContinue",
    "  if ($opencodeCommand) {",
    "    $shimSource = @($opencodeCommand)[0].Source",
    "    if ($shimSource -like '*.cmd' -or $shimSource -like '*.ps1') {",
    "      $bootstrapDir = Split-Path $shimSource -Parent",
    "      $opencodePath = Join-Path $bootstrapDir '" + bootstrapRelPath + "'",
    "      if (-not (Test-Path $opencodePath)) {",
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

  if (cli === 'opencode2') {
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

  const safeAuth   = escapeSingleQuotePS(serveAuthPath);
  const safeCreate = escapeSingleQuotePS(createPath);
  const safeSend   = escapeSingleQuotePS(sendPath);
  return [
    "Set-Location -LiteralPath '" + safeDir + "'",
    ...resolveLines,
    "$authFile = '" + safeAuth + "'",
    "$port = 0",
    "$pw = ''",
    "if (Test-Path -LiteralPath $authFile) {",
    "  try {",
    "    $auth = Get-Content -LiteralPath $authFile -Raw -Encoding UTF8 | ConvertFrom-Json",
    "    $bytes = [Text.Encoding]::UTF8.GetBytes('opencode:' + $auth.password)",
    "    $basic = 'Basic ' + [Convert]::ToBase64String($bytes)",
    "    $r = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $auth.port + '/session') -Headers @{ Authorization = $basic } -UseBasicParsing -TimeoutSec 3",
    "    if ($r.StatusCode -eq 200) { $port = $auth.port; $pw = $auth.password }",
    "  } catch {}",
    "}",
    "if ($port -eq 0) {",
    "  try {",
    "    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:4096/session' -UseBasicParsing -TimeoutSec 2",
    "    if ($r.StatusCode -eq 200) { $port = 4096; $pw = '' }",
    "  } catch {}",
    "}",
    "if ($port -eq 0) {",
    "  $pw = [guid]::NewGuid().ToString('n')",
    "  $env:OPENCODE_SERVER_PASSWORD = $pw",
    "  $serveOut = Join-Path $env:TEMP ('pp-serve-out-' + [guid]::NewGuid().ToString('n') + '.txt')",
    "  Start-Process -FilePath $opencodePath -ArgumentList @('serve', '--port', '0', '--hostname', '127.0.0.1') -NoNewWindow -RedirectStandardOutput $serveOut",
    "  $up = $false",
    "  for ($i = 0; $i -lt 120; $i++) {",
    "    $txt = Get-Content -LiteralPath $serveOut -Raw -Encoding UTF8 -ErrorAction SilentlyContinue",
    "    if ($txt -match 'listening on http://127\\.0\\.0\\.1:(\\d+)') { $port = [int]$Matches[1]; $up = $true; break }",
    "    Start-Sleep -Milliseconds 500",
    "  }",
    "  if (-not $up) { throw 'OpenCode server did not start' }",
    "  (@{ port = $port; username = 'opencode'; password = $pw } | ConvertTo-Json) | Set-Content -LiteralPath $authFile -Encoding UTF8",
    "}",
    "$env:OPENCODE_SERVER_PASSWORD = $pw",
    "$hdr = @{}",
    "if ($pw) {",
    "  $bytes = [Text.Encoding]::UTF8.GetBytes('opencode:' + $pw)",
    "  $hdr.Authorization = 'Basic ' + [Convert]::ToBase64String($bytes)",
    "}",
    "$dirEnc = [uri]::EscapeDataString((Get-Location).Path)",
    "$createResp = Invoke-WebRequest -Method Post -Uri ('http://127.0.0.1:' + $port + '/session?directory=' + $dirEnc) -Headers $hdr -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes((Get-Content -LiteralPath '" + safeCreate + "' -Raw -Encoding UTF8))) -UseBasicParsing",
    "$sid = ($createResp.Content | ConvertFrom-Json).id",
    "if (-not $sid) { throw 'OpenCode session creation failed' }",
    "$partsBody = Get-Content -LiteralPath '" + safeSend + "' -Raw -Encoding UTF8",
    "Invoke-WebRequest -Method Post -Uri ('http://127.0.0.1:' + $port + '/session/' + $sid + '/prompt_async?directory=' + $dirEnc) -Headers $hdr -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($partsBody)) -UseBasicParsing | Out-Null",
    "$attachArgs = @('attach', ('http://127.0.0.1:' + $port), '-s', $sid)",
    "if ($pw) { $attachArgs += @('-p', $pw) }",
    "& $opencodePath @attachArgs",
    "Remove-Item -LiteralPath '" + safeTmpDir + "' -Recurse -Force -ErrorAction SilentlyContinue",
  ].join('\n');
}

// Build the Linux/macOS shell script that launches OpenCode or OpenCode 2.
// OpenCode 1 uses the shared headless server + attached TUI (same flow as the
// Windows script); OpenCode 2 keeps the temporary config file + --standalone.
export function buildOpenCodeShScript(opts: {
  cli: 'opencode' | 'opencode2';
  workDir: string; model: string; message: string;
  yolo: boolean; promptPath: string; launchTmpDir: string;
  serveAuthPath: string; createPath: string; sendPath: string;
}): string {
  const { cli, workDir, message, yolo, launchTmpDir, serveAuthPath, createPath, sendPath } = opts;
  if (cli === 'opencode2') {
    const modelFile = path.join(launchTmpDir, 'pp-model.json');
    const modelExport = 'export OPENCODE_CONFIG=' + JSON.stringify(modelFile);
    const launchLine = cli + ' --standalone --prompt ' + JSON.stringify(message) + (yolo ? ' --auto' : '');
    return [
      '#!/bin/bash',
      'cd ' + JSON.stringify(workDir),
      modelExport,
      launchLine,
      'rm -rf ' + JSON.stringify(launchTmpDir),
      'rm -f "$0"',
    ].join('\n');
  }
  return [
    '#!/bin/bash',
    'cd ' + JSON.stringify(workDir),
    'AUTH_FILE=' + JSON.stringify(serveAuthPath),
    'PORT=0',
    'PW=""',
    'if [ -f "$AUTH_FILE" ]; then',
    '  PW=$(sed -n \'s/.*"password": "\\([^"]*\\)".*/\\1/p\' "$AUTH_FILE" | head -n 1)',
    '  PORT=$(sed -n \'s/.*"port": \\([0-9]*\\).*/\\1/p\' "$AUTH_FILE" | head -n 1)',
    '  if [ -n "$PW" ] && [ -n "$PORT" ]; then',
    '    CODE=$(curl -s -o /dev/null -w \'%{http_code}\' -u "opencode:$PW" --max-time 3 "http://127.0.0.1:$PORT/session" 2>/dev/null)',
    '    if [ "$CODE" = "200" ]; then',
    '      PORT=$PORT',
    '    else',
    '      PORT=0',
    '    fi',
    '  fi',
    'fi',
    'if [ "$PORT" = "0" ]; then',
    '  CODE=$(curl -s -o /dev/null -w \'%{http_code}\' --max-time 2 "http://127.0.0.1:4096/session" 2>/dev/null)',
    '  if [ "$CODE" = "200" ]; then',
    '    PORT=4096',
    '    PW=""',
    '  fi',
    'fi',
    'if [ "$PORT" = "0" ]; then',
    '  PW=$(head -c 16 /dev/urandom | xxd -p 2>/dev/null || openssl rand -hex 16 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(16))")',
    '  export OPENCODE_SERVER_PASSWORD="$PW"',
    '  LOG=$(mktemp)',
    '  opencode serve --port 0 --hostname 127.0.0.1 > "$LOG" 2>&1 &',
    '  for i in $(seq 1 120); do',
    '    PORT=$(grep -oE "listening on http://127\\.0\\.0\\.1:[0-9]+" "$LOG" | head -n 1 | grep -oE "[0-9]+$" || true)',
    '    if [ -n "$PORT" ]; then break; fi',
    '    sleep 0.5',
    '  done',
    '  rm -f "$LOG"',
    '  if [ -z "$PORT" ]; then echo "OpenCode server did not start" >&2; exit 1; fi',
    '  printf \'{"port":%d,"username":"opencode","password":"%s"}\\n\' "$PORT" "$PW" > "$AUTH_FILE"',
    'fi',
    'export OPENCODE_SERVER_PASSWORD="$PW"',
    'AUTH_HDR=""',
    'if [ -n "$PW" ]; then',
    '  AUTH_HDR="Authorization: Basic $(printf "opencode:%s" "$PW" | base64)"',
    'fi',
    'DIR_ENC=$(python3 -c "import urllib.parse, os; print(urllib.parse.quote(os.getcwd(), safe=\'\'))" 2>/dev/null || node -e "console.log(encodeURIComponent(process.cwd()))" 2>/dev/null || pwd)',
    'if [ -n "$AUTH_HDR" ]; then',
    '  SID=$(curl -s -X POST "http://127.0.0.1:$PORT/session?directory=$DIR_ENC" -H "Content-Type: application/json" -H "$AUTH_HDR" -d @"' + createPath + '" | grep -oE \'"id":"[^"]+"\' | head -n 1 | cut -d\'"\' -f4)',
    'else',
    '  SID=$(curl -s -X POST "http://127.0.0.1:$PORT/session?directory=$DIR_ENC" -H "Content-Type: application/json" -d @"' + createPath + '" | grep -oE \'"id":"[^"]+"\' | head -n 1 | cut -d\'"\' -f4)',
    'fi',
    'if [ -z "$SID" ]; then echo "OpenCode session creation failed" >&2; exit 1; fi',
    'if [ -n "$AUTH_HDR" ]; then',
    '  curl -s -X POST "http://127.0.0.1:$PORT/session/$SID/prompt_async?directory=$DIR_ENC" -H "Content-Type: application/json" -H "$AUTH_HDR" -d @"' + sendPath + '" >/dev/null',
    'else',
    '  curl -s -X POST "http://127.0.0.1:$PORT/session/$SID/prompt_async?directory=$DIR_ENC" -H "Content-Type: application/json" -d @"' + sendPath + '" >/dev/null',
    'fi',
    'if [ -n "$PW" ]; then',
    '  ' + cli + ' attach "http://127.0.0.1:$PORT" -s "$SID" -p "$PW"',
    'else',
    '  ' + cli + ' attach "http://127.0.0.1:$PORT" -s "$SID"',
    'fi',
    'rm -rf ' + JSON.stringify(launchTmpDir),
    'rm -f "$0"',
  ].join('\n');
}
