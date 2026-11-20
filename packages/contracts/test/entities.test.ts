import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { codes } from '../src/codes';
import {
  attachmentSchema,
  DocumentCreateSchema,
  entityContracts,
  EventCreateSchema,
  LineCreateSchema,
  LineReadSchema,
  LineStationCreateSchema,
  LineStationReadSchema,
  LineStationUpdateSchema,
  LineUpdateSchema,
  PlanCreateSchema,
  PlanProgramCreateSchema,
  PlanReadSchema,
  PlanUpdateSchema,
  RollingStockRangeCreateSchema,
  RouteMapCreateSchema,
  RouteMapUpdateSchema,
  ServiceCreateSchema,
  ServiceReadSchema,
  SourceCreateSchema,
  StationCreateSchema,
  StationReadSchema,
  StationUpdateSchema,
  TimetableSetSchema,
  TrainNumberRangeCreateSchema,
  TrainNumberRangeUpdateSchema,
  TransferCenterCreateSchema,
} from '../src';

const SRC = 'src-molit-nrp4-notice';
const rec = { checked_at: '2026-11-01', sources: [{ source_id: SRC }] };
const meta = {
  version: 3,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-02T09:30:00+09:00',
  deleted_at: null,
  last_changeset_id: null,
};
const recMeta = { ...meta, reviewed_at: null };
const DOC_ID = '0b5e6f3a-8d2c-4e1b-9a7f-1c2d3e4f5a6b';

/** 실패 경로 목록 */
function failPaths(schema: z.ZodType, input: unknown): string[] {
  const r = schema.safeParse(input);
  if (r.success) return [];
  return r.error.issues.map((i) => i.path.join('.'));
}

function expectFail(schema: z.ZodType, input: unknown, path: string): void {
  const paths = failPaths(schema, input);
  expect(paths, `expected failure at ${path}`).toContain(path);
}

describe('registry', () => {
  it('covers every entity type', () => {
    expect(Object.keys(entityContracts).sort()).toEqual([...codes.entityType.values].sort());
  });
});

describe('common', () => {
  it('requires at least one source (FR-DM-005)', () => {
    expectFail(
      StationCreateSchema,
      { id: 'stn-seoul', name_ko: '서울', checked_at: '2026-11-01', sources: [] },
      'sources',
    );
    expectFail(StationCreateSchema, { id: 'stn-seoul', name_ko: '서울', checked_at: '2026-11-01' }, 'sources');
  });

  it('source itself needs no sources', () => {
    const r = SourceCreateSchema.parse({
      id: SRC,
      title: '제4차 국가철도망 구축계획 고시',
      publisher: '국토교통부',
      type: 'notice',
      license: '공공저작물',
      license_class: 'public_work',
      retrieved_at: '2026-10-30',
      published: { value: '2021-07-05', precision: 'day' },
      checked_at: '2026-11-01',
    });
    expect(r.sources).toEqual([]);
    expect(r.published).toEqual({ value: '2021-07-05', precision: 'day' });
  });

  it('validates checked_at as YYYY-MM-DD', () => {
    expectFail(
      StationCreateSchema,
      { id: 'stn-seoul', name_ko: '서울', ...rec, checked_at: '2026-13-01' },
      'checked_at',
    );
    expectFail(
      StationCreateSchema,
      { id: 'stn-seoul', name_ko: '서울', ...rec, checked_at: '2026/11/01' },
      'checked_at',
    );
  });

  it('rejects unknown fields (strict) and wrong id prefix', () => {
    expectFail(StationCreateSchema, { id: 'stn-seoul', name_ko: '서울', ...rec, opened_value: '2020' }, '');
    expectFail(StationCreateSchema, { id: 'line-seoul', name_ko: '서울', ...rec }, 'id');
  });

  it('attachment kind refinements', () => {
    expect(attachmentSchema.safeParse({ kind: 'quote', quote: '…' }).success).toBe(true);
    expectFail(attachmentSchema, { kind: 'quote' }, 'quote');
    expectFail(attachmentSchema, { kind: 'link' }, 'url');
    expectFail(attachmentSchema, { kind: 'image' }, 'document_id');
    expectFail(attachmentSchema, { kind: 'document', url: 'https://x' }, 'document_id');
    expect(attachmentSchema.parse({ kind: 'image', document_id: DOC_ID })).toMatchObject({
      is_public: false,
      origin: 'manual',
    });
  });
});

describe('station', () => {
  const minimal = { id: 'stn-seoul', name_ko: '서울', ...rec };
  const full = {
    id: 'stn-seoul',
    name_ko: '서울',
    name_en: 'Seoul',
    name_hanja: '서울',
    name_full: null,
    kind: 'station',
    region_code: '11',
    region_basis: 'address',
    address: '서울특별시 용산구 한강대로 405',
    geom: { lat: 37.5547, lng: 126.9706 },
    coord_source: 'derived',
    coord_basis: 'parcel',
    coord_query: '한강대로 405',
    coord_same_as_id: null,
    coord_note: null,
    grade: '1',
    history_text: null,
    intro_text: null,
    merge_into_id: null,
    own_status: null,
    own_opened: null,
    own_closed: { value: null, precision: 'unknown' },
    checked_at: '2026-11-01',
    provenance_note: '공식 누리집',
    review_status: 'verified',
    editor_note: null,
    extra: { legacy: true },
    sources: [{ source_id: SRC, field: 'geom', locator: 'p.3', note: null }],
    names: [{ name: '경성', kind: 'former', valid_to: { value: '1946', precision: 'year' } }],
    external_refs: [{ system: 'rafis', code: '0001', is_primary: true }],
  };

  it('accepts minimal and fills defaults', () => {
    const s = StationCreateSchema.parse(minimal);
    expect(s.kind).toBe('station');
    expect(s.geom).toBeNull();
    expect(s.own_opened).toBeNull();
    expect(s.review_status).toBe('unverified');
    expect(s.names).toEqual([]);
    expect(s.external_refs).toEqual([]);
    expect(s.extra).toEqual({});
    expect(s.sources[0]).toEqual({ source_id: SRC, field: null, locator: null, note: null });
  });

  it('accepts full', () => {
    const s = StationCreateSchema.parse(full);
    expect(s.names[0]?.lang).toBe('ko');
    expect(StationReadSchema.safeParse({ ...full, ...recMeta }).success).toBe(true);
  });

  it('geom ⇔ coord_source', () => {
    expectFail(StationCreateSchema, { ...minimal, geom: { lat: 37.5, lng: 127 } }, 'coord_source');
    expectFail(StationCreateSchema, { ...minimal, coord_source: 'official' }, 'coord_source');
    expect(
      StationCreateSchema.safeParse({ ...minimal, geom: { lat: 37.5, lng: 127 }, coord_source: 'official' }).success,
    ).toBe(true);
  });

  it('geom range', () => {
    expectFail(StationCreateSchema, { ...minimal, geom: { lat: 40, lng: 127 }, coord_source: 'manual' }, 'geom.lat');
    expectFail(StationCreateSchema, { ...minimal, geom: { lat: 37, lng: 133 }, coord_source: 'manual' }, 'geom.lng');
  });

  it("coord_basis only with coord_source 'derived'", () => {
    expectFail(
      StationCreateSchema,
      { ...minimal, geom: { lat: 37.5, lng: 127 }, coord_source: 'official', coord_basis: 'district' },
      'coord_basis',
    );
    expectFail(StationCreateSchema, { ...minimal, coord_basis: 'district' }, 'coord_basis');
  });

  it('merge_into_id / coord_same_as_id ≠ id', () => {
    expectFail(StationCreateSchema, { ...minimal, merge_into_id: 'stn-seoul' }, 'merge_into_id');
    expectFail(StationCreateSchema, { ...minimal, coord_same_as_id: 'stn-seoul' }, 'coord_same_as_id');
    expect(StationCreateSchema.safeParse({ ...minimal, merge_into_id: 'stn-yongsan' }).success).toBe(true);
  });

  it('update is partial without id and without defaults', () => {
    expect(StationUpdateSchema.parse({ name_en: 'Seoul Station' })).toEqual({ name_en: 'Seoul Station' });
    expect(StationUpdateSchema.parse({})).toEqual({});
    expectFail(StationUpdateSchema, { id: 'stn-seoul' }, '');
    // 관련 필드가 함께 있을 때만 교차 검사
    expect(StationUpdateSchema.safeParse({ geom: { lat: 37.5, lng: 127 } }).success).toBe(true);
    expectFail(StationUpdateSchema, { geom: { lat: 37.5, lng: 127 }, coord_source: null }, 'coord_source');
    expectFail(StationUpdateSchema, { coord_source: 'manual', coord_basis: 'parcel' }, 'coord_basis');
    expectFail(StationUpdateSchema, { sources: [] }, 'sources');
  });

  it('read requires meta', () => {
    expectFail(StationReadSchema, full, 'version');
    expectFail(StationReadSchema, { ...full, ...recMeta, created_at: '2026-11-01' }, 'created_at');
  });
});

describe('line_station', () => {
  const minimal = {
    id: 'ls-gyeongbu--seoul',
    line_id: 'line-gyeongbu',
    station_id: 'stn-seoul',
    seq: 1,
    status: 'operating',
  };
  const full = {
    ...minimal,
    branch: null,
    km: 0,
    station_code: 'P313',
    order_confirmed: false,
    name_ko: '서울',
    name_en: 'Seoul',
    operator_id: 'op-korail',
    opened: { value: '1900-07-08', precision: 'day' },
    closed: null,
    geom: { lat: 37.5547, lng: 126.9706 },
    note: '승강장',
    sources: [{ source_id: SRC, field: 'geom' }],
    names: [{ name: '서울역', kind: 'source_raw' }],
    external_refs: [{ system: 'tago_subway', code: 'SEOUL' }],
  };

  it('accepts minimal without sources (inherits line sources)', () => {
    const r = LineStationCreateSchema.parse(minimal);
    expect(r.sources).toEqual([]);
    expect(r.order_confirmed).toBe(true);
    expect(r).not.toHaveProperty('checked_at');
  });

  it('accepts full and read', () => {
    expect(LineStationCreateSchema.safeParse(full).success).toBe(true);
    expect(LineStationReadSchema.safeParse({ ...full, ...meta }).success).toBe(true);
    // REC 가 없으므로 checked_at 은 받지 않는다
    expectFail(LineStationCreateSchema, { ...minimal, checked_at: '2026-11-01' }, '');
  });

  it('rejects bad refs', () => {
    expectFail(LineStationCreateSchema, { ...minimal, id: 'lst-x' }, 'id');
    expectFail(LineStationCreateSchema, { ...minimal, seq: 0 }, 'seq');
    expectFail(LineStationCreateSchema, { ...minimal, station_id: 'ls-gyeongbu--seoul' }, 'station_id');
    expectFail(LineStationCreateSchema, { ...minimal, status: 'open' }, 'status');
  });

  it('update', () => {
    expect(LineStationUpdateSchema.parse({ seq: 4 })).toEqual({ seq: 4 });
  });
});

describe('line', () => {
  const minimal = {
    id: 'line-gyeongbu',
    name_ko: '경부선',
    category: 'conventional',
    rail_class: 'conventional',
    status: 'operating',
    ...rec,
  };
  const full = {
    ...minimal,
    name_en: 'Gyeongbu Line',
    name_hanja: '京釜線',
    name_full: null,
    is_wide_area: false,
    wide_area_note: null,
    passenger_service: true,
    line_role: null,
    owner: '국가철도공단',
    start_station_id: 'stn-seoul',
    end_station_id: 'stn-busan',
    length_km: 441.7,
    opened: { value: '1905-01-01', precision: 'day' },
    closed: null,
    track: 'double',
    electrification: 'AC 25kV 60Hz',
    gauge_mm: 1435,
    design_speed_kmh: 150,
    color: '#0052A4',
    description: '서울–부산',
    parent_line_id: null,
    regions: ['11', '26'],
    operators: [{ operator_id: 'op-korail' }],
    osm_map: { relation_ids: [123, 456], way_names: ['경부선'], bbox: [126, 35, 129.1, 37.6] },
  };

  it('accepts minimal and full', () => {
    const m = LineCreateSchema.parse(minimal);
    expect(m.passenger_service).toBe(true);
    expect(m.osm_map).toBeNull();
    expect(m.regions).toEqual([]);
    const f = LineCreateSchema.parse(full);
    expect(f.operators[0]).toEqual({ operator_id: 'op-korail', role: 'operator', note: null });
    expect(f.osm_map).toMatchObject({ priority: 0, include_construction: true });
    expect(LineReadSchema.safeParse({ ...full, ...recMeta }).success).toBe(true);
  });

  it('color hex', () => {
    expectFail(LineCreateSchema, { ...minimal, color: '0052A4' }, 'color');
    expectFail(LineCreateSchema, { ...minimal, color: '#0052A' }, 'color');
    expectFail(LineUpdateSchema, { color: 'blue' }, 'color');
  });

  it('other checks', () => {
    expectFail(LineCreateSchema, { ...minimal, parent_line_id: 'line-gyeongbu' }, 'parent_line_id');
    expectFail(LineCreateSchema, { ...minimal, length_km: -1 }, 'length_km');
    expectFail(LineCreateSchema, { ...minimal, regions: ['11', '11'] }, 'regions.1');
    expectFail(LineCreateSchema, { ...minimal, regions: ['1'] }, 'regions.0');
    expectFail(LineCreateSchema, { ...minimal, osm_map: { bbox: [1, 2, 3] } }, 'osm_map.bbox');
  });
});

describe('service', () => {
  const minimal = {
    id: 'svc-sudogwon-1',
    name_ko: '수도권 전철 1호선',
    kind: 'wide_area',
    status: 'operating',
    ...rec,
  };
  const full = {
    ...minimal,
    train_class_id: 'tc-commuter',
    color: '#0052A4',
    opened: { value: '1974-08-15', precision: 'day' },
    closed: null,
    successor_id: null,
    description: null,
    lines: ['line-gyeongbu', 'line-gyeongin'],
    stop_patterns: [
      {
        code: 'express',
        name_ko: '급행',
        type: 'express',
        stops: ['ls-gyeongbu--seoul', 'ls-gyeongbu--yongsan', 'ls-gyeongin--incheon'],
      },
    ],
  };

  it('accepts minimal and full', () => {
    expect(ServiceCreateSchema.parse(minimal).stop_patterns).toEqual([]);
    expect(ServiceCreateSchema.safeParse(full).success).toBe(true);
    expect(ServiceReadSchema.safeParse({ ...full, ...recMeta }).success).toBe(true);
  });

  it('rejects bad stop patterns and duplicate lines', () => {
    expectFail(
      ServiceCreateSchema,
      { ...full, stop_patterns: [{ ...full.stop_patterns[0], stops: ['ls-gyeongbu--seoul'] }] },
      'stop_patterns.0.stops',
    );
    expectFail(
      ServiceCreateSchema,
      { ...full, stop_patterns: [{ ...full.stop_patterns[0], stops: ['stn-seoul', 'stn-yongsan'] }] },
      'stop_patterns.0.stops.0',
    );
    expectFail(ServiceCreateSchema, { ...full, lines: ['line-gyeongbu', 'line-gyeongbu'] }, 'lines.1');
    expectFail(
      ServiceCreateSchema,
      { ...full, stop_patterns: [full.stop_patterns[0], full.stop_patterns[0]] },
      'stop_patterns.1',
    );
  });
});

describe('plan', () => {
  const minimal = { id: 'plan-gtx-a', name_ko: 'GTX-A', ...rec };
  const milestone = {
    stage: 'opened',
    expected: { value: '2028-H2', precision: 'half' },
    basis: 'official',
    as_of: { value: '2026-03', precision: 'month' },
    source_id: SRC,
  };
  const full = {
    ...minimal,
    name_en: 'GTX-A',
    name_full: '수도권광역급행철도 A노선',
    scope: 'line',
    opened: null,
    operator_text: '에스지레일',
    description: null,
    is_national: true,
    stage_override: null,
    color: '#9A6292',
    refs: [
      { program_id: 'pp-national-rail-4', class: 'continued', category: 'wide_area', length_km: 83.1, source_id: SRC },
    ],
    stage_events: [{ stage: 'construction', date: { value: '2018-12-27', precision: 'day' }, source_id: SRC }],
    milestones: [milestone],
    lines: [
      { line_id: 'line-gtx-a', role: 'new' },
      {
        line_id: 'line-gyeongbu',
        role: 'replaces',
        from_line_station_id: 'ls-gyeongbu--seoul',
        to_line_station_id: 'ls-gyeongbu--suwon',
      },
    ],
    stations: [{ station_id: 'stn-seoul', role: 'existing' }, { station_id: 'stn-changneung' }],
    regions: ['11', '41'],
    relations: [{ target_plan_id: 'plan-gtx-a-ext', relation: 'succeeded_by', source_id: SRC }],
    geometries: [
      { kind: 'schematic', via_station_ids: ['stn-unjeong', 'stn-seoul', 'stn-dongtan'], source_id: SRC },
      {
        kind: 'traced',
        geom: {
          type: 'MultiLineString',
          coordinates: [
            [
              [126.97, 37.55],
              [127.07, 37.2],
            ],
          ],
        },
        accuracy_m: 50,
        source_id: SRC,
      },
    ],
    watch_keywords: ['GTX-A', '수도권광역급행철도'],
  };

  it('accepts minimal and full', () => {
    const m = PlanCreateSchema.parse(minimal);
    expect(m.scope).toBe('line');
    expect(m.is_national).toBe(false);
    expect(m.milestones).toEqual([]);
    const f = PlanCreateSchema.parse(full);
    expect(f.stage_events[0]).toMatchObject({ kind: 'reached', origin: 'manual' });
    expect(f.stations[1]?.role).toBe('new');
    expect(PlanReadSchema.safeParse({ ...full, ...recMeta }).success).toBe(true);
  });

  it("milestone: basis 'estimate' forbidden, source required (Q94 A)", () => {
    expectFail(
      PlanCreateSchema,
      { ...minimal, milestones: [{ ...milestone, basis: 'estimate' }] },
      'milestones.0.basis',
    );
    expectFail(
      PlanCreateSchema,
      { ...minimal, milestones: [{ ...milestone, source_id: null }] },
      'milestones.0.source_id',
    );
    const { source_id: _omit, ...noSource } = milestone;
    expectFail(PlanCreateSchema, { ...minimal, milestones: [noSource] }, 'milestones.0.source_id');
  });

  it('stage event needs non-null date and source', () => {
    expectFail(
      PlanCreateSchema,
      { ...minimal, stage_events: [{ stage: 'concept', date: null, source_id: SRC }] },
      'stage_events.0.date',
    );
    expectFail(
      PlanCreateSchema,
      { ...minimal, stage_events: [{ stage: 'concept', date: { value: '2020', precision: 'year' } }] },
      'stage_events.0.source_id',
    );
  });

  it('geometry: schematic needs ≥ 2 via stations, others need geom', () => {
    expectFail(
      PlanCreateSchema,
      { ...minimal, geometries: [{ kind: 'schematic', source_id: SRC }] },
      'geometries.0.via_station_ids',
    );
    expectFail(
      PlanCreateSchema,
      { ...minimal, geometries: [{ kind: 'schematic', via_station_ids: ['stn-seoul'], source_id: SRC }] },
      'geometries.0.via_station_ids',
    );
    expectFail(
      PlanCreateSchema,
      { ...minimal, geometries: [{ kind: 'official', source_id: SRC }] },
      'geometries.0.geom',
    );
    expectFail(
      PlanCreateSchema,
      {
        ...minimal,
        geometries: [{ kind: 'traced', geom: { type: 'MultiLineString', coordinates: [[[127, 37]]] }, source_id: SRC }],
      },
      'geometries.0.geom.coordinates.0',
    );
  });

  it('relation to itself and duplicates', () => {
    expectFail(
      PlanCreateSchema,
      { ...minimal, relations: [{ target_plan_id: 'plan-gtx-a', relation: 'related', source_id: SRC }] },
      'relations.0.target_plan_id',
    );
    expectFail(
      PlanCreateSchema,
      { ...minimal, stations: [{ station_id: 'stn-seoul' }, { station_id: 'stn-seoul', role: 'existing' }] },
      'stations.1',
    );
    expectFail(PlanCreateSchema, { ...minimal, color: '#12345G' }, 'color');
  });

  it('update', () => {
    expect(PlanUpdateSchema.parse({ milestones: [milestone] }).milestones?.[0]?.as_of).toEqual(milestone.as_of);
    expectFail(PlanUpdateSchema, { milestones: [{ ...milestone, basis: 'estimate' }] }, 'milestones.0.basis');
  });
});

describe('other entities', () => {
  it('plan_program', () => {
    const base = {
      id: 'pp-national-rail-4',
      name_ko: '제4차 국가철도망 구축계획',
      kind: 'national_rail',
      short: '4차 국철망',
      status: 'current',
      ord: 1,
      ...rec,
    };
    const r = PlanProgramCreateSchema.parse({
      ...base,
      round: 4,
      period_from: 2021,
      period_to: 2030,
      notices: [{ kind: 'approval', title: '고시', date: { value: '2021-07-05', precision: 'day' }, source_id: SRC }],
      points: ['요점'],
      figures: [{ label: '사업비', value: '92.5조' }],
    });
    expect(r.figures[0]?.source_id).toBeNull();
    expectFail(PlanProgramCreateSchema, { ...base, period_from: 2030, period_to: 2021 }, 'period_to');
    expectFail(PlanProgramCreateSchema, { ...base, id: 'national_rail_4' }, 'id');
    expectFail(PlanProgramCreateSchema, { ...base, round: 0 }, 'round');
  });

  it('train_number_range / rolling_stock_range ranges', () => {
    const tnr = {
      id: 'tnr-ktx-1',
      operator_id: 'op-korail',
      range_from: 1,
      range_to: 99,
      group: 'high_speed',
      ...rec,
      service_ids: ['svc-ktx-gyeongbu'],
    };
    expect(TrainNumberRangeCreateSchema.safeParse(tnr).success).toBe(true);
    expectFail(TrainNumberRangeCreateSchema, { ...tnr, range_to: 0 }, 'range_to');
    expectFail(TrainNumberRangeUpdateSchema, { range_from: 10, range_to: 5 }, 'range_to');
    expect(TrainNumberRangeUpdateSchema.safeParse({ range_to: 5 }).success).toBe(true);
    const rsr = {
      id: 'rsn-ktx-1',
      operator_id: 'op-korail',
      series: 'KTX-I',
      number_from: 1,
      number_to: 46,
      digits: 2,
      group: 'high_speed',
      status: 'operating',
      ...rec,
    };
    expect(RollingStockRangeCreateSchema.safeParse(rsr).success).toBe(true);
    expectFail(RollingStockRangeCreateSchema, { ...rsr, number_to: 0 }, 'number_to');
  });

  it('route_map embed requires document_id', () => {
    const base = {
      id: 'map-seoul-metro',
      title_ko: '수도권 노선도',
      publisher: '서울교통공사',
      mode: 'link',
      url: 'https://example.org',
      license: 'KOGL-1',
      attribution: '서울교통공사',
      ...rec,
    };
    expect(RouteMapCreateSchema.safeParse(base).success).toBe(true);
    expectFail(RouteMapCreateSchema, { ...base, mode: 'embed' }, 'document_id');
    expect(RouteMapCreateSchema.safeParse({ ...base, mode: 'embed', document_id: DOC_ID }).success).toBe(true);
    expectFail(RouteMapUpdateSchema, { mode: 'embed', document_id: null }, 'document_id');
  });

  it('event targets and transfer center', () => {
    const ev = {
      id: 'evt-opened-gtx-a-2024-03-30',
      type: 'opened',
      date: { value: '2024-03-30', precision: 'day' },
      title: 'GTX-A 개통',
      origin: 'manual',
      ...rec,
    };
    expect(
      EventCreateSchema.safeParse({
        ...ev,
        targets: [{ entity_id: 'line-gtx-a' }, { entity_id: 'ls-gtx-a--suseo', role: 'related' }],
        area_codes: ['capital'],
      }).success,
    ).toBe(true);
    expectFail(EventCreateSchema, { ...ev, targets: [{ entity_id: 'foo-bar' }] }, 'targets.0.entity_id');
    expectFail(EventCreateSchema, { ...ev, date: null }, 'date');
    const xc = { id: 'xc-daegok', name_ko: '대곡', kind: 'complex', status: 'planned', status_source_id: SRC, ...rec };
    expect(
      TransferCenterCreateSchema.safeParse({
        ...xc,
        plan_refs: [{ program_id: 'pp-tc-1', class: 'pilot', name_raw: '대곡', source_id: SRC }],
        station_ids: ['stn-daegok'],
      }).success,
    ).toBe(true);
    expectFail(TransferCenterCreateSchema, { ...xc, id: 'tc-daegok' }, 'id');
  });

  it('document and timetable', () => {
    const doc = {
      storage_key: 'k',
      filename: 'a.pdf',
      mime: 'application/pdf',
      size_bytes: 10,
      sha256: 'a'.repeat(64),
      kind: 'original',
      license_class: 'kogl_1',
    };
    expect(DocumentCreateSchema.parse(doc).publishable).toBe(false);
    expectFail(DocumentCreateSchema, { ...doc, license_class: 'restricted', publishable: true }, 'publishable');
    expectFail(DocumentCreateSchema, { ...doc, kind: 'figure_crop' }, 'parent_document_id');
    const tt = {
      id: 'tt-seoul-k1-weekday-up',
      station_id: 'stn-seoul',
      route_code: 'K1',
      day_type: 'weekday',
      direction: 'up',
      source_id: SRC,
    };
    expect(TimetableSetSchema.parse({ ...tt, entries: [{ minute: 300 }] }).entries[0]?.train_no).toBe('');
    expectFail(TimetableSetSchema, { ...tt, entries: [{ minute: 1680 }] }, 'entries.0.minute');
    // 같은 분·다른 종착 행 허용(0016: 행 순서가 PK)
    expect(
      TimetableSetSchema.parse({
        ...tt,
        entries: [
          { minute: 300, dest_name: 'A' },
          { minute: 300, dest_name: 'B' },
        ],
      }).entries,
    ).toHaveLength(2);
  });
});
