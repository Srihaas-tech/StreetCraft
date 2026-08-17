import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './web/tests/e2e',
  use: {
    baseURL: 'http://127.0.0.1:8102',
  },
});
