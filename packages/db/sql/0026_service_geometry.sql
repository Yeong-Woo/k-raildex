-- 0026 운행 계통 선형(지도 "운행 계통" 강조, docs/03-data-model.md 6-2절, docs/06-public-web.md FR-WEB-029)
--
-- 운행 계통은 선형을 갖지 않는다(물리 노선 ≠ 운행 계통, C-3). 계통이 다니는 구간을 노선 선형에서 잘라 파생한다.
-- 규칙: 계통 노선(service_line)마다 정차 패턴(전체 패턴 합)에 들어간 노선별 역을 노선 순서(seq, 같은 branch 끼리)로 이어
-- 이웃한 두 역 사이를 그 노선 OSM 선형에서 자른다(역 점 = mv_map_station, 근사 좌표 스냅과 같은 점).
--   1) 두 역이 같은 선형 조각 위(300 m 안) → 그 조각의 두 역 사이
--   2) 다른 조각 → 역 쪽 두 조각을 서로 가까운 끝까지 + 그 끝 사이 직선
--   3) 조각이 없으면 두 역 근처 통로(역 사이 거리의 25%, 최소 1 km) 안의 노선 선형, 그것도 없으면 직선(approximate)
-- 정차역이 하나도 없는 계통 노선(운행 예정 연장 — 1호선 연장 등)은 노선 선형 전체를 노선 상태로.
-- 파생 값 — 저장하지 않는다(물리화 뷰, refresh_derived 로 갱신). OSM 유래 선형이므로 ODbL 표기.

CREATE MATERIALIZED VIEW mv_service_segment AS
WITH parts AS (
  SELECT g.line_id, (ST_Dump(g.geom)).geom AS part FROM osm.v_line_geometry g
), served AS (
  SELECT DISTINCT p.service_id, ls.line_id, ls.station_id, ls.seq, coalesce(ls.branch, '') AS br
    FROM stop_pattern p
    JOIN service sv ON sv.id = p.service_id AND sv.deleted_at IS NULL
    JOIN stop_pattern_stop x ON x.pattern_id = p.id
    JOIN line_station ls ON ls.id = x.line_station_id AND ls.deleted_at IS NULL
), ordered AS (
  SELECT s.*, lead(s.station_id) OVER (PARTITION BY s.service_id, s.line_id, s.br ORDER BY s.seq) AS next_id FROM served s
), pairs AS (
  SELECT DISTINCT o.line_id, o.station_id AS a_id, o.next_id AS b_id, sa.geom AS a, sb.geom AS b
    FROM ordered o
    JOIN mv_map_station sa ON sa.station_id = o.station_id
    JOIN mv_map_station sb ON sb.station_id = o.next_id
   WHERE o.next_id IS NOT NULL
), seg AS (
  SELECT pr.line_id, pr.a_id, pr.b_id,
    CASE
      WHEN one.part IS NOT NULL THEN ST_LineSubstring(one.part, least(one.fa, one.fb), greatest(one.fa, one.fb))
      WHEN pa.part IS NOT NULL AND pb.part IS NOT NULL THEN
        ST_LineMerge(ST_Collect(ARRAY[
          ST_LineSubstring(pa.part, least(pa.f, pa.fe), greatest(pa.f, pa.fe)),
          ST_MakeLine(ST_LineInterpolatePoint(pa.part, pa.fe), ST_LineInterpolatePoint(pb.part, pb.fe)),
          ST_LineSubstring(pb.part, least(pb.f, pb.fe), greatest(pb.f, pb.fe))]))
      ELSE (SELECT ST_CollectionExtract(ST_Intersection(g.geom,
                     ST_Buffer(ST_MakeLine(pr.a, pr.b)::geography, greatest(1000, 0.25 * ST_Distance(pr.a::geography, pr.b::geography)))::geometry), 2)
              FROM osm.v_line_geometry g WHERE g.line_id = pr.line_id AND NOT g.is_construction)
    END AS geom,
    (one.part IS NULL AND (pa.part IS NULL OR pb.part IS NULL)) AS approximate,
    ST_MakeLine(pr.a, pr.b) AS straight
    FROM pairs pr
    LEFT JOIN LATERAL (
      SELECT p.part, ST_LineLocatePoint(p.part, pr.a) AS fa, ST_LineLocatePoint(p.part, pr.b) AS fb FROM parts p
       WHERE p.line_id = pr.line_id
         AND ST_DWithin(p.part::geography, pr.a::geography, 300) AND ST_DWithin(p.part::geography, pr.b::geography, 300)
       ORDER BY ST_Distance(p.part, pr.a) + ST_Distance(p.part, pr.b) LIMIT 1) one ON true
    LEFT JOIN LATERAL (
      SELECT p.part, ST_LineLocatePoint(p.part, pr.a) AS f,
             CASE WHEN ST_Distance(ST_StartPoint(p.part), pr.b) < ST_Distance(ST_EndPoint(p.part), pr.b) THEN 0 ELSE 1 END AS fe
        FROM parts p WHERE one.part IS NULL AND p.line_id = pr.line_id AND ST_DWithin(p.part::geography, pr.a::geography, 300)
       ORDER BY ST_Distance(p.part, pr.a) LIMIT 1) pa ON true
    LEFT JOIN LATERAL (
      SELECT p.part, ST_LineLocatePoint(p.part, pr.b) AS f,
             CASE WHEN ST_Distance(ST_StartPoint(p.part), pr.a) < ST_Distance(ST_EndPoint(p.part), pr.a) THEN 0 ELSE 1 END AS fe
        FROM parts p WHERE one.part IS NULL AND p.line_id = pr.line_id AND ST_DWithin(p.part::geography, pr.b::geography, 300)
       ORDER BY ST_Distance(p.part, pr.b) LIMIT 1) pb ON true
)
SELECT line_id, a_id, b_id,
       (approximate AND (geom IS NULL OR ST_IsEmpty(geom))) AS straight_line,
       CASE WHEN geom IS NULL OR ST_IsEmpty(geom) THEN straight ELSE geom END::geometry AS geom
  FROM seg;

CREATE UNIQUE INDEX mv_service_segment_idx ON mv_service_segment (line_id, a_id, b_id);

CREATE MATERIALIZED VIEW mv_service_geometry AS
WITH served AS (
  SELECT DISTINCT p.service_id, ls.line_id, ls.station_id, ls.seq, coalesce(ls.branch, '') AS br
    FROM stop_pattern p
    JOIN stop_pattern_stop x ON x.pattern_id = p.id
    JOIN line_station ls ON ls.id = x.line_station_id AND ls.deleted_at IS NULL
), ordered AS (
  SELECT s.*, lead(s.station_id) OVER (PARTITION BY s.service_id, s.line_id, s.br ORDER BY s.seq) AS next_id FROM served s
), parts AS (
  -- 정차 구간
  SELECT o.service_id, 'operating'::text AS status, g.straight_line AS approximate, g.geom
    FROM ordered o JOIN mv_service_segment g ON g.line_id = o.line_id AND g.a_id = o.station_id AND g.b_id = o.next_id
  UNION ALL
  -- 정차역이 없는 계통 노선: 노선 선형 전체(노선 상태)
  SELECT sl.service_id,
         CASE WHEN g.is_construction THEN 'under_construction' ELSE l.status END, false, g.geom::geometry
    FROM service_line sl
    JOIN line l ON l.id = sl.line_id AND l.deleted_at IS NULL
    JOIN osm.v_line_geometry g ON g.line_id = sl.line_id
   WHERE NOT EXISTS (SELECT 1 FROM served s WHERE s.service_id = sl.service_id AND s.line_id = sl.line_id)
)
SELECT p.service_id, p.status, p.approximate,
       ST_Multi(ST_LineMerge(ST_CollectionExtract(ST_Collect(p.geom), 2)))::geometry(MultiLineString, 4326) AS geom
  FROM parts p JOIN service sv ON sv.id = p.service_id AND sv.deleted_at IS NULL
 GROUP BY p.service_id, p.status, p.approximate;

CREATE UNIQUE INDEX mv_service_geometry_idx ON mv_service_geometry (service_id, status, approximate);

CREATE OR REPLACE FUNCTION refresh_derived() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_search;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_map_station;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_map_line;
  -- 운행 계통 선형은 역 점(mv_map_station)을 쓴다 → 그 뒤
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_service_segment;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_service_geometry;
END $$;
