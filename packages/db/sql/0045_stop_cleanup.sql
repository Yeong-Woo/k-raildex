-- 0045 정거장 통합 마무리(2026-11-28): 신호장·신호소·조차장을 정거장(노선역)으로 옮긴 뒤(변경 묶음 "정거장 통합 1~4")
-- 0042 의 시설 쪽 장치를 걷어 낸다 — 시설 종류는 차량기지·시험 선로만, facility_line role located·앞 노선역·km 는 없앤다.
-- 정거장 순서는 노선역(seq·branch)만으로, 구분은 코레일 정거장 등급(조차장·신호장·신호소) 또는 역 그룹 종류로 계산한다.

DROP VIEW v_stop_neighbor;
DROP VIEW v_line_stop_link;
DROP VIEW v_line_stop;

-- 지운 시설(정거장으로 통합)의 located 행만 남아 있다 — 살아 있는 시설에는 없음을 확인하고 지운다
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM facility_line fl JOIN facility f ON f.id = fl.facility_id
              WHERE fl.role = 'located' AND f.deleted_at IS NULL) THEN
    RAISE EXCEPTION '살아 있는 시설에 노선 위 정거장(located) 행이 남아 있음 — 먼저 정거장으로 옮길 것';
  END IF;
END $$;
DELETE FROM facility_line WHERE role = 'located';
ALTER TABLE facility_line DROP CONSTRAINT facility_line_position_chk;
ALTER TABLE facility_line DROP COLUMN after_line_station_id;
ALTER TABLE facility_line DROP COLUMN km;
ALTER TABLE facility_line DROP CONSTRAINT facility_line_role_chk;
ALTER TABLE facility_line ADD CONSTRAINT facility_line_role_chk CHECK (role IN ('serves', 'connects'));

ALTER TABLE facility DROP CONSTRAINT facility_kind_chk;
ALTER TABLE facility ADD CONSTRAINT facility_kind_chk
  CHECK (deleted_at IS NOT NULL OR kind IN ('depot', 'test_track'));

-- 노선별 정거장 순서(노선역). stop_class = 조차장·신호장·신호소 등급이 있으면 그것, 없으면 역 그룹 종류(station·freight·operational)
CREATE VIEW v_line_stop AS
SELECT x.line_id, x.branch, x.id AS line_station_id, x.station_id,
       coalesce(x.name_ko, s.name_ko) AS name_ko,
       CASE WHEN x.korail_class IN ('yard', 'signal_station', 'signal_post') THEN x.korail_class ELSE s.kind END AS stop_class,
       x.km, x.status,
       row_number() OVER (PARTITION BY x.line_id, coalesce(x.branch, '') ORDER BY x.seq)::int AS pos
  FROM line_station x
  JOIN station s ON s.id = x.station_id AND s.deleted_at IS NULL
  JOIN line l ON l.id = x.line_id AND l.deleted_at IS NULL
 WHERE x.deleted_at IS NULL;

-- 이웃 정거장 쌍(노선 순서 방향). basis sequence = 같은 노선·지선에서 이웃, branch = 갈라지는 정거장 → 지선 첫 정거장
CREATE VIEW v_line_stop_link AS
WITH junction AS (
  SELECT DISTINCT ON (x.line_id, x.branch) x.line_id, x.branch, j.id AS from_ls
    FROM line_station x
    JOIN line_station j ON j.id = x.branch_from_id AND j.deleted_at IS NULL AND j.line_id = x.line_id
   WHERE x.deleted_at IS NULL AND x.branch IS NOT NULL
   ORDER BY x.line_id, x.branch, x.seq
)
SELECT a.line_id, a.branch, a.line_station_id AS from_ls, a.station_id AS from_id, a.name_ko AS from_name,
       b.line_station_id AS to_ls, b.station_id AS to_id, b.name_ko AS to_name,
       CASE WHEN a.km IS NOT NULL AND b.km IS NOT NULL THEN abs(b.km - a.km) END AS distance_km,
       'sequence'::text AS basis
  FROM v_line_stop a
  JOIN v_line_stop b ON b.line_id = a.line_id AND coalesce(b.branch, '') = coalesce(a.branch, '') AND b.pos = a.pos + 1
UNION ALL
SELECT b.line_id, b.branch, a.line_station_id, a.station_id, a.name_ko, b.line_station_id, b.station_id, b.name_ko,
       CASE WHEN a.km IS NOT NULL AND b.km IS NOT NULL THEN abs(b.km - a.km) END,
       'branch'
  FROM junction jn
  JOIN v_line_stop a ON a.line_station_id = jn.from_ls
  JOIN v_line_stop b ON b.line_id = jn.line_id AND b.branch = jn.branch AND b.pos = 1;

-- 역 그룹별 앞뒤 정거장(분기·여러 노선이면 여러 행)
CREATE VIEW v_stop_neighbor AS
SELECT from_id AS station_id, from_ls AS line_station_id, line_id, branch, 'next'::text AS direction,
       to_id AS neighbor_station_id, to_ls AS neighbor_line_station_id, to_name AS neighbor_name, distance_km, basis
  FROM v_line_stop_link
UNION ALL
SELECT to_id, to_ls, line_id, branch, 'prev', from_id, from_ls, from_name, distance_km, basis
  FROM v_line_stop_link;
