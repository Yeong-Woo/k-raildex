-- 0017 OSM 선형 배정·계획 표시 선형 수정(docs/03-data-model.md 4-19, docs/legacy/design/site-structure.md 11-2) — 첫 OSM 적재(osm-rail) 때 발견
--
-- osm.v_line_way: 기존 build-map 배정 규칙과 맞춘다
-- 1) line_osm_map.bbox 는 relation 구성원에도 적용한다(0013 은 way 이름 후보에만 적용 → 7호선 인천 구간·8호선 별내선처럼
--    한 relation 을 bbox 로 나눈 노선에서 bbox 가 있는 노선이 relation 전체를 차지해 서울 7·8호선 선형이 비었다)
-- 2) bbox 판정 = way 의 가운데 꼭짓점(ST_PointN(n/2+1), 기존 wayCenter)이 bbox 안(경계 포함)
-- 3) way 이름 일치 = name 또는 name:ko(기존 규칙). 이름은 펼쳐서 해시 조인(0013 의 = ANY 중첩 반복은 전체 계산 ~0.6초)
-- 4) 후보 UNION 은 geom 없이 하고 마지막에 way 를 붙인다(geometry 비교 정렬 제거)
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
)
SELECT DISTINCT ON (c.way_id) c.line_id, c.way_id, w.is_construction, w.geom
  FROM cand c JOIN osm.way w ON w.id = c.way_id
 WHERE (c.include_construction OR NOT w.is_construction)
   AND (c.bbox IS NULL
        OR ST_Intersects(ST_PointN(w.geom, ST_NPoints(w.geom) / 2 + 1),
                         ST_MakeEnvelope(c.bbox[1], c.bbox[2], c.bbox[3], c.bbox[4], 4326)))
 ORDER BY c.way_id, c.priority, c.line_id;

-- v_plan_shape: OSM 공사 선형(MultiLineString 여럿)을 ST_Collect 하면 GeometryCollection 이 되어 MultiLineString 형 변환이
-- 실패했다(geom 을 읽는 모든 질의 — map_at_lines 포함). 선 성분만 뽑아 MultiLineString 으로
CREATE OR REPLACE VIEW v_plan_shape AS
WITH osm_c AS (
  SELECT pl.plan_id, ST_Multi(ST_CollectionExtract(ST_Collect(g.geom), 2)) AS geom
    FROM plan_line pl JOIN osm.v_line_geometry g ON g.line_id = pl.line_id AND g.is_construction
   WHERE pl.role IN ('new', 'extends')
   GROUP BY pl.plan_id
), own AS (
  SELECT DISTINCT ON (pg.plan_id) pg.plan_id, pg.kind, pg.geom, pg.accuracy_m, pg.source_id
    FROM plan_geometry pg WHERE pg.deleted_at IS NULL
   ORDER BY pg.plan_id, CASE pg.kind WHEN 'official' THEN 0 WHEN 'traced' THEN 1 ELSE 2 END, pg.id DESC
)
SELECT p.id AS plan_id,
       CASE WHEN o.plan_id IS NOT NULL THEN 'osm_construction' ELSE own.kind END AS quality,
       coalesce(o.geom, own.geom)::geometry(MultiLineString, 4326) AS geom,
       (o.plan_id IS NOT NULL) AS odbl,
       own.accuracy_m, own.source_id
  FROM plan p
  LEFT JOIN osm_c o ON o.plan_id = p.id
  LEFT JOIN own ON own.plan_id = p.id
 WHERE p.deleted_at IS NULL AND (o.plan_id IS NOT NULL OR own.plan_id IS NOT NULL);
