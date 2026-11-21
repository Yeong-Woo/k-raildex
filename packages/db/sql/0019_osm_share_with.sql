-- 0019 OSM 공용 구간(share_with)·먼저 차지(claim_first) 복원 (docs/03-data-model.md 4-7·4-19)
--
-- 기존 build-map 의 두 배정 옵션이 이관 때 계약에 열이 없어 note 로만 남았다(사용자 지적 2026-11-21: 수서~동탄 공용 구간이
-- GTX-A 로만 그려져 수서평택고속선 선형이 비었다).
-- 1) share_with: 다른 노선이 먼저 차지한 way 라도 그 노선이 share_with 에 있으면 이 노선에도 배정한다(공용 구간).
-- 2) claim_first: 기존에는 목록 순서보다 먼저 배정했다. 새 스키마에서는 priority 를 앞으로 당겨(−1000) 같은 효과를 낸다.

ALTER TABLE line_osm_map ADD COLUMN share_with text[] NOT NULL DEFAULT '{}';

-- note 에 보관된 옵션을 열로 옮긴다(이관 note 형식: "share_with: a, b" / "claim_first: true" 한 줄)
UPDATE line_osm_map
   SET share_with = string_to_array(substring(note FROM 'share_with: ([^\n]+)'), ', '),
       note = nullif(btrim(regexp_replace(note, '\n?share_with: [^\n]+', ''), E'\n '), '')
 WHERE note ~ 'share_with: ';

UPDATE line_osm_map
   SET priority = priority - 1000,
       note = nullif(btrim(regexp_replace(note, '\n?claim_first: true', ''), E'\n '), '')
 WHERE note ~ 'claim_first: true';

-- 열 이름·순서는 그대로(의존 뷰 v_line_geometry 유지). 공용 way 는 차지한 노선 + share_with 로 원한 노선에 모두 나온다
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
