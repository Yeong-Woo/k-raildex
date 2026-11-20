import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'domain',
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
