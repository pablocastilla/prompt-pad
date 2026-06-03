import { Page, expect } from '@playwright/test';

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
 * Select Claude Code in the provider picker. Claude Code launches directly
 * without a model picker, so the overlay closes immediately.
 */
export async function selectClaudeCodeProvider(page: Page) {
  await page.locator('.provider-picker-list .provider-picker-item[data-provider="claude-code"]').click();
  await expect(page.locator('.model-picker-overlay')).not.toBeVisible({ timeout: 5000 });
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
 * Claude Code has no model picker — the overlay closes immediately.
 */
export async function launchWithClaudeCode(page: Page) {
  await page.keyboard.press('Control+Shift+1');
  await expect(page.locator('.provider-picker-list')).toBeVisible({ timeout: 5000 });
  await selectClaudeCodeProvider(page);
}
