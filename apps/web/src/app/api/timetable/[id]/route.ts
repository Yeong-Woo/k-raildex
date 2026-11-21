/**
 * 역 전체 시간표 중계(FR-WEB-002: 브라우저는 API 에 직접 닿지 않는다). 공개 API 응답을 계약으로 검증해 그대로 넘긴다.
 * 캐시: 데이터 fetch 30초(lib/api.ts) + 응답 s-maxage 30.
 */
import { NextResponse } from 'next/server';
import { getTimetable } from '@/lib/data';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[a-z0-9-]{1,120}$/.test(id)) return NextResponse.json({ error: 'bad_id' }, { status: 400 });
  const tt = await getTimetable(id);
  if (!tt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(tt, {
    headers: { 'cache-control': 'public, s-maxage=30, stale-while-revalidate=300' },
  });
}
