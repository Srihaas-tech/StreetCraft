import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: 'web',
  server: {
    host: '0.0.0.0',
    port: 8102,
    strictPort: true,
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
  test: {
    include: ['tests/**/*.test.ts', '../server/tests/**/*.test.ts'],
    environment: 'jsdom',
  },
});
