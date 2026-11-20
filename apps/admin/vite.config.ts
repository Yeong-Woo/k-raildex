import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 개발 서버는 /v1·/health 를 관리 API 로 넘긴다. 운영에서는 같은 호스트(Cloudflare Access 뒤)의 리버스 프록시가 맡는다.
const apiTarget = process.env.ADMIN_API_PROXY ?? 'http://127.0.0.1:5101';
const port = Number(process.env.ADMIN_PORT ?? 5201);

/**
 * 워크스페이스 소스 별칭. @k-raildex/domain 은 서버 의존(pg)이 있어 브라우저 안전한 calc 만 쓰고,
 * @k-raildex/map 은 의존성 없는 스타일 모음이다. package.json 의존성 연결 전에도 동작하도록 경로로 묶는다(tsconfig paths 와 같음).
 */
export const workspaceAlias = {
  '@k-raildex/domain/calc': fileURLToPath(new URL('../../packages/domain/src/calc.ts', import.meta.url)),
  '@k-raildex/map': fileURLToPath(new URL('../../packages/map/src/index.ts', import.meta.url)),
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: workspaceAlias },
  // 지도 화면은 지연 로드라 첫 방문 때 의존성 재최적화(전체 새로 고침)가 나지 않게 미리 묶는다
  optimizeDeps: { include: ['maplibre-gl', '@dnd-kit/core', '@dnd-kit/sortable'] },
  server: {
    host: '127.0.0.1',
    port,
    strictPort: !!process.env.ADMIN_PORT,
    proxy: { '/v1': apiTarget, '/health': apiTarget },
  },
  preview: { host: '127.0.0.1', port: 5200 },
});
