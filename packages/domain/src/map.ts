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
              'coord_basis', m.coord_basis, 'snapped', m.snapped, 'line_ids', m.line_ids,
              -- 선형에 스냅한 역은 자체 좌표도 준다(편집 도구가 OSM 유래 좌표를 저장하지 않도록, C-6)
              'own_coord', CASE WHEN m.snapped THEN json_build_array(round(ST_X(s.geom::geometry)::numeric, 6), round(ST_Y(s.geom::geometry)::numeric, 6)) END
            ) AS properties
       FROM mv_map_station m LEFT JOIN station s ON s.id = m.station_id AND m.snapped ORDER BY m.station_id`,
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

// ------------------------------------------------------------------ 관리 지도 도구(FR-ADM-073·074)
// OSM 좌표는 응답(표시)으로만 내보낸다. 자체 테이블에 쓰지 않는다(C-6)

/** OSM way 응답 상한(초과하면 truncated: true) */
export const OSM_WAYS_LIMIT = 3000;

export type MapBbox = [number, number, number, number];

/** bbox=w,s,e,n */
export function parseBbox(raw: string | undefined): MapBbox | null {
  if (raw === undefined || raw === '') return null;
  const parts = raw.split(',').map((s) => Number(s.trim()));
  const [w, s, e, n] = parts;
  const ok =
    parts.length === 4 &&
    parts.every((v) => Number.isFinite(v)) &&
    w! >= -180 &&
    e! <= 180 &&
    s! >= -90 &&
    n! <= 90 &&
    w! < e! &&
    s! < n!;
  if (!ok)
    throw new DomainError('validation', `bbox 값 오류: ${raw}`, {
      violations: [{ rule: 'schema', path: 'bbox', message: 'w,s,e,n (경도·위도, w<e, s<n)' }],
    });
  return parts as MapBbox;
}

export interface OsmWaysQuery {
  bbox: MapBbox | null;
  line_id: string | null;
  /** 어느 노선에도 배정되지 않은 way 만 */
  unassigned: boolean;
  limit?: number;
}

export interface OsmRelationInfo {
  id: number;
  name: string | null;
  ref: string | null;
  route: string | null;
}

/** OSM way GeoJSON(bbox·노선·미배정 필터). 속성: way_id·name·ref·railway·is_construction·assigned_line_id·relation_ids */
export async function osmWays(db: Queryable, q: OsmWaysQuery): Promise<FeatureCollection> {
  const limit = Math.min(q.limit ?? OSM_WAYS_LIMIT, OSM_WAYS_LIMIT);
  const { rows } = await db.query<{ id: string; geometry: unknown; properties: Record<string, unknown> }>(
    `WITH w AS (
       SELECT w.id, w.geom, w.tags, w.is_construction, lw.line_id
         FROM osm.way w
         LEFT JOIN osm.v_line_way lw ON lw.way_id = w.id
        WHERE ($1::float8 IS NULL OR w.geom && ST_MakeEnvelope($1, $2, $3, $4, 4326))
          AND ($5::text IS NULL OR lw.line_id = $5)
          AND (NOT $6 OR lw.line_id IS NULL)
        ORDER BY w.id
        LIMIT $7
     ), rel AS (
       SELECT rm.way_id, json_agg(DISTINCT rm.relation_id) AS ids
         FROM osm.relation_member rm WHERE rm.way_id IN (SELECT id FROM w) GROUP BY rm.way_id
     )
     SELECT w.id::text AS id, ST_AsGeoJSON(w.geom, 6)::json AS geometry,
            json_build_object('way_id', w.id, 'name', coalesce(w.tags->>'name', w.tags->>'name:ko'), 'ref', w.tags->>'ref',
              'railway', w.tags->>'railway', 'construction', w.tags->>'construction', 'is_construction', w.is_construction,
              'assigned_line_id', w.line_id,
              'relation_ids', coalesce(rel.ids, '[]'::json)
            ) AS properties
       FROM w LEFT JOIN rel ON rel.way_id = w.id ORDER BY w.id`,
    [
      q.bbox?.[0] ?? null,
      q.bbox?.[1] ?? null,
      q.bbox?.[2] ?? null,
      q.bbox?.[3] ?? null,
      q.line_id,
      q.unassigned,
      limit + 1,
    ],
  );
  const truncated = rows.length > limit;
  const features = collect(truncated ? rows.slice(0, limit) : rows);
  const relIds = [...new Set(features.flatMap((f) => (f.properties.relation_ids as number[] | null) ?? []))];
  const rels = relIds.length
    ? (
        await db.query<OsmRelationInfo>(
          `SELECT id::int8 AS id, coalesce(tags->>'name', tags->>'name:ko') AS name, tags->>'ref' AS ref, tags->>'route' AS route
             FROM osm.relation WHERE id = ANY ($1::bigint[]) ORDER BY id`,
          [relIds],
        )
      ).rows.map((r) => ({ ...r, id: Number(r.id) }))
    : [];
  return {
    type: 'FeatureCollection',
    attribution: OSM_ATTRIBUTION,
    bbox_query: q.bbox,
    line_id: q.line_id,
    unassigned: q.unassigned,
    limit,
    truncated,
    relations: rels,
    features,
  };
}

/** 노선 선형 점검: 배정된 OSM way(선) + 노선별 역(점, 자체 좌표) + 배정 설정 */
export async function lineGeometry(db: Queryable, lineId: string): Promise<FeatureCollection> {
  const line = await db.query<{
    id: string;
    name_ko: string;
    status: string;
    length_km: string | null;
    color: string | null;
  }>(`SELECT id, name_ko, status, length_km, color FROM line WHERE id = $1 AND deleted_at IS NULL`, [lineId]);
  if (!line.rows[0]) throw new DomainError('not_found', `노선 ${lineId} 가 없음`);
  const map = await db.query<Record<string, unknown>>(
    `SELECT relation_ids::float8[] AS relation_ids, way_names, bbox::float8[] AS bbox, priority, include_construction, note
       FROM line_osm_map WHERE line_id = $1`,
    [lineId],
  );
  const ways = await osmWays(db, { bbox: null, line_id: lineId, unassigned: false });
  const stations = await db.query<{ id: string; geometry: unknown; properties: Record<string, unknown> }>(
    `SELECT ls.id, ST_AsGeoJSON(s.geom::geometry, 6)::json AS geometry,
            json_build_object('kind', 'station', 'line_station_id', ls.id, 'station_id', s.id,
              'name_ko', coalesce(ls.name_ko, s.name_ko), 'seq', ls.seq, 'status', ls.status, 'coord_basis', s.coord_basis) AS properties
       FROM line_station ls JOIN station s ON s.id = ls.station_id AND s.deleted_at IS NULL
      WHERE ls.line_id = $1 AND ls.deleted_at IS NULL AND s.geom IS NOT NULL
      ORDER BY ls.seq`,
    [lineId],
  );
  const len = await db.query<{ is_construction: boolean; km: number }>(
    `SELECT is_construction, round((ST_Length(geom::geography) / 1000)::numeric, 2)::float8 AS km
       FROM osm.v_line_geometry WHERE line_id = $1 ORDER BY is_construction`,
    [lineId],
  );
  const l = line.rows[0];
  return {
    type: 'FeatureCollection',
    attribution: OSM_ATTRIBUTION,
    line: { ...l, length_km: l.length_km == null ? null : Number(l.length_km) },
    osm_map: map.rows[0] ?? null,
    osm_length_km: Object.fromEntries(len.rows.map((r) => [r.is_construction ? 'construction' : 'operating', r.km])),
    truncated: ways.truncated,
    relations: ways.relations,
    features: [
      ...ways.features.map((f) => ({ ...f, properties: { kind: 'osm_way', ...f.properties } })),
      ...collect(stations.rows),
    ],
  };
}

/** 계획 선형 편집: 계획 선형 목록(kind·via_station_ids·accuracy) + 경유역 점 + v_plan_shape 결과 + 계획 연장(plan_ref) */
export async function planGeometry(db: Queryable, planId: string): Promise<FeatureCollection> {
  const plan = await db.query<{ id: string; name_ko: string }>(
    `SELECT id, name_ko FROM plan WHERE id = $1 AND deleted_at IS NULL`,
    [planId],
  );
  if (!plan.rows[0]) throw new DomainError('not_found', `계획 ${planId} 가 없음`);
  const geoms = await db.query<{ id: string; geometry: unknown; properties: Record<string, unknown> }>(
    `SELECT 'geometry-' || g.id AS id, ST_AsGeoJSON(g.geom, 6)::json AS geometry,
            json_build_object('kind', g.kind, 'index', row_number() OVER (ORDER BY g.id) - 1, 'via_station_ids', g.via_station_ids,
              'accuracy_m', g.accuracy_m, 'method_note', g.method_note, 'source_id', g.source_id, 'note', g.note,
              'length_km', round((ST_Length(g.geom::geography) / 1000)::numeric, 2)::float8) AS properties
       FROM plan_geometry g WHERE g.plan_id = $1 AND g.deleted_at IS NULL ORDER BY g.id`,
    [planId],
  );
  const via = await db.query<{ id: string; geometry: unknown; properties: Record<string, unknown> }>(
    `SELECT 'station-' || s.id AS id, ST_AsGeoJSON(s.geom::geometry, 6)::json AS geometry,
            json_build_object('kind', 'station', 'station_id', s.id, 'name_ko', s.name_ko, 'coord_basis', s.coord_basis) AS properties
       FROM station s
      WHERE s.id IN (SELECT unnest(via_station_ids) FROM plan_geometry WHERE plan_id = $1 AND deleted_at IS NULL)
        AND s.geom IS NOT NULL
      ORDER BY s.id`,
    [planId],
  );
  const shape = await db.query<{
    geometry: unknown;
    quality: string;
    odbl: boolean;
    accuracy_m: number | null;
    source_id: string | null;
    length_km: number | null;
  }>(
    `SELECT ST_AsGeoJSON(geom, 6)::json AS geometry, quality, odbl, accuracy_m, source_id,
            round((ST_Length(geom::geography) / 1000)::numeric, 2)::float8 AS length_km
       FROM v_plan_shape WHERE plan_id = $1`,
    [planId],
  );
  const refs = await db.query<{ program_id: string; section: string | null; length_km: string | null }>(
    `SELECT program_id, section, length_km FROM plan_ref WHERE plan_id = $1 ORDER BY seq`,
    [planId],
  );
  const s = shape.rows[0];
  return {
    type: 'FeatureCollection',
    plan: plan.rows[0],
    ...(s?.odbl ? { attribution: OSM_ATTRIBUTION } : {}),
    shape: s
      ? {
          type: 'Feature',
          id: 'shape',
          geometry: s.geometry,
          properties: {
            kind: 'shape',
            quality: s.quality,
            odbl: s.odbl,
            accuracy_m: s.accuracy_m,
            source_id: s.source_id,
            length_km: s.length_km,
          },
        }
      : null,
    refs: refs.rows.map((r) => ({ ...r, length_km: r.length_km == null ? null : Number(r.length_km) })),
    features: [...collect(geoms.rows), ...collect(via.rows)],
  };
}
