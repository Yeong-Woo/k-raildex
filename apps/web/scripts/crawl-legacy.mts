/**
 * 기존 사이트 URL 전수 크롤(WP 7.6, docs/11-implementation-plan.md M7 완료 기준 "기존 URL 전수 크롤 200/301").
 *
 * 1) 기존 사이트(--legacy, 기본 http://127.0.0.1:5000)의 sitemap.xml + 모든 페이지의 내부 링크(쿼리·앵커 포함)
 *    + 기존 라우트 정의(future-rail-db apps/web/src/app/**)에서 사이트맵·링크에 안 나오는 경로·쿼리 변형을 모은다.
 * 2) 새 사이트(--target, 기본 http://127.0.0.1:5203 = 운영 컨테이너)에 리디렉션을 따라가지 않고 요청해 상태를 적는다.
 *    3xx 면 Location 을 한 번 더 요청해 200 인지 본다. 목표: 모든 페이지 URL → 200 또는 301 → 200.
 * 3) 앵커(#…)는 서버가 못 보므로 새 HTML 에 그 id 가 있거나 옛 앵커 스크립트(legacyAnchorScript)의 표에 있는지 본다(경고).
 * 4) 쿼리 키는 새 페이지가 같은 키의 링크(탭·필터)를 갖고 있는지로 "알아듣는지"를 어림한다(경고).
 *
 * 실행: pnpm -F @k-raildex/web crawl:legacy [-- --legacy URL --target URL --out 파일 --concurrency 8]
 * 결과: 표준 출력 요약 + 보고서(기본 docs/legacy/url-crawl-<오늘>.md). 실패가 있으면 종료 코드 1.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface Options {
  legacy: string;
  target: string;
  out: string;
  concurrency: number;
  date: string;
}

function parseArgs(argv: string[]): Options {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const date = get('date') ?? new Date().toISOString().slice(0, 10);
  const repoRoot = resolve(new URL('.', import.meta.url).pathname, '../../..');
  return {
    legacy: (get('legacy') ?? process.env.LEGACY_BASE_URL ?? 'http://127.0.0.1:5000').replace(/\/$/, ''),
    target: (get('target') ?? process.env.WEB_BASE_URL ?? 'http://127.0.0.1:5203').replace(/\/$/, ''),
    out: resolve(get('out') ?? `${repoRoot}/docs/legacy/url-crawl-${date}.md`),
    concurrency: Number(get('concurrency') ?? 8),
    date,
  };
}

/** 기존 라우트 정의에서 온 경로(사이트맵·링크에 없을 수 있는 것) — future-rail-db apps/web/src/app/** */
const LEGACY_ROUTE_PAGES = [
  '/plans/programs/',
  '/system-summary/',
  '/search/', // 기존에는 없었지만 머리 검색 폼 대상이 바뀌어 같이 본다
];

/** 기존 클라이언트 스크립트가 만들던 쿼리 변형(링크로는 안 나옴 — site-structure.md 1·13·14절) */
const LEGACY_QUERY_VARIANTS = [
  '/stations/?status=unopened',
  '/stations/?status=open',
  '/stations/?status=',
  '/stations/?kind=with',
  '/stations/?kind=only',
  '/stations/?q=%EC%84%9C%EC%9A%B8',
  '/stations/?area=all#area-all',
  '/stations/?area=southeast&class=high_speed',
  '/stations/region/capital/?class=high_speed',
  '/stations/region/capital/?status=unopened',
  '/lines/?area=all#area-all',
  '/lines/?area=southeast&class=high_speed',
  '/services/?group=metro&area=all',
  '/plans/?program=national_rail_4&area=all#program-national_rail_4',
  '/trains/?n=102',
  '/trains/?n=2500',
  '/timeline/?type=opened',
  '/map/#line=line-seoul-2',
  '/map/#station=stn-seoul',
];

/** 기존 데이터 파일 라우트(브라우저 스크립트용 — 페이지 아님). 새 사이트는 Route Handler(/api/…)로 바꿨다 */
const LEGACY_DATA_FILES = [
  '/search-index.json',
  '/map/lines.geojson',
  '/map/stations.geojson',
  '/map/plans.geojson',
  '/stations/by-area/southeast.json',
  '/stations/by-area/honam.json',
  '/timetable/stn-seoul.json',
  '/favicon.svg',
];

/**
 * 알려진 차이(보고서에 이유를 붙인다 — 고치려면 데이터·API 변경이나 사용자 결정이 필요한 것).
 * 고쳐지면 여기서 지운다. docs/review/notes.md "(M7 7.6)" 항목과 같이 본다.
 */
const KNOWN_GAPS: { re: RegExp; reason: string }[] = [
  {
    re: /^\/timeline\/unknown\//,
    reason: '연도 미상 연표 — 공개 API 에 날짜 없는 사건 조건이 없다(round-05 Q117, API 변경 필요)',
  },
  {
    re: /^\/stations\/stn-sinheung\/$/,
    reason:
      '관리 앱에서 삭제된 역(2026-11-21), id_redirect 없음 — 동명 역 2곳(대전·경기) 중 어디로 옮길지 데이터 판단 필요',
  },
  {
    re: /^\/route-maps\//,
    reason:
      '기존 노선도 원본 이미지 — 새 DB 노선도가 모두 link 형식(document 없음). 원본을 문서로 올리면 /api/documents/ 로 연결 가능',
  },
  { re: /^\/timeline\/.*[?&]area=/, reason: '연표 권역 필터 — 공개 API 연표 항목에 권역이 없다(API 변경 필요)' },
  {
    re: /^\/stations\/.*[?&]kind=/,
    reason: '시설(신호장·차량기지 등) 목록 — 공개 API 역 목록이 여객역만 준다(API 변경 필요)',
  },
  {
    re: /^\/lines\/.*class=freight/,
    reason: '여객 미취급 노선 탭 — 공개 API 노선 목록에 여객 취급 여부가 없다(API 변경 필요)',
  },
  { re: /^\/terms\/#추가-예정/, reason: '기존 "추가 예정·미정의 용어" 절 — 새 용어 사전에 없는 절' },
  { re: /^\/terms\/#노선과-운행-계통/, reason: '기존 사이트에서도 없던 앵커(깨진 링크)' },
];
/** 링크·폼 없이 서버가 읽는 쿼리 키(쿼리 키 경고에서 뺀다) */
const SERVER_ONLY_KEYS: Record<string, string[]> = { '/stations/:id/': ['day'] };

const knownGap = (url: string) => KNOWN_GAPS.find((g) => g.re.test(url))?.reason;

/** 새 지도(lib/map-years.ts parseHash)가 읽는 해시 키 → 상세 절 */
const MAP_HASH_KEYS: Record<string, string> = { line: 'lines', station: 'stations', plan: 'plans' };

type Kind = 'page' | 'feed' | 'data' | 'asset';

function kindOf(pathname: string): Kind {
  if (/^\/(sitemap\.xml|robots\.txt|changes\.xml)$/.test(pathname)) return 'feed';
  if (/\.(json|geojson)$/.test(pathname)) return 'data';
  if (pathname.startsWith('/_next/') || /\.[a-z0-9]{2,5}$/i.test(pathname)) return 'asset';
  return 'page';
}

/** 경로 → 모양(보고서 묶음용): 상세 id 를 :id 로 */
function patternOf(pathname: string): string {
  return pathname
    .replace(/^\/(lines|stations|services|plans|transfer-centers)\/(?!region\/|programs\/)[^/]+\/$/, '/$1/:id/')
    .replace(/^\/stations\/region\/[^/]+\/$/, '/stations/region/:slug/')
    .replace(/^\/plans\/programs\/[^/]+\/$/, '/plans/programs/:id/')
    .replace(/^\/timeline\/[^/]+\/$/, '/timeline/:decade/');
}

async function pool<T>(items: readonly T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, n) }, async () => {
      while (i < items.length) {
        const x = items[i++]!;
        await fn(x);
      }
    }),
  );
}

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

function hrefsOf(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/gi)) out.push(decodeEntities(m[1]!));
  return out;
}

function idsOf(html: string): Set<string> {
  const s = new Set<string>();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) s.add(decodeEntities(m[1]!));
  return s;
}

/** 새 페이지의 옛 앵커 표(legacyAnchorScript 의 `var m={…}`) */
function legacyAnchorMapOf(html: string): Record<string, string> {
  const m = /var m=(\{.*?\});function f\(\)/.exec(html);
  if (!m) return {};
  try {
    return JSON.parse(m[1]!.replace(/\\u003c/g, '<')) as Record<string, string>;
  } catch {
    return {};
  }
}

async function get(
  url: string,
  timeoutMs = 30_000,
): Promise<{ status: number; location: string | null; body: string; ms: number; error?: string }> {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('html') ? await res.text() : (await res.arrayBuffer(), '');
    return { status: res.status, location: res.headers.get('location'), body, ms: performance.now() - t0 };
  } catch (e) {
    return {
      status: 0,
      location: null,
      body: '',
      ms: performance.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

interface Row {
  /** 경로 + 쿼리(앵커 제외) */
  url: string;
  kind: Kind;
  from: 'sitemap' | 'link' | 'route' | 'variant';
  legacyStatus?: number;
  status?: number;
  location?: string | null;
  finalStatus?: number;
  ok?: boolean;
  reason?: string;
  ms?: number;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const rows = new Map<string, Row>();
  const anchors = new Map<string, Set<string>>();
  const add = (pathAndQuery: string, from: Row['from'], hash?: string) => {
    const u = new URL(pathAndQuery, 'http://x');
    const key = u.pathname + u.search;
    if (!rows.has(key)) rows.set(key, { url: key, kind: kindOf(u.pathname), from });
    const h = hash ?? (u.hash ? u.hash.slice(1) : '');
    if (h) {
      if (!anchors.has(key)) anchors.set(key, new Set());
      anchors.get(key)!.add(h);
    }
  };

  // 1) 사이트맵
  const sm = await fetch(`${o.legacy}/sitemap.xml`).then((r) => (r.ok ? r.text() : ''));
  const smUrls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(decodeEntities(m[1]!)).pathname);
  for (const p of smUrls) add(p, 'sitemap');
  for (const p of ['/sitemap.xml', '/robots.txt', '/changes.xml']) add(p, 'route');
  for (const p of LEGACY_ROUTE_PAGES) add(p, 'route');
  for (const p of LEGACY_QUERY_VARIANTS) add(p, 'variant');
  for (const p of LEGACY_DATA_FILES) add(p, 'route');
  console.log(`기존 사이트맵 ${smUrls.length}개`);

  // 2) 기존 페이지 크롤(내부 링크 — 쿼리·앵커 포함). 페이지 HTML 은 경로당 한 번
  const crawled = new Set<string>();
  let frontier = [...rows.values()].filter((r) => r.kind === 'page').map((r) => r.url);
  const legacyOrigin = new URL(o.legacy).origin;
  while (frontier.length) {
    const next: string[] = [];
    await pool(frontier, o.concurrency, async (u) => {
      if (crawled.has(u)) return;
      crawled.add(u);
      const r = await get(o.legacy + u);
      const row = rows.get(u);
      if (row) row.legacyStatus = r.status;
      if (r.status !== 200 || !r.body) return;
      for (const href of hrefsOf(r.body)) {
        if (!href || href.startsWith('mailto:') || href.startsWith('javascript:')) continue;
        let abs: URL;
        try {
          abs = new URL(href, o.legacy + u);
        } catch {
          continue;
        }
        if (abs.origin !== legacyOrigin && abs.hostname !== 'k-raildex.com') continue;
        const key = abs.pathname + abs.search;
        const isNew = !rows.has(key);
        add(key + abs.hash, 'link');
        // 쿼리 없는 새 페이지 경로만 더 따라간다(쿼리 변형은 같은 페이지)
        if (isNew && !abs.search && kindOf(abs.pathname) === 'page') next.push(key);
      }
    });
    frontier = next;
  }
  console.log(`기존 페이지 ${crawled.size}개 크롤, URL ${rows.size}개(앵커 붙은 URL ${anchors.size}개)`);

  // 기존 사이트에서도 200 이 아닌 링크는 대상에서 뺀다(깨진 링크 — 보고서에 따로)
  const legacyBroken: Row[] = [];
  await pool(
    [...rows.values()].filter((r) => r.legacyStatus === undefined),
    o.concurrency,
    async (r) => {
      r.legacyStatus = (await get(o.legacy + r.url)).status;
    },
  );
  for (const r of rows.values()) if (r.legacyStatus !== 200) legacyBroken.push(r);

  // 3) 새 사이트 요청
  const targetHtml = new Map<string, string>();
  const targets = [...rows.values()].filter((r) => r.legacyStatus === 200);
  await pool(targets, o.concurrency, async (r) => {
    const a = await get(o.target + r.url);
    r.status = a.status;
    r.ms = a.ms;
    r.location = a.location;
    if (a.error) r.reason = a.error;
    if (a.status === 200) {
      r.finalStatus = 200;
      if (a.body) targetHtml.set(r.url, a.body);
    } else if (a.status >= 300 && a.status < 400 && a.location) {
      const loc = new URL(a.location, o.target + r.url);
      const b = await get(loc.toString());
      r.finalStatus = b.status;
      if (b.status === 200 && b.body) targetHtml.set(r.url, b.body);
      if (b.status !== 200) r.reason = `이동 대상 ${loc.pathname}${loc.search} → ${b.status}`;
      else if (a.status !== 301) r.reason = `${a.status} 이동(301 이 아님)`;
    } else if (!r.reason) r.reason = a.status === 404 ? '새 사이트에 없음(404)' : `상태 ${a.status}`;
    r.ok = r.status === 200 || (r.status === 301 && r.finalStatus === 200);
  });

  // 4) 앵커: 새 HTML 에 id 가 있거나 옛 앵커 표로 바뀌는지.
  //    `#line=…` 같은 상태 해시(지도)는 id 가 아니다 — 새 지도가 읽는 키인지, 가리키는 개체 상세가 통과하는지 본다
  const anchorMissing: { url: string; hash: string }[] = [];
  const stateHashBad: { url: string; hash: string; why: string }[] = [];
  let anchorTotal = 0;
  let stateHashTotal = 0;
  const detailOk = (section: string, id: string) => rows.get(`/${section}/${encodeURIComponent(id)}/`)?.ok === true;
  for (const [url, hs] of anchors) {
    const html = targetHtml.get(url);
    if (!html) continue;
    const ids = idsOf(html);
    const legacy = legacyAnchorMapOf(html);
    for (const h of hs) {
      let dec = h;
      try {
        dec = decodeURIComponent(h);
      } catch {
        /* 그대로 */
      }
      if (dec.includes('=')) {
        stateHashTotal++;
        for (const part of dec.split('&')) {
          const [k, v = ''] = part.split('=');
          const section = MAP_HASH_KEYS[k ?? ''];
          if (!url.startsWith('/map/') || !section)
            stateHashBad.push({ url, hash: dec, why: `새 지도가 읽지 않는 키 \`${k}\`` });
          else if (!detailOk(section, v)) stateHashBad.push({ url, hash: dec, why: `\`${v}\` 상세가 통과하지 않음` });
        }
        continue;
      }
      anchorTotal++;
      const mapped =
        legacy[dec] ??
        (dec.startsWith('program-') ? legacy[dec.slice(8)] && `program-${legacy[dec.slice(8)]}` : undefined);
      if (ids.has(dec) || (mapped && ids.has(mapped))) continue;
      anchorMissing.push({ url, hash: dec });
    }
  }

  // 5) 쿼리 키: 새 페이지에 같은 키의 링크(탭·필터 링크)나 폼 필드가 있는지
  const queryWarn = new Map<string, { key: string; pattern: string; example: string; count: number }>();
  for (const r of targets) {
    if (!r.url.includes('?') || r.kind !== 'page') continue;
    const u = new URL(r.url, 'http://x');
    const html = targetHtml.get(r.url);
    if (!html) continue;
    // 301 이 쿼리 이름을 바꿔 준 경우(예 ?status= → ?opened=)는 이동한 주소의 키를 본다
    const moved = r.status === 301 && r.location ? new URL(r.location, 'http://x').searchParams : null;
    for (const k of new Set(u.searchParams.keys())) {
      if (moved && !moved.has(k)) continue;
      if (SERVER_ONLY_KEYS[patternOf(u.pathname)]?.includes(k)) continue;
      const known = new RegExp(`href="[^"]*[?&;]${k}=|name="${k}"`).test(html);
      if (known) continue;
      const id = `${patternOf(u.pathname)} ?${k}=`;
      const w = queryWarn.get(id) ?? { key: k, pattern: patternOf(u.pathname), example: r.url, count: 0 };
      w.count++;
      queryWarn.set(id, w);
    }
  }

  // 요약
  const byKind = new Map<Kind, Map<string, number>>();
  for (const r of targets) {
    const st =
      r.status === 200
        ? '200'
        : r.status && r.status >= 300 && r.status < 400
          ? `${r.status}→${r.finalStatus}`
          : String(r.status);
    const m = byKind.get(r.kind) ?? new Map<string, number>();
    m.set(st, (m.get(st) ?? 0) + 1);
    byKind.set(r.kind, m);
  }
  const pages = targets.filter((r) => r.kind === 'page' || r.kind === 'feed');
  const failures = pages.filter((r) => !r.ok);
  const dataRows = targets.filter((r) => r.kind === 'data' || r.kind === 'asset');
  const byPattern = new Map<string, { n: number; ok: number; maxMs: number }>();
  for (const r of pages) {
    const p = patternOf(r.url.split('?')[0]!) + (r.url.includes('?') ? ' (쿼리)' : '');
    const e = byPattern.get(p) ?? { n: 0, ok: 0, maxMs: 0 };
    e.n++;
    if (r.ok) e.ok++;
    e.maxMs = Math.max(e.maxMs, r.ms ?? 0);
    byPattern.set(p, e);
  }

  const lines: string[] = [];
  lines.push(`# 기존 URL 전수 크롤 (${o.date})`);
  lines.push('');
  lines.push(
    `> \`apps/web/scripts/crawl-legacy.mts\` 가 만든 보고서(WP 7.6). 기존 사이트 \`${o.legacy}\` → 새 사이트 \`${o.target}\`. 리디렉션은 따라가지 않고 상태를 적은 뒤 3xx 는 Location 을 한 번 더 요청했다. 목표: 모든 페이지 URL → 200, 또는 301 → 200(docs/11-implementation-plan.md M7).`,
  );
  lines.push('');
  lines.push('## 1. 합계');
  lines.push('');
  lines.push(
    `- 기존 사이트맵 ${smUrls.length}개, 크롤한 기존 페이지 ${crawled.size}개, 모은 URL(경로+쿼리) ${rows.size}개, 앵커 ${anchorTotal}개`,
  );
  lines.push(`- 기존 사이트에서도 200 이 아닌 URL ${legacyBroken.length}개(대상에서 뺌 — 4절)`);
  lines.push(
    `- **페이지·피드 ${pages.length}개 중 통과 ${pages.length - failures.length}개, 실패 ${failures.length}개**`,
  );
  lines.push('');
  lines.push('| 종류 | 상태 | 개수 |');
  lines.push('| ---- | ---- | ---: |');
  for (const [k, m] of byKind) for (const [s, n] of [...m].sort()) lines.push(`| ${k} | ${s} | ${n} |`);
  lines.push('');
  lines.push('## 2. 경로 모양별');
  lines.push('');
  lines.push('| 경로 모양 | URL | 통과 | 가장 느린 응답(ms) |');
  lines.push('| --------- | --: | ---: | -----------------: |');
  for (const [p, e] of [...byPattern].sort()) lines.push(`| \`${p}\` | ${e.n} | ${e.ok} | ${Math.round(e.maxMs)} |`);
  lines.push('');
  lines.push('## 3. 실패(페이지·피드)');
  lines.push('');
  if (!failures.length) lines.push('없음.');
  else {
    lines.push('| URL | 상태 | 이유 |');
    lines.push('| --- | ---- | ---- |');
    for (const r of failures.sort((a, b) => a.url.localeCompare(b.url)))
      lines.push(
        `| \`${r.url}\` | ${r.status}${r.location ? ` → \`${r.location}\`` : ''} | ${r.reason ?? ''}${knownGap(r.url) ? ` — **${knownGap(r.url)}**` : ''} |`,
      );
  }
  lines.push('');
  lines.push('## 4. 기존 사이트에서도 200 이 아닌 URL');
  lines.push('');
  if (!legacyBroken.length) lines.push('없음.');
  else {
    lines.push('| URL | 기존 상태 | 출처 |');
    lines.push('| --- | --------- | ---- |');
    for (const r of legacyBroken) lines.push(`| \`${r.url}\` | ${r.legacyStatus} | ${r.from} |`);
  }
  lines.push('');
  lines.push('## 5. 데이터·정적 파일(페이지 아님 — 목표 밖)');
  lines.push('');
  lines.push(
    '기존 브라우저 스크립트가 받던 JSON·GeoJSON 과 정적 파일(아이콘·노선도 이미지). 새 사이트는 Route Handler(`/api/map/*`·`/api/timetable/*`·`/api/documents/*`)와 서버 렌더 검색으로 바꿨다(06 문서 6-2절).',
  );
  lines.push('');
  lines.push('| URL | 상태 |');
  lines.push('| --- | ---- |');
  for (const r of dataRows)
    lines.push(
      `| \`${r.url}\` | ${r.status}${r.location ? ` → \`${r.location}\` (${r.finalStatus})` : ''}${knownGap(r.url) ? ` — ${knownGap(r.url)}` : ''} |`,
    );
  lines.push('');
  lines.push(`## 6. 앵커 경고 (${anchorMissing.length}/${anchorTotal})`);
  lines.push('');
  lines.push(
    '새 HTML 에 같은 id 가 없고 옛 앵커 스크립트 표로도 안 바뀌는 앵커. 페이지는 열리지만 그 자리로 이동하지 않는다.',
  );
  lines.push('');
  const anchorGroups = new Map<string, { n: number; ex: string[] }>();
  for (const a of anchorMissing) {
    const g = `${patternOf(a.url.split('?')[0]!)} #${/^[a-z]+-/.test(a.hash) ? a.hash.replace(/^([a-z]+-).*$/, '$1…') : a.hash}`;
    const e = anchorGroups.get(g) ?? { n: 0, ex: [] };
    e.n++;
    if (e.ex.length < 3) e.ex.push(`${a.url}#${a.hash}`);
    anchorGroups.set(g, e);
  }
  if (!anchorGroups.size) lines.push('없음.');
  else {
    lines.push('| 모양 | 개수 | 예 | 이유 |');
    lines.push('| ---- | ---: | -- | ---- |');
    for (const [g, e] of [...anchorGroups].sort((a, b) => b[1].n - a[1].n))
      lines.push(
        `| \`${g}\` | ${e.n} | ${e.ex.map((x) => `\`${x}\``).join('<br>')} | ${e.ex.map(knownGap).find(Boolean) ?? ''} |`,
      );
  }
  lines.push('');
  lines.push(`## 7. 지도 상태 해시 경고 (${stateHashBad.length}/${stateHashTotal})`);
  lines.push('');
  lines.push(
    '`/map/#line=…`·`#station=…`·`#plan=…` 처럼 지도 스크립트가 읽는 해시. 키를 새 지도가 읽는지, 가리키는 개체의 상세 페이지가 통과하는지 본다.',
  );
  lines.push('');
  if (!stateHashBad.length) lines.push('없음.');
  else {
    lines.push('| URL | 이유 |');
    lines.push('| --- | ---- |');
    for (const b of stateHashBad.slice(0, 100)) lines.push(`| \`${b.url}#${b.hash}\` | ${b.why} |`);
    if (stateHashBad.length > 100) lines.push(`| … | 외 ${stateHashBad.length - 100}개 |`);
  }
  lines.push('');
  lines.push(`## 8. 쿼리 키 경고 (${queryWarn.size})`);
  lines.push('');
  lines.push(
    '새 페이지에 같은 키의 링크·폼 필드가 없어 무시될 것으로 보이는 쿼리 키(페이지는 200 이지만 필터가 안 걸린다).',
  );
  lines.push('');
  if (!queryWarn.size) lines.push('없음.');
  else {
    lines.push('| 경로 모양 | 키 | URL 수 | 예 | 이유 |');
    lines.push('| --------- | -- | -----: | -- | ---- |');
    for (const w of [...queryWarn.values()].sort((a, b) => b.count - a.count))
      lines.push(`| \`${w.pattern}\` | \`${w.key}\` | ${w.count} | \`${w.example}\` | ${knownGap(w.example) ?? ''} |`);
  }
  lines.push('');
  await writeFile(o.out, lines.join('\n'));

  console.log(`페이지·피드 ${pages.length}: 통과 ${pages.length - failures.length}, 실패 ${failures.length}`);
  for (const [k, m] of byKind) console.log(`  ${k}: ${[...m].map(([s, n]) => `${s}=${n}`).join(' ')}`);
  console.log(
    `앵커 경고 ${anchorMissing.length}/${anchorTotal}, 지도 해시 경고 ${stateHashBad.length}/${stateHashTotal}, 쿼리 키 경고 ${queryWarn.size}, 기존 깨진 링크 ${legacyBroken.length}`,
  );
  for (const r of failures.slice(0, 30)) console.log(`  실패 ${r.url} ${r.status} ${r.reason ?? ''}`);
  console.log(`보고서: ${o.out}`);
  if (failures.length) process.exitCode = 1;
}

await main();
