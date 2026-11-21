/**
 * 미래 지도 계획 정보 창(FR-WEB-025)용 요약 — 이름·단계·개통 예정(근거·발표 시점)·지연·출처 제목. 공개 API 계획 상세를 서버에서 읽어 줄인다.
 */
import { publicPlanDetailSchema } from '@k-raildex/contracts';
import { API_BASE, apiHeaders } from '@/lib/api-base';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[a-z0-9_-]{1,120}$/i.test(id)) return new Response('잘못된 계획 id', { status: 400 });
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/v1/public/plans/${encodeURIComponent(id)}`, {
      headers: apiHeaders(),
      next: { revalidate: 30, tags: ['kr-data', `kr-id:${id}`] },
    });
  } catch {
    return new Response('공개 API 에 연결하지 못함', { status: 503 });
  }
  if (res.status === 404 || res.status === 410 || res.status === 301) return Response.json(null, { status: 404 });
  if (!res.ok) return new Response('계획 자료 오류', { status: 502 });
  const parsed = publicPlanDetailSchema.safeParse(await res.json());
  if (!parsed.success) return new Response('계약과 다른 응답', { status: 502 });
  const p = parsed.data;
  const t = p.target_open;
  const src = t?.source_id ? p.sources.find((s) => s.source_id === t.source_id) : undefined;
  return Response.json(
    {
      id: p.id,
      name_ko: p.name_ko,
      name_full: p.name_full,
      stage: p.stage,
      target_open: t,
      target_source: src ? { title: src.title, publisher: src.publisher, type: src.type } : null,
      opened: p.opened,
      lines: p.lines.map((l) => ({ id: l.line_id, name_ko: l.name_ko, role: l.role })),
      station_count: p.stations.filter((s) => s.role === 'new').length,
      shape: p.shape,
      review_status: p.review_status,
    },
    { headers: { 'cache-control': 'public, max-age=30, stale-while-revalidate=300' } },
  );
}
