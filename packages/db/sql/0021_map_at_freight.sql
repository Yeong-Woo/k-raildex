-- 0021 시점별 지도에 여객 미취급(화물 전용) 노선 포함 (Q115 A, docs/03-data-model.md 6-1절)
--
-- 현재 지도(mv_map_line)는 화물선도 그리는데 시점 지도는 여객 노선만 넣어, 현재 → 미래로 바꾸면 화물선이 사라져
-- "폐선"으로 오해할 수 있었다. 운영 중 노선은 여객 취급과 관계없이 넣고 `passenger` 열로 구분한다(화면은 회색 가는 선).
-- 반환 열이 바뀌어 DROP 후 다시 만든다(의존 객체 없음 — 앱 질의만 부른다).

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
           ap.plan_id, ap.name_ko, 'planned'::text AS status, ap.stage, ap.line_style,
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
  )
  SELECT * FROM current_lines WHERE geom IS NOT NULL
  UNION ALL
  SELECT * FROM plan_features WHERE geom IS NOT NULL
$$;
