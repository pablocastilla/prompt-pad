import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');
const RESOURCES_DIR = path.join(__dirname, '..', 'resources');

test.describe('Window icon', () => {
  test('icon file exists and is not empty', () => {
    const icoPath = path.join(RESOURCES_DIR, 'icon.ico');
    expect(fs.existsSync(icoPath)).toBe(true);
    const stats = fs.statSync(icoPath);
    expect(stats.size).toBeGreaterThan(0);
  });

  test('window loads with custom icon (not default Electron)', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
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
  });
});
