-- 0014 시점별 지도(미래 지도) (docs/03-data-model.md 6-1절, docs/06-public-web.md 3절, Q87~Q92)
-- map_at_plans(y, stage_min, include_undated) : 그 시점까지 반영되는 미개통 계획과 표시 속성
-- map_at_lines(y, …)    : 그 시점의 노선 선형(현재 운영 + 반영 계획, 대체 노선 제외)
-- map_at_stations(y, …) : 그 시점의 역(현재 운영 + 반영 계획의 신설역, 폐역 예정 제외)
-- y = NULL 이면 "모든 예정 반영"(at=future). 색이 NULL 이면 단계 대표색을 화면이 고른다(Q91 A).

CREATE OR REPLACE FUNCTION map_line_style(stage text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN plan_stage_progress(stage) >= 9 THEN 'solid'          -- 착공·시운전
              WHEN plan_stage_progress(stage) >= 5 THEN 'dashed_bold'    -- 기본계획~실시설계
              ELSE 'dashed_thin' END
$$;

CREATE OR REPLACE FUNCTION map_at_plans(y integer, stage_min text DEFAULT 'basic_plan', include_undated boolean DEFAULT false)
RETURNS TABLE (
  plan_id text, name_ko text, stage text, line_style text,
  target_value text, target_precision text, target_from date,
  delayed boolean, undated boolean
)
LANGUAGE sql STABLE SET search_path = public, osm, pg_temp AS $$
  SELECT p.id, p.name_ko, s.stage, map_line_style(s.stage),
         t.value, t.precision, t.date_from,
         (t.date_to IS NOT NULL AND t.date_to < current_date) AS delayed,
         (t.plan_id IS NULL OR t.date_from IS NULL) AS undated
    FROM plan p
    JOIN v_plan_stage s ON s.plan_id = p.id
    LEFT JOIN v_plan_target_open t ON t.plan_id = p.id
   WHERE p.deleted_at IS NULL
     AND s.stage IS NOT NULL
     AND s.stage NOT IN ('opened', 'abandoned', 'dormant')
     AND plan_stage_progress(s.stage) >= plan_stage_progress(stage_min)
     AND (
       -- 개통 예정 연도가 y 이하(y NULL = 전부)
       (t.date_from IS NOT NULL AND (y IS NULL OR extract(year FROM t.date_from) <= y))
       -- 예정이 지났는데 미개통(지연) → 현재 연도 이후 어느 시점에도 보인다
       OR (t.date_to IS NOT NULL AND t.date_to < current_date AND (y IS NULL OR y >= extract(year FROM current_date)))
       -- 목표 미정: 요청할 때만("목표 미정" 칸)
       OR (include_undated AND (t.plan_id IS NULL OR t.date_from IS NULL))
     )
$$;

CREATE OR REPLACE FUNCTION map_at_lines(y integer, stage_min text DEFAULT 'basic_plan', include_undated boolean DEFAULT false)
RETURNS TABLE (
  feature_id text, line_id text, plan_id text, name_ko text, status text, stage text, line_style text,
  color text, color_basis text, quality text, odbl boolean, delayed boolean,
  target_value text, target_precision text, geom geometry
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
           coalesce(g.geom, (SELECT ST_Multi(ST_MakeLine(s.geom::geometry ORDER BY x.seq))
                               FROM line_station x JOIN station s ON s.id = x.station_id
                              WHERE x.line_id = l.id AND x.deleted_at IS NULL AND x.status IN ('operating', 'suspended')
                                AND s.geom IS NOT NULL AND x.branch IS NULL)) AS geom
      FROM line l
      LEFT JOIN osm.v_line_geometry g ON g.line_id = l.id AND NOT g.is_construction
     WHERE l.deleted_at IS NULL AND l.status IN ('operating', 'suspended') AND l.passenger_service
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
           sh.quality, coalesce(sh.odbl, false) AS odbl, ap.delayed, ap.target_value, ap.target_precision, sh.geom::geometry AS geom
      FROM ap JOIN plan p ON p.id = ap.plan_id
      LEFT JOIN v_plan_shape sh ON sh.plan_id = ap.plan_id
  )
  SELECT * FROM current_lines WHERE geom IS NOT NULL
  UNION ALL
  SELECT * FROM plan_features WHERE geom IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION map_at_stations(y integer, stage_min text DEFAULT 'basic_plan', include_undated boolean DEFAULT false)
RETURNS TABLE (
  station_id text, name_ko text, status text, future boolean, plan_ids text[], kind text,
  approximate boolean, geom geometry
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
         s.geom::geometry
    FROM station s
    JOIN v_station_status st ON st.station_id = s.id
    LEFT JOIN future_st f ON f.station_id = s.id
   WHERE s.deleted_at IS NULL AND s.geom IS NOT NULL AND s.kind = 'station'
     AND s.id NOT IN (SELECT station_id FROM closes)
     AND (st.status IN ('operating', 'suspended') OR f.station_id IS NOT NULL)
$$;
