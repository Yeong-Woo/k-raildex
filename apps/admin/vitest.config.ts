import { defineConfig } from 'vitest/config';
import { workspaceAlias } from './vite.config';

// 단위 시험만(src/**/*.test.*). e2e/ 의 Playwright 시험은 `pnpm -F @k-raildex/admin e2e` 로 따로 돈다.
export default defineConfig({
  resolve: { alias: workspaceAlias },
  test: {
    name: 'admin',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
  },
});
