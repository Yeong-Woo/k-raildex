/** 사이트 경로·앵커 도우미(순수 함수 — test/urls.test.ts). URL 은 끝 '/' 를 유지한다(FR-WEB-004). */

const enc = encodeURIComponent;

export const paths = {
  home: () => '/',
  lines: () => '/lines/',
  line: (id: string) => `/lines/${enc(id)}/`,
  stations: () => '/stations/',
  station: (id: string) => `/stations/${enc(id)}/`,
  stationRegion: (slug: string) => `/stations/region/${enc(slug)}/`,
  services: () => '/services/',
  service: (id: string) => `/services/${enc(id)}/`,
  plans: () => '/plans/',
  plan: (id: string) => `/plans/${enc(id)}/`,
  planPrograms: (id?: string) => `/plans/programs/${id ? `#${enc(id)}` : ''}`,
  planProgram: (id: string) => `/plans/programs/${enc(id)}/`,
  transferCenters: () => '/transfer-centers/',
  transferCenter: (id: string) => `/transfer-centers/${enc(id)}/`,
  facility: (id: string) => `/facilities/${enc(id)}/`,
  term: (id: string) => `/terms/#${enc(id)}`,
  search: (q?: string) => (q ? `/search/?q=${enc(q)}` : '/search/'),
  map: (hash?: string) => `/map/${hash ? `#${hash}` : ''}`,
  futureMap: () => '/map/?at=future',
  sources: () => '/sources/',
  about: () => '/about/',
  upcoming: () => '/upcoming/',
  closed: () => '/closed/',
  timeline: () => '/timeline/',
  /** 연대 페이지(예 2010 → /timeline/2010s/) */
  timelineDecade: (decade: number) => `/timeline/${decade}s/`,
  /** 날짜를 모르는 기록(Q117 A) */
  timelineUnknown: () => '/timeline/unknown/',
  trains: () => '/trains/',
  trainClasses: () => '/train-classes/',
  routeMaps: () => '/maps/',
  terms: () => '/terms/',
  /** 미래 지도 특정 연도(`/map/?at=2030#plan=…`) */
  mapAt: (at: number | 'future', hash?: string) => `/map/?at=${at}${hash ? `#${hash}` : ''}`,
  /** 공개 원문 다운로드(Route Handler 중계, FR-WEB-002) */
  document: (id: string) => `/api/documents/${enc(id)}/`,
  timetableJson: (stationId: string) => `/api/timetable/${enc(stationId)}/`,
};

/** 검색 결과·최근 변경의 개체 → 사이트 경로(API url_path 가 없을 때의 대체) */
export function entityPath(type: string, id: string): string | null {
  switch (type) {
    case 'line':
      return paths.line(id);
    case 'station':
      return paths.station(id);
    case 'service':
      return paths.service(id);
    case 'plan':
      return paths.plan(id);
    case 'transfer_center':
      return paths.transferCenter(id);
    case 'facility':
      return paths.facility(id);
    case 'glossary_term':
      return paths.term(id);
    default:
      return null;
  }
}

type Params = Record<string, string | undefined | null>;

/**
 * 현재 검색 조건에 값을 바꾼 링크(탭·필터 링크 — JS 없이 동작, NFR-WEB-002).
 * 값이 기본값(defaults)과 같거나 비면 쿼리에서 뺀다. 키 순서를 고정해 같은 조건이 같은 URL 이 되게 한다.
 */
export function withQuery(base: string, current: Params, change: Params, defaults: Params = {}, hash?: string): string {
  const merged: Params = { ...current, ...change };
  const qs = new URLSearchParams();
  for (const k of Object.keys(merged).sort()) {
    const v = merged[k];
    if (v === undefined || v === null || v === '' || v === defaults[k]) continue;
    qs.set(k, v);
  }
  const s = qs.toString();
  return `${base}${s ? `?${s}` : ''}${hash ? `#${hash}` : ''}`;
}

/** Next 의 searchParams(값이 배열일 수 있음) → 단일 값 */
export function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** 허용 목록 안의 값만(아니면 기본값) */
export function pickParam<T extends string>(v: string | string[] | undefined, allowed: readonly T[], fallback: T): T {
  const s = firstParam(v);
  return s && (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** 앵커 id(절 이동). 영문·숫자·-_ 만 남긴다 */
export function anchorId(...parts: string[]): string {
  return parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 오류 제보(GitHub 이슈 양식) 링크. 기본 주소가 없으면 null(링크 생략) */
export function issueUrl(base: string | undefined, title: string, pagePath: string): string | null {
  if (!base) return null;
  const u = new URL(base);
  u.searchParams.set('title', `[오류 제보] ${title}`);
  u.searchParams.set('body', `페이지: ${pagePath}\n\n무엇이 틀렸나요?\n\n근거(출처 링크):\n`);
  return u.toString();
}

/** id 접두사 → 사이트 경로(연표 대상 등 종류를 모를 때). 모르는 접두사는 null */
export function idPath(id: string): string | null {
  if (id.startsWith('line-')) return paths.line(id);
  if (id.startsWith('stn-')) return paths.station(id);
  if (id.startsWith('svc-')) return paths.service(id);
  if (id.startsWith('plan-')) return paths.plan(id);
  if (id.startsWith('xc-')) return paths.transferCenter(id);
  if (id.startsWith('fac-')) return paths.facility(id);
  if (id.startsWith('pp-')) return paths.planProgram(id);
  return null;
}

/** 연대 slug(`2010s`) ↔ 숫자 */
export function parseDecade(slug: string): number | null {
  const m = /^(\d{3}0)s$/.exec(slug);
  return m ? Number(m[1]) : null;
}
