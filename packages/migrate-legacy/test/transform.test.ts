/** 변환 단위 시험 — 기존 저장소 없이 작은 인라인 표본으로 */
import { describe, expect, it } from 'vitest';
import { entityContracts, type LineStationCreate } from '@k-raildex/contracts';
import { parseYamlRecords } from '../src/read/yaml';
import { parseTerminology } from '../src/read/terminology';
import type { LLine, LLineStation, LPlan, LSource, LStation } from '../src/read/types';
import { fuzzy, fuzzyRepairs, MigrationReport, programId, transferCenterId } from '../src/transform/common';
import { licenseClassOf, transformSource } from '../src/transform/source';
import { combineStatus, splitLineCode, transformNetwork } from '../src/transform/network';
import { resolveStops } from '../src/transform/service';
import { milestoneBasisOf, transformPlan } from '../src/transform/plan';
import { operatorOfEnum } from '../src/transform/operator-map';
import { transformGlossary } from '../src/transform/misc';
import { tagoMinute, transformTagoTimetables } from '../src/transform/timetable';
import { topoSort } from '../src/transform';
import { renderHeaders } from '../src/headers';

const P = (sources: string[] = ['src-a']) => ({ sources, checked_at: '2026-10-11' });
const empty = <T>() => ({ items: [] as T[], notes: new Map<string, string>(), header: null, file: '' });

describe('YAML 주석 읽기', () => {
  it('파일 머리 주석과 레코드 앞·안쪽 주석을 나눈다', () => {
    const r = parseYamlRecords(`# 파일 머리

- id: a
  name: 가
# ---- 절 머리
- id: b # 줄 끝 주석
  name: 나
`);
    expect(r.header).toBe('파일 머리');
    expect(r.items).toEqual([
      { id: 'a', name: '가' },
      { id: 'b', name: '나' },
    ]);
    expect(r.comments[0]).toBeNull();
    expect(r.comments[1]).toContain('---- 절 머리');
    expect(r.comments[1]).toContain('줄 끝 주석');
  });
});

describe('출처 license_class 판정', () => {
  it.each([
    ['notice', '고시 (저작권 보호 대상 아님)', 'public_work'],
    ['law', '법령', 'public_work'],
    ['press_release', '공공누리 제1유형 (국토교통부 보도자료, 출처 표시)', 'kogl_1'],
    ['map_image', '공공누리 제4유형 (출처표시·상업적 이용금지·변경금지)', 'kogl_4'],
    ['press_release', '공공누리 제1유형 추정 (인천광역시 보도자료)', 'unknown'],
    ['map_image', '공공누리 제3유형 표시(숨김) — 기관 확인 전까지 링크만', 'unknown'],
    ['wiki', 'CC BY-SA 4.0 — 사실 확인용 보조 출처', 'open'],
    ['news', '언론 보도 (사실 확인용, 출처 표시)', 'restricted'],
    ['dataset_file', '이용허락범위 제한 없음', 'unknown'],
  ])('%s / %s → %s', (type, license, cls) => {
    expect(licenseClassOf(type, license).cls).toBe(cls);
  });

  it('계약에 맞는 출처를 만들고 unknown 은 리포트한다', () => {
    const report = new MigrationReport();
    const s: LSource = {
      id: 'src-x',
      title: '자료',
      publisher: '기관',
      type: 'dataset_file',
      license: '이용허락범위 제한 없음',
      retrieved_at: '2026-10-11',
      published_at: '2026-06',
    };
    const out = transformSource(s, report, '주석');
    expect(entityContracts.source.create.safeParse(out).success).toBe(true);
    expect(out.published).toEqual({ value: '2026-06', precision: 'month' });
    expect(out.checked_at).toBe('2026-10-11');
    expect(out.editor_note).toBe('주석');
    expect(report.issues.get('license_class unknown')).toHaveLength(1);
  });
});

describe('공통 변환', () => {
  it('퍼지 날짜: 형식 오류는 중단, "일 00" 은 정밀도만 낮춘다', () => {
    fuzzyRepairs.length = 0;
    expect(() => fuzzy({ value: '2026-13', precision: 'month' }, 'x')).toThrow(/형식 오류/);
    expect(fuzzy({ value: '2000-03-00', precision: 'day' }, 'x')).toEqual({ value: '2000-03', precision: 'month' });
    expect(fuzzy({ value: '2001-00-00', precision: 'day' }, 'x')).toEqual({ value: '2001', precision: 'year' });
    expect(fuzzy({ precision: 'unknown' }, 'x')).toEqual({ value: null, precision: 'unknown' });
    expect(fuzzyRepairs).toHaveLength(2);
  });
  it('id 변경 규칙(Q69 A)', () => {
    expect(programId('national_rail_4')).toBe('pp-national-rail-4');
    expect(transferCenterId('tc-seoul')).toBe('xc-seoul');
  });
  it('번호대 운영기관: enum 과 other 의 id 접두사', () => {
    expect(operatorOfEnum('korail', 'tnr-x')).toBe('op-korail');
    expect(operatorOfEnum('other', 'tnr-arex-local')).toBe('op-airport-railroad');
    expect(operatorOfEnum('other', 'tnr-unknown')).toBeNull();
  });
  it('자기 참조가 먼저 오도록 정렬', () => {
    const out = topoSort(
      [
        { id: 'a', dep: 'b' },
        { id: 'b', dep: null },
      ],
      (x) => x.id,
      (x) => x.dep,
    );
    expect(out.map((x) => x.id)).toEqual(['b', 'a']);
  });
});

// 망 표본: 노선 1(운영, 1990 개통)·노선 2(공사 중), 역 가(두 노선 환승)·나(노선 1)·다(노선 없음)
const lines: LLine[] = [
  {
    id: 'line-one',
    name: { ko: '1호선' },
    category: 'metro',
    rail_class: 'urban',
    status: 'operating',
    region: ['서울특별시'],
    operator_name: '서울교통공사',
    opened_at: { value: '1990-01-01', precision: 'day' },
    codes: { kric_station_std: 'S1101,S1102', kr_line_no: '9' },
    provenance: P(),
  },
  {
    id: 'line-two',
    name: { ko: '2호선' },
    category: 'metro',
    rail_class: 'urban',
    status: 'under_construction',
    region: ['경기도'],
    operator_name: '모르는 회사',
    codes: { kric_station_std: 'S2' },
    provenance: P(),
  },
];
const stations: LStation[] = [
  {
    id: 'stn-ga',
    name: { ko: '가' },
    aliases: ['가', '가역'],
    status: 'operating',
    region: '서울특별시',
    lat: 37.5,
    lng: 127,
    coord_source: 'official',
    opened_at: { value: '1990-01-01', precision: 'day' },
    codes: { kric_station_std: ['0101@S1101', '0201@S2'], molit_metro_lines: '가', rafis: '가' },
    provenance: P(),
  },
  {
    id: 'stn-na',
    name: { ko: '나' },
    status: 'operating',
    opened_at: { value: '1991', precision: 'year' },
    codes: { tago_subway: 'MTRX1' },
    provenance: P(),
  },
  {
    id: 'stn-da',
    name: { ko: '다' },
    status: 'closed',
    closed_at: { value: '2001', precision: 'year' },
    provenance: P(),
  },
];
const lineStations: LLineStation[] = [
  { id: 'line-one--001', line_id: 'line-one', station_id: 'stn-ga', order: 1, provenance: P() },
  { id: 'line-one--002', line_id: 'line-one', station_id: 'stn-na', order: 2, station_code: '102', provenance: P() },
  { id: 'line-two--001', line_id: 'line-two', station_id: 'stn-ga', order: 1, provenance: P() },
];

describe('역·노선·노선별 역', () => {
  const report = new MigrationReport();
  const out = transformNetwork(
    {
      stations,
      lines,
      lineStations,
      services: [],
      tagoRoutes: [],
      linesManual: empty(),
      stationsManual: empty(),
      lineNames: empty(),
      osmLineMap: empty(),
    },
    report,
  );
  const ls = (id: string) => out.lineStations.find((x) => x.id === id)!;

  it('상태 배분: 덜 진행된 쪽(공사 중)·폐역 우선', () => {
    expect(combineStatus('under_construction', 'operating')).toBe('under_construction');
    expect(combineStatus('operating', 'closed')).toBe('closed');
    expect(combineStatus('planned', 'under_construction')).toBe('planned');
  });

  it('다중 노선 역: 노선 개통일과 같은 노선별 역에만 개통일(Q95 A)', () => {
    expect(ls('ls-one--ga').status).toBe('operating');
    expect(ls('ls-one--ga').opened).toEqual({ value: '1990-01-01', precision: 'day' });
    expect(ls('ls-two--ga').status).toBe('under_construction');
    expect(ls('ls-two--ga').opened).toBeNull();
  });

  it('단일 노선 역은 역 값을 그대로, 노선 없는 역은 own_*', () => {
    expect(ls('ls-one--na').opened).toEqual({ value: '1991', precision: 'year' });
    expect(ls('ls-one--na').station_code).toBe('102');
    const da = out.stations.find((s) => s.id === 'stn-da')!;
    expect(da.own_status).toBe('closed');
    expect(da.own_closed).toEqual({ value: '2001', precision: 'year' });
    expect(out.stations.find((s) => s.id === 'stn-ga')!.own_status).toBeNull();
  });

  it('노선 문맥 코드는 노선별 역으로, 못 풀면 역에 두고 리포트', () => {
    expect(ls('ls-one--ga').external_refs.map((r) => r.code)).toEqual(['0101@S1101']);
    expect(ls('ls-two--ga').external_refs.map((r) => r.code)).toEqual(['0201@S2']);
    expect(ls('ls-one--na').external_refs.map((r) => `${r.system}=${r.code}`)).toEqual(['tago_subway=MTRX1']);
    const ga = out.stations.find((s) => s.id === 'stn-ga')!;
    expect(ga.external_refs.map((r) => r.system).sort()).toEqual(['molit_metro_lines', 'rafis']);
    expect(report.issues.get('노선 문맥 코드 노선별 역 미해석(역에 보관)')).toHaveLength(1);
  });

  it('노선: 시·도·운영기관·외부 코드(쉼표 목록 분리)·운영기관 미매칭 리포트', () => {
    const one = out.lines.find((l) => l.id === 'line-one')!;
    expect(one.regions).toEqual(['11']);
    expect(one.operators).toEqual([{ operator_id: 'op-seoul-metro', role: 'operator', note: null }]);
    expect(one.extra).toEqual({ operator_name_raw: '서울교통공사' });
    expect(one.external_refs.map((r) => `${r.system}=${r.code}`)).toEqual([
      'kric_station_std_line=S1101',
      'kric_station_std_line=S1102',
      'kr_line_no=9',
    ]);
    expect(report.issues.get('운영기관 미매칭')).toEqual(['line-two: 모르는 회사']);
    expect(splitLineCode('a b,c')).toEqual(['a b,c']);
  });

  it('별칭은 대표 이름과 같아도 기존처럼 두고 중복만 뺀다', () => {
    expect(out.stations.find((s) => s.id === 'stn-ga')!.names.map((n) => n.name)).toEqual(['가', '가역']);
  });

  it('모든 출력이 계약을 통과한다', () => {
    for (const s of out.stations) expect(entityContracts.station.create.safeParse(s).success).toBe(true);
    for (const l of out.lines) expect(entityContracts.line.create.safeParse(l).success).toBe(true);
    for (const x of out.lineStations) expect(entityContracts.line_station.create.safeParse(x).success).toBe(true);
  });
});

describe('정차역 → 노선별 역', () => {
  const mk = (line: string, stn: string) =>
    ({ id: `ls-${line}--${stn}`, line_id: line, station_id: stn }) as LineStationCreate;
  const byStation = new Map<string, LineStationCreate[]>([
    ['a', [mk('l1', 'a')]],
    ['b', [mk('l1', 'b'), mk('l2', 'b')]],
    ['c', [mk('l2', 'c')]],
    ['x', [mk('l9', 'x')]],
  ]);
  it('하나면 확정, 여럿이면 앞 역과 같은 노선, 없으면 빼고 리포트', () => {
    const report = new MigrationReport();
    const out = resolveStops('svc-s', 'p', ['l1', 'l2'], ['a', 'b', 'c', 'x'], byStation, report);
    expect(out).toEqual(['ls-l1--a', 'ls-l1--b', 'ls-l2--c']);
    expect(report.issues.get('정차 패턴 정차역 노선별 역 미해석(정차역 제외)')).toEqual(['svc-s/p: x']);
  });
});

describe('계획', () => {
  it('기대 일정 근거 판정(Q94 A)', () => {
    expect(milestoneBasisOf('notice')).toBe('official');
    expect(milestoneBasisOf('official_page')).toBe('official');
    expect(milestoneBasisOf('news')).toBe('press');
    expect(milestoneBasisOf('wiki')).toBeNull();
  });

  const plan: LPlan = {
    id: 'plan-x',
    name: { ko: '연장' },
    plan_refs: [{ program: 'national_rail_4', class: 'new', source: 'src-n' }],
    stage: 'basic_plan',
    stage_history: [
      { stage: 'plan_listed', date: { value: '2021-07-05', precision: 'day' }, source: 'src-n' },
      { stage: 'basic_plan', date: { value: '2026-08-19', precision: 'day' }, source: 'src-kric-gazette' },
    ],
    target_open: { value: '2030', precision: 'year' },
    line_ids: ['line-one', 'line-two'],
    station_ids: ['stn-ga'],
    regions: ['서울특별시'],
    provenance: { sources: ['src-n', 'src-w', 'src-news'], checked_at: '2026-10-17' },
  };
  const ctx = {
    sources: new Map<string, LSource>([
      ['src-n', { id: 'src-n', title: '', publisher: '', type: 'news', license: '', retrieved_at: '2026-01-01' }],
      ['src-w', { id: 'src-w', title: '', publisher: '', type: 'wiki', license: '', retrieved_at: '2026-01-01' }],
      [
        'src-news',
        { id: 'src-news', title: '', publisher: '', type: 'notice', license: '', retrieved_at: '2026-01-01' },
      ],
    ]),
    lines: new Map(lines.map((l) => [l.id, l])),
    stations: new Map(stations.map((s) => [s.id, s])),
    parentOf: new Map<string, string>(),
    stationsWithGeom: new Set(['stn-ga']),
  };

  it('반영 내역 pp-, 관보 자동분, 기대 일정(공식 우선), 역할 초안, 감시 키워드', () => {
    const report = new MigrationReport();
    const out = transformPlan(plan, { ...plan, gazette_keywords: ['연장선'], national: true }, [], ctx, report, null);
    expect(out.refs[0]!.program_id).toBe('pp-national-rail-4');
    expect(out.stage_events.map((e) => e.origin)).toEqual(['manual', 'gazette_auto']);
    expect(out.milestones).toHaveLength(1);
    expect(out.milestones[0]).toMatchObject({
      basis: 'official',
      source_id: 'src-news',
      as_of: { value: '2026-10-17' },
    });
    expect(out.lines).toEqual([
      expect.objectContaining({ line_id: 'line-one', role: 'upgrades' }),
      expect.objectContaining({ line_id: 'line-two', role: 'new' }),
    ]);
    expect(out.stations).toEqual([{ station_id: 'stn-ga', role: 'existing' }]);
    expect(out.watch_keywords).toEqual(['연장선']);
    expect(out.is_national).toBe(true);
    expect(entityContracts.plan.create.safeParse(out).success).toBe(true);
  });

  it('근거 출처가 없으면 기대 일정을 만들지 않고 리포트(D-7)', () => {
    const report = new MigrationReport();
    const out = transformPlan(
      { ...plan, provenance: { sources: ['src-w'], checked_at: '2026-10-17' } },
      undefined,
      [],
      ctx,
      report,
      null,
    );
    expect(out.milestones).toEqual([]);
    expect(report.issues.get('개통 목표 근거 판정 불가(기대 일정 미이관, D-7)')).toHaveLength(1);
  });
});

describe('용어 사전', () => {
  const md = `# 사전

- 최종 갱신: 2026-10-11

## 1. 분류

### 고속철도

- 정의: 빠른 철도.
- 근거: 법 제2조
- 예: 경부고속선
- 주의: 차량과 다르다.
- 연혁: 2004 개통

## 2. 기관

| 기관 | 역할 |
| --- | --- |
| 국토교통부 | 정책 |
`;
  it('글머리를 필드로, 나머지는 정의 뒤로, 표만 있는 절은 절 이름 항목', () => {
    const g = parseTerminology(md);
    expect(g.updatedAt).toBe('2026-10-11');
    expect(g.terms).toHaveLength(2);
    const report = new MigrationReport();
    const terms = transformGlossary(g.terms, g.updatedAt!, report);
    expect(terms[0]).toMatchObject({
      id: 'term-1-1',
      term_ko: '고속철도',
      section: '분류',
      basis: '법 제2조',
      example: '경부고속선',
      caution: '차량과 다르다.',
    });
    expect(terms[0]!.definition).toBe('빠른 철도.\n\n- 연혁: 2004 개통');
    expect(terms[1]).toMatchObject({ id: 'term-2-1', term_ko: '기관' });
    for (const t of terms) expect(entityContracts.glossary_term.create.safeParse(t).success).toBe(true);
  });
});

describe('시간표', () => {
  it('TAGO 시각(04시 이전 24~27시)', () => {
    expect(tagoMinute('053000')).toBe(330);
    expect(tagoMinute('003000')).toBe(24 * 60 + 30);
    expect(tagoMinute('0')).toBeNull();
  });
  it('묶음·방향·중복 제거', () => {
    const raw = {
      subwayStationId: 'MTRS11001',
      retrieved_at: '2026-10-11',
      items: [
        {
          subwayRouteId: 'MTRS11',
          depTime: '053000',
          arrTime: '0',
          dailyTypeCode: '01',
          upDownTypeCode: 'U',
          endSubwayStationNm: '끝',
        },
        {
          subwayRouteId: 'MTRS11',
          depTime: '053000',
          arrTime: '0',
          dailyTypeCode: '01',
          upDownTypeCode: 'U',
          endSubwayStationNm: '끝',
        },
        { subwayRouteId: 'MTRS11', depTime: '0', arrTime: '060000', dailyTypeCode: '01', upDownTypeCode: 'U' },
      ],
    };
    const report = new MigrationReport();
    const sets = transformTagoTimetables(
      [raw],
      [{ route_id: 'MTRS11', name: '1호선', direction: { U: 'inner' } }],
      new Map([['MTRS11001', 'stn-ga']]),
      [
        {
          id: 'tt-ga-mtrs11-weekday-inner',
          station_id: 'stn-ga',
          route_code: 'MTRS11',
          day_type: 'weekday',
          direction: 'inner',
          direction_label: '끝 방면',
          first: '05:30',
          last: '06:00',
          count: 3,
          by_hour: [],
          detail_file: '',
          data_as_of: '2026-10-11',
          provenance: P(['src-tago-subway']),
        },
      ],
      { stationIds: new Set(['stn-ga']), serviceLines: new Map(), lsByStation: new Map() },
      report,
    );
    expect(sets.map((s) => s.id)).toEqual(['tt-ga-mtrs11-weekday-inner']);
    expect(sets[0]!.entries.map((e) => [e.minute, e.dest_name])).toEqual([
      [330, '끝'],
      [360, null],
    ]);
    expect(report.issues.get('시간표 행 수 ≠ 기존 요약 count')).toEqual(['tt-ga-mtrs11-weekday-inner: 2 vs 3']);
  });
});

describe('파일 머리 주석 문서(FR-MIG-005)', () => {
  it('경로순, 울타리 안에 원문 그대로', () => {
    const md = renderHeaders(
      new Map([
        ['data/own/sources.yaml', '출처 목록\n규칙: id 는 src-'],
        ['data/own/plans/a.yaml', '코드 ``` 포함'],
      ]),
    );
    expect(md.indexOf('data/own/plans/a.yaml')).toBeLessThan(md.indexOf('data/own/sources.yaml'));
    expect(md).toContain('```text\n출처 목록\n규칙: id 는 src-\n```');
    expect(md).toContain('````text\n코드 ``` 포함\n````');
    expect(md).toContain('파일 2개');
  });
});
