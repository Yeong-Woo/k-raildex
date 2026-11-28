/**
 * 시험·개발용 소규모 일관 데이터(WP 2.9). 도메인 적용기로 넣는다(적용기 시험 겸용).
 * 망: 노선 3(운영 2 + 공사 중 연장은 정거장 상태로), 역 6, 계획 3(연장·대체·철회), 운행 계통 1(급행 패턴).
 */
import type { Op } from './applier';

const D = '2026-11-20';
const SRC = 'src-fixture-notice';
const src = [{ source_id: SRC }];

export const FIXTURE_IDS = {
  source: SRC,
  stations: ['stn-fx-a', 'stn-fx-b', 'stn-fx-c', 'stn-fx-d', 'stn-fx-e', 'stn-fx-closed'],
  lines: ['line-fx-one', 'line-fx-two'],
  plans: ['plan-fx-ext', 'plan-fx-replace', 'plan-fx-withdrawn'],
} as const;

export function fixtureOps(): Op[] {
  const station = (
    id: string,
    name: string,
    region: string,
    lng: number,
    lat: number,
    extra: Record<string, unknown> = {},
  ): Op => ({
    op: 'create',
    entity_type: 'station',
    data: {
      id,
      name_ko: name,
      region_code: region,
      geom: { lat, lng },
      coord_source: 'official',
      checked_at: D,
      sources: src,
      ...extra,
    },
  });
  const ls = (
    id: string,
    line: string,
    stn: string,
    seq: number,
    status: string,
    extra: Record<string, unknown> = {},
  ): Op => ({
    op: 'create',
    entity_type: 'line_station',
    data: { id, line_id: line, station_id: stn, seq, status, ...extra },
  });
  return [
    {
      op: 'create',
      entity_type: 'source',
      data: {
        id: SRC,
        title: '시험용 고시',
        publisher: '국토교통부',
        type: 'notice',
        license: '공공저작물',
        license_class: 'public_work',
        retrieved_at: D,
        checked_at: D,
      },
    },
    {
      op: 'create',
      entity_type: 'operator',
      data: {
        id: 'op-fx-metro',
        name_ko: '시험교통공사',
        kind: 'local_corp',
        status: 'active',
        checked_at: D,
        sources: src,
      },
    },
    station('stn-fx-a', '가', '11', 127.0, 37.5, { names: [{ name: '가역', kind: 'alias' }] }),
    station('stn-fx-b', '나', '11', 127.05, 37.48),
    station('stn-fx-c', '다', '41', 127.1, 37.45),
    station('stn-fx-d', '라', '41', 127.15, 37.42, {
      coord_source: 'derived',
      coord_basis: 'district',
      coord_query: '경기도 시험시 시험동',
    }),
    station('stn-fx-e', '마', '41', 127.0, 37.4),
    {
      op: 'create',
      entity_type: 'station',
      data: {
        id: 'stn-fx-closed',
        name_ko: '바',
        region_code: '26',
        own_status: 'closed',
        own_closed: { value: '2001', precision: 'year' },
        checked_at: D,
        sources: src,
      },
    },
    {
      op: 'create',
      entity_type: 'line',
      data: {
        id: 'line-fx-one',
        name_ko: '시험 1호선',
        category: 'metro',
        rail_class: 'urban',
        status: 'operating',
        opened: { value: '1990-01-01', precision: 'day' },
        color: '#0052A4',
        regions: ['11', '41'],
        operators: [{ operator_id: 'op-fx-metro' }],
        checked_at: D,
        sources: src,
      },
    },
    {
      op: 'create',
      entity_type: 'line',
      data: {
        id: 'line-fx-two',
        name_ko: '시험 2호선',
        category: 'conventional',
        rail_class: 'conventional',
        status: 'operating',
        opened: { value: '2005', precision: 'year' },
        regions: ['11', '41'],
        checked_at: D,
        sources: src,
      },
    },
    ls('ls-fx-one--fx-a', 'line-fx-one', 'stn-fx-a', 1, 'operating', {
      station_code: '101',
      opened: { value: '1990-01-01', precision: 'day' },
    }),
    ls('ls-fx-one--fx-b', 'line-fx-one', 'stn-fx-b', 2, 'operating', {
      station_code: '102',
      opened: { value: '1990-01-01', precision: 'day' },
    }),
    ls('ls-fx-one--fx-c', 'line-fx-one', 'stn-fx-c', 3, 'operating', {
      station_code: '103',
      opened: { value: '1990-01-01', precision: 'day' },
    }),
    ls('ls-fx-one--fx-d', 'line-fx-one', 'stn-fx-d', 4, 'under_construction', { station_code: '104' }),
    ls('ls-fx-two--fx-a', 'line-fx-two', 'stn-fx-a', 1, 'operating', {
      name_ko: '가(2호선)',
      opened: { value: '2005-06', precision: 'month' },
    }),
    ls('ls-fx-two--fx-e', 'line-fx-two', 'stn-fx-e', 2, 'operating', {
      opened: { value: '2005-06', precision: 'month' },
    }),
    {
      op: 'update',
      entity_type: 'line',
      id: 'line-fx-one',
      data: { start_station_id: 'stn-fx-a', end_station_id: 'stn-fx-c' },
    },
    {
      op: 'create',
      entity_type: 'service',
      data: {
        id: 'svc-fx-one',
        name_ko: '시험 1호선 전철',
        kind: 'metro',
        status: 'operating',
        lines: ['line-fx-one'],
        stop_patterns: [
          {
            code: 'local',
            name_ko: '완행',
            type: 'local',
            stops: ['ls-fx-one--fx-a', 'ls-fx-one--fx-b', 'ls-fx-one--fx-c'],
          },
          { code: 'express', name_ko: '급행', type: 'express', stops: ['ls-fx-one--fx-a', 'ls-fx-one--fx-c'] },
        ],
        checked_at: D,
        sources: src,
      },
    },
    {
      op: 'create',
      entity_type: 'plan_program',
      data: {
        id: 'pp-fx-national-rail-4',
        kind: 'national_rail',
        name_ko: '시험 국가철도망 4차',
        short: '4차',
        round: 4,
        status: 'current',
        ord: 1,
        checked_at: D,
        sources: src,
      },
    },
    {
      op: 'create',
      entity_type: 'plan',
      data: {
        id: 'plan-fx-ext',
        name_ko: '시험 1호선 연장',
        refs: [{ program_id: 'pp-fx-national-rail-4', class: 'new', section: '다~라', source_id: SRC }],
        stage_events: [
          { stage: 'plan_listed', date: { value: '2021-07-05', precision: 'day' }, source_id: SRC },
          { stage: 'construction', date: { value: '2024', precision: 'year' }, source_id: SRC },
        ],
        milestones: [
          {
            stage: 'opened',
            expected: { value: '2029-H2', precision: 'half' },
            basis: 'press',
            as_of: { value: '2025-10', precision: 'month' },
            source_id: SRC,
          },
        ],
        lines: [{ line_id: 'line-fx-one', role: 'extends' }],
        stations: [{ station_id: 'stn-fx-d', role: 'new' }],
        regions: ['41'],
        geometries: [{ kind: 'schematic', via_station_ids: ['stn-fx-c', 'stn-fx-d'], source_id: SRC }],
        checked_at: D,
        sources: src,
      },
    },
    {
      op: 'create',
      entity_type: 'plan',
      data: {
        id: 'plan-fx-replace',
        name_ko: '시험 2호선 대체 신선',
        color: '#123456',
        refs: [{ program_id: 'pp-fx-national-rail-4', class: 'new', source_id: SRC }],
        stage_events: [{ stage: 'detail_design', date: { value: '2025', precision: 'year' }, source_id: SRC }],
        milestones: [
          { stage: 'opened', expected: { value: '2032', precision: 'year' }, basis: 'official', source_id: SRC },
        ],
        lines: [{ line_id: 'line-fx-two', role: 'replaces' }],
        geometries: [
          {
            kind: 'traced',
            geom: {
              type: 'MultiLineString',
              coordinates: [
                [
                  [127.0, 37.5],
                  [127.2, 37.3],
                ],
              ],
            },
            source_id: SRC,
          },
        ],
        checked_at: D,
        sources: src,
      },
    },
    {
      op: 'create',
      entity_type: 'plan',
      data: {
        id: 'plan-fx-withdrawn',
        name_ko: '시험 철회 사업',
        refs: [{ program_id: 'pp-fx-national-rail-4', class: 'review', source_id: SRC }],
        stage_events: [
          { stage: 'feasibility', date: { value: '2019', precision: 'year' }, source_id: SRC },
          { stage: 'feasibility', kind: 'withdrawn', date: { value: '2021', precision: 'year' }, source_id: SRC },
        ],
        checked_at: D,
        sources: src,
      },
    },
  ];
}
