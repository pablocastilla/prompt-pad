import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');
const RED_PIXEL_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4z8AAAAMAAgH2Qh4cAAAAAElFTkSuQmCC';

test.describe('File Attachment feature', () => {
  test('AttachedFilesBar drop zone is present in the editor', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // The drop zone button should be visible
    const dropZone = page.locator('.attach-drop-zone');
    await expect(dropZone).toBeVisible();

    await app.close();
  });

  test('getFileInfo IPC handler returns valid file metadata', async () => {
    const tmpFile = path.join(os.tmpdir(), 'pp-test-attach.txt');
    fs.writeFileSync(tmpFile, 'Hello from attached file', 'utf-8');

    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Call getFileInfo through the preload bridge (renderer context)
    const fileInfo = await page.evaluate(async (fp: string) => {
      return (window as unknown as { electronAPI: { getFileInfo: (p: string) => Promise<{ name: string; size: number } | null> } })
        .electronAPI.getFileInfo(fp);
    }, tmpFile);

    expect(fileInfo).not.toBeNull();
    expect(fileInfo?.name).toBe('pp-test-attach.txt');
    expect(fileInfo?.size).toBeGreaterThan(0);

    await app.close();
    fs.rmSync(tmpFile, { force: true });
  });

  test('getFileInfo IPC handler returns metadata for existing files', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Test with the project package.json
    const pkgPath = path.join(__dirname, '..', 'package.json');

    const info = await page.evaluate(async (fp: string) => {
      return (window as unknown as { electronAPI: { getFileInfo: (p: string) => Promise<{ name: string; size: number } | null> } })
        .electronAPI.getFileInfo(fp);
    }, pkgPath);

    expect(info).not.toBeNull();
    expect(info?.name).toBe('package.json');
    expect(info?.size).toBeGreaterThan(0);

    // Non-existent file returns null
    const missing = await page.evaluate(async (fp: string) => {
      return (window as unknown as { electronAPI: { getFileInfo: (p: string) => Promise<{ name: string; size: number } | null> } })
        .electronAPI.getFileInfo(fp);
    }, '/does/not/exist.txt');
    expect(missing).toBeNull();

    await app.close();
  });

  test('Dragging files over textarea applies file-drag-over style', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    const textarea = page.locator('.editor-textarea');
    await expect(textarea).toBeVisible();

    // Simulate dragover with Files type
    await page.evaluate(() => {
      const ta = document.querySelector('.editor-textarea') as HTMLElement;
      const evt = new DragEvent('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(evt, 'dataTransfer', {
        value: { types: ['Files'], dropEffect: '', effectAllowed: 'all' },
      });
      ta.dispatchEvent(evt);
    });

    // The textarea should gain the file-drag-over class
    await expect(textarea).toHaveClass(/file-drag-over/, { timeout: 3000 });

    await app.close();
  });

  test('AttachedFilesBar drop zone handles drop event', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    const bar = page.locator('.attached-files-bar');
    await expect(bar).toBeVisible();

    // Simulate drag-over on the bar
    await page.evaluate(() => {
      const bar = document.querySelector('.attached-files-bar') as HTMLElement;
      const overEvt = new DragEvent('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(overEvt, 'dataTransfer', {
        value: { types: ['Files'], dropEffect: '', effectAllowed: 'all' },
      });
      bar.dispatchEvent(overEvt);
    });

    await expect(bar).toHaveClass(/drag-over/, { timeout: 3000 });

    // Simulate dragleave
    await page.evaluate(() => {
      const bar = document.querySelector('.attached-files-bar') as HTMLElement;
      bar.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
    });

    await expect(bar).not.toHaveClass(/drag-over/, { timeout: 3000 });

    await app.close();
  });

  test('saveBlob IPC handler saves bytes as a temp PNG file', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Minimal 1×1 red PNG (89 bytes) – same bytes that Snipping Tool would produce
    const PNG_1x1 = [
      137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,2,0,0,0,
      144,119,83,222,0,0,0,12,73,68,65,84,8,215,99,248,207,192,0,0,0,2,0,1,
      226,33,188,51,0,0,0,0,73,69,78,68,174,66,96,130,
    ];

    const result = await page.evaluate(async (bytes: number[]) => {
      return (window as unknown as {
        electronAPI: { saveBlob: (b: number[], ext: string) => Promise<{ name: string; path: string; size: number } | null> }
      }).electronAPI.saveBlob(bytes, 'png');
    }, PNG_1x1);

    expect(result).not.toBeNull();
    expect(result?.name).toMatch(/^Pasted Image .+\.png$/);
    expect(result?.size).toBeGreaterThan(0);
    expect(result?.path).toMatch(/\.png$/);

    await app.close();
    if (result?.path) fs.rmSync(result.path, { force: true });
  });

  test('Pasting a native clipboard image shows an attached file chip', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    await app.evaluate(({ clipboard, nativeImage }, dataUrl: string) => {
      clipboard.writeImage(nativeImage.createFromDataURL(dataUrl));
    }, RED_PIXEL_PNG_DATA_URL);

    const clipboardHasImage = await page.evaluate(() => {
      return (window as unknown as { electronAPI: { clipboardHasImage: () => boolean } })
        .electronAPI.clipboardHasImage();
    });
    expect(clipboardHasImage).toBe(true);

    const directRead = await page.evaluate(async () => {
      return (window as unknown as {
        electronAPI: { readClipboardImage: () => Promise<{ name: string; path: string; size: number } | null> }
      }).electronAPI.readClipboardImage();
    });
    expect(directRead).not.toBeNull();
    expect(directRead?.name).toMatch(/^Pasted Image .+\.png$/);

    const textarea = page.locator('.editor-textarea');
    await textarea.click();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.paste();
    });

    const chip = page.locator('.attach-chip').first();
    await expect(chip).toBeVisible({ timeout: 5000 });
    await expect(chip).toContainText('Pasted Image');

    const chipPath = await chip.getAttribute('title');

    await app.close();
    if (chipPath) fs.rmSync(chipPath, { force: true });
  });
});
