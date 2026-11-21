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
  // 묶인 CJS 의존성(예: 수집기의 exceljs)이 Node 내장 모듈을 require 할 수 있게 ESM 번들에 require 를 만든다
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
