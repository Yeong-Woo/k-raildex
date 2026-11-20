/** 시간표 수집기 단위 시험 — DB 없이 작은 인라인 표본으로 */
import { describe, expect, it } from 'vitest';
import {
  apiKey,
  baseKey,
  buildKricSets,
  buildTagoSets,
  canonicalJson,
  directionLabel,
  hhmmToMinute,
  lineStationResolver,
  loopDirection,
  makeNameResolver,
  minuteToHhmm,
  opsMinute,
  parseTagoResponse,
  sha256Of,
  splitOf,
  tagoMinute,
  tagoScopeKeys,
  todayKst,
  type KricConfig,
  type KricFile,
  type NetworkContext,
  type TagoRawFile,
} from '../src';

describe('시각(04시 이전 = 24~27시)', () => {
  it('TAGO HHMMSS', () => {
    expect(tagoMinute('053000')).toBe(330);
    expect(tagoMinute('53000')).toBe(330);
    expect(tagoMinute('003030')).toBe(24 * 60 + 30);
    expect(tagoMinute('035900')).toBe(27 * 60 + 59);
    expect(tagoMinute('040000')).toBe(240);
    expect(tagoMinute('0')).toBeNull();
    expect(tagoMinute('')).toBeNull();
    expect(tagoMinute('abc')).toBeNull();
  });
  it('운행정보 HH:MM:SS, 00:00 은 없음', () => {
    expect(opsMinute('05:28:00')).toBe(328);
    expect(opsMinute('00:12:00')).toBe(24 * 60 + 12);
    expect(opsMinute('01:05')).toBe(25 * 60 + 5);
    expect(opsMinute('00:00:00')).toBeNull();
    expect(opsMinute('')).toBeNull();
  });
  it('표기 왕복', () => {
    expect(minuteToHhmm(24 * 60 + 30)).toBe('24:30');
    expect(hhmmToMinute('2430')).toBe(1470);
    expect(hhmmToMinute('05:01')).toBe(301);
    expect(todayKst(new Date('2026-11-20T16:00:00Z'))).toBe('2026-11-21');
  });
});

describe('역명 정규화', () => {
  it('괄호 부역명·가운뎃점·끝 역 제거', () => {
    expect(baseKey('죽전(단국대)')).toBe('죽전');
    expect(baseKey('동대문역사문화공원역')).toBe('동대문역사문화공원');
    expect(baseKey('총신대입구 (이수)')).toBe('총신대입구');
    expect(baseKey('가ㆍ나')).toBe('가나');
    expect(baseKey('역')).toBe('역');
  });
});

describe('TAGO 묶음', () => {
  const raw: TagoRawFile = {
    subwayStationId: 'MTRX11001',
    retrieved_at: '2026-10-11',
    items: [
      {
        subwayRouteId: 'MTRX11',
        depTime: '053000',
        arrTime: '0',
        dailyTypeCode: '01',
        upDownTypeCode: 'U',
        endSubwayStationNm: '끝(부역명)',
      },
      {
        subwayRouteId: 'MTRX11',
        depTime: '053000',
        arrTime: '0',
        dailyTypeCode: '01',
        upDownTypeCode: 'U',
        endSubwayStationNm: '끝(부역명)',
      },
      {
        subwayRouteId: 'MTRX11',
        depTime: '053000',
        arrTime: '0',
        dailyTypeCode: '01',
        upDownTypeCode: 'U',
        endSubwayStationNm: '중간',
      },
      { subwayRouteId: 'MTRX11', depTime: '0', arrTime: '003000', dailyTypeCode: '01', upDownTypeCode: 'U' },
      {
        subwayRouteId: 'MTRX11',
        depTime: '060000',
        arrTime: '0',
        dailyTypeCode: '03',
        upDownTypeCode: 'D',
        endSubwayStationNm: '처음',
      },
      { subwayRouteId: 'MTRX11', depTime: '0', arrTime: '0', dailyTypeCode: '03', upDownTypeCode: 'D' },
    ],
  };
  const ctx = {
    tagoToStation: new Map([['MTRX11001', 'stn-ga']]),
    hasStation: (id: string) => id === 'stn-ga',
    hasService: (id: string) => id === 'svc-x',
    lineStationOf: lineStationResolver([{ id: 'ls-x--ga', line_id: 'line-x', station_id: 'stn-ga' }], (s) =>
      s === 'svc-x' ? ['line-x'] : undefined,
    ),
  };
  const r = buildTagoSets(
    [raw, { subwayStationId: 'MTRUNKNOWN', retrieved_at: '2026-10-11', items: [] }],
    [{ route_id: 'MTRX1', service_id: 'svc-x', direction: { U: 'inner' }, fallback_label: { U: '시계 방면' } }],
    ctx,
  );
  it('요일·방향(재정의)·중복 제거·시각순', () => {
    expect(r.sets.map((s) => s.id)).toEqual(['tt-ga-mtrx11-holiday-down', 'tt-ga-mtrx11-weekday-inner']);
    const w = r.sets[1]!;
    expect(w.entries.map((e) => [e.minute, e.dest_name])).toEqual([
      [330, '끝(부역명)'],
      [330, '중간'],
      [1470, null],
    ]);
    expect(w).toMatchObject({ service_id: 'svc-x', line_station_id: 'ls-x--ga', data_as_of: '2026-10-11' });
  });
  it('방면 라벨: 괄호 제거 + 종착 없는 행은 fallback_label', () => {
    expect(r.sets[1]!.direction_label).toBe('끝·중간·시계 방면');
    expect(r.sets[0]!.direction_label).toBe('처음 방면');
    expect(directionLabel([{ to: null }], '서울 방면', true)).toBe('서울 방면');
    expect(directionLabel([{ to: 'A' }, { to: 'B' }, { to: 'B' }], undefined, false)).toBe('B·A 방면');
  });
  it('통계·미매칭·교체 범위', () => {
    expect(r.stats).toMatchObject({ files: 2, rows: 6, rows_dropped: 1, unmatched_tago: 1 });
    expect(r.issues.counts()['TAGO 역 id 미매칭(시간표 raw)']).toBe(1);
    expect(tagoScopeKeys(r.files)).toEqual([
      { station_id: 'stn-ga', route_prefix_of: 'MTRX11001' },
      { station_id: 'stn-ga', route_code: 'MTRX11' },
    ]);
  });
  it('API 응답 해석', () => {
    const ok = parseTagoResponse(
      JSON.stringify({
        response: {
          header: { resultCode: '00', resultMsg: 'OK' },
          body: { totalCount: 1, items: { item: raw.items[0] } },
        },
      }),
    );
    expect(ok.value.total).toBe(1);
    expect(ok.value.items).toHaveLength(1);
    const none = parseTagoResponse(JSON.stringify({ response: { header: { resultCode: '03' }, body: { items: '' } } }));
    expect(none.value).toEqual({ total: 0, items: [] });
    const err = (code: string) =>
      JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { returnReasonCode: code, returnAuthMsg: 'x' } } });
    expect(() => parseTagoResponse(err('22'))).toThrow(/트래픽/);
    expect(() => parseTagoResponse(err('30'))).toThrowError(expect.objectContaining({ name: 'FatalApiError' }));
    expect(() => parseTagoResponse('<html>')).toThrowError(expect.objectContaining({ name: 'RetryableApiError' }));
  });
});

describe('운행정보 규칙', () => {
  it('2호선 순환: 역번호 증가 = 내선, 감소 = 외선, 243→201 은 증가로', () => {
    expect(loopDirection([201, 202, 203])).toBe('inner');
    expect(loopDirection([203, 202, 201])).toBe('outer');
    expect(loopDirection([242, 243, 201, 202])).toBe('inner');
    expect(loopDirection([202, 201, 243])).toBe('outer');
    expect(loopDirection([201])).toBeNull();
    expect(loopDirection([201, 205])).toBeNull();
  });
  it('splits: 약호·번호 범위', () => {
    const sp = [{ prefix: 'K', from: 1700, to: 1803, service_id: 'svc-dg' }];
    expect(splitOf('K1701', sp)?.service_id).toBe('svc-dg');
    expect(splitOf('k1803', sp)?.service_id).toBe('svc-dg');
    expect(splitOf('S1701', sp)).toBeUndefined();
    expect(splitOf('K1804', sp)).toBeUndefined();
    expect(splitOf('1701', [{ from: 1700, to: 1800, service_id: 'x' }])?.service_id).toBe('x');
  });
});

// 작은 망: 노선 L(가 201 · 나 202 · 다 203 · 라 204 미개통), 다른 노선 M(가산)
function net(): NetworkContext {
  const st = (id: string, name: string, aliases: string[] = [], status = 'operating') =>
    [id, { id, name_ko: name, aliases, status }] as const;
  return {
    stations: new Map([
      st('stn-ga', '가'),
      st('stn-na', '나나', ['나나(부역)']),
      st('stn-da', '다'),
      st('stn-ra', '라', [], 'under_construction'),
      st('stn-gasan', '가산디지털단지'),
      st('stn-far', '먼곳'),
      st('stn-dup1', '같은이름'),
      st('stn-dup2', '같은이름'),
    ]),
    lineStations: [
      { id: 'ls-l--ga', line_id: 'line-l', station_id: 'stn-ga', seq: 1, station_code: '201' },
      { id: 'ls-l--na', line_id: 'line-l', station_id: 'stn-na', seq: 2, station_code: '202' },
      { id: 'ls-l--da', line_id: 'line-l', station_id: 'stn-da', seq: 3, station_code: '203' },
      { id: 'ls-l--ra', line_id: 'line-l', station_id: 'stn-ra', seq: 4, station_code: '204' },
      { id: 'ls-l--gasan', line_id: 'line-l', station_id: 'stn-gasan', seq: 5, station_code: null },
      { id: 'ls-m--far', line_id: 'line-m', station_id: 'stn-far', seq: 1, station_code: null },
    ],
    services: new Map([
      [
        'svc-l',
        { id: 'svc-l', line_ids: ['line-l'], stop_patterns: [['stn-ga', 'stn-na', 'stn-da']], areas: ['capital'] },
      ],
      ['svc-south', { id: 'svc-south', line_ids: ['line-m'], stop_patterns: [], areas: ['southeast'] }],
    ]),
    tagoToStation: new Map(),
    rafisRefs: new Map([['가산디지털단지', ['stn-gasan']]]),
  };
}

describe('역명 해석 순서', () => {
  const n = net();
  const globalIdx = new Map<string, Set<string>>([
    ['먼곳', new Set(['stn-far'])],
    ['같은이름', new Set(['stn-dup1', 'stn-dup2'])],
  ]);
  const unresolved: string[] = [];
  const resolve = makeNameResolver({
    net: n,
    candIds: ['stn-ga', 'stn-na', 'stn-da', 'stn-ra', 'stn-gasan'],
    manual: { 수기: 'stn-da', 무시: null, 틀림: 'stn-nope' },
    rafisAbbr: new Map([['가산디', ['가산디지털단지']]]),
    globalIdx,
    onUnresolved: (r) => unresolved.push(r),
  });
  it('수기 표 → 후보 이름·별칭 → RAFIS 약어 → 접두 → 전역 유일', () => {
    expect(resolve('수기')).toBe('stn-da');
    expect(resolve('무시')).toBeNull();
    expect(resolve('틀림')).toBeNull();
    expect(resolve('가')).toBe('stn-ga');
    expect(resolve('나나(부역)')).toBe('stn-na');
    expect(resolve('가산디')).toBe('stn-gasan');
    expect(resolve('2나')).toBe('stn-na'); // 숫자 접두 제거 후 접두 일치
    expect(resolve('먼곳')).toBe('stn-far'); // 후보 밖이지만 전역 유일
    expect(resolve('라')).toBeNull(); // 미개통 역은 후보에서 뺀다
    expect(resolve('같은이름')).toBeNull();
    expect(unresolved).toEqual(['라', '같은이름']);
    resolve('라');
    expect(unresolved).toHaveLength(2); // 캐시
  });
});

describe('운행정보 세트 만들기', () => {
  const cfg: KricConfig = {
    routes: [
      {
        line_no: 'S9902',
        service_id: 'svc-l',
        direction_rule: 'loop',
        loop_line_id: 'line-l',
        splits: [{ prefix: 'K', from: 100, to: 199, service_id: 'svc-south' }],
      },
    ],
    day_types: { 평일: ['weekday'], '토요일+공휴일': ['saturday', 'holiday'] },
    kinds: { 급행: '급행' },
    names: { S9902: { 다역: 'stn-da' } },
  };
  const t = (no: string, day: string, kind: string, stops: [string, string, string][]) => ({
    no,
    day,
    kind,
    from: stops[0]![0],
    to: stops[stops.length - 1]![0],
    stops,
  });
  const file: KricFile = {
    line_no: 'S9902',
    data_as_of: '2026-06-25',
    trains: [
      t('1001', '평일', '일반', [
        ['가', '00:00:00', '05:30:00'],
        ['나나', '05:32:00', '05:33:00'],
        ['다역', '05:35:00', '00:00:00'],
      ]),
      t('1002', '평일', '급행', [
        ['다역', '00:00:00', '05:40:00'],
        ['나나', '05:42:00', '05:43:00'],
        ['가', '05:45:00', '00:00:00'],
      ]),
      t('1003', '토요일+공휴일', '일반', [
        ['가', '00:00:00', '00:10:00'],
        ['모름', '00:11:00', '00:11:00'],
        ['나나', '00:12:00', '00:13:00'],
      ]),
      t('K101', '평일', '일반', [['먼곳', '00:00:00', '06:00:00']]),
      t('1004', '명절', '일반', [['가', '00:00:00', '07:00:00']]),
    ],
  };
  // TAGO 에 (가, svc-l, weekday, inner) 가 이미 있다
  const r = buildKricSets([file], cfg, new Map(), net(), {
    covered: new Set(['stn-ga|svc-l|weekday|inner']),
    destVotes: [],
  });
  const byId = new Map(r.sets.map((s) => [s.id, s]));
  it('순환 방향·TAGO 에 없는 조합만·한 행이 두 요일에', () => {
    expect([...byId.keys()].sort()).toEqual([
      'tt-da-s9902-weekday-inner',
      'tt-da-s9902-weekday-outer',
      'tt-ga-s9902-holiday-inner',
      'tt-ga-s9902-saturday-inner',
      'tt-ga-s9902-weekday-outer',
      'tt-na-s9902-holiday-inner',
      'tt-na-s9902-saturday-inner',
      'tt-na-s9902-weekday-inner',
      'tt-na-s9902-weekday-outer',
    ]);
    const job = r.jobs.find((j) => j.key === 'S9902')!;
    expect(job.skipped_covered).toBe(1);
    expect(job.unresolved).toEqual({ 모름: 1 });
  });
  it('행: 기점 출발·중간 출발·종점 도착, 열차번호·운행유형·종착역', () => {
    expect(byId.get('tt-na-s9902-weekday-inner')!.entries).toEqual([
      { minute: 333, dest_name: '다', dest_station_id: 'stn-da', train_no: '1001', note: null },
    ]);
    expect(byId.get('tt-ga-s9902-weekday-outer')!.entries).toEqual([
      { minute: 345, dest_name: '가', dest_station_id: 'stn-ga', train_no: '1002', note: '급행' },
    ]);
    expect(byId.get('tt-na-s9902-saturday-inner')!.entries[0]).toMatchObject({ minute: 24 * 60 + 12 }); // 종점은 도착
    const sat = byId.get('tt-ga-s9902-saturday-inner')!;
    expect(sat.day_note).toContain('토요일·공휴일 공통 다이아');
    expect(sat).toMatchObject({
      service_id: 'svc-l',
      line_station_id: 'ls-l--ga',
      data_as_of: '2026-06-25',
      direction_label: '나나 방면',
    });
  });
  it('splits 로 나뉜 권역 밖 계통은 시간표를 만들지 않음', () => {
    const south = r.jobs.find((j) => j.key === 'S9902/svc-south')!;
    expect(south).toMatchObject({ scope: 'out_of_area', trains: 1 });
    expect(r.sets.some((s) => s.service_id === 'svc-south')).toBe(false);
  });
  it('종착역 TAGO 방향 투표 → 정차 패턴 순서', () => {
    const noLoop: KricConfig = { ...cfg, routes: [{ line_no: 'S9902', service_id: 'svc-l' }] };
    const r2 = buildKricSets([file], noLoop, new Map(), net(), {
      covered: new Set(),
      destVotes: [{ service_id: 'svc-l', direction: 'up', dest_name: '다', n: 5 }],
    });
    const ids = r2.sets.map((s) => s.id);
    expect(ids).toContain('tt-ga-s9902-weekday-up'); // 1001 → 다: 투표 up
    expect(ids).toContain('tt-da-s9902-weekday-up'); // 1002 다 → 가: 패턴 순서상 뒤 → 앞 = up
    expect(ids).toContain('tt-ga-s9902-saturday-down'); // 1003 가 → 나나: 패턴 순서 앞 → 뒤 = down
  });
});

describe('공통 도구', () => {
  it('API 키: 서비스별 → 공통', () => {
    expect(apiKey('A_KEY', 'COMMON', { A_KEY: 'a', COMMON: 'c' })).toEqual({ key: 'a', var: 'A_KEY' });
    expect(apiKey('A_KEY', 'COMMON', { COMMON: ' c ' })).toEqual({ key: 'c', var: 'COMMON' });
    expect(apiKey('A_KEY', 'COMMON', {})).toBeNull();
  });
  it('정규 JSON 해시는 키 순서와 무관', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
    expect(sha256Of({ a: 1, b: 2 })).toBe(sha256Of({ b: 2, a: 1 }));
  });
});
