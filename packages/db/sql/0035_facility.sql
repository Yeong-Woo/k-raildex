-- 0035 시설 facility(2026-11-27 사용자 지시): 차량기지는 역 그룹에서 떼어 별도 개체 "시설"(id fac-)로 둔다.
-- kind: depot 차량기지(앞으로 다른 시설 종류를 더할 수 있다). 0034 의 역 그룹 하위 표(station_depot·station_depot_line, 값 없음)는 없앤다.
-- facility_line.role: serves 담당 노선(차량을 맡는 노선) / connects 붙은 선로(기지선 등 — 시설이 이어진 노선)
DROP TABLE station_depot_line;
DROP TABLE station_depot;

ALTER TABLE change_op DROP CONSTRAINT change_op_entity_type_chk;
ALTER TABLE change_op ADD CONSTRAINT change_op_entity_type_chk CHECK (entity_type IN ('source', 'operator', 'station', 'line_station', 'line', 'train_class', 'service', 'plan_program', 'plan', 'event', 'train_number_range', 'rolling_stock_range', 'transfer_center', 'route_map', 'glossary_term', 'facility'));
ALTER TABLE entity DROP CONSTRAINT entity_type_chk;
ALTER TABLE entity ADD CONSTRAINT entity_type_chk CHECK (type IN ('source', 'operator', 'station', 'line_station', 'line', 'train_class', 'service', 'plan_program', 'plan', 'event', 'train_number_range', 'rolling_stock_range', 'transfer_center', 'route_map', 'glossary_term', 'facility'));
ALTER TABLE ref_external_system DROP CONSTRAINT ref_external_system_entity_type_chk;
ALTER TABLE ref_external_system ADD CONSTRAINT ref_external_system_entity_type_chk CHECK (entity_type IN ('source', 'operator', 'station', 'line_station', 'line', 'train_class', 'service', 'plan_program', 'plan', 'event', 'train_number_range', 'rolling_stock_range', 'transfer_center', 'route_map', 'glossary_term', 'facility'));

CREATE TABLE facility (
  id text PRIMARY KEY REFERENCES entity(id) ON UPDATE CASCADE,
  name_ko text NOT NULL,
  name_en text,
  name_full text,
  kind text NOT NULL DEFAULT 'depot',
  functions text[] NOT NULL DEFAULT '{}',
  operator_id text REFERENCES operator(id) ON UPDATE CASCADE,
  status text NOT NULL DEFAULT 'operating',
  opened_value text,
  opened_precision text,
  opened_from date GENERATED ALWAYS AS (fuzzy_from(opened_value, opened_precision)) STORED,
  opened_to date GENERATED ALWAYS AS (fuzzy_to(opened_value, opened_precision)) STORED,
  closed_value text,
  closed_precision text,
  closed_from date GENERATED ALWAYS AS (fuzzy_from(closed_value, closed_precision)) STORED,
  closed_to date GENERATED ALWAYS AS (fuzzy_to(closed_value, closed_precision)) STORED,
  region_code text REFERENCES ref_region(code),
  address text,
  geom geography(Point, 4326),
  coord_source text,
  coord_basis text,
  coord_query text,
  coord_note text,
  description text,
  checked_at date NOT NULL,
  provenance_note text,
  review_status text NOT NULL DEFAULT 'unverified',
  reviewed_at timestamptz,
  editor_note text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app_user(id),
  updated_by uuid REFERENCES app_user(id),
  last_changeset_id text REFERENCES changeset(id) ON UPDATE CASCADE,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES app_user(id),
  delete_reason text,
  CONSTRAINT facility_id_chk CHECK (id ~ '^fac-[a-z0-9]+(-{1,2}[a-z0-9]+)*$'),
  CONSTRAINT facility_name_ko_chk CHECK (name_ko <> ''),
  CONSTRAINT facility_kind_chk CHECK (kind IN ('depot')),
  CONSTRAINT facility_functions_chk CHECK (functions <@ ARRAY['stabling', 'inspection', 'light_maintenance', 'heavy_maintenance', 'track_maintenance']::text[]),
  CONSTRAINT facility_status_chk CHECK (status IN ('operating', 'suspended', 'under_construction', 'planned', 'abandoned', 'closed')),
  CONSTRAINT facility_opened_fuzzy_chk CHECK (fuzzy_valid(opened_value, opened_precision)),
  CONSTRAINT facility_closed_fuzzy_chk CHECK (fuzzy_valid(closed_value, closed_precision)),
  CONSTRAINT facility_coord_source_chk CHECK (coord_source IN ('official', 'manual', 'derived')),
  CONSTRAINT facility_coord_basis_chk CHECK (coord_basis IN ('parcel', 'district', 'township', 'existing_station')),
  CONSTRAINT facility_review_status_chk CHECK (review_status IN ('unverified', 'verified', 'flagged')),
  CHECK ((geom IS NULL) = (coord_source IS NULL)),
  CHECK (coord_basis IS NULL OR coord_source = 'derived')
);
CREATE INDEX ON facility USING gist (geom);

CREATE TABLE facility_line (
  facility_id text NOT NULL REFERENCES facility(id) ON DELETE CASCADE ON UPDATE CASCADE,
  line_id text NOT NULL REFERENCES line(id) ON UPDATE CASCADE,
  role text NOT NULL DEFAULT 'serves',
  note text,
  ord integer NOT NULL DEFAULT 0,
  PRIMARY KEY (facility_id, line_id, role),
  CONSTRAINT facility_line_role_chk CHECK (role IN ('serves', 'connects'))
);
CREATE INDEX facility_line_line_idx ON facility_line (line_id);

INSERT INTO entity_table (table_name, entity_type, curated) VALUES ('facility', 'facility', true);
CREATE TRIGGER facility_entity_type_guard BEFORE INSERT OR UPDATE OF id ON facility FOR EACH ROW EXECUTE FUNCTION entity_type_guard('facility');
CREATE TRIGGER facility_sync_deleted AFTER UPDATE OF deleted_at ON facility FOR EACH ROW EXECUTE FUNCTION sync_entity_deleted();
CREATE CONSTRAINT TRIGGER facility_source_required AFTER INSERT OR UPDATE ON facility DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_record_source();
CREATE TRIGGER facility_touch_meta BEFORE UPDATE ON facility FOR EACH ROW EXECUTE FUNCTION touch_meta();
