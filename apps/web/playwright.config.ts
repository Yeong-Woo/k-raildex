import { defineConfig, devices } from '@playwright/test';

// 공개 사이트 연기 시험(smoke). 떠 있는 사이트(WEB_BASE_URL, 기본 dev 서버 http://127.0.0.1:5303)를 대상으로 한다.
// 사이트·공개 API 가 없으면 시험을 건너뛴다(e2e/smoke.spec.ts). 실행: pnpm -F @k-raildex/web e2e
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: './node_modules/.e2e-results',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.WEB_BASE_URL ?? 'http://127.0.0.1:5303',
    viewport: { width: 1440, height: 900 },
    locale: 'ko-KR',
  },
});
