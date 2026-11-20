-- 0009 연표·열차번호대·차량번호대·환승센터·노선도·용어 (docs/03-data-model.md 4-12~4-16·4-18절)

CREATE TABLE event (
  id text PRIMARY KEY REFERENCES entity(id) ON UPDATE CASCADE,
  type text NOT NULL,
  date_value text,
  date_precision text NOT NULL,
  date_from date GENERATED ALWAYS AS (fuzzy_from(date_value, date_precision)) STORED,
  date_to date GENERATED ALWAYS AS (fuzzy_to(date_value, date_precision)) STORED,
  title text NOT NULL,
  note text,
  origin text NOT NULL,
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
  CONSTRAINT event_id_chk CHECK (id ~ '^evt-[a-z0-9]+(-{1,2}[a-z0-9]+)*$'),
  CONSTRAINT event_type_chk CHECK (type IN ('opened', 'closed', 'suspended', 'resumed', 'renamed', 'transfer_opened', 'service_started', 'service_ended', 'stage_changed', 'plan_listed', 'other')),
  CONSTRAINT event_date_fuzzy_chk CHECK (fuzzy_valid(date_value, date_precision)),
  CONSTRAINT event_date_precision_chk CHECK (date_precision IN ('day', 'month', 'half', 'year', 'unknown')),
  CONSTRAINT event_origin_chk CHECK (origin IN ('manual', 'chronology', 'agent')),
  CONSTRAINT event_review_status_chk CHECK (review_status IN ('verified', 'unverified', 'flagged'))
);

CREATE INDEX event_date_idx ON event (date_from);

CREATE TABLE event_target (
  event_id text REFERENCES event(id) ON DELETE CASCADE ON UPDATE CASCADE,
  entity_id text REFERENCES entity(id) ON UPDATE CASCADE,
  role text NOT NULL DEFAULT 'subject' CHECK (role IN ('subject', 'related')),
  PRIMARY KEY (event_id, entity_id)
);

CREATE INDEX event_target_entity_idx ON event_target (entity_id);

CREATE TABLE event_area (
  event_id text REFERENCES event(id) ON DELETE CASCADE ON UPDATE CASCADE,
  area_code text REFERENCES ref_area(code),
  PRIMARY KEY (event_id, area_code)
);

CREATE TABLE train_number_range (
  id text PRIMARY KEY REFERENCES entity(id) ON UPDATE CASCADE,
  operator_id text NOT NULL REFERENCES operator(id) ON UPDATE CASCADE,
  code_prefix text,
  range_from integer NOT NULL,
  range_to integer NOT NULL,
  "group" text NOT NULL,
  train_class_id text REFERENCES train_class(id) ON UPDATE CASCADE,
  route_text text,
  parity_rule text,
  valid_from_value text,
  valid_from_precision text,
  valid_from_from date GENERATED ALWAYS AS (fuzzy_from(valid_from_value, valid_from_precision)) STORED,
  valid_from_to date GENERATED ALWAYS AS (fuzzy_to(valid_from_value, valid_from_precision)) STORED,
  valid_to_value text,
  valid_to_precision text,
  valid_to_from date GENERATED ALWAYS AS (fuzzy_from(valid_to_value, valid_to_precision)) STORED,
  valid_to_to date GENERATED ALWAYS AS (fuzzy_to(valid_to_value, valid_to_precision)) STORED,
  note text,
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
  CONSTRAINT train_number_range_id_chk CHECK (id ~ '^tnr-[a-z0-9]+(-{1,2}[a-z0-9]+)*$'),
  CONSTRAINT train_number_range_group_chk CHECK ("group" IN ('high_speed', 'intercity', 'wide_area', 'metro', 'freight', 'non_revenue', 'other')),
  CONSTRAINT train_number_range_parity_rule_chk CHECK (parity_rule IN ('odd_down_even_up', 'odd_up_even_down', 'none')),
  CONSTRAINT train_number_range_valid_from_fuzzy_chk CHECK (fuzzy_valid(valid_from_value, valid_from_precision)),
  CONSTRAINT train_number_range_valid_from_precision_chk CHECK (valid_from_precision IN ('day', 'month', 'half', 'year', 'unknown')),
  CONSTRAINT train_number_range_valid_to_fuzzy_chk CHECK (fuzzy_valid(valid_to_value, valid_to_precision)),
  CONSTRAINT train_number_range_valid_to_precision_chk CHECK (valid_to_precision IN ('day', 'month', 'half', 'year', 'unknown')),
  CONSTRAINT train_number_range_review_status_chk CHECK (review_status IN ('verified', 'unverified', 'flagged')),
  CONSTRAINT train_number_range_range_chk CHECK (range_to >= range_from)
);

CREATE INDEX train_number_range_range_idx ON train_number_range USING gist (int4range(range_from, range_to, '[]'));

CREATE TABLE train_number_range_service (
  range_id text REFERENCES train_number_range(id) ON DELETE CASCADE ON UPDATE CASCADE,
  service_id text REFERENCES service(id) ON UPDATE CASCADE,
  PRIMARY KEY (range_id, service_id)
);

CREATE TABLE train_number_range_line (
  range_id text REFERENCES train_number_range(id) ON DELETE CASCADE ON UPDATE CASCADE,
  line_id text REFERENCES line(id) ON UPDATE CASCADE,
  PRIMARY KEY (range_id, line_id)
);

CREATE TABLE rolling_stock_range (
  id text PRIMARY KEY REFERENCES entity(id) ON UPDATE CASCADE,
  operator_id text NOT NULL REFERENCES operator(id) ON UPDATE CASCADE,
  series text NOT NULL,
  number_prefix text,
  number_from integer NOT NULL,
  number_to integer NOT NULL,
  digits integer NOT NULL CHECK (digits > 0),
  "group" text NOT NULL,
  model text,
  train_class_id text REFERENCES train_class(id) ON UPDATE CASCADE,
  number_rule text,
  status text NOT NULL,
  introduced_value text,
  introduced_precision text,
  introduced_from date GENERATED ALWAYS AS (fuzzy_from(introduced_value, introduced_precision)) STORED,
  introduced_to date GENERATED ALWAYS AS (fuzzy_to(introduced_value, introduced_precision)) STORED,
  retired_value text,
  retired_precision text,
  retired_from date GENERATED ALWAYS AS (fuzzy_from(retired_value, retired_precision)) STORED,
  retired_to date GENERATED ALWAYS AS (fuzzy_to(retired_value, retired_precision)) STORED,
  owner_note text,
  formation_label text,
  formation_from text,
  formation_to text,
  formation_count integer,
  formation_cars integer,
  formation_code_prefix text,
  formation_note text,
  note text,
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
  CONSTRAINT rolling_stock_range_id_chk CHECK (id ~ '^rsn-[a-z0-9]+(-{1,2}[a-z0-9]+)*$'),
  CONSTRAINT rolling_stock_range_group_chk CHECK ("group" IN ('high_speed', 'intercity', 'wide_area', 'metro', 'locomotive', 'coach', 'freight', 'other')),
  CONSTRAINT rolling_stock_range_status_chk CHECK (status IN ('operating', 'planned', 'closed')),
  CONSTRAINT rolling_stock_range_introduced_fuzzy_chk CHECK (fuzzy_valid(introduced_value, introduced_precision)),
  CONSTRAINT rolling_stock_range_introduced_precision_chk CHECK (introduced_precision IN ('day', 'month', 'half', 'year', 'unknown')),
  CONSTRAINT rolling_stock_range_retired_fuzzy_chk CHECK (fuzzy_valid(retired_value, retired_precision)),
  CONSTRAINT rolling_stock_range_retired_precision_chk CHECK (retired_precision IN ('day', 'month', 'half', 'year', 'unknown')),
  CONSTRAINT rolling_stock_range_review_status_chk CHECK (review_status IN ('verified', 'unverified', 'flagged')),
  CONSTRAINT rolling_stock_range_range_chk CHECK (number_to >= number_from)
);

CREATE TABLE rolling_stock_range_service (
  range_id text REFERENCES rolling_stock_range(id) ON DELETE CASCADE ON UPDATE CASCADE,
  service_id text REFERENCES service(id) ON UPDATE CASCADE,
  PRIMARY KEY (range_id, service_id)
);

CREATE TABLE rolling_stock_range_line (
  range_id text REFERENCES rolling_stock_range(id) ON DELETE CASCADE ON UPDATE CASCADE,
  line_id text REFERENCES line(id) ON UPDATE CASCADE,
  PRIMARY KEY (range_id, line_id)
);

CREATE TABLE transfer_center (
  id text PRIMARY KEY REFERENCES entity(id) ON UPDATE CASCADE,
  name_ko text NOT NULL,
  name_en text,
  name_full text,
  kind text NOT NULL,
  region_code text REFERENCES ref_region(code),
  area_code text REFERENCES ref_area(code),
  status text NOT NULL,
  status_as_of_value text,
  status_as_of_precision text,
  status_as_of_from date GENERATED ALWAYS AS (fuzzy_from(status_as_of_value, status_as_of_precision)) STORED,
  status_as_of_to date GENERATED ALWAYS AS (fuzzy_to(status_as_of_value, status_as_of_precision)) STORED,
  status_source_id text NOT NULL REFERENCES source(id) ON UPDATE CASCADE,
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
  CONSTRAINT transfer_center_id_chk CHECK (id ~ '^xc-[a-z0-9]+(-{1,2}[a-z0-9]+)*$'),
  CONSTRAINT transfer_center_name_ko_chk CHECK (name_ko <> ''),
  CONSTRAINT transfer_center_kind_chk CHECK (kind IN ('complex', 'transfer')),
  CONSTRAINT transfer_center_status_chk CHECK (status IN ('planned', 'design', 'construction', 'completed', 'withdrawn', 'unknown')),
  CONSTRAINT transfer_center_status_as_of_fuzzy_chk CHECK (fuzzy_valid(status_as_of_value, status_as_of_precision)),
  CONSTRAINT transfer_center_status_as_of_precision_chk CHECK (status_as_of_precision IN ('day', 'month', 'half', 'year', 'unknown')),
  CONSTRAINT transfer_center_review_status_chk CHECK (review_status IN ('verified', 'unverified', 'flagged'))
);

CREATE TABLE transfer_center_plan_ref (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  center_id text NOT NULL REFERENCES transfer_center(id) ON DELETE CASCADE ON UPDATE CASCADE,
  program_id text NOT NULL REFERENCES plan_program(id) ON UPDATE CASCADE,
  class text NOT NULL,
  name_raw text NOT NULL,
  cost_100m_krw numeric(12,1),
  rail_now text,
  rail_future text,
  page text,
  note text,
  source_id text NOT NULL REFERENCES source(id) ON UPDATE CASCADE,
  seq integer NOT NULL,
  CONSTRAINT transfer_center_plan_ref_class_chk CHECK (class IN ('pilot', 'candidate', 'new', 'continued', 'review'))
);

CREATE TABLE transfer_center_status_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  center_id text NOT NULL REFERENCES transfer_center(id) ON DELETE CASCADE ON UPDATE CASCADE,
  status text NOT NULL,
  date_value text,
  date_precision text NOT NULL,
  date_from date GENERATED ALWAYS AS (fuzzy_from(date_value, date_precision)) STORED,
  date_to date GENERATED ALWAYS AS (fuzzy_to(date_value, date_precision)) STORED,
  note text,
  source_id text NOT NULL REFERENCES source(id) ON UPDATE CASCADE,
  CONSTRAINT transfer_center_status_event_status_chk CHECK (status IN ('planned', 'design', 'construction', 'completed', 'withdrawn', 'unknown')),
  CONSTRAINT transfer_center_status_event_date_fuzzy_chk CHECK (fuzzy_valid(date_value, date_precision)),
  CONSTRAINT transfer_center_status_event_date_precision_chk CHECK (date_precision IN ('day', 'month', 'half', 'year', 'unknown'))
);

CREATE TABLE transfer_center_station (
  center_id text REFERENCES transfer_center(id) ON DELETE CASCADE ON UPDATE CASCADE,
  station_id text REFERENCES station(id) ON UPDATE CASCADE,
  PRIMARY KEY (center_id, station_id)
);

CREATE TABLE transfer_center_plan (
  center_id text REFERENCES transfer_center(id) ON DELETE CASCADE ON UPDATE CASCADE,
  plan_id text REFERENCES plan(id) ON UPDATE CASCADE,
  PRIMARY KEY (center_id, plan_id)
);

CREATE TABLE route_map (
  id text PRIMARY KEY REFERENCES entity(id) ON UPDATE CASCADE,
  title_ko text NOT NULL,
  title_en text,
  publisher text NOT NULL,
  region text,
  mode text NOT NULL,
  document_id uuid REFERENCES document(id),
  url text NOT NULL,
  license text NOT NULL,
  attribution text NOT NULL,
  as_of text,
  width integer,
  height integer,
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
  CONSTRAINT route_map_id_chk CHECK (id ~ '^map-[a-z0-9]+(-{1,2}[a-z0-9]+)*$'),
  CONSTRAINT route_map_mode_chk CHECK (mode IN ('embed', 'link')),
  CONSTRAINT route_map_review_status_chk CHECK (review_status IN ('verified', 'unverified', 'flagged')),
  CONSTRAINT route_map_embed_chk CHECK (mode <> 'embed' OR document_id IS NOT NULL)
);

CREATE TABLE glossary_term (
  id text PRIMARY KEY REFERENCES entity(id) ON UPDATE CASCADE,
  term_ko text NOT NULL,
  term_en text,
  section text NOT NULL,
  definition text NOT NULL,
  basis text,
  example text,
  caution text,
  ord integer NOT NULL,
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
  CONSTRAINT glossary_term_id_chk CHECK (id ~ '^term-[a-z0-9]+(-{1,2}[a-z0-9]+)*$'),
  CONSTRAINT glossary_term_review_status_chk CHECK (review_status IN ('verified', 'unverified', 'flagged'))
);
