import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');
const APP_DIR = path.join(os.homedir(), '.prompt-pad');

function cleanSession() {
  const sessionPath = path.join(APP_DIR, 'session.json');
  if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { force: true });
}

test.describe('Tab context menu', () => {
  test.beforeEach(() => {
    cleanSession();
  });

  test('Right-click on tab opens context menu', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Add a second tab
    await page.locator('.tab-add').click();
    await page.waitForTimeout(100);

    // Verify two tabs exist
    await expect(page.locator('.tab')).toHaveCount(2);

    // Right-click on the first tab
    const firstTab = page.locator('.tab').first();
    await firstTab.click({ button: 'right' });

    // Context menu should appear
    await expect(page.locator('.tab-context-menu')).toBeVisible();

    // All menu items should be present
    await expect(page.locator('.tab-context-item')).toHaveCount(5);

    await app.close();
  });

  test('Close tabs to the left works', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Add multiple tabs
    await page.locator('.tab-add').click();
    await page.waitForTimeout(50);
    await page.locator('.tab-add').click();
    await page.waitForTimeout(50);
    await page.locator('.tab-add').click();
    await page.waitForTimeout(100);

    await expect(page.locator('.tab')).toHaveCount(4);

    // Right-click on the last tab (index 3)
    const tabs = page.locator('.tab');
    const lastTab = tabs.last();
    await lastTab.click({ button: 'right' });

    // Click "Close tabs to the left"
    const closeLeftBtn = page.locator('.tab-context-item').nth(1);
    await closeLeftBtn.click();

    await page.waitForTimeout(100);

    // Should only have 1 tab left
    await expect(page.locator('.tab')).toHaveCount(1);

    await app.close();
  });

  test('Close tabs to the right works', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Add multiple tabs
    await page.locator('.tab-add').click();
    await page.waitForTimeout(50);
    await page.locator('.tab-add').click();
    await page.waitForTimeout(50);
    await page.locator('.tab-add').click();
    await page.waitForTimeout(100);

    await expect(page.locator('.tab')).toHaveCount(4);

    // Right-click on the first tab
    const firstTab = page.locator('.tab').first();
    await firstTab.click({ button: 'right' });

    // Click "Close tabs to the right"
    const closeRightBtn = page.locator('.tab-context-item').nth(2);
    await closeRightBtn.click();

    await page.waitForTimeout(100);

    // Should only have 1 tab left
    await expect(page.locator('.tab')).toHaveCount(1);

    await app.close();
  });

  test('Close other tabs works', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Add multiple tabs
    await page.locator('.tab-add').click();
    await page.waitForTimeout(50);
    await page.locator('.tab-add').click();
    await page.waitForTimeout(100);

    await expect(page.locator('.tab')).toHaveCount(3);

    // Right-click on the second tab
    const secondTab = page.locator('.tab').nth(1);
    await secondTab.click({ button: 'right' });

    // Click "Close other tabs"
    const closeOthersBtn = page.locator('.tab-context-item').nth(4);
    await closeOthersBtn.click();

    await page.waitForTimeout(100);

    // Should only have 1 tab left
    await expect(page.locator('.tab')).toHaveCount(1);

    await app.close();
  });

  test('Close all tabs works', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Add multiple tabs
    await page.locator('.tab-add').click();
    await page.waitForTimeout(50);
    await page.locator('.tab-add').click();
    await page.waitForTimeout(100);

    await expect(page.locator('.tab')).toHaveCount(3);

    // Right-click on any tab
    const firstTab = page.locator('.tab').first();
    await firstTab.click({ button: 'right' });

    // Click "Close all tabs"
    const closeAllBtn = page.locator('.tab-context-item').last();
    await closeAllBtn.click();

    await page.waitForTimeout(100);

    // Should have 1 tab (the one we right-clicked on)
    await expect(page.locator('.tab')).toHaveCount(1);

    await app.close();
  });

  test('Context menu closes on Escape', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Add a second tab
    await page.locator('.tab-add').click();
    await page.waitForTimeout(100);

    // Right-click on a tab
    const firstTab = page.locator('.tab').first();
    await firstTab.click({ button: 'right' });

    // Context menu should be visible
    await expect(page.locator('.tab-context-menu')).toBeVisible();

    // Press Escape
    await page.keyboard.press('Escape');

    // Context menu should be hidden
    await expect(page.locator('.tab-context-menu')).not.toBeVisible();

    await app.close();
  });

  test('Context menu closes on outside click', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Add a second tab
    await page.locator('.tab-add').click();
    await page.waitForTimeout(100);

    // Right-click on a tab
    const firstTab = page.locator('.tab').first();
    await firstTab.click({ button: 'right' });

    await expect(page.locator('.tab-context-menu')).toBeVisible();

    // Click outside the menu
    await page.locator('.editor-textarea').click();

    await expect(page.locator('.tab-context-menu')).not.toBeVisible();

    await app.close();
  });

  test('Disabled items are not clickable when no tabs to close', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Only one tab exists, right-click on it
    const onlyTab = page.locator('.tab').first();
    await onlyTab.click({ button: 'right' });

    // "Close tabs to the left" should be disabled
    const closeLeftBtn = page.locator('.tab-context-item').nth(1);
    await expect(closeLeftBtn).toHaveClass(/disabled/);

    // "Close tabs to the right" should be disabled
    const closeRightBtn = page.locator('.tab-context-item').nth(2);
    await expect(closeRightBtn).toHaveClass(/disabled/);

    // "Close other tabs" should be disabled
    const closeOthersBtn = page.locator('.tab-context-item').nth(3);
    await expect(closeOthersBtn).toHaveClass(/disabled/);

    await app.close();
  });
});
