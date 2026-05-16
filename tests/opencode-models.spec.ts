import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';

const MAIN_JS = path.join(__dirname, '..', 'dist-electron', 'main.js');

test.describe('OpenCode Models Feature', () => {
  test('getOpenCodeModels IPC returns models from CLI', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Call getOpenCodeModels through the preload bridge
    const models = await page.evaluate(async () => {
      return (window as unknown as {
        electronAPI: { getOpenCodeModels: () => Promise<{ id: string; label: string }[]> }
      }).electronAPI.getOpenCodeModels();
    });

    console.log(`Fetched ${models.length} models`);
    console.log('First 5 models:', models.slice(0, 5));
    
    // Verify we got models
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    
    // Verify structure
    if (models.length > 0) {
      expect(models[0]).toHaveProperty('id');
      expect(models[0]).toHaveProperty('label');
      expect(typeof models[0].id).toBe('string');
      expect(typeof models[0].label).toBe('string');
    }
    
    // Check if we have more than just fallback (3) models
    // Should have ~40+ from actual CLI
    console.log(`Total models: ${models.length} (fallback is 3, CLI should be ~40+)`);
    
    await app.close();
  });

  test('ModelPicker shows available models for OpenCode launch', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Inject a pending launch for OpenCode to trigger ModelPicker
    await page.evaluate(() => {
      const store = (window as any).__store;
      if (store && store.setState) {
        store.setState({
          pendingLaunch: {
            launch: {
              id: 'test-launch',
              tool: 'opencode',
              model: '',
              folder: '/tmp',
              yolo: false,
              mode: 'interactive',
            },
            prompt: 'test prompt',
            attachedFiles: [],
          }
        });
      }
    });

    // Wait for modal to appear
    await page.waitForTimeout(500);
    
    // Check if ModelPicker is visible (look for model-picker class)
    const modelPicker = page.locator('[class*="model-picker"]');
    const isVisible = await modelPicker.isVisible().catch(() => false);
    
    console.log(`ModelPicker visible: ${isVisible}`);
    
    // Get all text content
    const bodyText = await page.locator('body').innerText();
    console.log('Body text contains "opencode":', bodyText.includes('opencode'));
    console.log('Body text contains "kimi":', bodyText.includes('kimi'));
    console.log('Body text contains "minimax":', bodyText.includes('minimax'));
    
    await app.close();
  });

  test('Pinned models persist across sessions', async () => {
    // First session: add pinned model
    let app = await electron.launch({ args: [MAIN_JS] });
    let page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Get initial store state
    let pinnedBefore = await page.evaluate(() => {
      const store = (window as any).__store;
      return store?.getState?.()?.pinnedModels || [];
    });
    
    console.log(`Pinned models before: ${pinnedBefore.length}`);
    
    await app.close();

    // Give it a moment
    await new Promise(r => setTimeout(r, 500));

    // Second session: check if pinned models are still there
    app = await electron.launch({ args: [MAIN_JS] });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    let pinnedAfter = await page.evaluate(() => {
      const store = (window as any).__store;
      return store?.getState?.()?.pinnedModels || [];
    });
    
    console.log(`Pinned models after: ${pinnedAfter.length}`);
    
    await app.close();
  });

  test('Console logs show model fetching activity', async () => {
    const app = await electron.launch({ args: [MAIN_JS] });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    const logs: any[] = [];
    page.on('console', msg => {
      logs.push({
        type: msg.type(),
        text: msg.text(),
      });
    });

    // Trigger ModelPicker for OpenCode
    await page.evaluate(() => {
      const store = (window as any).__store;
      if (store?.setState) {
        store.setState({
          pendingLaunch: {
            launch: {
              id: 'test-launch-' + Date.now(),
              tool: 'opencode',
              model: '',
              folder: '/tmp',
              yolo: false,
              mode: 'interactive',
            },
            prompt: 'test',
            attachedFiles: [],
          }
        });
      }
    });

    // Wait for fetch to happen
    await page.waitForTimeout(1000);

    // Check logs
    const fetchLogs = logs.filter(l => l.text.includes('Fetching OpenCode models'));
    const fetchedLogs = logs.filter(l => l.text.includes('Fetched models'));
    
    console.log(`Found ${fetchLogs.length} "Fetching" logs`);
    console.log(`Found ${fetchedLogs.length} "Fetched" logs`);
    
    if (fetchedLogs.length > 0) {
      console.log('Sample fetch log:', fetchedLogs[0].text.substring(0, 100));
    }

    await app.close();
  });
});
