import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'importers',
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
