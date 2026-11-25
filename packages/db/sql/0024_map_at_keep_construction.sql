-- 0024 시점 지도: 지금 공사 중인 노선·역은 어느 시점에도 보인다(사용자 지시 2026-11-25 "미래를 정하더라도 공사중인 노선은 보여야 해")
--
-- 전에는 공사 중 노선이 연결 계획의 개통 목표 연도 전까지 시점 지도에서 빠졌다(예: 2026년 화면에 인덕원동탄선·1호선 연장 없음).
-- 이제 목표 전에는 현재 지도처럼 '공사 중'(굵은 점선)으로, 목표 연도부터는 계획 선(개통 예정)으로 그린다. 역도 같게.

DROP FUNCTION map_at_lines(integer, text, boolean);

CREATE FUNCTION map_at_lines(y integer, stage_min text DEFAULT 'basic_plan', include_undated boolean DEFAULT false)
RETURNS TABLE (
  feature_id text, line_id text, plan_id text, name_ko text, status text, stage text, line_style text,
  color text, color_basis text, quality text, odbl boolean, delayed boolean,
  target_value text, target_precision text, passenger boolean, geom geometry
)
LANGUAGE sql STABLE SET search_path = public, osm, pg_temp AS $$
  WITH ap AS (SELECT * FROM map_at_plans(y, stage_min, include_undated)),
  hidden AS (   -- 반영 계획이 대체하는 노선(구간 지정 없는 경우만 통째로 숨김)
    SELECT pl.line_id FROM plan_line pl JOIN ap ON ap.plan_id = pl.plan_id
     WHERE pl.role = 'replaces' AND pl.from_line_station_id IS NULL AND pl.to_line_station_id IS NULL
  ),
  current_lines AS (   -- 현재 운영 중(휴업 포함) 노선: OSM 선형, 없으면 역 순서 직선
    SELECT 'line:' || l.id AS feature_id, l.id AS line_id, NULL::text AS plan_id, l.name_ko, l.status,
           NULL::text AS stage, 'solid'::text AS line_style, l.color, CASE WHEN l.color IS NULL THEN 'status' ELSE 'line' END AS color_basis,
           CASE WHEN g.geom IS NOT NULL THEN 'osm' ELSE 'station_sequence' END AS quality,
           (g.geom IS NOT NULL) AS odbl, false AS delayed, NULL::text AS target_value, NULL::text AS target_precision,
           l.passenger_service AS passenger,
           coalesce(g.geom, (SELECT ST_Multi(ST_MakeLine(s.geom::geometry ORDER BY x.seq))
                               FROM line_station x JOIN station s ON s.id = x.station_id
                              WHERE x.line_id = l.id AND x.deleted_at IS NULL AND x.status IN ('operating', 'suspended')
                                AND s.geom IS NOT NULL AND x.branch IS NULL)) AS geom
      FROM line l
      LEFT JOIN osm.v_line_geometry g ON g.line_id = l.id AND NOT g.is_construction
     WHERE l.deleted_at IS NULL AND l.status IN ('operating', 'suspended')
       AND l.id NOT IN (SELECT line_id FROM hidden)
  ),
  plan_line_feats AS (   -- 반영 계획의 신설·연장 노선 중 OSM 공사 중 선형이 있는 것: 노선마다 따로 그린다
    SELECT pl.plan_id, pl.line_id, pl.role, l.name_ko, l.color AS line_color, g.geom,
           row_number() OVER (PARTITION BY pl.plan_id ORDER BY pl.role = 'extends' DESC, pl.line_id) AS rn
      FROM ap
      JOIN plan_line pl ON pl.plan_id = ap.plan_id AND pl.role IN ('extends', 'new')
      JOIN line l ON l.id = pl.line_id AND l.deleted_at IS NULL
      JOIN osm.v_line_geometry g ON g.line_id = pl.line_id AND g.is_construction
  ),
  plan_features AS (
    -- (가) 노선 단위: 이름·색은 그 노선(연장이면 기존 노선색), 첫 노선은 'plan:<계획>', 나머지는 'plan:<계획>:<노선>'
    SELECT CASE WHEN f.rn = 1 THEN 'plan:' || f.plan_id ELSE 'plan:' || f.plan_id || ':' || f.line_id END AS feature_id,
           f.line_id, f.plan_id, f.name_ko, 'planned'::text AS status, ap.stage, ap.line_style,
           coalesce(f.line_color, p.color) AS color,
           CASE WHEN f.line_color IS NOT NULL THEN CASE WHEN f.role = 'extends' THEN 'extends_line' ELSE 'line' END
                WHEN p.color IS NOT NULL THEN 'official'
                ELSE 'stage' END AS color_basis,
           'osm_construction'::text AS quality, true AS odbl, ap.delayed, ap.target_value, ap.target_precision,
           true AS passenger, f.geom
      FROM plan_line_feats f JOIN ap ON ap.plan_id = f.plan_id JOIN plan p ON p.id = f.plan_id
    UNION ALL
    -- (나) 노선 선형이 없는 계획: 계획 선형(v_plan_shape) 하나
    SELECT 'plan:' || ap.plan_id,
           (SELECT pl.line_id FROM plan_line pl WHERE pl.plan_id = ap.plan_id AND pl.role IN ('extends', 'new')
             ORDER BY pl.role = 'extends' DESC LIMIT 1),
           ap.plan_id,
           coalesce((SELECT l.name_ko FROM plan_line pl JOIN line l ON l.id = pl.line_id AND l.deleted_at IS NULL
                      WHERE pl.plan_id = ap.plan_id AND pl.role IN ('extends', 'new')
                      ORDER BY pl.role = 'extends' DESC LIMIT 1), ap.name_ko),
           'planned'::text, ap.stage, ap.line_style,
           coalesce(
             (SELECT l.color FROM plan_line pl JOIN line l ON l.id = pl.line_id
               WHERE pl.plan_id = ap.plan_id AND pl.role = 'extends' AND l.color IS NOT NULL LIMIT 1),
             p.color),
           CASE WHEN EXISTS (SELECT 1 FROM plan_line pl JOIN line l ON l.id = pl.line_id
                              WHERE pl.plan_id = ap.plan_id AND pl.role = 'extends' AND l.color IS NOT NULL) THEN 'extends_line'
                WHEN p.color IS NOT NULL THEN 'official'
                ELSE 'stage' END,
           sh.quality, coalesce(sh.odbl, false), ap.delayed, ap.target_value, ap.target_precision, true, sh.geom::geometry
      FROM ap JOIN plan p ON p.id = ap.plan_id
      LEFT JOIN v_plan_shape sh ON sh.plan_id = ap.plan_id
     WHERE NOT EXISTS (SELECT 1 FROM plan_line_feats f WHERE f.plan_id = ap.plan_id)
  ),
  construction_lines AS (   -- 지금 공사 중인 구간(OSM construction): 그 시점에 반영된 계획 선으로 그려지지 않으면 현재 지도처럼 공사 중으로
    SELECT 'line:' || l.id || ':construction', l.id, NULL::text, l.name_ko, 'under_construction'::text,
           NULL::text, 'solid'::text, l.color, CASE WHEN l.color IS NULL THEN 'status' ELSE 'line' END,
           'osm'::text, true, false, NULL::text, NULL::text, l.passenger_service, g.geom
      FROM line l
      JOIN osm.v_line_geometry g ON g.line_id = l.id AND g.is_construction
     WHERE l.deleted_at IS NULL
       AND l.id NOT IN (SELECT line_id FROM hidden)
       AND NOT EXISTS (SELECT 1 FROM plan_line_feats f WHERE f.line_id = l.id)
  )
  SELECT * FROM current_lines WHERE geom IS NOT NULL
  UNION ALL
  SELECT * FROM construction_lines WHERE geom IS NOT NULL
  UNION ALL
  SELECT * FROM plan_features WHERE geom IS NOT NULL
$$;

DROP FUNCTION map_at_stations(integer, text, boolean);

CREATE FUNCTION map_at_stations(y integer, stage_min text DEFAULT 'basic_plan', include_undated boolean DEFAULT false)
RETURNS TABLE (
  station_id text, name_ko text, status text, future boolean, plan_ids text[], kind text,
  approximate boolean, snapped boolean, geom geometry
)
LANGUAGE sql STABLE SET search_path = public, osm, pg_temp AS $$
  WITH ap AS (SELECT * FROM map_at_plans(y, stage_min, include_undated)),
  closes AS (
    SELECT ps.station_id FROM plan_station ps JOIN ap ON ap.plan_id = ps.plan_id WHERE ps.role = 'closes'
  ),
  future_st AS (
    SELECT ps.station_id, array_agg(DISTINCT ps.plan_id) AS plan_ids
      FROM plan_station ps JOIN ap ON ap.plan_id = ps.plan_id
     WHERE ps.role IN ('new', 'existing', 'subject')
     GROUP BY ps.station_id
  )
  SELECT s.id, s.name_ko, st.status,
         (st.status NOT IN ('operating', 'suspended')) AS future,
         coalesce(f.plan_ids, '{}'), s.kind,
         (s.coord_basis IS NOT NULL) AS approximate,
         coalesce(ms.snapped, false) AS snapped,
         coalesce(ms.geom, s.geom::geometry) AS geom
    FROM station s
    JOIN v_station_status st ON st.station_id = s.id
    LEFT JOIN future_st f ON f.station_id = s.id
    LEFT JOIN mv_map_station ms ON ms.station_id = s.id
   WHERE s.deleted_at IS NULL AND s.geom IS NOT NULL AND s.kind = 'station'
     AND s.id NOT IN (SELECT station_id FROM closes)
     AND (st.status IN ('operating', 'suspended', 'under_construction') OR f.station_id IS NOT NULL
          -- 공사 중 노선의 역(계획 연결 없이 '계획' 상태인 역 포함 — 현재 지도와 같게)
          OR EXISTS (SELECT 1 FROM line_station x JOIN line l ON l.id = x.line_id AND l.deleted_at IS NULL
                      WHERE x.station_id = s.id AND x.deleted_at IS NULL AND l.status = 'under_construction'))
$$;
