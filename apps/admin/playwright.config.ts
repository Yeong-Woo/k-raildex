import { defineConfig, devices } from '@playwright/test';

// 관리 앱 E2E(NFR-ADM-004). 준비(DB·API·Vite)는 e2e/global-setup.ts — 주소는 E2E_BASE_URL 로 넘어온다.
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: './node_modules/.e2e-results',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    locale: 'ko-KR',
    trace: 'retain-on-failure',
  },
});
