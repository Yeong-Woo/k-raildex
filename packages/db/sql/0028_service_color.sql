-- 0028 운행 계통 표시 색(round-06 Q127 A): 계통 색이 없으면 계통 노선(seq 순) 중 색이 있는 첫 노선의 색. 저장하지 않고 계산한다
-- color_basis = service(계통 자체 색) / line(대표 노선 색) / NULL(둘 다 없음 — 지도는 강조 기본색)
CREATE VIEW v_service_color AS
SELECT s.id AS service_id,
       coalesce(s.color, lc.color) AS color,
       CASE WHEN s.color IS NOT NULL THEN 'service' WHEN lc.color IS NOT NULL THEN 'line' END AS color_basis,
       CASE WHEN s.color IS NULL THEN lc.line_id END AS color_line_id
  FROM service s
  LEFT JOIN LATERAL (
    SELECT l.id AS line_id, l.color
      FROM service_line sl JOIN line l ON l.id = sl.line_id AND l.deleted_at IS NULL
     WHERE sl.service_id = s.id AND l.color IS NOT NULL
     ORDER BY sl.seq LIMIT 1
  ) lc ON true
 WHERE s.deleted_at IS NULL;
