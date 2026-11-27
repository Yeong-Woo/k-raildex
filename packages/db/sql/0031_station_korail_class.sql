-- 0031 한국철도공사 정거장 등급·관리역(2026-11-27 사용자 지시): 코레일 직제규정 시행세칙의 직제상 지위.
-- kind(여객역·신호장 등 시설 기능)와 따로 둔다 — 코레일이 관리하는 역에만 쓰고, 다른 운영기관 역은 비운다.
-- korail_class: management 관리역 / ordinary 보통역 / operating_halt 운전간이역 / staffed_halt 배치간이역 /
--   consigned_ticket 갑종 위탁발매소 / unstaffed_halt 무배치간이역(을종 위탁 포함) / temporary_platform 임시승강장 /
--   yard 조차장 / signal_station 신호장 / signal_post 신호소
-- korail_mgmt_grade: 관리역 등급 1~3급(역장 직급) — 관리역일 때만
-- managed_by_id: 이 역을 관할하는 관리역(하위역 → 관리역). 관리역 자신은 비운다(V-H18)
ALTER TABLE station ADD COLUMN korail_class text;
ALTER TABLE station ADD COLUMN korail_mgmt_grade smallint;
ALTER TABLE station ADD COLUMN managed_by_id text REFERENCES station(id) ON UPDATE CASCADE;
ALTER TABLE station ADD CONSTRAINT station_korail_class_chk CHECK (korail_class IN (
  'management', 'ordinary', 'operating_halt', 'staffed_halt', 'consigned_ticket', 'unstaffed_halt',
  'temporary_platform', 'yard', 'signal_station', 'signal_post'));
ALTER TABLE station ADD CONSTRAINT station_korail_mgmt_grade_chk
  CHECK (korail_mgmt_grade IS NULL OR (korail_mgmt_grade BETWEEN 1 AND 3 AND korail_class = 'management'));
ALTER TABLE station ADD CONSTRAINT station_managed_by_not_self_chk CHECK (managed_by_id <> id);
CREATE INDEX station_managed_by_idx ON station (managed_by_id) WHERE managed_by_id IS NOT NULL;
