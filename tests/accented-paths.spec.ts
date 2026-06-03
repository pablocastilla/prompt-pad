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

function saveTestSettings(testDir: string, overrides: Record<string, unknown> = {}) {
  const settings = {
    theme: 'light',
    language: 'en',
    useOneDrive: false,
    ...overrides,
  };
  fs.writeFileSync(path.join(testDir, 'settings.json'), JSON.stringify(settings, null, 2));
}

function saveLaunches(testDir: string, launches: unknown[]) {
  fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify(launches, null, 2));
}

function readLaunchCalls(testDir: string): Array<Record<string, unknown>> {
  const files = fs.readdirSync(testDir).filter(f => f.startsWith('launch-call-') && f.endsWith('.json'));
  return files
    .map(f => JSON.parse(fs.readFileSync(path.join(testDir, f), 'utf-8')))
    .sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')));
}

test.describe('Launch with accented folder paths', () => {
  test('folder path with Spanish accents is preserved in launch call', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      saveLaunches(testDir, [
        { id: 'acc1', name: 'Proyecto con Tildes', folder: 'C:\\Users\\José\\Desktop\\solución\\visión' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.waitForTimeout(200);

      const editor = page.locator('.editor-textarea');
      await editor.fill('probando con acentos: á é í ó ú ñ');

      const launchItem = page.locator('.launch-list-item').first();
      await launchItem.dblclick();
      await page.waitForTimeout(300);

      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      await page.locator('.provider-picker-list .provider-picker-item[data-provider="claude-code"]').click();
      await expect(page.locator('.model-picker-overlay')).not.toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(500);

      const calls = readLaunchCalls(testDir);
      expect(calls.length).toBeGreaterThan(0);

      const lastCall = calls[calls.length - 1];
      expect(lastCall.folder).toBe('C:\\Users\\José\\Desktop\\solución\\visión');
      expect(lastCall.prompt).toContain('probando con acentos: á é í ó ú ñ');
      expect(String(lastCall.folder)).not.toContain('Ã');
      expect(String(lastCall.prompt)).not.toContain('Ã');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('all special Spanish characters survive round-trip through launch call', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      saveLaunches(testDir, [
        { id: 'acc2', name: 'Prueba Ñandú', folder: 'C:\\Users\\MáximoPérez\\Documentos\\aplicación-niño\\cañón' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.waitForTimeout(200);

      const editor = page.locator('.editor-textarea');
      await editor.fill('Prueba con caracteres ñ ü Á É Í Ó Ú');

      const launchItem = page.locator('.launch-list-item').first();
      await launchItem.dblclick();
      await page.waitForTimeout(300);

      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      await page.locator('.provider-picker-list .provider-picker-item[data-provider="claude-code"]').click();
      await expect(page.locator('.model-picker-overlay')).not.toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(500);

      const calls = readLaunchCalls(testDir);
      expect(calls.length).toBeGreaterThan(0);

      const lastCall = calls[calls.length - 1];
      expect(lastCall.folder).toBe('C:\\Users\\MáximoPérez\\Documentos\\aplicación-niño\\cañón');
      expect(String(lastCall.folder)).not.toContain('Ã');
      expect(String(lastCall.prompt)).not.toContain('Ã');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('prompt content with accents is preserved regardless of folder path', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      saveLaunches(testDir, [
        { id: 'acc3', name: 'Normal Folder', folder: 'C:\\projects\\normal' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.waitForTimeout(200);

      const accentedPrompt = 'Lee el archivo "instrucción.txt" y refactoriza el método leerDatosÚnicos';
      const editor = page.locator('.editor-textarea');
      await editor.fill(accentedPrompt);

      const launchItem = page.locator('.launch-list-item').first();
      await launchItem.dblclick();
      await page.waitForTimeout(300);

      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      await page.locator('.provider-picker-list .provider-picker-item[data-provider="claude-code"]').click();
      await expect(page.locator('.model-picker-overlay')).not.toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(500);

      const calls = readLaunchCalls(testDir);
      expect(calls.length).toBeGreaterThan(0);

      const lastCall = calls[calls.length - 1];
      expect(lastCall.prompt).toContain('instrucción');
      expect(lastCall.prompt).toContain('leerDatosÚnicos');
      expect(String(lastCall.prompt)).not.toContain('Ã');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
