import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 45000,
  workers: 2,
  use: {
    // No browser needed – Electron tests use _electron launcher
  },
});
