import type { NextConfig } from 'next';

/**
 * 공개 사이트(docs/06-public-web.md). 데이터는 요청 때 서버가 공개 API(/v1/public/*)에서 받는다 — 데이터가 바뀌어도 다시 빌드하지 않는다(FR-WEB-001).
 * - 끝 '/' 를 유지한다(FR-WEB-004, 기존 URL).
 * - HTML 캐시 헤더(FR-WEB-003): 엣지(Cloudflare) 30초 + stale-while-revalidate. 데이터 fetch 캐시는 src/lib/api.ts(30초·태그).
 * - 모노레포: 워크스페이스 패키지(TS 원본)를 그대로 변환한다. standalone 출력은 docker/web.Dockerfile 이 쓴다.
 */
const allowedDevOrigins = [
  ...new Set(
    ['127.0.0.1', 'localhost', ...(process.env.DEV_ALLOWED_ORIGINS ?? '').split(',')]
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];

/** HTML 응답 캐시(FR-WEB-003, Q52 A: 쓰기 반영 30초 이내). 정적 파일(/_next)·Route Handler(/api)는 제외 */
export const HTML_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=300';

const config: NextConfig = {
  output: 'standalone',
  trailingSlash: true,
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@k-raildex/contracts', '@k-raildex/ui', '@k-raildex/map'],
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
  // 미래 지도 MapLibre 워커(Route Handler /api/map/worker/ 가 파일을 그대로 읽는다)
  outputFileTracingIncludes: { '/api/map/worker': ['./node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs'] },
  images: { unoptimized: true },
  allowedDevOrigins,
  // next dev 가 저장소에 AGENTS.md 를 만들지 않게(규칙은 루트 CLAUDE.md)
  agentRules: false,
  async headers() {
    return [
      {
        source: '/:path((?!_next/|api/).*)',
        headers: [
          { key: 'Cache-Control', value: HTML_CACHE_CONTROL },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default config;
