-- 0041 옛 선로(2026-11-28 사용자 지시 — 중앙선 (구) 노선 지도). 수집기 osm-rail 이 폐선·미사용 선로
-- (railway=disused·abandoned·razed·dismantled, 또는 disused:railway·abandoned:railway 만 있는 way — ways_old_kr)도 받는다.
-- 옛 선로는 폐지된 노선(status closed·abandoned)에만 배정하고, 그 노선에는 옛 선로만 배정한다 —
-- 같은 이름(예: "중앙선")의 운영 선로와 옛 선로가 서로 섞이지 않게. 운영·휴업·공사 중 노선 규칙은 그대로.
-- 옛 선로는 old_name 으로도 이름 배정한다.

-- 옛 선로 태그 판정(운영·공사 중 railway 값이 아니면 옛 선로)
CREATE OR REPLACE FUNCTION osm.is_old_way(tags jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(tags->>'railway', '') !~ '^(rail|subway|light_rail|monorail|tram|construction|narrow_gauge|funicular)$'
$$;

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
  -- 옛 선로는 옛 이름(old_name)으로도 찾는다(자전거길이 된 옛 선로는 name 이 길 이름 — 예: old_name=중앙본선)
  SELECT n.line_id, n.priority, n.bbox, n.include_construction, w.id
    FROM names n JOIN osm.way w ON w.tags->>'old_name' = n.name AND osm.is_old_way(w.tags)
  UNION
  -- 개별 지정 way(기존 규칙대로 bbox 도 적용)
  SELECT m.line_id, m.priority, m.bbox, m.include_construction, u.way_id
    FROM line_osm_map m CROSS JOIN LATERAL unnest(m.way_ids) AS u(way_id)
), ok AS (
  SELECT c.line_id, c.priority, c.way_id, w.is_construction, w.geom
    FROM cand c
    JOIN osm.way w ON w.id = c.way_id
    JOIN line l ON l.id = c.line_id
   WHERE (c.include_construction OR NOT w.is_construction)
     AND osm.is_old_way(w.tags) = (l.status IN ('closed', 'abandoned'))
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

-- 시설 선로: 이름·반경 후보에서 옛 선로를 뺀다(개별 지정 way 와 기지선 노선 선형은 그대로)
CREATE OR REPLACE VIEW osm.v_facility_way AS
SELECT DISTINCT ON (facility_id, way_id) facility_id, way_id, source, geom FROM (
  SELECT m.facility_id, w.id AS way_id, 'names' AS source, w.geom, 1 AS rk
    FROM facility_osm_map m JOIN facility f ON f.id = m.facility_id AND f.deleted_at IS NULL
    JOIN osm.way w ON (w.tags->>'name' = ANY (m.way_names) OR w.tags->>'name:ko' = ANY (m.way_names))
                  AND NOT osm.is_old_way(w.tags)
  UNION ALL
  SELECT m.facility_id, w.id, 'ways', w.geom, 2
    FROM facility_osm_map m JOIN facility f ON f.id = m.facility_id AND f.deleted_at IS NULL
    JOIN osm.way w ON w.id = ANY (m.way_ids)
  UNION ALL
  SELECT f.id, w.id, 'yard', w.geom, 3
    FROM facility f LEFT JOIN facility_osm_map m ON m.facility_id = f.id
    JOIN osm.way w ON w.tags->>'service' = 'yard' AND NOT osm.is_old_way(w.tags)
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
