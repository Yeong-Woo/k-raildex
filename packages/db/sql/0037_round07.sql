-- 0037 round-07 결정 반영(2026-11-27)
-- 0037 지선의 본선 수동 지정(round-07 Q153 B, 2026-11-27): 고시 노선번호로 본선을 정할 수 없는 지선
-- (본선 312 중앙선(안동~경주) 삭제 뒤 남은 북영주삼각선 31203·금장삼각선 31205 → 중앙선 203)에 본선을 적는다.
-- 노선번호 본선(앞 세 자리)이 있으면 그것이 우선이고, 없을 때만 이 칸을 쓴다.
ALTER TABLE line ADD COLUMN branch_of_id text REFERENCES line(id) ON UPDATE CASCADE;
ALTER TABLE line ADD CONSTRAINT line_branch_of_not_self_chk CHECK (branch_of_id <> id);

CREATE OR REPLACE VIEW v_line_branch AS
SELECT DISTINCT ON (l.id)
       l.id AS line_id, e.code AS line_no,
       coalesce(p.id, m.id) AS branch_of_line_id,
       CASE WHEN p.id IS NOT NULL THEN pe.code ELSE (SELECT me.code FROM external_ref me
              WHERE me.entity_id = m.id AND me.system = 'molit_line_no' AND length(me.code) = 3 ORDER BY me.is_primary DESC, me.code LIMIT 1) END
         AS branch_of_line_no,
       CASE WHEN p.id IS NOT NULL THEN 'line_no' WHEN m.id IS NOT NULL THEN 'manual' END AS basis
  FROM line l
  JOIN external_ref e ON e.entity_id = l.id AND e.system = 'molit_line_no' AND length(e.code) = 5
  LEFT JOIN external_ref pe ON pe.system = 'molit_line_no' AND pe.code = left(e.code, 3)
  LEFT JOIN line p ON p.id = pe.entity_id AND p.deleted_at IS NULL
  LEFT JOIN line m ON m.id = l.branch_of_id AND m.deleted_at IS NULL
 WHERE l.deleted_at IS NULL
 ORDER BY l.id, e.is_primary DESC, p.id NULLS LAST, e.code;

-- 시설 종류 "시험 선로"(round-07 Q141 B): 오송 철도종합시험선로는 영업 노선이 아니라 시설로 둔다.
ALTER TABLE facility DROP CONSTRAINT facility_kind_chk;
ALTER TABLE facility ADD CONSTRAINT facility_kind_chk CHECK (kind IN ('depot', 'test_track'));

-- 분기역 시간표를 노선역별로 나눈다(round-07 Q148): 같은 역·노선코드·요일·방향이라도 노선역이 다르면 다른 세트.
ALTER TABLE timetable_set DROP CONSTRAINT timetable_set_station_id_route_code_day_type_direction_key;
ALTER TABLE timetable_set ADD CONSTRAINT timetable_set_key_uniq
  UNIQUE NULLS NOT DISTINCT (station_id, route_code, day_type, direction, line_station_id);
