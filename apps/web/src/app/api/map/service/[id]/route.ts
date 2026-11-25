/**
 * 지도 "운행 계통" 강조(FR-WEB-029)용 계통 선형 중계 → 공개 API `/v1/public/map/services/{id}.geojson`.
 * 브라우저는 API 에 닿지 않는다(FR-WEB-002). ETag·Cache-Control 은 그대로 넘긴다.
 */
import { API_BASE, apiHeaders } from '@/lib/api-base';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[a-z0-9_-]{1,120}$/i.test(id)) return new Response('잘못된 운행 계통 id', { status: 400 });
  const inm = req.headers.get('if-none-match');
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/v1/public/map/services/${encodeURIComponent(id)}.geojson`, {
      headers: apiHeaders(inm ? { 'if-none-match': inm } : {}),
      cache: 'no-store',
    });
  } catch {
    return new Response('공개 API 에 연결하지 못함', { status: 503 });
  }
  if (res.status === 404) return Response.json(null, { status: 404 });
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
