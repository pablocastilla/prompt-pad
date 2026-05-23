import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');

function getTestDir(): string {
  const dir = path.join(os.tmpdir(), `pp-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getSettingsPath(testDir: string): string {
  return path.join(testDir, 'settings.json');
}

function cleanSettings(testDir: string) {
  const p = getSettingsPath(testDir);
  if (fs.existsSync(p)) fs.rmSync(p, { force: true });
}

async function openSettings(page: import('@playwright/test').Page) {
  await page.locator('.activity-btn').nth(3).click();
  await expect(page.locator('.settings-panel')).toBeVisible();
}

test.describe('Settings panel', () => {
  test('Settings panel renders theme cards and language selector', async () => {
    const testDir = getTestDir();
    try {
      cleanSettings(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // Open settings panel
      await openSettings(page);

      // Theme cards
      await expect(page.locator('.theme-card')).toHaveCount(4);
      await expect(page.locator('.theme-card').first()).toContainText(/Light|Claro/i);

      // Language selector
      const langSelect = page.locator('.settings-select').first();
      await expect(langSelect).toBeVisible();
      const options = langSelect.locator('option');
      await expect(options).toHaveCount(3);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Language selection: selecting English sets language to en', async () => {
    const testDir = getTestDir();
    try {
      cleanSettings(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // Open settings
      await openSettings(page);

      // Select English
      const langSelect = page.locator('.settings-select').first();
      await langSelect.selectOption('en');

      // Verify settings were saved
      await page.waitForTimeout(200);
      const settings = await page.evaluate(() => {
        return (window as unknown as { electronAPI: { loadSettings: () => Promise<{ language: string }> } })
          .electronAPI.loadSettings();
      });
      expect(settings.language).toBe('en');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Language selection: selecting Spanish sets language to es', async () => {
    const testDir = getTestDir();
    try {
      cleanSettings(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // Open settings
      await openSettings(page);

      // Select Spanish
      const langSelect = page.locator('.settings-select').first();
      await langSelect.selectOption('es');

      // Verify settings were saved
      await page.waitForTimeout(200);
      const settings = await page.evaluate(() => {
        return (window as unknown as { electronAPI: { loadSettings: () => Promise<{ language: string }> } })
          .electronAPI.loadSettings();
      });
      expect(settings.language).toBe('es');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Check for updates button is present and clickable', async () => {
    const testDir = getTestDir();
    try {
      cleanSettings(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // Open settings
      await openSettings(page);

      // Check for updates button
      const updateBtn = page.locator('.settings-update-btn');
      await expect(updateBtn).toBeVisible();
      await expect(updateBtn).toBeEnabled();
      await expect(updateBtn).toContainText(/Check for updates|Buscar actualizaciones/i);

      // Click it - should not throw
      await updateBtn.click();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Theme switching works', async () => {
    const testDir = getTestDir();
    try {
      cleanSettings(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // Open settings
      await openSettings(page);

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
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Version is displayed in settings', async () => {
    const testDir = getTestDir();
    try {
      cleanSettings(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // Open settings
      await openSettings(page);

      // Version element should be visible
      const versionEl = page.locator('.settings-version');
      await expect(versionEl).toBeVisible();

      // In dev mode it may show "...", in packaged builds it shows version
      const text = await versionEl.textContent();
      expect(text).toBeTruthy();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Settings shows VS Code shortcut selector and hides key-type selectors', async () => {
    const testDir = getTestDir();
    try {
      cleanSettings(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await openSettings(page);

      await expect(page.getByText(/Open VS Code shortcuts|Atajos para abrir VS Code/i)).toBeVisible();
      const vsCodeShortcutSelect = page.locator('.settings-section').filter({ hasText: /Shortcut keys|Teclas de atajo/i }).locator('.form-group').nth(2).locator('select');
      await expect(vsCodeShortcutSelect).toBeVisible();
      await expect(vsCodeShortcutSelect).toHaveValue('ctrl+alt+shift');

      await expect(page.getByText(/Phrase key type|Tipo de tecla de frase/i)).toHaveCount(0);
      await expect(page.getByText(/Launch key type|Tipo de tecla de lanzamiento/i)).toHaveCount(0);

      await vsCodeShortcutSelect.selectOption('ctrl+alt');
      await page.waitForTimeout(200);

      const settings = await page.evaluate(() => {
        return (window as unknown as { electronAPI: { loadSettings: () => Promise<{ openVsCodeShortcutModifier: string }> } })
          .electronAPI.loadSettings();
      });
      expect(settings.openVsCodeShortcutModifier).toBe('ctrl+alt');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
