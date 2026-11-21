-- 0020 OSM 개별 way 지정(way_ids) 복원 — 기존 build-map 의 `ways` 옵션(이관 때 note 로만 보관)
-- relation·이름으로 잡히지 않는 짧은 구간을 노선에 더할 때 쓴다(예: GTX-A 동탄역 구간 — GTX-A relation 은 역 0.8km 앞에서 끝나고
-- 역 구간 way 는 이름이 수서평택고속선이라 수서평택고속선이 차지한다 → way_ids + share_with 로 함께 배정). OSM id 숫자만 보관.

ALTER TABLE line_osm_map ADD COLUMN way_ids bigint[] NOT NULL DEFAULT '{}';

UPDATE line_osm_map
   SET way_ids = string_to_array(substring(note FROM 'ways: ([^\n]+)'), ', ')::bigint[],
       note = nullif(btrim(regexp_replace(note, '\n?ways: [^\n]+', ''), E'\n '), '')
 WHERE note ~ 'ways: [0-9]';

CREATE OR REPLACE VIEW osm.v_line_way AS
WITH names AS (
  SELECT m.line_id, m.priority, m.bbox, m.include_construction, n.name
    FROM line_osm_map m CROSS JOIN LATERAL unnest(m.way_names) AS n(name)
), cand AS (
  SELECT m.line_id, m.priority, m.bbox, m.include_construction, rm.way_id
    FROM line_osm_map m JOIN osm.relation_member rm ON rm.relation_id = ANY (m.relation_ids)
  UNION
  SELECT n.line_id, n.priority, n.bbox, n.include_construction, w.id
    FROM names n JOIN osm.way w ON w.tags->>'name' = n.name
  UNION
  SELECT n.line_id, n.priority, n.bbox, n.include_construction, w.id
    FROM names n JOIN osm.way w ON w.tags->>'name:ko' = n.name
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

REFRESH MATERIALIZED VIEW mv_map_station;
REFRESH MATERIALIZED VIEW mv_map_line;
