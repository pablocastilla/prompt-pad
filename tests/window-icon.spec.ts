import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'child_process';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');
const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const PACKAGED_WINDOWS_EXE = path.join(__dirname, '..', 'release', 'win-unpacked', 'Prompt-Pad.exe');

interface WindowsVersionInfo {
  FileDescription: string;
  ProductName: string;
  OriginalFilename: string;
  InternalName: string;
  FileVersion: string;
}

function getTestDir(): string {
  const dir = path.join(os.tmpdir(), `pp-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function launchWithTestDir(testDir: string) {
  return electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
}

function readWindowsVersionInfo(filePath: string): WindowsVersionInfo {
  const escapedPath = filePath.replace(/'/g, "''");
  const output = execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `(Get-Item '${escapedPath}').VersionInfo | Select-Object FileDescription, ProductName, OriginalFilename, InternalName, FileVersion | ConvertTo-Json -Compress`,
  ], { encoding: 'utf-8' });

  return JSON.parse(output) as WindowsVersionInfo;
}

test.describe('Window icon', () => {
  test('icon file exists and is not empty', () => {
    const icoPath = path.join(RESOURCES_DIR, 'icon.ico');
    expect(fs.existsSync(icoPath)).toBe(true);
    const stats = fs.statSync(icoPath);
    expect(stats.size).toBeGreaterThan(0);
  });

  test('PNG icon file exists and is not empty', () => {
    const pngPath = path.join(RESOURCES_DIR, 'icon.png');
    expect(fs.existsSync(pngPath)).toBe(true);
    const stats = fs.statSync(pngPath);
    expect(stats.size).toBeGreaterThan(0);
  });

  test('packaged Windows executable is branded instead of Electron', () => {
    test.skip(process.platform !== 'win32', 'Windows executable metadata is only available on Windows.');
    test.skip(!fs.existsSync(PACKAGED_WINDOWS_EXE), 'Run npm run dist:win to generate the packaged executable.');

    const versionInfo = readWindowsVersionInfo(PACKAGED_WINDOWS_EXE);

    expect(versionInfo.ProductName).toBe('Prompt-Pad');
    expect(versionInfo.FileDescription).toBe('Prompt-Pad');
    expect(versionInfo.OriginalFilename).toBe('Prompt-Pad.exe');
    expect(versionInfo.InternalName).toBe('Prompt-Pad');
    expect(versionInfo.FileVersion).toBeTruthy();
  });

  test('app window loads successfully', async () => {
    const testDir = getTestDir();
    try {
      const app = await launchWithTestDir(testDir);
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      const title = await page.title();
      expect(title).toBeDefined();

      const version = await page.evaluate(async () => {
        return (window as unknown as { electronAPI: { getAppVersion: () => Promise<string> } })
          .electronAPI.getAppVersion();
      });
      expect(version).toBeTruthy();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
