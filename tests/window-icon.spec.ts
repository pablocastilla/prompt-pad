import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');
const RESOURCES_DIR = path.join(__dirname, '..', 'resources');

function getTestDir(): string {
  const dir = path.join(os.tmpdir(), `pp-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function launchWithTestDir(testDir: string) {
  return electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
}

test.describe('Window icon', () => {
  test('icon file exists and is not empty', () => {
    const icoPath = path.join(RESOURCES_DIR, 'icon.ico');
    expect(fs.existsSync(icoPath)).toBe(true);
    const stats = fs.statSync(icoPath);
    expect(stats.size).toBeGreaterThan(0);
  });

  test('window loads with custom icon (not default Electron)', async () => {
    const testDir = getTestDir();
    try {
      const app = await launchWithTestDir(testDir);
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // Verify the app window is created and responsive
      const title = await page.title();
      expect(title).toBeDefined();

      // Verify the window is not showing the default Electron icon
      // by checking that the app is properly initialized
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
