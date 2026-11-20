import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Nest 데코레이터(legacy) 변환에 swc 를 쓴다. 주입은 @Inject 명시라 메타데이터가 없어도 동작한다
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    name: 'api',
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
