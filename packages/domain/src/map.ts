/**
 * 지도 GeoJSON(docs/03-data-model.md 6-1절, docs/06-public-web.md 3절). 관리 앱 미리 보기와 공개 API 가 같이 쓴다.
 * - 시점별(미래) 지도: map_at_lines·map_at_stations(y, stage_min, include_undated). y = NULL 이면 "모든 예정 반영"(at=future)
 * - 현재 지도: mv_map_station·mv_map_line(물리화 뷰, worker 가 refresh_derived 로 갱신)
 * OSM 에서 온 선형(odbl)은 ODbL 표기 대상이다.
 */
import { codes, type Code } from '@k-raildex/contracts';
import type { Queryable } from './db';
import { DomainError } from './errors';

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors, ODbL';

export interface Feature {
  type: 'Feature';
  id?: string;
  geometry: unknown;
  properties: Record<string, unknown>;
}

export interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
  [extra: string]: unknown;
}

export interface MapAtQuery {
  /** 연도, null = 모든 예정(future) */
  year: number | null;
  stage_min: Code<'planStage'>;
  include_undated: boolean;
}

/** at 쿼리: 없으면 올해, 'future' 면 null, 그 밖은 연도(1900~2100) */
export function parseMapAt(raw: string | undefined, now = new Date()): number | null {
  if (raw === undefined || raw === '' || raw === 'now' || raw === 'current') return now.getFullYear();
  if (raw === 'future') return null;
  if (/^\d{4}$/.test(raw)) {
    const y = Number(raw);
    if (y >= 1900 && y <= 2100) return y;
  }
  throw new DomainError('validation', `at 값 오류: ${raw}`, {
    violations: [{ rule: 'schema', path: 'at', message: '연도(YYYY) 또는 future' }],
  });
}

export function parseStageMin(raw: string | undefined): Code<'planStage'> {
  const v = raw === undefined || raw === '' ? 'basic_plan' : raw;
  if (!(codes.planStage.values as readonly string[]).includes(v))
    throw new DomainError('validation', `stage_min 값 오류: ${v}`, {
      violations: [{ rule: 'schema', path: 'stage_min', message: codes.planStage.values.join('|') }],
    });
  return v as Code<'planStage'>;
}

function collect(rows: { id: string; geometry: unknown; properties: Record<string, unknown> }[]): Feature[] {
  return rows.map((r) => ({ type: 'Feature', id: r.id, geometry: r.geometry, properties: r.properties }));
}

export async function mapAtLines(db: Queryable, q: MapAtQuery): Promise<FeatureCollection> {
  const { rows } = await db.query<{ id: string; geometry: unknown; properties: Record<string, unknown> }>(
    `SELECT m.feature_id AS id, ST_AsGeoJSON(m.geom, 6)::json AS geometry,
            json_build_object('feature_id', m.feature_id, 'line_id', m.line_id, 'plan_id', m.plan_id, 'name_ko', m.name_ko,
              'status', m.status, 'stage', m.stage, 'line_style', m.line_style, 'color', m.color, 'color_basis', m.color_basis,
              'quality', m.quality, 'odbl', m.odbl, 'delayed', m.delayed,
              'target_value', m.target_value, 'target_precision', m.target_precision) AS properties
       FROM map_at_lines($1::int, $2, $3) m
      ORDER BY m.plan_id NULLS FIRST, m.feature_id`,
    [q.year, q.stage_min, q.include_undated],
  );
  const features = collect(rows);
  return {
    type: 'FeatureCollection',
    at: q.year ?? 'future',
    stage_min: q.stage_min,
    include_undated: q.include_undated,
    ...(features.some((f) => f.properties.odbl) ? { attribution: OSM_ATTRIBUTION } : {}),
    features,
  };
}

export async function mapAtStations(db: Queryable, q: MapAtQuery): Promise<FeatureCollection> {
  const { rows } = await db.query<{ id: string; geometry: unknown; properties: Record<string, unknown> }>(
    `SELECT m.station_id AS id, ST_AsGeoJSON(m.geom, 6)::json AS geometry,
            json_build_object('station_id', m.station_id, 'name_ko', m.name_ko, 'status', m.status, 'future', m.future,
              'plan_ids', m.plan_ids, 'approximate', m.approximate) AS properties
       FROM map_at_stations($1::int, $2, $3) m ORDER BY m.station_id`,
    [q.year, q.stage_min, q.include_undated],
  );
  return {
    type: 'FeatureCollection',
    at: q.year ?? 'future',
    stage_min: q.stage_min,
    include_undated: q.include_undated,
    features: collect(rows),
  };
}

export async function currentMapStations(db: Queryable): Promise<FeatureCollection> {
  const { rows } = await db.query<{ id: string; geometry: unknown; properties: Record<string, unknown> }>(
    `SELECT m.station_id AS id, ST_AsGeoJSON(m.geom, 6)::json AS geometry,
            json_build_object('station_id', m.station_id, 'name_ko', m.name_ko, 'status', m.status,
              'coord_basis', m.coord_basis, 'snapped', m.snapped, 'line_ids', m.line_ids) AS properties
       FROM mv_map_station m ORDER BY m.station_id`,
  );
  return { type: 'FeatureCollection', features: collect(rows) };
}

export async function currentMapLines(db: Queryable): Promise<FeatureCollection> {
  const { rows } = await db.query<{ id: string; geometry: unknown; properties: Record<string, unknown> }>(
    `SELECT m.line_id || CASE WHEN m.is_construction THEN ':construction' ELSE '' END AS id,
            ST_AsGeoJSON(m.geom, 6)::json AS geometry,
            json_build_object('line_id', m.line_id, 'name_ko', m.name_ko, 'status', m.status, 'rail_class', m.rail_class,
              'color', m.color, 'is_construction', m.is_construction) AS properties
       FROM mv_map_line m ORDER BY m.line_id, m.is_construction`,
  );
  return { type: 'FeatureCollection', attribution: OSM_ATTRIBUTION, features: collect(rows) };
}

/** 연도 슬라이더: 개통 예정 연도별 계획 수 + 목표 미정 수(map_at_plans(NULL, stage_min, true)) */
export async function mapTimeline(
  db: Queryable,
  stageMin: Code<'planStage'>,
): Promise<{ stage_min: string; years: { year: number; count: number }[]; undated: number }> {
  const { rows } = await db.query<{ year: number | null; n: number }>(
    `SELECT CASE WHEN undated THEN NULL ELSE extract(year FROM target_from)::int END AS year, count(*)::int AS n
       FROM map_at_plans(NULL, $1, true) GROUP BY 1 ORDER BY 1 NULLS LAST`,
    [stageMin],
  );
  return {
    stage_min: stageMin,
    years: rows.filter((r) => r.year != null).map((r) => ({ year: r.year!, count: r.n })),
    undated: rows.find((r) => r.year == null)?.n ?? 0,
  };
}
