-- 0042 정거장(2026-11-28 사용자 지시, A안): 정거장 = 역(여객역)·화물역·신호장·신호소·조차장을 통틀어 이르는 말.
-- 새 개체를 만들지 않고, 노선역(line_station)과 노선 위 시설(facility_line role located)을 노선 순서로 엮은 파생 뷰로 둔다.
-- (1) 시설 종류 신호장·신호소를 나눈다(signal_box → signal_station·signal_post). signal_box 는 데이터를 옮긴 뒤 0043 에서 뺀다.
-- (2) facility_line role located = 이 노선 위 정거장 위치: after_line_station_id(바로 앞 노선역, NULL = 노선 첫머리)·km.
-- (3) line_station.branch_from_id = 지선(branch)이 갈라져 나오는 노선역(지선 행 중 하나에만 두면 된다).
-- (4) 뷰 v_line_stop(노선별 정거장 순서) · v_line_stop_link(이웃 정거장 쌍·거리) · v_stop_neighbor(정거장별 앞뒤 정거장).
--     거리 = 두 정거장 km 가 모두 있을 때 차이(같은 노선 이정 기준으로 본다). 하나라도 없으면 NULL(미확인).

ALTER TABLE facility DROP CONSTRAINT facility_kind_chk;
ALTER TABLE facility ADD CONSTRAINT facility_kind_chk
  CHECK (kind IN ('depot', 'test_track', 'signal_box', 'signal_station', 'signal_post', 'yard'));

ALTER TABLE facility_line DROP CONSTRAINT facility_line_role_chk;
ALTER TABLE facility_line ADD CONSTRAINT facility_line_role_chk CHECK (role IN ('serves', 'connects', 'located'));
ALTER TABLE facility_line ADD COLUMN after_line_station_id text REFERENCES line_station(id) ON UPDATE CASCADE;
ALTER TABLE facility_line ADD COLUMN km numeric(7,2);
ALTER TABLE facility_line ADD CONSTRAINT facility_line_position_chk
  CHECK (role = 'located' OR (after_line_station_id IS NULL AND km IS NULL));

ALTER TABLE line_station ADD COLUMN branch_from_id text REFERENCES line_station(id) ON UPDATE CASCADE;
ALTER TABLE line_station ADD CONSTRAINT line_station_branch_from_chk
  CHECK (branch_from_id IS NULL OR (branch IS NOT NULL AND branch_from_id <> id));

-- 노선별 정거장 순서. pos = 같은 노선·같은 지선(branch) 안의 순번(1부터)
CREATE VIEW v_line_stop AS
WITH stops AS (
  SELECT x.line_id, x.branch, 'station'::text AS node_type, x.station_id AS node_id, x.id AS line_station_id,
         NULL::text AS facility_id,
         CASE s.kind WHEN 'freight' THEN 'freight_station' ELSE 'station' END AS stop_kind,
         coalesce(x.name_ko, s.name_ko) AS name_ko, x.km, x.status,
         x.seq AS anchor_seq, 0 AS sub, 0 AS ord
    FROM line_station x
    JOIN station s ON s.id = x.station_id AND s.deleted_at IS NULL
    JOIN line l ON l.id = x.line_id AND l.deleted_at IS NULL
   WHERE x.deleted_at IS NULL
  UNION ALL
  SELECT fl.line_id, a.branch, 'facility', f.id, NULL, f.id,
         f.kind, f.name_ko, fl.km, f.status,
         a.seq, 1, fl.ord
    FROM facility_line fl
    JOIN facility f ON f.id = fl.facility_id AND f.deleted_at IS NULL
    JOIN line l ON l.id = fl.line_id AND l.deleted_at IS NULL
    LEFT JOIN line_station a ON a.id = fl.after_line_station_id AND a.deleted_at IS NULL
   WHERE fl.role = 'located' AND f.kind IN ('signal_station', 'signal_post', 'yard')
)
SELECT line_id, branch, node_type, node_id, line_station_id, facility_id, stop_kind, name_ko, km, status,
       row_number() OVER (PARTITION BY line_id, coalesce(branch, '')
                          ORDER BY anchor_seq NULLS FIRST, sub, km NULLS LAST, ord, node_id)::int AS pos
  FROM stops;

-- 이웃 정거장 쌍(노선 순서 방향: from → to). basis sequence = 같은 노선·지선에서 이웃, branch = 갈라지는 노선역 → 지선 첫 정거장
CREATE VIEW v_line_stop_link AS
WITH s AS (SELECT * FROM v_line_stop),
junction AS (
  SELECT DISTINCT ON (x.line_id, x.branch) x.line_id, x.branch, j.id AS from_ls
    FROM line_station x
    JOIN line_station j ON j.id = x.branch_from_id AND j.deleted_at IS NULL AND j.line_id = x.line_id
   WHERE x.deleted_at IS NULL AND x.branch IS NOT NULL
   ORDER BY x.line_id, x.branch, x.seq
)
SELECT a.line_id, a.branch, a.node_type AS from_type, a.node_id AS from_id, a.name_ko AS from_name,
       b.node_type AS to_type, b.node_id AS to_id, b.name_ko AS to_name,
       CASE WHEN a.km IS NOT NULL AND b.km IS NOT NULL THEN abs(b.km - a.km) END AS distance_km,
       'sequence'::text AS basis
  FROM s a
  JOIN s b ON b.line_id = a.line_id AND coalesce(b.branch, '') = coalesce(a.branch, '') AND b.pos = a.pos + 1
UNION ALL
SELECT b.line_id, b.branch, a.node_type, a.node_id, a.name_ko, b.node_type, b.node_id, b.name_ko,
       CASE WHEN a.km IS NOT NULL AND b.km IS NOT NULL THEN abs(b.km - a.km) END,
       'branch'
  FROM junction jn
  JOIN s a ON a.line_station_id = jn.from_ls
  JOIN s b ON b.line_id = jn.line_id AND b.branch = jn.branch AND b.pos = 1;

-- 정거장별 앞뒤 정거장(분기·여러 노선이면 여러 행). direction prev = 노선 순서상 앞, next = 뒤
CREATE VIEW v_stop_neighbor AS
SELECT from_type AS node_type, from_id AS node_id, line_id, branch, 'next'::text AS direction,
       to_type AS neighbor_type, to_id AS neighbor_id, to_name AS neighbor_name, distance_km, basis
  FROM v_line_stop_link
UNION ALL
SELECT to_type, to_id, line_id, branch, 'prev', from_type, from_id, from_name, distance_km, basis
  FROM v_line_stop_link;
