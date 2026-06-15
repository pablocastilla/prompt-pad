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

function saveSettings(testDir: string, overrides: Record<string, unknown> = {}) {
  const p = path.join(testDir, 'settings.json');
  fs.writeFileSync(p, JSON.stringify({
    theme: 'dark',
    language: 'en',
    useOneDrive: false,
    ...overrides,
  }, null, 2));
}

test.describe('Help overlay', () => {
  test('help button is rendered below the statistics button with the ? glyph', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(400);

      const buttons = page.locator('.activity-bar .activity-btn');
      // launches, phrases, history, stats, help, settings -> 6 buttons
      await expect(buttons).toHaveCount(6);

      const statsBtn = page.locator('.activity-btn[data-tour-id="statistics"]');
      const helpBtn = page.locator('.activity-btn[data-tour-id="help"]');
      const settingsBtn = page.locator('.activity-btn[data-tour-id="settings"]');

      await expect(statsBtn).toBeVisible();
      await expect(helpBtn).toBeVisible();
      await expect(settingsBtn).toBeVisible();
      await expect(helpBtn).toHaveText('?');
      await expect(helpBtn).toHaveAttribute('title', /Help/i);

      // Stats button is above the help button (smaller y), help button is above settings.
      const statsBox = await statsBtn.boundingBox();
      const helpBox = await helpBtn.boundingBox();
      const settingsBox = await settingsBtn.boundingBox();
      expect(statsBox).not.toBeNull();
      expect(helpBox).not.toBeNull();
      expect(settingsBox).not.toBeNull();
      expect(helpBox!.y).toBeGreaterThan(statsBox!.y);
      expect(settingsBox!.y).toBeGreaterThan(helpBox!.y);

      // Settings still lives below the activity spacer (i.e. is visually separated).
      const spacer = page.locator('.activity-spacer');
      const spacerBox = await spacer.boundingBox();
      expect(spacerBox).not.toBeNull();
      expect(helpBox!.y).toBeLessThan(spacerBox!.y);
      expect(settingsBox!.y).toBeGreaterThan(spacerBox!.y);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('clicking the help button opens an eye-catching banner with arrows to each feature', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      // Give settings/language a moment to settle before opening the overlay.
      await page.waitForTimeout(600);

      await expect(page.locator('.help-overlay')).toHaveCount(0);

      await page.locator('.activity-btn[data-tour-id="help"]').click();
      const overlay = page.locator('.help-overlay');
      await expect(overlay).toBeVisible();

      const card = page.locator('.help-card');
      await expect(card).toBeVisible();
      // Title is locale-dependent (auto-detect can win the race on Spanish systems);
      // either greeting is fine as long as "Prompt Pad" is referenced.
      await expect(card.locator('.help-card-title')).toContainText(/Prompt Pad/i);
      await expect(card.locator('.help-card-subtitle')).not.toBeEmpty();

      // All six features should be explained.
      const items = card.locator('.help-item');
      await expect(items).toHaveCount(6);

      for (const id of ['launches', 'phrases', 'history', 'statistics', 'help', 'settings']) {
        const item = card.locator(`.help-item[data-help-for="${id}"]`);
        await expect(item).toBeVisible();
        // Each item carries an arrow icon and a non-empty title + text.
        await expect(item.locator('.help-arrow')).toBeVisible();
        await expect(item.locator('.help-item-title')).not.toBeEmpty();
        await expect(item.locator('.help-item-text')).not.toBeEmpty();
      }

      // The Launches description must emphasise that it's a working folder
      // and that the prompt is fired from there at the CLI.
      const launchesText = await card.locator('.help-item[data-help-for="launches"] .help-item-text').textContent();
      expect(launchesText ?? '').toMatch(/folder|carpeta/i);

      // Activity-bar button for help is highlighted while overlay is open.
      await expect(page.locator('.activity-btn[data-tour-id="help"]')).toHaveClass(/active/);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('help overlay closes on Escape', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(400);

      const helpBtn = page.locator('.activity-btn[data-tour-id="help"]');
      const overlay = page.locator('.help-overlay');

      await helpBtn.click();
      await expect(overlay).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(overlay).toHaveCount(0);
      await expect(helpBtn).not.toHaveClass(/active/);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('help overlay closes via the Got it button', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(400);

      const helpBtn = page.locator('.activity-btn[data-tour-id="help"]');
      const overlay = page.locator('.help-overlay');

      await helpBtn.click();
      await expect(overlay).toBeVisible();
      await page.locator('.help-close-btn').click();
      await expect(overlay).toHaveCount(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('help overlay closes via the X icon in the header', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(400);

      const helpBtn = page.locator('.activity-btn[data-tour-id="help"]');
      const overlay = page.locator('.help-overlay');

      await helpBtn.click();
      await expect(overlay).toBeVisible();
      await page.locator('.help-close-x').click();
      await expect(overlay).toHaveCount(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('help overlay closes when clicking the backdrop', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(400);

      const helpBtn = page.locator('.activity-btn[data-tour-id="help"]');
      const overlay = page.locator('.help-overlay');

      await helpBtn.click();
      await expect(overlay).toBeVisible();
      // Click at the very top of the overlay (well inside its padding, away from the card).
      await overlay.click({ position: { x: 5, y: 5 } });
      await expect(overlay).toHaveCount(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('help overlay toggles closed when the help button is clicked again', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(400);

      const helpBtn = page.locator('.activity-btn[data-tour-id="help"]');
      const overlay = page.locator('.help-overlay');

      await helpBtn.click();
      await expect(overlay).toBeVisible();
      await helpBtn.click();
      await expect(overlay).toHaveCount(0);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('clicking inside the help card does not close the overlay', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(400);

      await page.locator('.activity-btn[data-tour-id="help"]').click();
      await expect(page.locator('.help-overlay')).toBeVisible();

      // Click on a help item — overlay should stay open.
      await page.locator('.help-item').first().click();
      await page.waitForTimeout(150);
      await expect(page.locator('.help-overlay')).toBeVisible();

      // Click on the title — overlay should stay open.
      await page.locator('.help-card-title').click();
      await page.waitForTimeout(150);
      await expect(page.locator('.help-overlay')).toBeVisible();

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('help overlay positions to the right of the activity bar and points its arrows back toward it', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(400);

      await page.locator('.activity-btn[data-tour-id="help"]').click();
      const card = page.locator('.help-card');
      await expect(card).toBeVisible();

      const activityBar = page.locator('.activity-bar');
      const barBox = await activityBar.boundingBox();
      const cardBox = await card.boundingBox();
      expect(barBox).not.toBeNull();
      expect(cardBox).not.toBeNull();
      // Card should start after the activity bar so it doesn't cover it.
      expect(cardBox!.x).toBeGreaterThanOrEqual(barBox!.x + barBox!.width - 1);

      // Every help-item arrow renders text content (the actual arrow glyph).
      const arrows = page.locator('.help-arrow');
      const arrowCount = await arrows.count();
      expect(arrowCount).toBe(6);
      for (let i = 0; i < arrowCount; i++) {
        const txt = await arrows.nth(i).textContent();
        expect(txt?.trim().length ?? 0).toBeGreaterThan(0);
      }

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('help overlay localises to Spanish when the language is es', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir, { language: 'es' });
      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(400);

      const helpBtn = page.locator('.activity-btn[data-tour-id="help"]');
      await expect(helpBtn).toHaveAttribute('title', /Ayuda/i);

      await helpBtn.click();
      const card = page.locator('.help-card');
      await expect(card.locator('.help-card-title')).toContainText(/Bienvenido/i);
      await expect(card.locator('.help-card-eyebrow')).toContainText(/Visita rápida/i);
      await expect(card.locator('.help-close-btn')).toContainText(/Entendido/i);

      // Each Spanish title is present
      await expect(card.locator('.help-item[data-help-for="launches"] .help-item-title')).toContainText(/Lanzamientos/i);
      await expect(card.locator('.help-item[data-help-for="phrases"] .help-item-title')).toContainText(/Frases/i);
      await expect(card.locator('.help-item[data-help-for="history"] .help-item-title')).toContainText(/Historial/i);
      await expect(card.locator('.help-item[data-help-for="statistics"] .help-item-title')).toContainText(/Estadísticas/i);
      await expect(card.locator('.help-item[data-help-for="help"] .help-item-title')).toContainText(/Ayuda/i);
      await expect(card.locator('.help-item[data-help-for="settings"] .help-item-title')).toContainText(/Ajustes/i);

      await app.close();
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('help overlay does not touch OneDrive: settings file is unchanged after open/close', async () => {
    const testDir = getTestDir();
    try {
      saveSettings(testDir);
      const settingsPath = path.join(testDir, 'settings.json');
      const before = fs.readFileSync(settingsPath, 'utf-8');

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(400);

      await page.locator('.activity-btn[data-tour-id="help"]').click();
      await expect(page.locator('.help-overlay')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('.help-overlay')).toHaveCount(0);

      await app.close();

      // No OneDrive marker, no help-state file written; settings.json content untouched.
      const after = fs.readFileSync(settingsPath, 'utf-8');
      expect(JSON.parse(after)).toEqual(JSON.parse(before));
      expect(fs.existsSync(path.join(testDir, 'help.json'))).toBe(false);
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
