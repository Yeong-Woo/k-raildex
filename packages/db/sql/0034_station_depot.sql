-- 0034 차량기지(2026-11-27 사용자 지시): 차량기지는 "시설" 역 그룹(station.kind = 'depot')이고 기지 정보는 아래 두 하위 표에 둔다.
-- 어느 기지선에 붙었는지는 그 역 그룹의 노선역(예: 광명주박기지선 위 광명주박기지)으로 나타낸다 — 따로 저장하지 않는다.
-- functions: stabling 주박 / inspection 검수 / light_maintenance 경정비 / heavy_maintenance 중정비 / track_maintenance 시설·선로 보수
CREATE TABLE station_depot (
  station_id text PRIMARY KEY REFERENCES station(id) ON DELETE CASCADE ON UPDATE CASCADE,
  functions text[] NOT NULL DEFAULT '{}',
  operator_id text REFERENCES operator(id) ON UPDATE CASCADE,
  opened_value text,
  opened_precision text,
  opened_from date GENERATED ALWAYS AS (fuzzy_from(opened_value, opened_precision)) STORED,
  opened_to date GENERATED ALWAYS AS (fuzzy_to(opened_value, opened_precision)) STORED,
  note text,
  CONSTRAINT station_depot_functions_chk CHECK (functions <@ ARRAY['stabling', 'inspection', 'light_maintenance', 'heavy_maintenance', 'track_maintenance']::text[]),
  CONSTRAINT station_depot_opened_fuzzy_chk CHECK (fuzzy_valid(opened_value, opened_precision))
);

-- 차량기지가 차량을 맡는 노선(담당 노선)
CREATE TABLE station_depot_line (
  station_id text NOT NULL REFERENCES station(id) ON DELETE CASCADE ON UPDATE CASCADE,
  line_id text NOT NULL REFERENCES line(id) ON UPDATE CASCADE,
  note text,
  ord integer NOT NULL DEFAULT 0,
  PRIMARY KEY (station_id, line_id)
);
CREATE INDEX station_depot_line_line_idx ON station_depot_line (line_id);
