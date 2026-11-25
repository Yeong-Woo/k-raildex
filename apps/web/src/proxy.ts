/**
 * 옛 id 301(FR-WEB-004, Q69 A) — Next 16 proxy(옛 middleware). 공개 API `/v1/public/redirects` 를 5분 캐시해
 * 경로(`/transfer-centers/tc-…/` → `/transfer-centers/xc-…/`)와 쿼리 값(`?program=national_rail_4`)을 영구 이동(301)한다.
 * 서버 컴포넌트의 permanentRedirect 는 308 이라, 옛 id 는 여기서 먼저 301 로 잡는다(API 가 301 을 주는 경우 lib/api.ts 의 308 은 예비).
 * API 에 닿지 않으면 그냥 통과시킨다(페이지가 오류 화면을 낸다).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { API_BASE, apiHeaders } from '@/lib/api-base';
import { legacyRouteRedirect, resolveRedirect, type RedirectEntry } from '@/lib/redirects';

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
  // 기존 사이트에만 있던 경로·쿼리 이름(API 와 무관) → 그 결과에 옛 id 이동을 한 번 더 — 301 한 번으로 끝낸다
  const legacy = legacyRouteRedirect(pathname, search);
  const u = legacy ? new URL(legacy, req.nextUrl) : null;
  const p = u ? u.pathname : pathname;
  const s = u ? u.search : search;
  const map = await redirectMap();
  const to = map && map.size > 0 ? resolveRedirect(p, s, map) : null;
  const dest = to ?? legacy;
  if (!dest) return NextResponse.next();
  return NextResponse.redirect(new URL(dest, req.nextUrl), 301);
}

export const config = {
  // 페이지 경로만(정적 파일·Route Handler·파일 확장자 경로 제외)
  // 기존 노선도 이미지 주소(`/route-maps/*.jpg`)는 확장자가 있어도 받는다
  matcher: ['/((?!_next/|api/|.*\\.[A-Za-z0-9]+$).*)', '/route-maps/:path*'],
};
