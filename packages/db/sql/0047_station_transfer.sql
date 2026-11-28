-- 0047 환승(2026-11-29 사용자 지시 — 일반철도 환승은 여객 취급 정거장에서만): 노선 정거장의 환승 노선 = 같은 역 그룹에
-- 정거장이 있는 다른 노선 중 아래를 모두 만족하는 것.
--   (1) 역 그룹이 여객역(kind station — 화물역·운전 취급 제외)
--   (2) 두 정거장 모두 코레일 정거장 등급이 조차장·신호장·신호소가 아님
--   (3) 두 노선 모두 여객 취급(line.passenger_service)
-- 예: 경강선 (서원주~강릉)·영동선 청량신호소는 서로 환승이 아니다. 접속(갈라짐)은 정거장 순서 표의 접속 노선으로 본다.
CREATE VIEW v_line_station_transfer AS
SELECT DISTINCT a.line_id, a.station_id, b.line_id AS transfer_line_id
  FROM line_station a
  JOIN line_station b ON b.station_id = a.station_id AND b.line_id <> a.line_id AND b.deleted_at IS NULL
  JOIN station s ON s.id = a.station_id AND s.deleted_at IS NULL AND s.kind = 'station'
  JOIN line la ON la.id = a.line_id AND la.deleted_at IS NULL AND la.passenger_service
  JOIN line lb ON lb.id = b.line_id AND lb.deleted_at IS NULL AND lb.passenger_service
 WHERE a.deleted_at IS NULL
   AND coalesce(a.korail_class, '') NOT IN ('yard', 'signal_station', 'signal_post')
   AND coalesce(b.korail_class, '') NOT IN ('yard', 'signal_station', 'signal_post');
