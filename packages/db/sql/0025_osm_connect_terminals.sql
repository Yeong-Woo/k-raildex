-- 0025 OSM 선형을 끝 역까지 잇기(connect_terminals, docs/03-data-model.md 4-7·4-19절)
--
-- OSM 에 공사 중 선로가 끝 역 앞에서 끊겨 그려진 경우(1호선 연장: 서동탄 앞 약 450 m 미작도) 노선이 역과 떨어져 보인다.
-- 노선별로 켜는 옵션: 본선(branch 없음) 첫·끝 역의 자체 좌표(coord_basis 없음)와 가장 가까운 선형 점을 직선으로 잇는다(5 m~2 km).
-- 표시용 파생 값 — 저장하지 않는다(C-5, OSM 좌표는 뷰에서만). 모든 노선에 켜지 않는 이유: 역 좌표가 선로에서 떨어진
-- 노선(판교·춘천 등 500 m 이상)에 근거 없는 직선이 생긴다.

ALTER TABLE line_osm_map ADD COLUMN connect_terminals boolean NOT NULL DEFAULT false;

CREATE OR REPLACE VIEW osm.v_line_geometry AS
WITH w AS (
  SELECT v.line_id, v.is_construction, v.geom
    FROM osm.v_line_way v JOIN line l ON l.id = v.line_id AND l.deleted_at IS NULL
), term AS (
  SELECT DISTINCT x.line_id, s.geom::geometry AS pt
    FROM line_osm_map m
    JOIN LATERAL (
      (SELECT ls.line_id, ls.station_id FROM line_station ls
        WHERE ls.line_id = m.line_id AND ls.deleted_at IS NULL AND ls.branch IS NULL ORDER BY ls.seq LIMIT 1)
      UNION ALL
      (SELECT ls.line_id, ls.station_id FROM line_station ls
        WHERE ls.line_id = m.line_id AND ls.deleted_at IS NULL AND ls.branch IS NULL ORDER BY ls.seq DESC LIMIT 1)
    ) x ON true
    JOIN station s ON s.id = x.station_id AND s.deleted_at IS NULL AND s.geom IS NOT NULL AND s.coord_basis IS NULL
   WHERE m.connect_terminals
), conn AS (
  SELECT t.line_id, c.is_construction, ST_MakeLine(t.pt, ST_ClosestPoint(c.geom, t.pt)) AS geom
    FROM term t
    CROSS JOIN LATERAL (SELECT w.is_construction, w.geom FROM w WHERE w.line_id = t.line_id
                         ORDER BY w.geom <-> t.pt LIMIT 1) c
   WHERE ST_Distance(c.geom::geography, t.pt::geography) BETWEEN 5 AND 2000
)
SELECT u.line_id, u.is_construction,
       ST_Multi(ST_LineMerge(ST_Collect(u.geom)))::geometry(MultiLineString, 4326) AS geom
  FROM (SELECT * FROM w UNION ALL SELECT * FROM conn) u
 GROUP BY u.line_id, u.is_construction;

UPDATE line_osm_map SET connect_terminals = true WHERE line_id = 'line-seodongtan-dongtan';
