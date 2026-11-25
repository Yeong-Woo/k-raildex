-- 0027 공사 중인데 OSM 공사 선형이 없는 노선(예: 수서광주선)도 현재 지도·모든 시점 지도에 '공사 중'으로 그린다
--
-- 0024 는 OSM 공사 선형만 보아, 계획 선형(traced, KDI 노선도 추적)만 있는 수서광주선이 현재 지도와 개통 목표 전 시점에서 빠졌다.
-- v_line_plan_shape: 공사 중 노선 중 OSM 공사 선형이 없고, 그 노선을 신설·연장하는 공사 단계 계획(신설·연장 노선이 그 하나뿐)의
-- 계획 선형이 있는 것. 계획 선형은 자체 데이터(OSM 이 아니면 ODbL 아님)라 quality·odbl 을 그대로 넘긴다.

CREATE VIEW v_line_plan_shape AS
SELECT DISTINCT ON (l.id) l.id AS line_id, pl.plan_id, sh.quality, coalesce(sh.odbl, false) AS odbl, sh.geom::geometry AS geom
  FROM line l
  JOIN plan_line pl ON pl.line_id = l.id AND pl.role IN ('new', 'extends')
  JOIN plan p ON p.id = pl.plan_id AND p.deleted_at IS NULL
  JOIN v_plan_shape sh ON sh.plan_id = pl.plan_id AND sh.geom IS NOT NULL
 WHERE l.deleted_at IS NULL AND l.status = 'under_construction'
   AND plan_current_stage(pl.plan_id) = 'construction'
   AND NOT EXISTS (SELECT 1 FROM osm.v_line_geometry g WHERE g.line_id = l.id AND g.is_construction)
   AND (SELECT count(*) FROM plan_line q WHERE q.plan_id = pl.plan_id AND q.role IN ('new', 'extends')) = 1
 ORDER BY l.id, sh.quality = 'schematic', pl.plan_id;

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
    UNION ALL
    -- OSM 공사 선형이 없는 공사 중 노선: 공사 단계 계획의 계획 선형(v_line_plan_shape). 그 계획이 이 시점에 반영돼 있으면 계획 선으로 그려지므로 뺀다
    SELECT 'line:' || l.id || ':construction', l.id, s.plan_id, l.name_ko, 'under_construction'::text,
           NULL::text, 'solid'::text, l.color, CASE WHEN l.color IS NULL THEN 'status' ELSE 'line' END,
           s.quality, s.odbl, false, NULL::text, NULL::text, l.passenger_service, s.geom
      FROM v_line_plan_shape s JOIN line l ON l.id = s.line_id
     WHERE l.id NOT IN (SELECT line_id FROM hidden)
       AND s.plan_id NOT IN (SELECT plan_id FROM ap)
  )
  SELECT * FROM current_lines WHERE geom IS NOT NULL
  UNION ALL
  SELECT * FROM construction_lines WHERE geom IS NOT NULL
  UNION ALL
  SELECT * FROM plan_features WHERE geom IS NOT NULL
$$;
