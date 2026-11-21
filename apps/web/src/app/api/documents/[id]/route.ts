/**
 * 공개 원문 다운로드 중계(FR-WEB-002·FR-WEB-005, Q39·Q75 A). 공개 API `/v1/public/documents/:id` 를 스트리밍으로 넘기고
 * 라이선스 헤더(X-License-Class·X-License-Notice)와 ETag 를 유지한다. 공개 대상이 아니면 API 가 404.
 */
import { API_BASE, apiHeaders } from '@/lib/api';

const PASS = [
  'content-type',
  'content-length',
  'content-disposition',
  'etag',
  'cache-control',
  'x-license-class',
  'x-license-notice',
  'x-content-type-options',
];

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('잘못된 원문 id', { status: 400 });
  const disp = new URL(req.url).searchParams.get('disposition') === 'inline' ? '?disposition=inline' : '';
  const inm = req.headers.get('if-none-match');
  const res = await fetch(`${API_BASE}/v1/public/documents/${id}${disp}`, {
    headers: apiHeaders(inm ? { 'if-none-match': inm, accept: '*/*' } : { accept: '*/*' }),
    cache: 'no-store',
  });
  if (res.status === 404) return new Response('공개 원문이 없습니다', { status: 404 });
  const headers = new Headers();
  for (const h of PASS) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(res.status === 304 ? null : res.body, { status: res.status, headers });
}
