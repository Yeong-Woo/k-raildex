import { defineConfig } from 'tsup';

// 작업 공간 패키지(@k-raildex/*)는 TS 원본이라 묶어 넣고, node_modules 의존성은 외부로 둔다.
// 데코레이터는 tsconfig 의 experimentalDecorators 로 esbuild 가 변환한다. emitDecoratorMetadata 는 esbuild 가
// 지원하지 않으므로 모든 생성자 주입에 @Inject(토큰)을 명시한다(src/README 대신 app.module.ts 주석 참고).
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
