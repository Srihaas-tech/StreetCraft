import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: 'web',
  server: {
    host: '0.0.0.0',
    port: 8102,
    strictPort: true,
    proxy: {
      '/bluemap': {
        target: 'http://127.0.0.1:8101',
        changeOrigin: true,
      },
    },
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
