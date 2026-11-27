/**
 * 지도 GeoJSON·연도별 건수 중계(FR-WEB-002: 브라우저는 API 에 닿지 않는다). `/api/map/{lines|stations|plans|timeline|depots}/?at=&stage_min=&include_undated=`
 * → 공개 API `/v1/public/map/*`. 연도별 응답은 API 가 판 단위로 메모(public-cache.ts)하고, 여기서는 ETag·Cache-Control 을 그대로 넘겨
 * 브라우저가 연도마다 HTTP 캐시·304 를 쓴다(NFR-WEB-001 연도 전환 < 300ms — 화면도 연도별로 메모리에 둔다).
 */
import { API_BASE, apiHeaders } from '@/lib/api-base';

const UPSTREAM: Record<string, string> = {
  lines: '/v1/public/map/lines.geojson',
  stations: '/v1/public/map/stations.geojson',
  plans: '/v1/public/map/plans.geojson',
  timeline: '/v1/public/map/timeline',
  depots: '/v1/public/map/depots.geojson',
};
const ALLOWED = ['at', 'stage_min', 'include_undated'] as const;

export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  const up = UPSTREAM[kind];
  if (!up) return new Response('없는 지도 자료', { status: 404 });
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ALLOWED) {
    const v = src.get(k);
    if (v && /^[a-z0-9_]{1,20}$/i.test(v)) qs.set(k, v);
  }
  const inm = req.headers.get('if-none-match');
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${up}${qs.size ? `?${qs}` : ''}`, {
      headers: apiHeaders(inm ? { 'if-none-match': inm } : {}),
      cache: 'no-store',
    });
  } catch {
    return new Response('공개 API 에 연결하지 못함', { status: 503 });
  }
  if (res.status === 400) return new Response('잘못된 지도 조건', { status: 400 });
  if (!res.ok && res.status !== 304) return new Response('지도 자료 오류', { status: 502 });
  const headers = new Headers({
    'cache-control': res.headers.get('cache-control') ?? 'public, max-age=30, stale-while-revalidate=600',
    'x-content-type-options': 'nosniff',
  });
  for (const h of ['content-type', 'etag', 'x-data-version']) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(res.status === 304 ? null : res.body, { status: res.status, headers });
}
