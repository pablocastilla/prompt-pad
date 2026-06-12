import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');

function getTestDir(): string {
  const dir = path.join(os.tmpdir(), `pp-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveTestSettings(testDir: string, overrides: Record<string, unknown> = {}) {
  fs.writeFileSync(path.join(testDir, 'settings.json'), JSON.stringify({
    theme: 'light',
    language: 'en',
    useOneDrive: false,
    phraseShortcutModifier: 'ctrl',
    launchShortcutModifier: 'ctrl+shift',
    openVsCodeShortcutModifier: 'ctrl+alt+shift',
    ...overrides,
  }, null, 2));
}

function savePhrases(testDir: string, phrases: unknown[]) {
  fs.writeFileSync(path.join(testDir, 'phrases.json'), JSON.stringify(phrases, null, 2));
}

function saveLaunches(testDir: string, launches: unknown[]) {
  fs.writeFileSync(path.join(testDir, 'launches.json'), JSON.stringify(launches, null, 2));
}

function initGitRepo(repoPath: string) {
  fs.mkdirSync(repoPath, { recursive: true });
  execSync('git init', { cwd: repoPath });
  execSync('git config user.email test@test.com', { cwd: repoPath });
  execSync('git config user.name Test', { cwd: repoPath });
  fs.writeFileSync(path.join(repoPath, 'readme.md'), '# Test Repo\n');
  execSync('git add readme.md', { cwd: repoPath });
  execSync('git commit -m "initial commit"', { cwd: repoPath });
  fs.writeFileSync(path.join(repoPath, 'readme.md'), '# Test Repo\nModified content\n');
  fs.writeFileSync(path.join(repoPath, 'new-file.ts'), 'const x = 1;\n');
}

test.describe('Git diff panel', () => {

  test('git panel is not visible before any launch', async () => {
    const testDir = getTestDir();
    try {
      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Test', folder: '/tmp/nonexistent' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await expect(page.locator('.git-panel')).toHaveCount(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('git panel appears after launching with a folder', async () => {
    const testDir = getTestDir();
    try {
      const repoDir = path.join(testDir, 'my-repo');
      initGitRepo(repoDir);

      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'My Repo', folder: repoDir },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.editor-textarea').fill('test prompt');
      await page.waitForTimeout(100);

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('3');
      await page.waitForTimeout(1000);

      await expect(page.locator('.git-panel')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.git-panel-title')).toHaveText('Git Changes');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('git panel shows changed files after launch', async () => {
    const testDir = getTestDir();
    try {
      const repoDir = path.join(testDir, 'my-repo');
      initGitRepo(repoDir);

      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'My Repo', folder: repoDir },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.editor-textarea').fill('test prompt');
      await page.waitForTimeout(100);

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('3');
      await page.waitForTimeout(1000);

      await expect(page.locator('.git-panel')).toBeVisible({ timeout: 5000 });

      await expect(page.locator('.git-panel-file')).toHaveCount(2);

      const filePaths = page.locator('.git-file-path');
      const texts = await filePaths.allTextContents();
      expect(texts).toContain('readme.md');
      expect(texts).toContain('new-file.ts');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('git panel shows correct status indicators', async () => {
    const testDir = getTestDir();
    try {
      const repoDir = path.join(testDir, 'my-repo');
      initGitRepo(repoDir);

      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'My Repo', folder: repoDir },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.editor-textarea').fill('test prompt');
      await page.waitForTimeout(100);

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('3');
      await page.waitForTimeout(1000);

      await expect(page.locator('.git-panel')).toBeVisible({ timeout: 5000 });

      const statusBadges = page.locator('.git-file-status');
      const badgeTexts = await statusBadges.allTextContents();
      expect(badgeTexts).toContain('M');
      expect(badgeTexts).toContain('?');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('clicking a file shows its diff', async () => {
    const testDir = getTestDir();
    try {
      const repoDir = path.join(testDir, 'my-repo');
      initGitRepo(repoDir);

      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'My Repo', folder: repoDir },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.editor-textarea').fill('test prompt');
      await page.waitForTimeout(100);

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('3');
      await page.waitForTimeout(1000);

      await expect(page.locator('.git-panel')).toBeVisible({ timeout: 5000 });

      await page.locator('.git-panel-file').first().click();
      await page.waitForTimeout(500);

      await expect(page.locator('.git-panel-diff-filename')).toBeVisible();
      await expect(page.locator('.git-diff-content')).toBeVisible();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('diff shows the correct filename and content', async () => {
    const testDir = getTestDir();
    try {
      const repoDir = path.join(testDir, 'my-repo');
      initGitRepo(repoDir);

      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'My Repo', folder: repoDir },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.editor-textarea').fill('test prompt');
      await page.waitForTimeout(100);

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('3');
      await page.waitForTimeout(1000);

      await expect(page.locator('.git-panel')).toBeVisible({ timeout: 5000 });

      await page.locator('.git-panel-file').first().click();
      await page.waitForTimeout(500);

      const diffFilename = await page.locator('.git-panel-diff-filename').textContent();
      expect(diffFilename).toBe('readme.md');

      await expect(page.locator('.git-diff-content')).toBeVisible();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('back button returns to file list from diff view', async () => {
    const testDir = getTestDir();
    try {
      const repoDir = path.join(testDir, 'my-repo');
      initGitRepo(repoDir);

      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'My Repo', folder: repoDir },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.editor-textarea').fill('test prompt');
      await page.waitForTimeout(100);

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('3');
      await page.waitForTimeout(1000);

      await expect(page.locator('.git-panel')).toBeVisible({ timeout: 5000 });

      await page.locator('.git-panel-file').first().click();
      await page.waitForTimeout(500);

      await expect(page.locator('.git-panel-diff-header')).toBeVisible();

      const backBtn = page.locator('.git-panel-diff-header .btn-icon').first();
      await backBtn.click();
      await page.waitForTimeout(300);

      await expect(page.locator('.git-panel-files')).toBeVisible();
      await expect(page.locator('.git-panel-diff-header')).toHaveCount(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('close button hides the git panel', async () => {
    const testDir = getTestDir();
    try {
      const repoDir = path.join(testDir, 'my-repo');
      initGitRepo(repoDir);

      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'My Repo', folder: repoDir },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.editor-textarea').fill('test prompt');
      await page.waitForTimeout(100);

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('3');
      await page.waitForTimeout(1000);

      await expect(page.locator('.git-panel')).toBeVisible({ timeout: 5000 });

      await page.locator('.git-panel-header .btn-icon').click();
      await page.waitForTimeout(300);

      await expect(page.locator('.git-panel')).toHaveCount(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('git panel shows no changes for clean repo', async () => {
    const testDir = getTestDir();
    try {
      const repoDir = path.join(testDir, 'clean-repo');
      fs.mkdirSync(repoDir, { recursive: true });
      execSync('git init', { cwd: repoDir });
      execSync('git config user.email test@test.com', { cwd: repoDir });
      execSync('git config user.name Test', { cwd: repoDir });
      fs.writeFileSync(path.join(repoDir, 'readme.md'), '# Clean\n');
      execSync('git add readme.md', { cwd: repoDir });
      execSync('git commit -m "initial"', { cwd: repoDir });

      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Clean Repo', folder: repoDir },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.editor-textarea').fill('test prompt');
      await page.waitForTimeout(100);

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('3');
      await page.waitForTimeout(1000);

      await expect(page.locator('.git-panel')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.git-panel-empty')).toHaveText('No changes detected');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('git panel handles non-git folder gracefully', async () => {
    const testDir = getTestDir();
    try {
      const plainDir = path.join(testDir, 'non-git-folder');
      fs.mkdirSync(plainDir, { recursive: true });
      fs.writeFileSync(path.join(plainDir, 'file.txt'), 'hello');

      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Plain Folder', folder: plainDir },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.editor-textarea').fill('test prompt');
      await page.waitForTimeout(100);

      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('3');
      await page.waitForTimeout(1000);

      await expect(page.locator('.git-panel')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.git-panel-empty')).toHaveText('No changes detected');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('multiple launches reuse the same git panel for the new folder', async () => {
    const testDir = getTestDir();
    try {
      const repoDir1 = path.join(testDir, 'repo1');
      initGitRepo(repoDir1);
      const repoDir2 = path.join(testDir, 'repo2');
      fs.mkdirSync(repoDir2, { recursive: true });
      execSync('git init', { cwd: repoDir2 });
      execSync('git config user.email test@test.com', { cwd: repoDir2 });
      execSync('git config user.name Test', { cwd: repoDir2 });
      fs.writeFileSync(path.join(repoDir2, 'main.ts'), '// initial\n');
      execSync('git add main.ts', { cwd: repoDir2 });
      execSync('git commit -m "init"', { cwd: repoDir2 });
      fs.writeFileSync(path.join(repoDir2, 'main.ts'), '// initial\n// modified\n');

      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Repo 1', folder: repoDir1, shortcut: '1' },
        { id: 'l2', name: 'Repo 2', folder: repoDir2, shortcut: '2' },
      ]);

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(500);

      await page.locator('.editor-textarea').fill('test prompt');
      await page.waitForTimeout(100);

      // Launch with repo1
      await page.keyboard.press('Control+Shift+1');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('3');
      await page.waitForTimeout(1000);
      await expect(page.locator('.git-panel')).toBeVisible({ timeout: 5000 });

      let filePaths = page.locator('.git-file-path');
      let texts = await filePaths.allTextContents();
      expect(texts).toContain('readme.md');
      expect(texts).toContain('new-file.ts');

      // Fill editor again and launch with repo2
      await page.locator('.editor-textarea').fill('second launch');
      await page.waitForTimeout(100);

      await page.keyboard.press('Control+Shift+2');
      await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('3');
      await page.waitForTimeout(1000);

      await expect(page.locator('.git-panel')).toBeVisible({ timeout: 5000 });
      filePaths = page.locator('.git-file-path');
      texts = await filePaths.allTextContents();
      expect(texts).toContain('main.ts');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

});
