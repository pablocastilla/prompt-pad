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

function savePhrases(testDir: string, phrases: unknown[]) {
  fs.writeFileSync(path.join(testDir, 'phrases.json'), JSON.stringify(phrases, null, 2));
}

function saveLaunches(testDir: string, launches: unknown[]) {
  fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify(launches, null, 2));
}

test.describe('Custom Shortcuts', () => {
  test('launches display correct shortcut kbd labels', async () => {
    const testDir = getTestDir();
    try {
      saveLaunches(testDir, [
        { id: 'l1', name: 'Project A', tool: 'opencode', model: 'opencode/minimax-m2.5-free', folder: '/tmp/a', yolo: true, mode: 'interactive', shortcut: '7' },
        { id: 'l2', name: 'Project B', tool: 'opencode', model: 'opencode/minimax-m2.5-free', folder: '/tmp/b', yolo: false, mode: 'interactive', shortcut: '9' },
        { id: 'l3', name: 'Project C', tool: 'opencode', model: 'opencode/minimax-m2.5-free', folder: '/tmp/c', yolo: true, mode: 'interactive', shortcut: '3' },
      ]);
      savePhrases(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').first().click();
      await page.waitForTimeout(200);

      const items = page.locator('.launch-list-item');
      await expect(items).toHaveCount(3);
      await expect(items.nth(0).locator('.launch-shortcut')).toHaveText('Ctrl+Shift+7');
      await expect(items.nth(1).locator('.launch-shortcut')).toHaveText('Ctrl+Shift+9');
      await expect(items.nth(2).locator('.launch-shortcut')).toHaveText('Ctrl+Shift+3');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('phrases display correct shortcut kbd labels', async () => {
    const testDir = getTestDir();
    try {
      savePhrases(testDir, [
        { id: 'p1', name: 'Greeting', content: 'Hello', shortcut: '3' },
        { id: 'p2', name: 'Farewell', content: 'Goodbye', shortcut: '0' },
        { id: 'p3', name: 'Question', content: 'How are you?', shortcut: '6' },
      ]);
      saveLaunches(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').nth(1).click();
      await page.waitForTimeout(200);

      const items = page.locator('.phrase-item');
      await expect(items).toHaveCount(3);
      await expect(items.nth(0).locator('.phrase-shortcut')).toHaveText('Ctrl+3');
      await expect(items.nth(1).locator('.phrase-shortcut')).toHaveText('Ctrl+0');
      await expect(items.nth(2).locator('.phrase-shortcut')).toHaveText('Ctrl+6');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('phrase shortcut inserts content by assigned number', async () => {
    const testDir = getTestDir();
    try {
      savePhrases(testDir, [
        { id: 'p1', name: 'Greeting', content: 'Hello from phrase', shortcut: '3' },
        { id: 'p2', name: 'Farewell', content: 'Goodbye', shortcut: '0' },
      ]);
      saveLaunches(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      const editor = page.locator('.editor-textarea');

      await page.keyboard.press('Control+3');
      await page.waitForTimeout(200);
        await expect(editor).toContainText('Hello from phrase');
      await expect(editor.locator('.phrase-text')).toContainText('Hello from phrase');

      await editor.fill('');
      await page.keyboard.press('Control+0');
      await page.waitForTimeout(200);
        await expect(editor).toContainText('Goodbye');
      await expect(editor.locator('.phrase-text')).toContainText('Goodbye');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('launch shortcut opens model picker by assigned number', async () => {
    const testDir = getTestDir();
    try {
      saveLaunches(testDir, [
        { id: 'l1', name: 'Project A', tool: 'opencode', model: 'opencode/minimax-m2.5-free', folder: '/tmp/a', yolo: true, mode: 'interactive', shortcut: '7' },
        { id: 'l2', name: 'Project B', tool: 'opencode', model: 'opencode/minimax-m2.5-free', folder: '/tmp/b', yolo: false, mode: 'interactive', shortcut: '9' },
      ]);
      savePhrases(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.editor-textarea').fill('test prompt');

      await page.keyboard.press('Control+Shift+7');
      await page.waitForTimeout(500);
      await expect(page.locator('.model-picker-overlay')).toBeVisible();

      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);

      await page.keyboard.press('Control+Shift+9');
      await page.waitForTimeout(500);
      await expect(page.locator('.model-picker-overlay')).toBeVisible();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('Ctrl+Shift launch shortcut does not trigger Ctrl phrase shortcut', async () => {
    const testDir = getTestDir();
    try {
      savePhrases(testDir, [
        { id: 'p1', name: 'Phrase Nine', content: 'PHRASE-9', shortcut: '9' },
      ]);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Launch Nine', tool: 'opencode', model: 'opencode/minimax-m2.5-free', folder: '/tmp/a', yolo: true, mode: 'interactive', shortcut: '9' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      const editor = page.locator('.editor-textarea');
      await editor.fill('prompt-content');

      await page.keyboard.press('Control+Shift+9');
      await page.waitForTimeout(350);

      await expect(page.locator('.model-picker-overlay')).toBeVisible();
        await expect(editor).toContainText('prompt-content');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('inserting a phrase from catalog applies persistent phrase-text styling', async () => {
    const testDir = getTestDir();
    try {
      savePhrases(testDir, [
        { id: 'p1', name: 'Greeting', content: 'Hello from catalog', shortcut: '1' },
      ]);
      saveLaunches(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.activity-btn').nth(1).click();
      await page.waitForTimeout(200);
      await page.locator('.phrase-item').first().click();

      const editor = page.locator('.editor-textarea');
        await expect(editor).toContainText('Hello from catalog');
      const phraseSpan = editor.locator('.phrase-text');
      await expect(phraseSpan).toContainText('Hello from catalog');

      await page.waitForTimeout(3600);
      await expect(phraseSpan).toContainText('Hello from catalog');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('unassigned shortcuts do nothing', async () => {
    const testDir = getTestDir();
    try {
      savePhrases(testDir, [
        { id: 'p1', name: 'Greeting', content: 'Hello', shortcut: '3' },
      ]);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Project A', tool: 'opencode', model: 'opencode/minimax-m2.5-free', folder: '/tmp/a', yolo: true, mode: 'interactive', shortcut: '7' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      const editor = page.locator('.editor-textarea');
      await editor.fill('Existing content');

      await page.keyboard.press('Control+1');
      await page.waitForTimeout(200);
        await expect(editor).toContainText('Existing content');

      await page.keyboard.press('Control+Shift+1');
      await page.waitForTimeout(200);
      await expect(page.locator('.model-picker-overlay')).not.toBeVisible();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('add form includes shortcut selector', async () => {
    const testDir = getTestDir();
    try {
      saveLaunches(testDir, []);
      savePhrases(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Open launches, click add (+ button is last in actions)
      await page.locator('.activity-btn').first().click();
      await page.waitForTimeout(200);
      await page.locator('.panel-section-actions .btn-icon').last().click();
      await page.waitForTimeout(200);

      const launchSelect = page.locator('.launch-form select').last();
      await expect(launchSelect).toBeVisible();

      // Cancel and switch to phrases
      await page.locator('.launch-form .form-actions .btn').first().click();
      await page.waitForTimeout(100);

      await page.locator('.activity-btn').nth(1).click();
      await page.waitForTimeout(200);
      await page.locator('.panel-section-header .btn-icon').click();
      await page.waitForTimeout(200);

      const phraseSelect = page.locator('.phrase-form select');
      await expect(phraseSelect).toBeVisible();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('items without shortcuts get positional shortcuts on first load (migration)', async () => {
    const testDir = getTestDir();
    try {
      // Old format: no shortcut field
      saveLaunches(testDir, [
        { id: 'l1', name: 'First', tool: 'opencode', model: 'opencode/minimax-m2.5-free', folder: '/tmp/a', yolo: true, mode: 'interactive' },
        { id: 'l2', name: 'Second', tool: 'opencode', model: 'opencode/minimax-m2.5-free', folder: '/tmp/b', yolo: false, mode: 'interactive' },
        { id: 'l3', name: 'Third', tool: 'opencode', model: 'opencode/minimax-m2.5-free', folder: '/tmp/c', yolo: true, mode: 'interactive' },
      ]);
      savePhrases(testDir, [
        { id: 'p1', name: 'Alpha', content: 'A' },
        { id: 'p2', name: 'Beta', content: 'B' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Check migration persisted to file
      const savedLaunches = JSON.parse(fs.readFileSync(path.join(testDir, 'launches.json'), 'utf-8'));
      expect(savedLaunches[0].shortcut).toBe('1');
      expect(savedLaunches[1].shortcut).toBe('2');
      expect(savedLaunches[2].shortcut).toBe('3');

      const savedPhrases = JSON.parse(fs.readFileSync(path.join(testDir, 'phrases.json'), 'utf-8'));
      expect(savedPhrases[0].shortcut).toBe('1');
      expect(savedPhrases[1].shortcut).toBe('2');

      // Verify display
      await page.locator('.activity-btn').first().click();
      await page.waitForTimeout(200);
      await expect(page.locator('.launch-list-item').nth(0).locator('.launch-shortcut')).toHaveText('Ctrl+Shift+1');
      await expect(page.locator('.launch-list-item').nth(1).locator('.launch-shortcut')).toHaveText('Ctrl+Shift+2');
      await expect(page.locator('.launch-list-item').nth(2).locator('.launch-shortcut')).toHaveText('Ctrl+Shift+3');

      // Verify keyboard works with migrated shortcuts
      await page.locator('.editor-textarea').fill('test');
      await page.keyboard.press('Control+Shift+1');
      await page.waitForTimeout(500);
      await expect(page.locator('.model-picker-overlay')).toBeVisible();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('can change shortcut via edit form and persist', async () => {
    const testDir = getTestDir();
    try {
      savePhrases(testDir, [
        { id: 'p1', name: 'Test', content: 'Hello', shortcut: '3' },
      ]);
      saveLaunches(testDir, []);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      // Open phrases panel and click edit on the first phrase
      await page.locator('.activity-btn').nth(1).click();
      await page.waitForTimeout(200);

      const phraseItem = page.locator('.phrase-item').first();
      await phraseItem.hover();
      await phraseItem.locator('.phrase-item-actions .btn-icon').first().click();
      await page.waitForTimeout(300);

      // Verify the form opened with correct shortcut
      const select = page.locator('.phrase-form select');
      await expect(select).toBeVisible();
      await expect(select).toHaveValue('3');

      // Change shortcut from 3 to 7
      await select.selectOption('7');
      await page.waitForTimeout(100);

      // Save
      await page.locator('.phrase-form .form-actions .btn-primary').click();
      await page.waitForTimeout(300);

      // Verify persisted
      const saved = JSON.parse(fs.readFileSync(path.join(testDir, 'phrases.json'), 'utf-8'));
      expect(saved[0].shortcut).toBe('7');

      // Verify the kbd label updated
      await expect(phraseItem.locator('.phrase-shortcut')).toHaveText('Ctrl+7');

      // Verify keyboard now works with new shortcut
      await page.keyboard.press('Control+7');
      await page.waitForTimeout(200);
      await expect(page.locator('.editor-textarea')).toContainText('Hello');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
