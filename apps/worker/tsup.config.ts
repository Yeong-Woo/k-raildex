import { defineConfig } from 'tsup';

// 작업 공간 패키지(@k-raildex/*)는 TS 원본이라 묶어 넣고, node_modules 의존성은 외부로 둔다
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@k-raildex\//],
});
