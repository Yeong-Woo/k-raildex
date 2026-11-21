/**
 * MapLibre 워커 파일(ESM) — 패키지 파일을 그대로 내보낸다(setWorkerUrl). 번들러가 워커를 따로 옮기지 않아도 되게(관리 앱은 Vite `?url`).
 * 경로는 앱 폴더 기준(next dev·standalone server.js 모두 cwd = apps/web). standalone 추적은 next.config `outputFileTracingIncludes`.
 * 판(maplibre-gl 버전)이 같으면 내용이 같으므로 오래 캐시한다.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const WORKER = path.join(process.cwd(), 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl-worker.mjs');
let body: Promise<Buffer> | null = null;

export async function GET() {
  body ??= readFile(WORKER);
  try {
    const buf = await body;
    return new Response(new Uint8Array(buf), {
      headers: {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (e) {
    body = null;
    console.error(`[web] MapLibre 워커 파일 읽기 실패: ${(e as Error).message}`);
    return new Response('워커 파일 없음', { status: 500 });
  }
}
