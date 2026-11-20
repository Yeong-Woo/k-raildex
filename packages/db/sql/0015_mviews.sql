-- 0015 물리화 뷰 (docs/03-data-model.md 6·7절). data_version 증가 뒤 worker 가 REFRESH MATERIALIZED VIEW CONCURRENTLY.
-- 시설(kind ≠ station) 역은 검색·지도에서 뺀다(기존 규칙).

-- 통합 검색: 이름·별칭·정식 명칭·영문·역번호·초성
CREATE MATERIALIZED VIEW mv_search AS
WITH names AS (
  -- 역(그룹)
  SELECT s.id AS entity_id, 'station'::text AS type, s.name_ko AS name, 'name'::text AS name_kind, 10 AS rank_boost
    FROM station s WHERE s.deleted_at IS NULL AND s.kind = 'station'
  UNION ALL SELECT s.id, 'station', s.name_en, 'name_en', 5 FROM station s
   WHERE s.deleted_at IS NULL AND s.kind = 'station' AND s.name_en IS NOT NULL
  UNION ALL SELECT s.id, 'station', s.name_full, 'name_full', 5 FROM station s
   WHERE s.deleted_at IS NULL AND s.kind = 'station' AND s.name_full IS NOT NULL
  -- 노선별 역 이름(그룹 결과로 모은다)
  UNION ALL SELECT x.station_id, 'station', x.name_ko, 'line_name', 6 FROM line_station x JOIN station s ON s.id = x.station_id
   WHERE x.deleted_at IS NULL AND s.deleted_at IS NULL AND s.kind = 'station' AND x.name_ko IS NOT NULL
  -- 노선·운행 계통·계획
  UNION ALL SELECT l.id, 'line', l.name_ko, 'name', 8 FROM line l WHERE l.deleted_at IS NULL
  UNION ALL SELECT l.id, 'line', l.name_full, 'name_full', 5 FROM line l WHERE l.deleted_at IS NULL AND l.name_full IS NOT NULL
  UNION ALL SELECT sv.id, 'service', sv.name_ko, 'name', 7 FROM service sv WHERE sv.deleted_at IS NULL
  UNION ALL SELECT p.id, 'plan', p.name_ko, 'name', 6 FROM plan p WHERE p.deleted_at IS NULL
  UNION ALL SELECT p.id, 'plan', p.name_full, 'name_full', 4 FROM plan p WHERE p.deleted_at IS NULL AND p.name_full IS NOT NULL
  UNION ALL SELECT f.plan_id, 'plan', f.section, 'section', 2 FROM plan_ref f JOIN plan p ON p.id = f.plan_id
   WHERE p.deleted_at IS NULL AND f.section IS NOT NULL
  UNION ALL SELECT g.id, 'glossary_term', g.term_ko, 'name', 3 FROM glossary_term g WHERE g.deleted_at IS NULL
  -- 별칭(내부 표기 포함 — 화면에는 내부 표기를 별칭으로 보이지 않게 name_kind 로 구분)
  UNION ALL SELECT
      CASE WHEN e.type = 'line_station' THEN (SELECT x.station_id FROM line_station x WHERE x.id = en.entity_id) ELSE en.entity_id END,
      CASE WHEN e.type = 'line_station' THEN 'station' ELSE e.type END,
      en.name, 'alias_' || en.kind, 3
    FROM entity_name en JOIN entity e ON e.id = en.entity_id AND e.deleted_at IS NULL
   WHERE e.type IN ('station', 'line_station', 'line', 'service', 'plan', 'glossary_term')
), codes AS (
  SELECT x.station_id AS entity_id, string_agg(DISTINCT x.station_code, ' ') AS code
    FROM line_station x WHERE x.deleted_at IS NULL AND x.station_code IS NOT NULL GROUP BY x.station_id
)
SELECT row_number() OVER () AS row_id,
       n.entity_id, n.type, n.name, n.name_kind, hangul_chosung(n.name) AS chosung, c.code, n.rank_boost,
       CASE n.type WHEN 'station' THEN sa.areas WHEN 'line' THEN la.areas WHEN 'service' THEN va.areas WHEN 'plan' THEN pa.areas
                   ELSE '{}'::text[] END AS area_codes,
       CASE n.type WHEN 'station' THEN '/stations/' || n.entity_id || '/' WHEN 'line' THEN '/lines/' || n.entity_id || '/'
                   WHEN 'service' THEN '/services/' || n.entity_id || '/' WHEN 'plan' THEN '/plans/' || n.entity_id || '/'
                   WHEN 'glossary_term' THEN '/terms/#' || n.entity_id END AS url_path
  FROM names n
  LEFT JOIN codes c ON c.entity_id = n.entity_id AND n.type = 'station'
  LEFT JOIN v_station_area sa ON sa.station_id = n.entity_id
  LEFT JOIN v_line_area la ON la.line_id = n.entity_id
  LEFT JOIN v_service_area va ON va.service_id = n.entity_id
  LEFT JOIN v_plan_area pa ON pa.plan_id = n.entity_id
 WHERE n.entity_id IS NOT NULL AND n.name IS NOT NULL AND n.name <> '';

CREATE UNIQUE INDEX mv_search_row_idx ON mv_search (row_id);
CREATE INDEX mv_search_name_trgm_idx ON mv_search USING gin (name gin_trgm_ops);
CREATE INDEX mv_search_chosung_trgm_idx ON mv_search USING gin (chosung gin_trgm_ops);
CREATE INDEX mv_search_code_idx ON mv_search USING gin (code gin_trgm_ops);

-- 현재 지도: 역(여객역, 좌표 있음). 근사 좌표 역은 소속 노선의 OSM 선형 위 가장 가까운 점으로 옮겨 표시
-- (parcel 1km · district 3km · township 10km 이내, 다른 노선 선형으로는 옮기지 않음 — 기존 규칙, 저장 안 함 C-6)
CREATE MATERIALIZED VIEW mv_map_station AS
SELECT s.id AS station_id, s.name_ko, s.name_en, st.status, s.coord_basis,
       coalesce((SELECT array_agg(v.line_id ORDER BY v.line_id) FROM v_station_line v WHERE v.station_id = s.id), '{}') AS line_ids,
       lc.line_classes,
       snap.geom IS NOT NULL AS snapped,
       coalesce(snap.geom, s.geom::geometry)::geometry(Point, 4326) AS geom
  FROM station s
  JOIN v_station_status st ON st.station_id = s.id
  JOIN v_station_line_class lc ON lc.station_id = s.id
  LEFT JOIN LATERAL (
    SELECT ST_ClosestPoint(g.geom, s.geom::geometry) AS geom
      FROM v_station_line v JOIN osm.v_line_geometry g ON g.line_id = v.line_id
     WHERE v.station_id = s.id AND s.coord_basis IN ('parcel', 'district', 'township')
       AND ST_DWithin(g.geom::geography, s.geom,
             CASE s.coord_basis WHEN 'parcel' THEN 1000 WHEN 'district' THEN 3000 ELSE 10000 END)
     ORDER BY ST_Distance(g.geom::geography, s.geom) LIMIT 1
  ) snap ON true
 WHERE s.deleted_at IS NULL AND s.kind = 'station' AND s.geom IS NOT NULL;

CREATE UNIQUE INDEX mv_map_station_id_idx ON mv_map_station (station_id);
CREATE INDEX mv_map_station_geom_idx ON mv_map_station USING gist (geom);

-- 현재 지도: 노선 선형(OSM, 공사 중 포함) + 노선 속성. ODbL 표기 대상
CREATE MATERIALIZED VIEW mv_map_line AS
SELECT row_number() OVER (ORDER BY g.line_id, g.is_construction) AS row_id,
       g.line_id, l.name_ko, l.status, l.rail_class, l.category, l.is_wide_area, l.passenger_service, l.color,
       g.is_construction, g.geom
  FROM osm.v_line_geometry g JOIN line l ON l.id = g.line_id AND l.deleted_at IS NULL;

CREATE UNIQUE INDEX mv_map_line_row_idx ON mv_map_line (row_id);
CREATE INDEX mv_map_line_geom_idx ON mv_map_line USING gist (geom);

-- worker 가 부르는 갱신 함수
CREATE OR REPLACE FUNCTION refresh_derived() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_search;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_map_station;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_map_line;
END $$;
