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

  test('diff shows staged changes', async () => {
    const testDir = getTestDir();
    try {
      const repoDir = path.join(testDir, 'staged-repo');
      fs.mkdirSync(repoDir, { recursive: true });
      execSync('git init', { cwd: repoDir });
      execSync('git config user.email test@test.com', { cwd: repoDir });
      execSync('git config user.name Test', { cwd: repoDir });
      fs.writeFileSync(path.join(repoDir, 'main.ts'), '// original\n');
      execSync('git add main.ts', { cwd: repoDir });
      execSync('git commit -m "initial"', { cwd: repoDir });
      // Stage a change
      fs.writeFileSync(path.join(repoDir, 'main.ts'), '// original\n// staged change\n');
      execSync('git add main.ts', { cwd: repoDir });

      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Staged Repo', folder: repoDir },
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
      const diffText = await page.locator('.git-diff-content').textContent();
      expect(diffText).toContain('staged change');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('diff shows untracked file content', async () => {
    const testDir = getTestDir();
    try {
      const repoDir = path.join(testDir, 'untracked-repo');
      fs.mkdirSync(repoDir, { recursive: true });
      execSync('git init', { cwd: repoDir });
      execSync('git config user.email test@test.com', { cwd: repoDir });
      execSync('git config user.name Test', { cwd: repoDir });
      fs.writeFileSync(path.join(repoDir, 'existing.ts'), '// existing\n');
      execSync('git add existing.ts', { cwd: repoDir });
      execSync('git commit -m "initial"', { cwd: repoDir });
      // Create an untracked file
      fs.writeFileSync(path.join(repoDir, 'new-file.ts'), 'const y = 2;\n');

      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Untracked Repo', folder: repoDir },
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

      // Click on the untracked file
      const untrackedFile = page.locator('.git-file-status.git-status-untracked').first();
      await untrackedFile.locator('..').click();
      await page.waitForTimeout(500);

      await expect(page.locator('.git-panel-diff-filename')).toBeVisible();
      await expect(page.locator('.git-diff-content')).toBeVisible();
      const diffText = await page.locator('.git-diff-content').textContent();
      expect(diffText).toContain('const y = 2;');
      expect(diffText).toContain('+const y = 2;');

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('git panel has resize handle', async () => {
    const testDir = getTestDir();
    try {
      const repoDir = path.join(testDir, 'resize-repo');
      initGitRepo(repoDir);

      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Resize Repo', folder: repoDir },
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
      await expect(page.locator('.git-panel-resize-handle')).toBeVisible();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
  test('git panel resize changes width', async () => {
    const testDir = getTestDir();
    try {
      const repoDir = path.join(testDir, 'resize-repo-2');
      initGitRepo(repoDir);

      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Resize Repo', folder: repoDir },
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

      const handle = page.locator('.git-panel-resize-handle');
      const box = await handle.boundingBox();
      expect(box).not.toBeNull();
      if (!box) return;

      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;

      const page2 = page;

      // Drag right by 100px to make panel narrower
      await page2.mouse.move(startX, startY);
      await page2.mouse.down();
      await page2.mouse.move(startX + 100, startY, { steps: 5 });
      await page2.mouse.up();
      await page.waitForTimeout(300);

      const newBox = await page.locator('.git-panel').boundingBox();
      expect(newBox).not.toBeNull();
      if (!newBox) return;
      // Width should be less than default 320 (approximately 220 after dragging right)
      expect(newBox.width).toBeLessThan(300);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('git panel resize in opposite direction', async () => {
    const testDir = getTestDir();
    try {
      const repoDir = path.join(testDir, 'resize-repo-3');
      initGitRepo(repoDir);

      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Resize Repo', folder: repoDir },
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

      const handle = page.locator('.git-panel-resize-handle');
      const box = await handle.boundingBox();
      expect(box).not.toBeNull();
      if (!box) return;

      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;

      // Drag left by 100px to make panel wider
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 100, startY, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(300);

      const newBox = await page.locator('.git-panel').boundingBox();
      expect(newBox).not.toBeNull();
      if (!newBox) return;
      // Width should be greater than default 320
      expect(newBox.width).toBeGreaterThan(330);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('git panel resize persists width in localStorage', async () => {
    const testDir = getTestDir();
    try {
      const repoDir = path.join(testDir, 'resize-repo-4');
      initGitRepo(repoDir);

      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Resize Repo', folder: repoDir },
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

      const handle = page.locator('.git-panel-resize-handle');
      const box = await handle.boundingBox();
      expect(box).not.toBeNull();
      if (!box) return;

      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;

      // Drag right to shrink
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 80, startY, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(300);

      const newBox = await page.locator('.git-panel').boundingBox();
      expect(newBox).not.toBeNull();
      if (!newBox) return;

      // Get the saved width from localStorage
      const savedWidth = await page.evaluate(() => localStorage.getItem('gitPanelWidth'));
      expect(savedWidth).not.toBeNull();
      expect(Number(savedWidth)).toBeCloseTo(newBox.width, -1);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('git panel resize respects min width', async () => {
    const testDir = getTestDir();
    try {
      const repoDir = path.join(testDir, 'resize-repo-5');
      initGitRepo(repoDir);

      saveTestSettings(testDir);
      savePhrases(testDir, []);
      saveLaunches(testDir, [
        { id: 'l1', name: 'Resize Repo', folder: repoDir },
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

      const handle = page.locator('.git-panel-resize-handle');
      const box = await handle.boundingBox();
      expect(box).not.toBeNull();
      if (!box) return;

      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;

      // Drag right by a huge amount (min width is 180, default is 320, so dragging 500px should hit min)
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 500, startY, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(300);

      const newBox = await page.locator('.git-panel').boundingBox();
      expect(newBox).not.toBeNull();
      if (!newBox) return;
      // Should not go below 180px
      expect(newBox.width).toBeGreaterThanOrEqual(180);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

});
