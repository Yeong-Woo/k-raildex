/**
 * 공개 지도 GeoJSON(docs/04-api.md 5절, docs/03-data-model.md 6-1절, docs/06-public-web.md 3절).
 * - at 없음 = 현재 지도(mv_map_station·mv_map_line, 근사 좌표는 노선 선형에 스냅해 표시 — 저장 안 함 C-6)
 * - at = 연도 | future = 시점별 지도(map_at_* — 관리 앱과 같은 도메인 함수 map.ts 를 쓴다)
 * OSM 유래 선형·좌표가 섞이면 attribution(ODbL)을 붙인다.
 */
import type { Code } from '@k-raildex/contracts';
import type { Queryable } from '../db';
import { mapAtLines, OSM_ATTRIBUTION, type FeatureCollection, type MapAtQuery } from '../map';

export type PublicMapAt = { mode: 'current' } | ({ mode: 'at' } & MapAtQuery);

type FRow = { id: string; geometry: unknown; properties: Record<string, unknown> };

const collect = (rows: FRow[]) =>
  rows.map((r) => ({ type: 'Feature' as const, id: r.id, geometry: r.geometry, properties: r.properties }));

function header(q: PublicMapAt) {
  return q.mode === 'current'
    ? { at: 'current' as const, stage_min: null, include_undated: false }
    : { at: q.year ?? ('future' as const), stage_min: q.stage_min, include_undated: q.include_undated };
}

/**
 * 차량기지 지도 점(시설 kind depot, 좌표 있음 — 0035). 색은 첫 담당 노선색. 현재 지도 전용.
 * allKinds = 관리 앱 지도: 시험 선로 등 모든 시설 종류(2026-11-29 사용자 지시 — 모든 시설을 지도에).
 */
export async function publicMapDepots(db: Queryable, opts: { allKinds?: boolean } = {}): Promise<FeatureCollection> {
  const { rows } = await db.query<{ fc: FeatureCollection }>(
    `SELECT json_build_object('type', 'FeatureCollection', 'features', coalesce(json_agg(f ORDER BY f->'properties'->>'facility_id'), '[]'::json)) AS fc
       FROM (
         SELECT json_build_object(
                  'type', 'Feature',
                  'geometry', json_build_object('type', 'Point', 'coordinates',
                                json_build_array(round(ST_X(x.geom::geometry)::numeric, 6), round(ST_Y(x.geom::geometry)::numeric, 6))),
                  'properties', json_build_object(
                    'facility_id', x.id, 'name_ko', x.name_ko, 'kind', x.kind, 'status', x.status,
                    'functions', x.functions,
                    'operator', (SELECT o.name_ko FROM operator o WHERE o.id = x.operator_id),
                    'served', coalesce((SELECT json_agg(l.name_ko ORDER BY fl.ord, l.id) FROM facility_line fl
                                          JOIN line l ON l.id = fl.line_id AND l.deleted_at IS NULL
                                         WHERE fl.facility_id = x.id AND fl.role = 'serves'), '[]'::json),
                    'color', (SELECT l.color FROM facility_line fl JOIN line l ON l.id = fl.line_id AND l.deleted_at IS NULL
                               WHERE fl.facility_id = x.id AND fl.role = 'serves' ORDER BY fl.ord, l.id LIMIT 1),
                    'approximate', x.coord_basis IS NOT NULL)) AS f
           FROM facility x
          WHERE x.deleted_at IS NULL AND ($1 OR x.kind = 'depot') AND x.geom IS NOT NULL
       ) q`,
    [opts.allKinds === true],
  );
  return rows[0]!.fc;
}

export async function publicMapStations(db: Queryable, q: PublicMapAt): Promise<FeatureCollection> {
  if (q.mode === 'current') {
    const { rows } = await db.query<FRow>(
      `SELECT m.station_id AS id, ST_AsGeoJSON(m.geom, 6)::json AS geometry,
              json_build_object('station_id', m.station_id, 'name_ko', m.name_ko, 'status', m.status,
                'approximate', m.coord_basis IS NOT NULL, 'future', m.status NOT IN ('operating', 'suspended'),
                'plan_ids', '[]'::json, 'line_ids', m.line_ids) AS properties, m.snapped
         FROM mv_map_station m ORDER BY m.station_id`,
    );
    const snapped = rows.some((r) => (r as FRow & { snapped: boolean }).snapped);
    return {
      type: 'FeatureCollection',
      ...header(q),
      // 근사 좌표 역을 OSM 선형 위로 옮긴 점이 섞인다
      ...(snapped ? { attribution: OSM_ATTRIBUTION } : {}),
      features: collect(rows.map(({ id, geometry, properties }) => ({ id, geometry, properties }))),
    };
  }
  const { rows } = await db.query<FRow>(
    `SELECT m.station_id AS id, ST_AsGeoJSON(m.geom, 6)::json AS geometry,
            json_build_object('station_id', m.station_id, 'name_ko', m.name_ko, 'status', m.status,
              'approximate', m.approximate, 'future', m.future, 'plan_ids', to_json(m.plan_ids),
              'line_ids', coalesce((SELECT array_agg(v.line_id ORDER BY v.line_id) FROM v_station_line v WHERE v.station_id = m.station_id), '{}')
            ) AS properties, m.snapped
       FROM map_at_stations($1::int, $2, $3) m ORDER BY m.station_id`,
    [q.year, q.stage_min, q.include_undated],
  );
  // 현재 지도와 같은 스냅 점(근사 좌표 역 → OSM 선형 위)이 섞인다
  const snapped = rows.some((r) => (r as FRow & { snapped: boolean }).snapped);
  return {
    type: 'FeatureCollection',
    ...header(q),
    ...(snapped ? { attribution: OSM_ATTRIBUTION } : {}),
    features: collect(rows.map(({ id, geometry, properties }) => ({ id, geometry, properties }))),
  };
}

export async function publicMapLines(db: Queryable, q: PublicMapAt): Promise<FeatureCollection> {
  if (q.mode === 'at') {
    const fc = await mapAtLines(db, q);
    return { ...fc, ...header(q) };
  }
  const { rows } = await db.query<FRow>(
    `SELECT 'line:' || m.line_id || CASE WHEN m.is_construction THEN ':construction' ELSE '' END AS id,
            ST_AsGeoJSON(m.geom, 6)::json AS geometry,
            json_build_object('feature_id', 'line:' || m.line_id || CASE WHEN m.is_construction THEN ':construction' ELSE '' END,
              'line_id', m.line_id, 'plan_id', NULL, 'name_ko', m.name_ko,
              'status', CASE WHEN m.is_construction THEN 'under_construction' ELSE m.status END,
              'stage', NULL, 'line_style', 'solid', 'color', m.color,
              'color_basis', CASE WHEN m.color IS NULL THEN 'status' ELSE 'line' END,
              'quality', 'osm', 'odbl', true, 'delayed', false, 'target_value', NULL, 'target_precision', NULL,
              'passenger', m.passenger_service) AS properties
       FROM mv_map_line m
      -- 폐지 노선(옛 선로, 0041)은 현재 지도가 아니다 — 관리 앱 지도에서만 보인다
      WHERE m.status NOT IN ('closed', 'abandoned')
     UNION ALL
     -- OSM 공사 선형이 없는 공사 중 노선은 공사 단계 계획의 계획 선형으로(0027 v_line_plan_shape)
     SELECT 'line:' || s.line_id || ':construction', ST_AsGeoJSON(s.geom, 6)::json,
            json_build_object('feature_id', 'line:' || s.line_id || ':construction',
              'line_id', s.line_id, 'plan_id', s.plan_id, 'name_ko', l.name_ko, 'status', 'under_construction',
              'stage', NULL, 'line_style', 'solid', 'color', l.color,
              'color_basis', CASE WHEN l.color IS NULL THEN 'status' ELSE 'line' END,
              'quality', s.quality, 'odbl', s.odbl, 'delayed', false, 'target_value', NULL, 'target_precision', NULL,
              'passenger', l.passenger_service)
       FROM v_line_plan_shape s JOIN line l ON l.id = s.line_id
      ORDER BY 1`,
  );
  return {
    type: 'FeatureCollection',
    ...header(q),
    ...(rows.length ? { attribution: OSM_ATTRIBUTION } : {}),
    features: collect(rows),
  };
}

/** 계획 선형(v_plan_shape) + 시점별 포함 계획(map_at_plans). at 없음 = 올해 */
export async function publicMapPlans(db: Queryable, q: MapAtQuery): Promise<FeatureCollection> {
  const { rows } = await db.query<FRow & { odbl: boolean }>(
    `SELECT a.plan_id AS id, ST_AsGeoJSON(sh.geom, 6)::json AS geometry, coalesce(sh.odbl, false) AS odbl,
            json_build_object('plan_id', a.plan_id, 'name_ko', a.name_ko, 'stage', a.stage, 'line_style', a.line_style,
              'color', p.color, 'quality', sh.quality, 'odbl', coalesce(sh.odbl, false), 'delayed', a.delayed, 'undated', a.undated,
              'target_value', a.target_value, 'target_precision', a.target_precision) AS properties
       FROM map_at_plans($1::int, $2, $3) a JOIN plan p ON p.id = a.plan_id
       LEFT JOIN v_plan_shape sh ON sh.plan_id = a.plan_id
      ORDER BY a.target_from NULLS LAST, a.plan_id`,
    [q.year, q.stage_min, q.include_undated],
  );
  return {
    type: 'FeatureCollection',
    at: q.year ?? 'future',
    stage_min: q.stage_min,
    include_undated: q.include_undated,
    ...(rows.some((r) => r.odbl) ? { attribution: OSM_ATTRIBUTION } : {}),
    features: collect(rows.map(({ id, geometry, properties }) => ({ id, geometry, properties }))),
  };
}

/** 연도 슬라이더: 연도별 개통 예정 계획 수·목록 + 목표 미정(FR-WEB-020·025) */
export async function publicMapTimeline(db: Queryable, stageMin: Code<'planStage'>) {
  const { rows } = await db.query<{
    year: number | null;
    plan_id: string;
    name_ko: string;
    stage: string;
    delayed: boolean;
    cy: number;
  }>(
    `SELECT CASE WHEN undated THEN NULL ELSE extract(year FROM target_from)::int END AS year, plan_id, name_ko, stage, delayed,
            extract(year FROM current_date)::int AS cy
       FROM map_at_plans(NULL, $1, true) ORDER BY target_from NULLS LAST, plan_id`,
    [stageMin],
  );
  const cy = rows[0]?.cy ?? new Date().getFullYear();
  const years = new Map<number, { id: string; name_ko: string; stage: string; delayed: boolean }[]>();
  const undated: { id: string; name_ko: string; stage: string }[] = [];
  for (const r of rows) {
    if (r.year == null) {
      undated.push({ id: r.plan_id, name_ko: r.name_ko, stage: r.stage });
      continue;
    }
    const list = years.get(r.year) ?? [];
    list.push({ id: r.plan_id, name_ko: r.name_ko, stage: r.stage, delayed: r.delayed });
    years.set(r.year, list);
  }
  return {
    stage_min: stageMin,
    current_year: cy,
    years: [...years.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, plans]) => ({ year, count: plans.length, plans })),
    undated: undated.length,
    undated_plans: undated,
  };
}

/** 운행 계통 선형(mv_service_geometry, docs/03-data-model.md 6-2절). 없는 계통이면 null */
export async function publicMapService(db: Queryable, id: string) {
  const svc = await db.query<{ id: string }>(`SELECT id FROM service WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!svc.rows[0]) return null;
  const { rows } = await db.query<FRow>(
    `SELECT g.service_id || ':' || g.status || CASE WHEN g.approximate THEN ':approx' ELSE '' END AS id,
            ST_AsGeoJSON(g.geom, 6)::json AS geometry,
            json_build_object('service_id', s.id, 'name_ko', s.name_ko, 'kind', s.kind, 'color', c.color,
              'color_basis', c.color_basis, 'status', g.status, 'approximate', g.approximate) AS properties
       FROM mv_service_geometry g JOIN service s ON s.id = g.service_id
       JOIN v_service_color c ON c.service_id = s.id
      WHERE g.service_id = $1
      ORDER BY g.status <> 'operating', g.approximate`,
    [id],
  );
  return {
    type: 'FeatureCollection' as const,
    service_id: id,
    ...(rows.length ? { attribution: OSM_ATTRIBUTION } : {}),
    features: collect(rows),
  };
}
