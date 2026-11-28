-- 0044 정거장 통합(2026-11-28 사용자 지시 — 0042 A안을 바꿈): "노선역"을 "정거장"이라 부르고(식별자 line_station·ls- 는 그대로),
-- 시설의 신호장·신호소·조차장을 정거장(노선역)으로 되돌린다. 구분은 코레일 정거장 등급(line_station.korail_class
-- yard·signal_station·signal_post)으로 한다. 그 역 그룹의 종류는 새 값 operational(운전 취급 — 여객·화물 취급 없음).
ALTER TABLE station DROP CONSTRAINT station_kind_chk;
ALTER TABLE station ADD CONSTRAINT station_kind_chk
  CHECK (deleted_at IS NOT NULL OR kind IN ('station', 'freight', 'operational'));
-- 0038 에서 시설로 옮기며 소프트 삭제한 신호장·조차장 역 그룹(옛 kind signal_box·yard)은 되살릴 수 있게 코드값만 새 값으로
-- 바꾼다(사실 값이 아닌 코드값 정리 — 행은 삭제 상태 그대로, 되살리기는 변경 묶음으로).
UPDATE station SET kind = 'operational' WHERE deleted_at IS NOT NULL AND kind IN ('signal_box', 'yard');
