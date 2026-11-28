-- 0046 관리 앱 지도의 여객역 아닌 역 그룹 점(2026-11-29 사용자 지시 — 신호장·신호소·조차장·화물역도 지도에 보이게,
-- 폐지된 신호장 포함). 현재 지도 역 점 mv_map_station 은 여객역(kind station)만이라 운전 취급·화물역이 지도에 없었다.
-- mv_map_station 은 공개 지도·운행 계통 구간(mv_service_segment)이 쓰므로 그대로 두고, 나머지 종류만 일반 뷰로 더한다
-- (행 수가 적어 물리화하지 않는다). 근사 좌표 스냅 규칙은 mv_map_station 과 같다.
-- stop_class = 정거장에 붙은 코레일 정거장 등급(조차장·신호장·신호소, 영업 중 정거장 먼저) — 없으면 역 그룹 종류.
CREATE VIEW v_map_stop_point AS
SELECT s.id AS station_id, s.name_ko, s.name_en, st.status, s.coord_basis, s.kind,
       coalesce((SELECT x.korail_class FROM line_station x
                  WHERE x.station_id = s.id AND x.deleted_at IS NULL AND x.korail_class IN ('yard', 'signal_station', 'signal_post')
                  ORDER BY (x.status = 'operating') DESC, x.id LIMIT 1), s.kind) AS stop_class,
       coalesce((SELECT array_agg(v.line_id ORDER BY v.line_id) FROM v_station_line v WHERE v.station_id = s.id), '{}') AS line_ids,
       snap.geom IS NOT NULL AS snapped,
       coalesce(snap.geom, s.geom::geometry)::geometry(Point, 4326) AS geom
  FROM station s
  LEFT JOIN v_station_status st ON st.station_id = s.id
  LEFT JOIN LATERAL (
    SELECT ST_ClosestPoint(g.geom, s.geom::geometry) AS geom
      FROM v_station_line v JOIN osm.v_line_geometry g ON g.line_id = v.line_id
     WHERE v.station_id = s.id AND s.coord_basis IN ('parcel', 'district', 'township')
       AND ST_DWithin(g.geom::geography, s.geom,
             CASE s.coord_basis WHEN 'parcel' THEN 1000 WHEN 'district' THEN 3000 ELSE 10000 END)
     ORDER BY ST_Distance(g.geom::geography, s.geom) LIMIT 1
  ) snap ON true
 WHERE s.deleted_at IS NULL AND s.kind <> 'station' AND s.geom IS NOT NULL;
