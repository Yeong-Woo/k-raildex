-- 0033 본선·지선(2026-11-27 사용자 지시): 국토교통부 고시 사업용철도 노선번호(external_ref molit_line_no)로 계산한다 — 저장하지 않는다.
-- 본선 = 세 자리(경부고속선 101), 지선 = 본선 번호 + 두 자리(시흥연결선 10101). 지선의 본선 = 앞 세 자리가 같은 노선.
-- 본선 번호가 삭제된 지선(312 중앙선(안동~경주) 삭제 뒤 북영주삼각선 31203·금장삼각선 31205)은 parent 없음.
-- line.parent_line_id(Q22 — 공사 구간 노선을 합칠 노선)와는 다른 개념이다.
CREATE VIEW v_line_branch AS
SELECT DISTINCT ON (l.id)
       l.id AS line_id, e.code AS line_no, p.id AS branch_of_line_id, pe.code AS branch_of_line_no
  FROM line l
  JOIN external_ref e ON e.entity_id = l.id AND e.system = 'molit_line_no' AND length(e.code) = 5
  LEFT JOIN external_ref pe ON pe.system = 'molit_line_no' AND pe.code = left(e.code, 3)
  LEFT JOIN line p ON p.id = pe.entity_id AND p.deleted_at IS NULL
 WHERE l.deleted_at IS NULL
 ORDER BY l.id, e.is_primary DESC, p.id NULLS LAST, e.code;
