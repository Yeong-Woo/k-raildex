-- 0040 본선·지선 뷰 보강(2026-11-28): 고시 노선번호가 없는 지선(연결선·기지선 — 약목보수기지선·부발기지선·강릉기지선 등)도
-- 수동 본선(branch_of_id)이 있으면 v_line_branch 에 나오게 한다. 노선번호 본선(앞 세 자리)이 있으면 그것이 우선(0037 그대로).
CREATE OR REPLACE VIEW v_line_branch AS
SELECT DISTINCT ON (l.id)
       l.id AS line_id, e.code AS line_no,
       coalesce(p.id, m.id) AS branch_of_line_id,
       CASE WHEN p.id IS NOT NULL THEN pe.code ELSE (SELECT me.code FROM external_ref me
              WHERE me.entity_id = m.id AND me.system = 'molit_line_no' AND length(me.code) = 3 ORDER BY me.is_primary DESC, me.code LIMIT 1) END
         AS branch_of_line_no,
       CASE WHEN p.id IS NOT NULL THEN 'line_no' WHEN m.id IS NOT NULL THEN 'manual' END AS basis
  FROM line l
  LEFT JOIN external_ref e ON e.entity_id = l.id AND e.system = 'molit_line_no' AND length(e.code) = 5
  LEFT JOIN external_ref pe ON pe.system = 'molit_line_no' AND pe.code = left(e.code, 3)
  LEFT JOIN line p ON p.id = pe.entity_id AND p.deleted_at IS NULL
  LEFT JOIN line m ON m.id = l.branch_of_id AND m.deleted_at IS NULL
 WHERE l.deleted_at IS NULL AND (e.code IS NOT NULL OR l.branch_of_id IS NOT NULL)
 ORDER BY l.id, e.is_primary DESC NULLS LAST, p.id NULLS LAST, e.code;
