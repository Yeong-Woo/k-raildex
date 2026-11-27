-- 0036 시설 OSM 선로(2026-11-27 사용자 지시 — 시설 OSM 보완). OSM 은 osm 스키마에만 두고(C-5) 시설에는 배정 규칙만 저장한다.
-- 수집기 osm-rail 이 차량기지·조차장 안 선로(service=yard)도 받는다(ways_yards_kr). 이 선로는 노선 "이름" 배정에 쓰지 않는다
-- (기지 안 선로 이름이 본선 이름과 같아도 본선 선형에 들어가지 않게) — relation 구성 way·개별 way_ids 로는 여전히 배정된다.

CREATE TABLE facility_osm_map (
  facility_id text PRIMARY KEY REFERENCES facility(id) ON DELETE CASCADE ON UPDATE CASCADE,
  way_names text[] NOT NULL DEFAULT '{}',
  way_ids bigint[] NOT NULL DEFAULT '{}',
  -- 시설 좌표 둘레에서 기지 안 선로(service=yard)를 모을 반경(m). 0 이면 안 모은다
  radius_m integer NOT NULL DEFAULT 800 CHECK (radius_m BETWEEN 0 AND 5000),
  note text
);

CREATE OR REPLACE VIEW osm.v_line_way AS
WITH names AS (
  SELECT m.line_id, m.priority, m.bbox, m.include_construction, n.name
    FROM line_osm_map m CROSS JOIN LATERAL unnest(m.way_names) AS n(name)
), yard AS (
  -- 노선 relation 에 들지 않은 기지 안 선로
  SELECT w.id FROM osm.way w
   WHERE w.tags->>'service' = 'yard' AND NOT EXISTS (SELECT 1 FROM osm.relation_member rm WHERE rm.way_id = w.id)
), cand AS (
  SELECT m.line_id, m.priority, m.bbox, m.include_construction, rm.way_id
    FROM line_osm_map m JOIN osm.relation_member rm ON rm.relation_id = ANY (m.relation_ids)
  UNION
  SELECT n.line_id, n.priority, n.bbox, n.include_construction, w.id
    FROM names n JOIN osm.way w ON w.tags->>'name' = n.name WHERE w.id NOT IN (SELECT id FROM yard)
  UNION
  SELECT n.line_id, n.priority, n.bbox, n.include_construction, w.id
    FROM names n JOIN osm.way w ON w.tags->>'name:ko' = n.name WHERE w.id NOT IN (SELECT id FROM yard)
  UNION
  -- 개별 지정 way(기존 규칙대로 bbox 도 적용)
  SELECT m.line_id, m.priority, m.bbox, m.include_construction, u.way_id
    FROM line_osm_map m CROSS JOIN LATERAL unnest(m.way_ids) AS u(way_id)
), ok AS (
  SELECT c.line_id, c.priority, c.way_id, w.is_construction, w.geom
    FROM cand c JOIN osm.way w ON w.id = c.way_id
   WHERE (c.include_construction OR NOT w.is_construction)
     AND (c.bbox IS NULL
          OR ST_Intersects(ST_PointN(w.geom, ST_NPoints(w.geom) / 2 + 1),
                           ST_MakeEnvelope(c.bbox[1], c.bbox[2], c.bbox[3], c.bbox[4], 4326)))
), owner AS (
  SELECT DISTINCT ON (way_id) line_id, way_id, is_construction, geom
    FROM ok ORDER BY way_id, priority, line_id
)
SELECT line_id, way_id, is_construction, geom FROM owner
UNION ALL
SELECT o.line_id, o.way_id, o.is_construction, o.geom
  FROM ok o
  JOIN owner ow ON ow.way_id = o.way_id AND ow.line_id <> o.line_id
  JOIN line_osm_map m ON m.line_id = o.line_id AND ow.line_id = ANY (m.share_with);

-- 시설 선로: (a) facility_osm_map 이름·개별 way (b) 시설 좌표 radius_m 안의 기지 안 선로(service=yard, 지도에만)
-- (c) 시설이 붙은 기지선(facility_line role connects, line_role depot_line)의 노선 선형. source = names·ways·yard·depot_line
CREATE VIEW osm.v_facility_way AS
SELECT DISTINCT ON (facility_id, way_id) facility_id, way_id, source, geom FROM (
  SELECT m.facility_id, w.id AS way_id, 'names' AS source, w.geom, 1 AS rk
    FROM facility_osm_map m JOIN facility f ON f.id = m.facility_id AND f.deleted_at IS NULL
    JOIN osm.way w ON w.tags->>'name' = ANY (m.way_names) OR w.tags->>'name:ko' = ANY (m.way_names)
  UNION ALL
  SELECT m.facility_id, w.id, 'ways', w.geom, 2
    FROM facility_osm_map m JOIN facility f ON f.id = m.facility_id AND f.deleted_at IS NULL
    JOIN osm.way w ON w.id = ANY (m.way_ids)
  UNION ALL
  SELECT f.id, w.id, 'yard', w.geom, 3
    FROM facility f LEFT JOIN facility_osm_map m ON m.facility_id = f.id
    JOIN osm.way w ON w.tags->>'service' = 'yard'
                  AND ST_DWithin(w.geom::geography, f.geom, coalesce(m.radius_m, 800))
   WHERE f.deleted_at IS NULL AND f.geom IS NOT NULL AND coalesce(m.radius_m, 800) > 0
  UNION ALL
  SELECT fl.facility_id, v.way_id, 'depot_line', v.geom, 4
    FROM facility_line fl JOIN facility f ON f.id = fl.facility_id AND f.deleted_at IS NULL
    JOIN line l ON l.id = fl.line_id AND l.deleted_at IS NULL AND l.line_role = 'depot_line'
    JOIN osm.v_line_way v ON v.line_id = l.id
   WHERE fl.role = 'connects'
) q ORDER BY facility_id, way_id, rk;

REFRESH MATERIALIZED VIEW mv_map_station;
REFRESH MATERIALIZED VIEW mv_map_line;
