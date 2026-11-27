-- 0032 운영기관 정리·노선역 단위 코레일 정거장 등급(2026-11-27 사용자 지시)
-- 용어: station = 역 그룹(이용자가 "소사역"이라 부르는 장소), line_station = 노선역(한 노선·한 운영기관의 역).
-- 정거장 등급·관리역은 코레일 직제상 노선역 단위다(경인선 소사 = 보통역·부천역 소속, 서해선 소사 = 무배치간이역·부천역 소속).
-- 0031 에서 역 그룹(station)에 둔 칸은 값이 하나도 없어 노선역으로 옮긴다.

ALTER TABLE station DROP CONSTRAINT station_korail_class_chk;
ALTER TABLE station DROP CONSTRAINT station_korail_mgmt_grade_chk;
ALTER TABLE station DROP CONSTRAINT station_managed_by_not_self_chk;
DROP INDEX station_managed_by_idx;
ALTER TABLE station DROP COLUMN korail_class, DROP COLUMN korail_mgmt_grade, DROP COLUMN managed_by_id;

-- korail_class: management 관리역 / ordinary 보통역 / operating_halt 운전간이역 / staffed_halt 배치간이역 /
--   consigned_ticket 갑종 위탁발매소 / unstaffed_halt 무배치간이역(을종 위탁 포함) / temporary_platform 임시승강장 /
--   yard 조차장 / signal_station 신호장 / signal_post 신호소
-- korail_mgmt_grade: 관리역 1~3급 — 관리역일 때만
-- managed_by_id: 이 노선역을 관할하는 관리역(노선역 — 예: 경인선 부천). 운영기관이 한국철도공사인 노선역만(V-H18)
ALTER TABLE line_station ADD COLUMN korail_class text;
ALTER TABLE line_station ADD COLUMN korail_mgmt_grade smallint;
ALTER TABLE line_station ADD COLUMN managed_by_id text REFERENCES line_station(id) ON UPDATE CASCADE;
ALTER TABLE line_station ADD CONSTRAINT line_station_korail_class_chk CHECK (korail_class IN (
  'management', 'ordinary', 'operating_halt', 'staffed_halt', 'consigned_ticket', 'unstaffed_halt',
  'temporary_platform', 'yard', 'signal_station', 'signal_post'));
ALTER TABLE line_station ADD CONSTRAINT line_station_korail_mgmt_grade_chk
  CHECK (korail_mgmt_grade IS NULL OR (korail_mgmt_grade BETWEEN 1 AND 3 AND korail_class = 'management'));
ALTER TABLE line_station ADD CONSTRAINT line_station_managed_by_not_self_chk CHECK (managed_by_id <> id);
CREATE INDEX line_station_managed_by_idx ON line_station (managed_by_id) WHERE managed_by_id IS NOT NULL;

-- 노선역의 현재 운영기관(파생): 노선역에 적은 운영기관 > 노선 운영기관(role operator)이 하나뿐이면 그것.
-- 통합(merged)된 기관은 승계 기관으로(SR → 한국철도공사, 2026-09-01). 노선 운영기관이 둘 이상이면(구간 분할·공동 운영)
-- 노선역에 적어야 한다 — basis ambiguous(품질 X-line-station-operator)
CREATE VIEW v_line_station_operator AS
WITH lo AS (
  SELECT lo.line_id, CASE WHEN o.status = 'merged' AND o.merged_into_id IS NOT NULL THEN o.merged_into_id ELSE o.id END AS operator_id
    FROM line_operator lo JOIN operator o ON o.id = lo.operator_id AND o.deleted_at IS NULL
   WHERE lo.role = 'operator'
), one AS (
  SELECT line_id, min(operator_id) AS operator_id, count(DISTINCT operator_id)::int AS n FROM lo GROUP BY line_id
)
SELECT x.id AS line_station_id, x.line_id, x.station_id,
       CASE WHEN x.operator_id IS NOT NULL THEN
              (SELECT CASE WHEN o.status = 'merged' AND o.merged_into_id IS NOT NULL THEN o.merged_into_id ELSE o.id END
                 FROM operator o WHERE o.id = x.operator_id)
            WHEN one.n = 1 THEN one.operator_id END AS operator_id,
       CASE WHEN x.operator_id IS NOT NULL THEN 'line_station'
            WHEN one.n = 1 THEN 'line'
            WHEN one.n > 1 THEN 'ambiguous'
            ELSE 'none' END AS basis
  FROM line_station x
  LEFT JOIN one ON one.line_id = x.line_id
 WHERE x.deleted_at IS NULL;

-- 역 그룹 ↔ 노선(노선역 정보): 운영기관을 위 규칙으로(예전: 노선 운영기관 중 첫째 — 9호선 2·3단계 구간이 틀렸다)
CREATE OR REPLACE VIEW v_station_line AS
SELECT x.station_id, x.line_id, x.id AS line_station_id, x.seq, x.km, x.branch, x.station_code, x.order_confirmed,
       coalesce(x.name_ko, s.name_ko) AS name_ko, coalesce(x.name_en, s.name_en) AS name_en,
       x.status, x.opened_value, x.opened_precision, x.closed_value, x.closed_precision,
       (SELECT vo.operator_id FROM v_line_station_operator vo WHERE vo.line_station_id = x.id) AS operator_id,
       l.rail_class, l.category
  FROM line_station x
  JOIN station s ON s.id = x.station_id AND s.deleted_at IS NULL
  JOIN line l ON l.id = x.line_id AND l.deleted_at IS NULL
 WHERE x.deleted_at IS NULL;
