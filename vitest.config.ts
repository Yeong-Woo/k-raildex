import { defineConfig } from 'vitest/config';

// 워크스페이스 전체 시험. 패키지마다 vitest.config.ts 가 있으면 그 설정을 프로젝트로 쓴다.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    passWithNoTests: true,
  },
});
