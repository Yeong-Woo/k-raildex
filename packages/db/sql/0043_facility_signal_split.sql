-- 0043 신호장·신호소 구분 마무리(2026-11-28): 살아 있는 시설을 signal_station·signal_post 로 옮긴 뒤(변경 묶음
-- cs-2026-11-28-30fdf1d2, 이름 …신호장/…신호소 기준) signal_box 를 뺀다. 소프트 삭제된 옛 행은 이력 보존을 위해 그대로 둔다(0039 와 같은 방식).
ALTER TABLE facility DROP CONSTRAINT facility_kind_chk;
ALTER TABLE facility ADD CONSTRAINT facility_kind_chk
  CHECK (deleted_at IS NOT NULL OR kind IN ('depot', 'test_track', 'signal_station', 'signal_post', 'yard'));

-- 옛 선로 판정 좁히기(0041 보완): railway 가 폐선 값이거나, railway 없이 생애 주기 접두 태그(disused:railway·abandoned:railway)만
-- 있을 때만 옛 선로. 태그가 비어 있는 way(railway 없음)는 옛 선로로 보지 않는다.
CREATE OR REPLACE FUNCTION osm.is_old_way(tags jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(tags->>'railway' IN ('disused', 'abandoned', 'razed', 'dismantled'),
                  tags ? 'disused:railway' OR tags ? 'abandoned:railway')
$$;
