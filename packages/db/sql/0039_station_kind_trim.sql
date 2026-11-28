-- 0039 역 그룹 종류 정리(2026-11-28 사용자 지시): 신호장·신호소·조차장·차량기지는 시설(facility, 0038)로, 분기점·연결선은 지선(line)으로
-- 옮겼으므로 역 그룹 종류는 여객역(station)·화물역(freight)만 남긴다. 소프트 삭제된 옛 행은 이력 보존을 위해 그대로 둔다.
ALTER TABLE station DROP CONSTRAINT station_kind_chk;
ALTER TABLE station ADD CONSTRAINT station_kind_chk CHECK (deleted_at IS NOT NULL OR kind IN ('station', 'freight'));
