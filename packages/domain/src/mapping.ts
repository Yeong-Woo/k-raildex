/**
 * 개체 대응표: 계약(zod, packages/contracts) ↔ DB 행.
 * - 단순 필드는 DB 열 정보로 자동 판별한다: `x_value/x_precision` 쌍 = 퍼지 날짜, geography = 점, geometry = 선, jsonb = JSON.
 * - 하위 목록(별도 테이블)만 여기 적는다. 하위 목록의 seq·ord 는 배열 순서(계약 규약).
 */
import type { EntityType } from '@k-raildex/contracts';
import { fromDb } from './db';
import type { ColumnInfo } from './schema-info';

export type ChildKind =
  /** 객체 배열 → 행 여러 개 */
  | 'objects'
  /** 값 배열 → 한 열(valueColumn)의 행 여러 개 */
  | 'values'
  /** 객체 하나(또는 null) → 행 0/1 개 */
  | 'single';

export interface ChildSpec {
  field: string;
  table: string;
  /** 부모 id 를 담는 열 */
  fk: string;
  kind: ChildKind;
  /** kind values 의 값 열 */
  valueColumn?: string;
  /** 배열 순서를 저장하는 열 */
  orderColumn?: 'seq' | 'ord';
  /** 행 읽기 순서(orderColumn 이 없을 때) */
  orderBy?: string;
  /** 쓰기 메타(created_by 등)를 채울 테이블 */
  hasMeta?: boolean;
  /** 계약에 없는 열(id 등)을 읽기에서 뺀다 */
}

export interface EntitySpec {
  type: EntityType;
  table: string;
  children: ChildSpec[];
  /** REC(큐레이션 메타) 열이 있는 개체(reviewed_at 을 읽는다) */
  curated: boolean;
}

const common = (fk = 'entity_id'): ChildSpec[] => [
  { field: 'sources', table: 'record_source', fk, kind: 'objects', orderColumn: 'ord' },
  { field: 'names', table: 'entity_name', fk, kind: 'objects', orderColumn: 'ord' },
  { field: 'external_refs', table: 'external_ref', fk, kind: 'objects', orderBy: 'id' },
];

const spec = (type: EntityType, children: ChildSpec[] = [], curated = true, table: string = type): EntitySpec => ({
  type,
  table,
  curated,
  children: [...common(), ...children],
});

export const ENTITY_SPECS: Readonly<Record<EntityType, EntitySpec>> = {
  source: spec(
    'source',
    [{ field: 'documents', table: 'source_document', fk: 'source_id', kind: 'objects', orderBy: 'document_id' }],
    true, // REC 열(reviewed_at 등)이 있다. 출처 ≥1 요구는 없음(DB entity_table.curated = false)
  ),
  operator: spec('operator'),
  station: spec('station'),
  line_station: spec('line_station', [], false),
  line: spec('line', [
    {
      field: 'regions',
      table: 'line_region',
      fk: 'line_id',
      kind: 'values',
      valueColumn: 'region_code',
      orderBy: 'region_code',
    },
    { field: 'operators', table: 'line_operator', fk: 'line_id', kind: 'objects', orderColumn: 'ord' },
    { field: 'osm_map', table: 'line_osm_map', fk: 'line_id', kind: 'single' },
  ]),
  train_class: spec('train_class'),
  service: spec('service', [
    {
      field: 'lines',
      table: 'service_line',
      fk: 'service_id',
      kind: 'values',
      valueColumn: 'line_id',
      orderColumn: 'seq',
    },
    // stop_patterns 는 2단(stop_pattern + stop_pattern_stop)이라 적용기·읽기에서 따로 처리한다
  ]),
  plan_program: spec('plan_program', [
    { field: 'notices', table: 'plan_program_notice', fk: 'program_id', kind: 'objects', orderColumn: 'seq' },
    {
      field: 'points',
      table: 'plan_program_point',
      fk: 'program_id',
      kind: 'values',
      valueColumn: 'text',
      orderColumn: 'seq',
    },
    { field: 'figures', table: 'plan_program_figure', fk: 'program_id', kind: 'objects', orderColumn: 'seq' },
  ]),
  plan: spec('plan', [
    { field: 'refs', table: 'plan_ref', fk: 'plan_id', kind: 'objects', orderColumn: 'seq' },
    {
      field: 'stage_events',
      table: 'plan_stage_event',
      fk: 'plan_id',
      kind: 'objects',
      orderBy: 'date_from NULLS LAST, id',
    },
    { field: 'milestones', table: 'plan_milestone', fk: 'plan_id', kind: 'objects', orderBy: 'id' },
    { field: 'lines', table: 'plan_line', fk: 'plan_id', kind: 'objects', orderBy: 'line_id, role' },
    { field: 'stations', table: 'plan_station', fk: 'plan_id', kind: 'objects', orderBy: 'station_id' },
    {
      field: 'regions',
      table: 'plan_region',
      fk: 'plan_id',
      kind: 'values',
      valueColumn: 'region_code',
      orderBy: 'region_code',
    },
    { field: 'relations', table: 'plan_relation', fk: 'plan_id', kind: 'objects', orderBy: 'id' },
    { field: 'geometries', table: 'plan_geometry', fk: 'plan_id', kind: 'objects', orderBy: 'id', hasMeta: true },
    {
      field: 'watch_keywords',
      table: 'plan_watch_keyword',
      fk: 'plan_id',
      kind: 'values',
      valueColumn: 'keyword',
      orderBy: 'keyword',
    },
  ]),
  event: spec('event', [
    { field: 'targets', table: 'event_target', fk: 'event_id', kind: 'objects', orderBy: 'role DESC, entity_id' },
    {
      field: 'area_codes',
      table: 'event_area',
      fk: 'event_id',
      kind: 'values',
      valueColumn: 'area_code',
      orderBy: 'area_code',
    },
  ]),
  train_number_range: spec('train_number_range', [
    {
      field: 'service_ids',
      table: 'train_number_range_service',
      fk: 'range_id',
      kind: 'values',
      valueColumn: 'service_id',
      orderBy: 'service_id',
    },
    {
      field: 'line_ids',
      table: 'train_number_range_line',
      fk: 'range_id',
      kind: 'values',
      valueColumn: 'line_id',
      orderBy: 'line_id',
    },
  ]),
  rolling_stock_range: spec('rolling_stock_range', [
    {
      field: 'service_ids',
      table: 'rolling_stock_range_service',
      fk: 'range_id',
      kind: 'values',
      valueColumn: 'service_id',
      orderBy: 'service_id',
    },
    {
      field: 'line_ids',
      table: 'rolling_stock_range_line',
      fk: 'range_id',
      kind: 'values',
      valueColumn: 'line_id',
      orderBy: 'line_id',
    },
  ]),
  transfer_center: spec('transfer_center', [
    { field: 'plan_refs', table: 'transfer_center_plan_ref', fk: 'center_id', kind: 'objects', orderColumn: 'seq' },
    {
      field: 'status_events',
      table: 'transfer_center_status_event',
      fk: 'center_id',
      kind: 'objects',
      orderBy: 'date_from NULLS LAST, id',
    },
    {
      field: 'station_ids',
      table: 'transfer_center_station',
      fk: 'center_id',
      kind: 'values',
      valueColumn: 'station_id',
      orderBy: 'station_id',
    },
    {
      field: 'plan_ids',
      table: 'transfer_center_plan',
      fk: 'center_id',
      kind: 'values',
      valueColumn: 'plan_id',
      orderBy: 'plan_id',
    },
  ]),
  route_map: spec('route_map'),
  glossary_term: spec('glossary_term'),
  facility: spec('facility', [
    { field: 'lines', table: 'facility_line', fk: 'facility_id', kind: 'objects', orderColumn: 'ord' },
    { field: 'osm_map', table: 'facility_osm_map', fk: 'facility_id', kind: 'single' },
  ]),
};

/** 운행 계통 정차 패턴(2단 하위) */
export const STOP_PATTERNS_FIELD = 'stop_patterns';

// ---------------------------------------------------------------------------
// 필드 ↔ 열 변환
// ---------------------------------------------------------------------------

export type FieldKind = 'fuzzy' | 'point' | 'geometry' | 'json' | 'plain';

export function fieldKind(field: string, cols: Map<string, ColumnInfo>): FieldKind | null {
  if (cols.has(`${field}_value`) && cols.has(`${field}_precision`)) return 'fuzzy';
  const c = cols.get(field);
  if (!c) return null;
  if (c.udt === 'geography') return 'point';
  if (c.udt === 'geometry') return 'geometry';
  if (c.udt === 'jsonb' || c.udt === 'json') return 'json';
  return 'plain';
}

/** SELECT 목록: 계약 필드를 읽는 데 필요한 표현식 */
export function selectExprs(fields: string[], cols: Map<string, ColumnInfo>, alias = 't'): string[] {
  const out: string[] = [];
  for (const f of fields) {
    switch (fieldKind(f, cols)) {
      case 'fuzzy':
        out.push(`${alias}."${f}_value"`, `${alias}."${f}_precision"`);
        break;
      case 'point':
        out.push(`ST_Y(${alias}."${f}"::geometry) AS "${f}__lat"`, `ST_X(${alias}."${f}"::geometry) AS "${f}__lng"`);
        break;
      case 'geometry':
        out.push(`ST_AsGeoJSON(${alias}."${f}")::json AS "${f}__geojson"`);
        break;
      case 'json':
      case 'plain':
        out.push(`${alias}."${f}"`);
        break;
      default:
        break;
    }
  }
  return out;
}

/** 행 → 계약 필드 값 */
export function readField(field: string, row: Record<string, unknown>, cols: Map<string, ColumnInfo>): unknown {
  switch (fieldKind(field, cols)) {
    case 'fuzzy': {
      const precision = row[`${field}_precision`];
      if (precision == null) return null;
      return { value: (row[`${field}_value`] as string | null) ?? null, precision };
    }
    case 'point': {
      const lat = row[`${field}__lat`];
      return lat == null ? null : { lat: Number(lat), lng: Number(row[`${field}__lng`]) };
    }
    case 'geometry': {
      const g = row[`${field}__geojson`] as { type: string; coordinates: unknown } | null;
      if (!g) return null;
      // DB 는 MultiLineString 으로 저장한다
      return { type: 'MultiLineString', coordinates: g.coordinates };
    }
    case 'json':
      return row[field] ?? null;
    case 'plain': {
      const c = cols.get(field)!;
      const v = fromDb(row[field], c.dataType);
      if (c.dataType === 'ARRAY' && Array.isArray(v) && (c.udt === '_int8' || c.udt === '_numeric'))
        return v.map(Number);
      return v;
    }
    default:
      return undefined;
  }
}

export interface ColumnWrite {
  column: string;
  /** 자리표시자 $n 을 쓰는 SQL 표현식 */
  expr: (param: string) => string;
  value: unknown;
}

/** 계약 필드 값 → 쓸 열들 */
export function writeField(field: string, value: unknown, cols: Map<string, ColumnInfo>): ColumnWrite[] {
  switch (fieldKind(field, cols)) {
    case 'fuzzy': {
      const f = value as { value: string | null; precision: string } | null;
      return [
        { column: `${field}_value`, expr: (p) => p, value: f?.value ?? null },
        { column: `${field}_precision`, expr: (p) => p, value: f?.precision ?? null },
      ];
    }
    case 'point': {
      const pt = value as { lat: number; lng: number } | null;
      return [
        {
          column: field,
          expr: (p) => `ST_GeogFromText(${p})`,
          value: pt ? `SRID=4326;POINT(${pt.lng} ${pt.lat})` : null,
        },
      ];
    }
    case 'geometry':
      return [
        {
          column: field,
          expr: (p) => `ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${p}), 4326))`,
          value: value == null ? null : JSON.stringify(value),
        },
      ];
    case 'json':
      return [{ column: field, expr: (p) => p, value: value == null ? null : JSON.stringify(value) }];
    case 'plain':
      return [{ column: field, expr: (p) => p, value: value ?? null }];
    default:
      throw new Error(`대응하는 열이 없는 필드: ${field}`);
  }
}
