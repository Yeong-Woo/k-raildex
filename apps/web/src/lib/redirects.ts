/**
 * 옛 id 이동(FR-WEB-004, Q69 A — 순수 함수, test/redirects.test.ts).
 * - 경로: `/<절>/<옛 id>/` → 새 경로(API url_path, 상위 계획은 `/plans/programs/<새 id>/`) — 301
 * - 쿼리 값: 값이 옛 id 이면 새 id 로(예 `/plans/?program=national_rail_4` → `?program=pp-national-rail-4`) — 301
 * - 앵커: 서버는 볼 수 없으므로 페이지 스크립트(legacyAnchorScript)가 `#옛 id`·`#program-옛 id` 를 새 앵커로 바꾼다
 */

export interface RedirectEntry {
  old_id: string;
  new_id: string;
  type: string;
  url_path: string | null;
}

export type RedirectMap = ReadonlyMap<string, RedirectEntry>;

const DETAIL_SECTIONS: Record<string, string> = {
  lines: 'line',
  stations: 'station',
  services: 'service',
  plans: 'plan',
  'transfer-centers': 'transfer_center',
};

function detailPath(r: RedirectEntry, section: string): string {
  if (r.type === 'plan_program') return `/plans/programs/${encodeURIComponent(r.new_id)}/`;
  if (r.url_path && !r.url_path.includes('#')) return r.url_path;
  return `/${section}/${encodeURIComponent(r.new_id)}/`;
}

/** 새 경로 + 쿼리(바꿀 것이 없으면 null) */
export function resolveRedirect(pathname: string, search: string, map: RedirectMap): string | null {
  let path = pathname;
  const segs = pathname
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  // /plans/programs/<옛 id>/ 와 /<절>/<옛 id>/
  if (segs.length === 3 && segs[0] === 'plans' && segs[1] === 'programs') {
    const r = map.get(segs[2]!);
    if (r?.type === 'plan_program') path = detailPath(r, 'plans');
  } else if (segs.length === 2 && DETAIL_SECTIONS[segs[0]!]) {
    const r = map.get(segs[1]!);
    if (r) path = detailPath(r, segs[0]!);
  }
  const qs = new URLSearchParams(search);
  let qChanged = false;
  for (const [k, v] of [...qs.entries()]) {
    const r = map.get(v);
    if (r) {
      qs.set(k, r.new_id);
      qChanged = true;
    }
  }
  if (path === pathname && !qChanged) return null;
  // url_path 에 쿼리가 붙어 있으면 그대로 두고 남은 쿼리를 잇는다
  const s = qs.toString();
  if (!s) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${s}`;
}

/** 기존 역 목록 개통 필터(`?status=`) 값 → 새 `?opened=` 값(기본 opened 는 쿼리에서 뺀다) */
const LEGACY_STATION_STATUS: Record<string, string | null> = {
  open: null,
  '': 'all',
  unopened: 'unopened',
  operating: null,
  suspended: null,
  planned: 'unopened',
  under_construction: 'unopened',
  closed: 'closed',
  abandoned: 'closed',
};

/**
 * 기존 사이트에만 있던 경로·쿼리 이름 → 새 경로(WP 7.6 URL 전수 크롤, docs/legacy/url-crawl-2026-11-22.md). 바꿀 것이 없으면 null.
 * - `/timeline/2000-2004/`(기존 5년 단위 연대) → `/timeline/2000s/`(10년 단위). 항목 앵커(사건 id)는 그대로 쓰인다
 * - `/system-summary/`(기존 시스템 구조도 — 새 시스템에는 없음) → `/about/`
 * - `/stations/?status=` · `/stations/region/<slug>/?status=`(기존 개통 필터) → `?opened=`
 */
export function legacyRouteRedirect(pathname: string, search: string): string | null {
  let path = pathname;
  const five = /^\/timeline\/(\d{4})-(\d{4})\/$/.exec(pathname);
  if (five) path = `/timeline/${Math.floor(Number(five[1]) / 10) * 10}s/`;
  else if (pathname === '/system-summary/') path = '/about/';
  // 기존 노선도 원본 이미지(`/route-maps/<파일>.jpg`) → 노선도 페이지(원본은 문서로 게시, round-06 Q131 A)
  else if (pathname.startsWith('/route-maps/')) return '/maps/';
  const qs = new URLSearchParams(search);
  let qChanged = false;
  if ((pathname === '/stations/' || pathname.startsWith('/stations/region/')) && qs.has('status')) {
    const v = qs.get('status') ?? '';
    qs.delete('status');
    const opened = v in LEGACY_STATION_STATUS ? LEGACY_STATION_STATUS[v] : null;
    if (opened && !qs.has('opened')) qs.set('opened', opened);
    qChanged = true;
  }
  if (path === pathname && !qChanged) return null;
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/**
 * 옛 앵커 → 새 앵커(Q69 A). 페이지에 인라인으로 넣는 작은 스크립트 본문.
 * pairs = [옛 id, 새 id]. `#옛`, `#program-옛`(기존 계획 목록 차수 구역) 둘 다 본다.
 */
export function legacyAnchorScript(pairs: readonly (readonly [string, string])[]): string {
  const m: Record<string, string> = {};
  for (const [o, n] of pairs) m[o] = n;
  return `(function(){var m=${JSON.stringify(m).replace(/</g, '\\u003c')};function f(){var h;try{h=decodeURIComponent(location.hash.slice(1))}catch(e){return}if(!h||document.getElementById(h))return;var p=['','program-'];for(var i=0;i<p.length;i++){if(h.indexOf(p[i])!==0)continue;var n=m[h.slice(p[i].length)];if(n){var t=p[i]+n;history.replaceState(null,'','#'+encodeURIComponent(t));var el=document.getElementById(t);if(el)el.scrollIntoView();return}}}f();addEventListener('hashchange',f)})();`;
}
