import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');
const APP_DIR = path.join(os.homedir(), '.prompt-pad');

function ensureAppDir() {
  if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true });
}

function getSettingsPath(): string {
  ensureAppDir();
  return path.join(APP_DIR, 'settings.json');
}

function cleanSettings() {
  const p = getSettingsPath();
  if (fs.existsSync(p)) fs.rmSync(p, { force: true });
}

test.describe('Settings panel', () => {
  test.beforeEach(() => {
    cleanSettings();
  });

  test('Settings panel renders theme cards and language selector', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Open settings panel
    await page.locator('.activity-btn').nth(2).click();
    await expect(page.locator('.settings-panel')).toBeVisible();

    // Theme cards
    await expect(page.locator('.theme-card')).toHaveCount(4);
    await expect(page.locator('.theme-card').first()).toContainText(/Light|Claro/i);

    // Language selector
    const langSelect = page.locator('.settings-select');
    await expect(langSelect).toBeVisible();
    const options = langSelect.locator('option');
    await expect(options).toHaveCount(3);

    await app.close();
  });

  test('Language selection: selecting English sets language to en', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Open settings
    await page.locator('.activity-btn').nth(2).click();
    await expect(page.locator('.settings-panel')).toBeVisible();

    // Select English
    const langSelect = page.locator('.settings-select');
    await langSelect.selectOption('en');

    // Verify settings were saved
    await page.waitForTimeout(200);
    const settings = await page.evaluate(() => {
      return (window as unknown as { electronAPI: { loadSettings: () => Promise<{ language: string }> } })
        .electronAPI.loadSettings();
    });
    expect(settings.language).toBe('en');

    await app.close();
  });

  test('Language selection: selecting Spanish sets language to es', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Open settings
    await page.locator('.activity-btn').nth(2).click();
    await expect(page.locator('.settings-panel')).toBeVisible();

    // Select Spanish
    const langSelect = page.locator('.settings-select');
    await langSelect.selectOption('es');

    // Verify settings were saved
    await page.waitForTimeout(200);
    const settings = await page.evaluate(() => {
      return (window as unknown as { electronAPI: { loadSettings: () => Promise<{ language: string }> } })
        .electronAPI.loadSettings();
    });
    expect(settings.language).toBe('es');

    await app.close();
  });

  test('Check for updates button is present and clickable', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Open settings
    await page.locator('.activity-btn').nth(2).click();
    await expect(page.locator('.settings-panel')).toBeVisible();

    // Check for updates button
    const updateBtn = page.locator('.settings-update-btn');
    await expect(updateBtn).toBeVisible();
    await expect(updateBtn).toBeEnabled();
    await expect(updateBtn).toContainText(/Check for updates|Buscar actualizaciones/i);

    // Click it - should not throw
    await updateBtn.click();

    await app.close();
  });

  test('Theme switching works', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Open settings
    await page.locator('.activity-btn').nth(2).click();
    await expect(page.locator('.settings-panel')).toBeVisible();

    // Switch to dark theme
    const darkCard = page.locator('.theme-card').nth(1);
    await darkCard.click();

    await page.waitForTimeout(100);
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('dark');

    // Switch to gaudy theme
    const gaudyCard = page.locator('.theme-card').nth(2);
    await gaudyCard.click();

    await page.waitForTimeout(100);
    const theme2 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme2).toBe('gaudy');

    await app.close();
  });

  test('Version is displayed in settings', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Open settings
    await page.locator('.activity-btn').nth(2).click();
    await expect(page.locator('.settings-panel')).toBeVisible();

    // Version element should be visible
    const versionEl = page.locator('.settings-version');
    await expect(versionEl).toBeVisible();

    // In dev mode it may show "...", in packaged builds it shows version
    const text = await versionEl.textContent();
    expect(text).toBeTruthy();

    await app.close();
  });
});
