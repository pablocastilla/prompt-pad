import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { formatRemoteSessionsUrl } from '../electron/remoteServer';
import { removeTestDir } from './helpers';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');

function getTestDir(): string {
  const dir = path.join(os.tmpdir(), `pp-remote-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test.describe('formatRemoteSessionsUrl helper', () => {
  const host = '192.168.1.50';
  const port = 4127;
  const key = 'a1b2c3d4';

  test('falls back to local host and port when baseUrl is empty or undefined', () => {
    expect(formatRemoteSessionsUrl(undefined, host, port, key)).toBe('http://192.168.1.50:4127/?key=a1b2c3d4');
    expect(formatRemoteSessionsUrl('', host, port, key)).toBe('http://192.168.1.50:4127/?key=a1b2c3d4');
    expect(formatRemoteSessionsUrl('   ', host, port, key)).toBe('http://192.168.1.50:4127/?key=a1b2c3d4');
    expect(formatRemoteSessionsUrl(null, host, port, key)).toBe('http://192.168.1.50:4127/?key=a1b2c3d4');
  });

  test('appends key to domain-only external URL', () => {
    expect(formatRemoteSessionsUrl('https://sessions.example.com', host, port, key))
      .toBe('https://sessions.example.com/?key=a1b2c3d4');
  });

  test('preserves port in external URL', () => {
    expect(formatRemoteSessionsUrl('http://myserver.org:8443', host, port, key))
      .toBe('http://myserver.org:8443/?key=a1b2c3d4');
  });

  test('preserves trailing slash and paths in external URL', () => {
    expect(formatRemoteSessionsUrl('https://example.com/sessions/', host, port, key))
      .toBe('https://example.com/sessions/?key=a1b2c3d4');
    expect(formatRemoteSessionsUrl('https://example.com/sessions', host, port, key))
      .toBe('https://example.com/sessions?key=a1b2c3d4');
  });

  test('appends key properly when existing query params exist', () => {
    expect(formatRemoteSessionsUrl('https://example.com/?tag=mobile', host, port, key))
      .toBe('https://example.com/?tag=mobile&key=a1b2c3d4');
  });

  test('replaces existing key in URL with current active key', () => {
    expect(formatRemoteSessionsUrl('https://example.com/?key=oldkey', host, port, key))
      .toBe('https://example.com/?key=a1b2c3d4');
  });

  test('prepends http:// if protocol is omitted', () => {
    expect(formatRemoteSessionsUrl('example.com:4127', host, port, key))
      .toBe('http://example.com:4127/?key=a1b2c3d4');
  });
});

test.describe('Remote sessions external URL Playwright integration', () => {
  test('uses external URL for QR and mobile URL display in Sessions panel', async () => {
    const testDir = getTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'settings.json'), JSON.stringify({
        theme: 'dark',
        language: 'en',
        useOneDrive: false,
        remoteSessionsExternalUrl: 'https://mysessions.example.com:8080',
      }));

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      // Open Sessions tab via activity bar
      await page.locator('.activity-btn[data-tour-id="sessions"]').click();
      await expect(page.locator('.sessions-panel')).toBeVisible();

      // Click "View on mobile"
      const mobileBtn = page.locator('.sessions-remote button.btn').first();
      await expect(mobileBtn).toBeVisible();
      await mobileBtn.click();

      // Check card is visible
      const card = page.locator('.sessions-remote-card');
      await expect(card).toBeVisible();

      // URL code element should contain external URL and key query param
      const codeEl = card.locator('code');
      await expect(codeEl).toBeVisible();
      const displayedUrl = await codeEl.textContent();
      expect(displayedUrl).toMatch(/^https:\/\/mysessions\.example\.com:8080\/\?key=[a-f0-9]+$/);

      // QR SVG should be generated
      const qrEl = card.locator('.sessions-remote-qr svg');
      await expect(qrEl).toBeVisible();

      // External hint text should be displayed
      await expect(card).toContainText(/Scan the QR with your phone to open the external URL/i);

      // Now change external URL via Settings panel
      await page.locator('.activity-btn[data-tour-id="settings"]').click();
      await expect(page.locator('.settings-panel')).toBeVisible();

      const urlInput = page.locator('#remote-sessions-url');
      await expect(urlInput).toBeVisible();
      await expect(urlInput).toHaveValue('https://mysessions.example.com:8080');

      await urlInput.fill('https://newtunnel.ngrok.app');
      await page.waitForTimeout(200);

      // Reopen Sessions tab
      await page.locator('.activity-btn[data-tour-id="sessions"]').click();
      await expect(page.locator('.sessions-panel')).toBeVisible();

      // The URL should have updated
      const updatedUrl = await card.locator('code').textContent();
      expect(updatedUrl).toMatch(/^https:\/\/newtunnel\.ngrok\.app\/\?key=[a-f0-9]+$/);

      // Clear the URL in Settings and verify it reverts to local LAN IP
      await page.locator('.activity-btn[data-tour-id="settings"]').click();
      await expect(page.locator('.settings-panel')).toBeVisible();
      await urlInput.fill('');
      await page.waitForTimeout(200);

      await page.locator('.activity-btn[data-tour-id="sessions"]').click();
      const revertedUrl = await card.locator('code').textContent();
      expect(revertedUrl).toMatch(/^http:\/\/(\d+\.\d+\.\d+\.\d+|127\.0\.0\.1):\d+\/\?key=[a-f0-9]+$/);
      await expect(card).toContainText(/Scan the QR with your phone \(same Wi-Fi\)/i);

      await app.close();
    } finally {
      removeTestDir(testDir);
    }
  });

  test('OneDrive sync is never touched when configuring remote sessions external URL', async () => {
    const testDir = getTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'settings.json'), JSON.stringify({
        theme: 'dark',
        language: 'en',
        useOneDrive: false,
      }));

      const app = await electron.launch({ args: [MAIN_JS], env: { ...process.env, PROMPT_PAD_TEST_DIR: testDir } });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      await page.locator('.activity-btn[data-tour-id="settings"]').click();
      await expect(page.locator('.settings-panel')).toBeVisible();

      const urlInput = page.locator('#remote-sessions-url');
      await urlInput.fill('https://tunnel.example.com');
      await page.waitForTimeout(200);

      const savedSettings = JSON.parse(fs.readFileSync(path.join(testDir, 'settings.json'), 'utf8'));
      expect(savedSettings.useOneDrive).toBe(false);
      expect(savedSettings.remoteSessionsExternalUrl).toBe('https://tunnel.example.com');

      await app.close();
    } finally {
      removeTestDir(testDir);
    }
  });
});
