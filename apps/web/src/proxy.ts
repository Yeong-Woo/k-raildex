/**
 * 옛 id 301(FR-WEB-004, Q69 A) — Next 16 proxy(옛 middleware). 공개 API `/v1/public/redirects` 를 5분 캐시해
 * 경로(`/transfer-centers/tc-…/` → `/transfer-centers/xc-…/`)와 쿼리 값(`?program=national_rail_4`)을 영구 이동(301)한다.
 * 서버 컴포넌트의 permanentRedirect 는 308 이라, 옛 id 는 여기서 먼저 301 로 잡는다(API 가 301 을 주는 경우 lib/api.ts 의 308 은 예비).
 * API 에 닿지 않으면 그냥 통과시킨다(페이지가 오류 화면을 낸다).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { API_BASE, apiHeaders } from '@/lib/api-base';
import { resolveRedirect, type RedirectEntry } from '@/lib/redirects';

const TTL_MS = 5 * 60_000;
let cache: { at: number; map: Map<string, RedirectEntry> } | null = null;
let inflight: Promise<Map<string, RedirectEntry>> | null = null;

async function load(): Promise<Map<string, RedirectEntry>> {
  const res = await fetch(`${API_BASE}/v1/public/redirects`, { headers: apiHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(`redirects ${res.status}`);
  const body = (await res.json()) as { items: RedirectEntry[] };
  return new Map(body.items.map((r) => [r.old_id, r]));
}

async function redirectMap(): Promise<Map<string, RedirectEntry> | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  inflight ??= load().finally(() => (inflight = null));
  try {
    const map = await inflight;
    cache = { at: Date.now(), map };
    return map;
  } catch {
    // 실패하면 지난 목록이라도 쓴다
    return cache?.map ?? null;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const map = await redirectMap();
  if (!map || map.size === 0) return NextResponse.next();
  const to = resolveRedirect(pathname, search, map);
  if (!to) return NextResponse.next();
  return NextResponse.redirect(new URL(to, req.nextUrl), 301);
}

export const config = {
  // 페이지 경로만(정적 파일·Route Handler·파일 확장자 경로 제외)
  matcher: ['/((?!_next/|api/|.*\\.[A-Za-z0-9]+$).*)'],
};
