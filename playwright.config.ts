import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    // No browser needed – Electron tests use _electron launcher
  },
});
