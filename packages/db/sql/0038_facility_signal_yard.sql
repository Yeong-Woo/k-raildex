-- 0038 시설 종류 추가(2026-11-27 사용자 지시): 신호장·신호소와 조차장을 역 그룹(station)에서 시설(facility)로 옮긴다.
ALTER TABLE facility DROP CONSTRAINT facility_kind_chk;
ALTER TABLE facility ADD CONSTRAINT facility_kind_chk CHECK (kind IN ('depot', 'test_track', 'signal_box', 'yard'));
