import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const TEST_SCRIPT_PREFIX = 'pp-encoding-test-';

function getTempPath(filename: string): string {
  return path.join(os.tmpdir(), filename);
}

test.describe('PS1 encoding with BOM', () => {
  test('PS1 file written with BOM preserves accented characters', async () => {
    const id = Date.now().toString();
    const psPath = getTempPath(TEST_SCRIPT_PREFIX + id + '.ps1');

    const accentedDir = 'C:\\Users\\ÁlvaroSánchezFlores\\Desktop\\solución\\visión';
    const accentedModel = 'modelo-con-tildes-áéíóúñ';

    const script = [
      "Set-Location -LiteralPath '" + accentedDir.replace(/'/g, "''") + "'",
      "$args = @('--model', '" + accentedModel.replace(/'/g, "''") + "')",
      "Write-Host 'done'",
    ].join('\n');

    try {
      fs.writeFileSync(psPath, '\uFEFF' + script, 'utf-8');

      expect(fs.existsSync(psPath)).toBe(true);

      const bytes = fs.readFileSync(psPath);
      expect(bytes[0]).toBe(0xEF);
      expect(bytes[1]).toBe(0xBB);
      expect(bytes[2]).toBe(0xBF);

      const content = fs.readFileSync(psPath, 'utf-8');
      expect(content).toContain('ÁlvaroSánchezFlores');
      expect(content).toContain('solución');
      expect(content).toContain('visión');
      expect(content).toContain('modelo-con-tildes-áéíóúñ');
      expect(content).not.toContain('Ã');
    } finally {
      try { fs.unlinkSync(psPath); } catch { /* clean up */ }
    }
  });

  test('PS1 file without BOM would mangle accented characters when read as ANSI', async () => {
    const id = Date.now().toString();
    const psPath = getTempPath(TEST_SCRIPT_PREFIX + id + '-nobom.ps1');

    const accentedDir = 'C:\\Users\\ÁlvaroSánchezFlores\\Desktop\\solución\\visión';

    const script = [
      "Set-Location -LiteralPath '" + accentedDir.replace(/'/g, "''") + "'",
      "Write-Host 'done'",
    ].join('\n');

    try {
      fs.writeFileSync(psPath, script, 'utf-8');

      const bytes = fs.readFileSync(psPath);
      expect(bytes[0]).not.toBe(0xEF);

      const content = fs.readFileSync(psPath, 'utf-8');
      expect(content).toContain('ÁlvaroSánchezFlores');
      expect(content).toContain('solución');
      expect(content).toContain('visión');

      const buffer = fs.readFileSync(psPath);
      const latin1Content = buffer.toString('latin1');
      expect(latin1Content).toContain('Ã');
    } finally {
      try { fs.unlinkSync(psPath); } catch { /* clean up */ }
    }
  });

  function runPS1AndGetOutput(psPath: string): string {
    const { execFileSync } = require('child_process');
    const outPath = psPath.replace(/\.ps1$/, '-out.txt');
    const psCmd =
      `$ErrorActionPreference = 'Stop'\n` +
      `try { . '${psPath.replace(/'/g, "''")}' *>&1 | Out-File -LiteralPath '${outPath.replace(/'/g, "''")}' -Encoding UTF8 } ` +
      `catch { $_.Exception.Message | Out-File -LiteralPath '${outPath.replace(/'/g, "''")}' -Encoding UTF8 }`;
    const wrapperPath = psPath.replace(/\.ps1$/, '-wrap.ps1');
    try {
      fs.writeFileSync(wrapperPath, '\uFEFF' + psCmd, 'utf-8');
      try {
        execFileSync('powershell.exe', [
          '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapperPath,
        ], { timeout: 15000 });
      } catch { /* PowerShell may exit non-zero on Set-Location errors */ }
      if (fs.existsSync(outPath)) {
        return fs.readFileSync(outPath, 'utf-8').trim();
      }
      return '';
    } finally {
      try { fs.unlinkSync(wrapperPath); } catch { /* ok */ }
      try { fs.unlinkSync(outPath); } catch { /* ok */ }
    }
  }

  test('PS1 with BOM can be verified by PowerShell', async () => {
    if (process.platform !== 'win32') {
      test.skip();
      return;
    }

    const id = Date.now().toString();
    const psPath = getTempPath(TEST_SCRIPT_PREFIX + id + '.ps1');

    const accentedPath = 'C:\\Users\\Público\\Documentos\\información';

    const script = [
      "Write-Output 'Path: " + accentedPath.replace(/'/g, "''") + "'",
    ].join('\n');

    try {
      fs.writeFileSync(psPath, '\uFEFF' + script, 'utf-8');
      const output = runPS1AndGetOutput(psPath);

      expect(output).toContain('información');
      expect(output).not.toContain('informaciÃ³n');
      expect(output).not.toContain('Ã');
    } finally {
      try { fs.unlinkSync(psPath); } catch { /* clean up */ }
    }
  });

  test('all special Spanish characters survive BOM round-trip with PowerShell', async () => {
    if (process.platform !== 'win32') {
      test.skip();
      return;
    }

    const id = Date.now().toString();
    const psPath = getTempPath(TEST_SCRIPT_PREFIX + id + '.ps1');

    const specialChars = 'á é í ó ú ü ñ Á É Í Ó Ú Ü Ñ';
    const script = [
      "Write-Output '" + specialChars + "'",
    ].join('\n');

    try {
      fs.writeFileSync(psPath, '\uFEFF' + script, 'utf-8');
      const output = runPS1AndGetOutput(psPath);

      expect(output).toBe(specialChars);
    } finally {
      try { fs.unlinkSync(psPath); } catch { /* clean up */ }
    }
  });

  test('PS1 with BOM and accented Set-Location does not error on PowerShell parse', async () => {
    if (process.platform !== 'win32') {
      test.skip();
      return;
    }

    const id = Date.now().toString();
    const psPath = getTempPath(TEST_SCRIPT_PREFIX + id + '.ps1');

    const accentedDir = 'C:\\Users\\JoséMariño\\proyectos-código\\aplicación';

    const script = [
      "$dir = '" + accentedDir.replace(/'/g, "''") + "'",
      "Write-Output $dir",
    ].join('\n');

    try {
      fs.writeFileSync(psPath, '\uFEFF' + script, 'utf-8');
      const output = runPS1AndGetOutput(psPath);

      expect(output).toContain('JoséMariño');
      expect(output).toContain('proyectos-código');
      expect(output).toContain('aplicación');
      expect(output).not.toContain('Ã');
    } finally {
      try { fs.unlinkSync(psPath); } catch { /* clean up */ }
    }
  });

  test('BOM-PS1 round-trips the full script structure used by Prompt Pad', async () => {
    if (process.platform !== 'win32') {
      test.skip();
      return;
    }

    const id = Date.now().toString();
    const psPath = getTempPath(TEST_SCRIPT_PREFIX + id + '.ps1');

    const workDir = 'C:\\Users\\MáximoPérez\\Desktop\\solución-IA\\visiom';
    const model = 'opencode/deepseek-v4-pro';
    const message = 'Lee el archivo con tildes y caracteres especiales: áéíóúñ';

    const script = [
      "$workDir = '" + workDir.replace(/'/g, "''") + "'",
      "$model   = '" + model.replace(/'/g, "''") + "'",
      "$message = '" + message.replace(/'/g, "''") + "'",
      "Write-Output ('workDir=' + $workDir)",
      "Write-Output ('model='   + $model)",
      "Write-Output ('message=' + $message)",
    ].join('\n');

    try {
      fs.writeFileSync(psPath, '\uFEFF' + script, 'utf-8');
      const output = runPS1AndGetOutput(psPath);

      expect(output).toContain('workDir=C:\\Users\\MáximoPérez\\Desktop\\solución-IA\\visiom');
      expect(output).toContain('model=opencode/deepseek-v4-pro');
      expect(output).toContain('message=Lee el archivo con tildes y caracteres especiales: áéíóúñ');
      expect(output).not.toContain('Ã');
      expect(output).not.toContain('MÃ¡ximo');
      expect(output).not.toContain('PÃ©rez');
    } finally {
      try { fs.unlinkSync(psPath); } catch { /* clean up */ }
    }
  });
});
