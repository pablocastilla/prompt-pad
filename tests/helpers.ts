import { Page, expect } from '@playwright/test';
import * as fs from 'fs';

/**
 * Remove a test directory, retrying briefly on Windows EBUSY/EPERM locks that
 * linger right after Electron closes its profile (antivirus and indexing can
 * keep files busy for a moment).
 */
export function removeTestDir(dir: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EBUSY' && code !== 'EPERM') throw err;
      // Synchronous sleep so the lock (antivirus, indexer or lingering Electron
      // handle) has time to clear before the next attempt.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
    }
  }
  // Last resort: the directory lives in the OS temp folder and every attempt
  // was blocked by an external lock, so leaving it behind must not fail the run.
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

/**
 * After the provider picker opens (via Ctrl+Shift+N or dblclick), select OpenCode
 * so the test can interact with the model picker. Use this helper in every spec
 * that previously assumed Ctrl+Shift+N would land directly on the model picker.
 *
 * @param page Playwright page
 * @param opts.waitForList When true, waits for `.model-picker-list` to be visible
 *   (i.e. the model picker step is fully rendered). Set to false for tests that
 *   need to inspect transient state like the loading indicator.
 */
export async function selectOpenCodeProvider(page: Page, opts: { waitForList?: boolean } = {}) {
  const { waitForList = true } = opts;
  await page.locator('.provider-picker-list .provider-picker-item[data-provider="opencode"]').click();
  if (waitForList) {
    await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 5000 });
  } else {
    // Just wait for the picker step transition (provider list disappears).
    await expect(page.locator('.provider-picker-list')).not.toBeVisible({ timeout: 5000 });
  }
}

/**
 * Select Claude Code in the provider picker and wait for its model list.
 */
export async function selectClaudeCodeProvider(page: Page, opts: { waitForList?: boolean } = {}) {
  const { waitForList = true } = opts;
  await page.locator('.provider-picker-list .provider-picker-item[data-provider="claude-code"]').click();
  if (waitForList) {
    await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 5000 });
  } else {
    await expect(page.locator('.provider-picker-list')).not.toBeVisible({ timeout: 5000 });
  }
}

/**
 * Click a model in the open model picker by its id. The row exposes the model
 * through its label only, so callers pass the visible label (or use the first
 * row, which is the provider's "Default" entry).
 */
export async function selectModelByLabel(page: Page, label: string | RegExp) {
  const row = page.locator('.model-picker-item', {
    has: page.locator('.model-picker-item-label', { hasText: label }),
  }).first();
  await expect(row).toBeVisible({ timeout: 5000 });
  await row.click();
}

/**
 * Select OpenAI Codex in the provider picker and wait for its model list.
 */
export async function selectCodexProvider(page: Page, opts: { waitForList?: boolean } = {}) {
  const { waitForList = true } = opts;
  await page.locator('.provider-picker-list .provider-picker-item[data-provider="codex"]').click();
  if (waitForList) {
    await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 5000 });
  } else {
    await expect(page.locator('.provider-picker-list')).not.toBeVisible({ timeout: 5000 });
  }
}

/**
 * Select GitHub Copilot in the provider picker, then wait for the model picker list.
 */
export async function selectCopilotProvider(page: Page, opts: { waitForList?: boolean } = {}) {
  const { waitForList = true } = opts;
  await page.locator('.provider-picker-list .provider-picker-item[data-provider="copilot"]').click();
  if (waitForList) {
    await expect(page.locator('.model-picker-list')).toBeVisible({ timeout: 5000 });
  } else {
    await expect(page.locator('.provider-picker-list')).not.toBeVisible({ timeout: 5000 });
  }
}

/**
 * Convenience: press Ctrl+Shift+1 to launch the first config, then select OpenCode.
 * This is the most common flow in tests that exercise the OpenCode model picker.
 */
export async function openModelPickerForFirstLaunch(page: Page) {
  await page.keyboard.press('Control+Shift+1');
  await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });
  await selectOpenCodeProvider(page);
}

/**
 * Convenience: press Ctrl+Shift+1 to launch the first config, then select Claude Code.
 * Claude Code opens its model picker; choosing the first row uses its default model.
 */
export async function launchWithClaudeCode(page: Page) {
  await page.keyboard.press('Control+Shift+1');
  await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });
  await selectClaudeCodeProvider(page);
  await page.locator('.model-picker-list .model-picker-item').first().click();
  await expect(page.locator('.model-picker-overlay')).not.toBeVisible({ timeout: 5000 });
}

/**
 * Convenience: press Ctrl+Shift+1 to launch the first config, then select Codex.
 * Codex opens its model picker; choosing the first row uses its default model.
 */
export async function launchWithCodex(page: Page) {
  await page.keyboard.press('Control+Shift+1');
  await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });
  await selectCodexProvider(page);
  await page.locator('.model-picker-list .model-picker-item').first().click();
  await expect(page.locator('.model-picker-overlay')).not.toBeVisible({ timeout: 5000 });
}
