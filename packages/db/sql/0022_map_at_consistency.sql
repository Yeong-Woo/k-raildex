-- 0022 현재 ↔ 시점 지도 전환 때 달라지던 것 바로잡기(사용자 보고 2026-11-25, docs/03-data-model.md 6-1절)
--
-- 1) 역 위치: 현재 지도(mv_map_station)는 근사 좌표 역(coord_basis 지번·시군구·읍면동)을 노선 선형에 스냅해 그리는데
--    map_at_stations 는 자체 좌표를 그대로 써서 전환하면 역이 최대 2 km 옮겨 갔다(인덕원동탄선 정거장 등). 같은 스냅 점을 쓴다(저장 안 함, C-6).
-- 2) 계획 선형 이름: 신설·연장 노선이 있는 계획은 노선 이름으로(평택고속연결선이 계획 이름 "수원발 KTX"로 바뀌던 것). 계획은 plan_id 로 남는다.
-- 3) 계획과 묶이지 않은 공사 중 구간(병점기지선 등)이 시점 지도에서 사라지던 것: 모든 시점에 공사 중으로 그린다.
-- 반환 열이 바뀌어(map_at_stations snapped) DROP 후 다시 만든다(의존 객체 없음 — 앱 질의만 부른다).

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
  plan_features AS (   -- 반영 계획: 신설·연장 노선 단위, 노선이 없으면 계획 선형
    SELECT 'plan:' || ap.plan_id AS feature_id,
           (SELECT pl.line_id FROM plan_line pl WHERE pl.plan_id = ap.plan_id AND pl.role IN ('extends', 'new')
             ORDER BY pl.role = 'extends' DESC LIMIT 1) AS line_id,
           ap.plan_id,
           coalesce((SELECT l.name_ko FROM plan_line pl JOIN line l ON l.id = pl.line_id AND l.deleted_at IS NULL
                      WHERE pl.plan_id = ap.plan_id AND pl.role IN ('extends', 'new')
                      ORDER BY pl.role = 'extends' DESC LIMIT 1), ap.name_ko) AS name_ko,
           'planned'::text AS status, ap.stage, ap.line_style,
           coalesce(
             (SELECT l.color FROM plan_line pl JOIN line l ON l.id = pl.line_id
               WHERE pl.plan_id = ap.plan_id AND pl.role = 'extends' AND l.color IS NOT NULL LIMIT 1),
             p.color) AS color,
           CASE WHEN EXISTS (SELECT 1 FROM plan_line pl JOIN line l ON l.id = pl.line_id
                              WHERE pl.plan_id = ap.plan_id AND pl.role = 'extends' AND l.color IS NOT NULL) THEN 'extends_line'
                WHEN p.color IS NOT NULL THEN 'official'
                ELSE 'stage' END AS color_basis,
           sh.quality, coalesce(sh.odbl, false) AS odbl, ap.delayed, ap.target_value, ap.target_precision, true AS passenger, sh.geom::geometry AS geom
      FROM ap JOIN plan p ON p.id = ap.plan_id
      LEFT JOIN v_plan_shape sh ON sh.plan_id = ap.plan_id
  ),
  construction_lines AS (   -- 계획(신설·연장)과 묶이지 않은 공사 중 구간: 개통 시점을 모르므로 현재 지도처럼 모든 시점에 공사 중으로
    SELECT 'line:' || l.id || ':construction', l.id, NULL::text, l.name_ko, 'under_construction'::text,
           NULL::text, 'solid'::text, l.color, CASE WHEN l.color IS NULL THEN 'status' ELSE 'line' END,
           'osm'::text, true, false, NULL::text, NULL::text, l.passenger_service, g.geom
      FROM line l
      JOIN osm.v_line_geometry g ON g.line_id = l.id AND g.is_construction
     WHERE l.deleted_at IS NULL
       AND l.id NOT IN (SELECT line_id FROM hidden)
       AND NOT EXISTS (SELECT 1 FROM plan_line pl JOIN plan p ON p.id = pl.plan_id AND p.deleted_at IS NULL
                        WHERE pl.line_id = l.id AND pl.role IN ('new', 'extends'))
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
     AND (st.status IN ('operating', 'suspended') OR f.station_id IS NOT NULL)
$$;
