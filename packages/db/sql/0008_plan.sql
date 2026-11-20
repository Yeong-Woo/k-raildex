-- 0008 상위 계획·계획 사업 (docs/03-data-model.md 4-10·4-11절)

CREATE TABLE plan_program (
  id text PRIMARY KEY REFERENCES entity(id) ON UPDATE CASCADE,
  name_ko text NOT NULL,
  name_en text,
  name_full text,
  kind text NOT NULL,
  short text NOT NULL,
  round integer CHECK (round >= 1),
  region_code text REFERENCES ref_region(code),
  period_from integer,
  period_to integer,
  issuer text,
  legal_basis text,
  status text NOT NULL,
  parent_id text REFERENCES plan_program(id) ON UPDATE CASCADE,
  summary text,
  document_note text,
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
  CONSTRAINT plan_program_id_chk CHECK (id ~ '^pp-[a-z0-9]+(-{1,2}[a-z0-9]+)*$'),
  CONSTRAINT plan_program_name_ko_chk CHECK (name_ko <> ''),
  CONSTRAINT plan_program_kind_chk CHECK (kind IN ('territorial', 'national_rail', 'metro_network', 'wide_area_transport', 'wide_area_improvement', 'transfer_center', 'other')),
  CONSTRAINT plan_program_status_chk CHECK (status IN ('current', 'superseded', 'draft')),
  CONSTRAINT plan_program_review_status_chk CHECK (review_status IN ('verified', 'unverified', 'flagged')),
  CONSTRAINT plan_program_period_chk CHECK (period_from IS NULL OR period_to IS NULL OR period_to >= period_from)
);

CREATE TABLE plan_program_notice (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  program_id text NOT NULL REFERENCES plan_program(id) ON DELETE CASCADE ON UPDATE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  number text,
  date_value text,
  date_precision text NOT NULL,
  date_from date GENERATED ALWAYS AS (fuzzy_from(date_value, date_precision)) STORED,
  date_to date GENERATED ALWAYS AS (fuzzy_to(date_value, date_precision)) STORED,
  note text,
  source_id text NOT NULL REFERENCES source(id) ON UPDATE CASCADE,
  seq integer NOT NULL,
  CONSTRAINT plan_program_notice_kind_chk CHECK (kind IN ('approval', 'amendment', 'correction', 'submission', 'other')),
  CONSTRAINT plan_program_notice_date_fuzzy_chk CHECK (fuzzy_valid(date_value, date_precision)),
  CONSTRAINT plan_program_notice_date_precision_chk CHECK (date_precision IN ('day', 'month', 'half', 'year', 'unknown'))
);

CREATE TABLE plan_program_point (
  program_id text REFERENCES plan_program(id) ON DELETE CASCADE ON UPDATE CASCADE,
  seq integer,
  text text NOT NULL,
  PRIMARY KEY (program_id, seq)
);

CREATE TABLE plan_program_figure (
  program_id text REFERENCES plan_program(id) ON DELETE CASCADE ON UPDATE CASCADE,
  seq integer,
  label text NOT NULL,
  value text NOT NULL,
  source_id text REFERENCES source(id) ON UPDATE CASCADE,
  PRIMARY KEY (program_id, seq)
);

CREATE TABLE plan (
  id text PRIMARY KEY REFERENCES entity(id) ON UPDATE CASCADE,
  name_ko text NOT NULL,
  name_en text,
  name_full text,
  scope text NOT NULL DEFAULT 'line',
  opened_value text,
  opened_precision text,
  opened_from date GENERATED ALWAYS AS (fuzzy_from(opened_value, opened_precision)) STORED,
  opened_to date GENERATED ALWAYS AS (fuzzy_to(opened_value, opened_precision)) STORED,
  operator_text text,
  description text,
  is_national boolean NOT NULL DEFAULT false,
  stage_override text,
  color text CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
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
  CONSTRAINT plan_id_chk CHECK (id ~ '^plan-[a-z0-9]+(-{1,2}[a-z0-9]+)*$'),
  CONSTRAINT plan_name_ko_chk CHECK (name_ko <> ''),
  CONSTRAINT plan_scope_chk CHECK (scope IN ('line', 'station', 'facility')),
  CONSTRAINT plan_opened_fuzzy_chk CHECK (fuzzy_valid(opened_value, opened_precision)),
  CONSTRAINT plan_opened_precision_chk CHECK (opened_precision IN ('day', 'month', 'half', 'year', 'unknown')),
  CONSTRAINT plan_stage_override_chk CHECK (stage_override IN ('concept', 'plan_listed', 'prefeasibility', 'feasibility', 'strategic_eia', 'basic_plan', 'basic_design', 'eia', 'detail_design', 'construction', 'trial_run', 'opened', 'abandoned', 'dormant')),
  CONSTRAINT plan_review_status_chk CHECK (review_status IN ('verified', 'unverified', 'flagged'))
);

CREATE INDEX plan_name_trgm_idx ON plan USING gin (name_ko gin_trgm_ops);

CREATE TABLE plan_ref (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id text NOT NULL REFERENCES plan(id) ON DELETE CASCADE ON UPDATE CASCADE,
  program_id text NOT NULL REFERENCES plan_program(id) ON UPDATE CASCADE,
  edition text,
  timing text,
  class text NOT NULL,
  category text,
  section text,
  content text,
  length_km numeric(8,2),
  cost_100m_krw numeric(12,1),
  task_group text,
  source_id text NOT NULL REFERENCES source(id) ON UPDATE CASCADE,
  locator text,
  seq integer NOT NULL,
  CONSTRAINT plan_ref_class_chk CHECK (class IN ('new', 'review', 'continued')),
  CONSTRAINT plan_ref_category_chk CHECK (category IN ('high_speed', 'conventional', 'wide_area', 'urban'))
);

CREATE INDEX plan_ref_plan_idx ON plan_ref (plan_id, seq);
CREATE INDEX plan_ref_program_idx ON plan_ref (program_id);

CREATE TABLE plan_stage_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id text NOT NULL REFERENCES plan(id) ON DELETE CASCADE ON UPDATE CASCADE,
  stage text NOT NULL,
  kind text NOT NULL DEFAULT 'reached',
  date_value text,
  date_precision text NOT NULL,
  date_from date GENERATED ALWAYS AS (fuzzy_from(date_value, date_precision)) STORED,
  date_to date GENERATED ALWAYS AS (fuzzy_to(date_value, date_precision)) STORED,
  note text,
  source_id text NOT NULL REFERENCES source(id) ON UPDATE CASCADE,
  origin text NOT NULL DEFAULT 'manual',
  CONSTRAINT plan_stage_event_stage_chk CHECK (stage IN ('concept', 'plan_listed', 'prefeasibility', 'feasibility', 'strategic_eia', 'basic_plan', 'basic_design', 'eia', 'detail_design', 'construction', 'trial_run', 'opened', 'abandoned', 'dormant')),
  CONSTRAINT plan_stage_event_kind_chk CHECK (kind IN ('reached', 'withdrawn', 'dormant')),
  CONSTRAINT plan_stage_event_date_fuzzy_chk CHECK (fuzzy_valid(date_value, date_precision)),
  CONSTRAINT plan_stage_event_date_precision_chk CHECK (date_precision IN ('day', 'month', 'half', 'year', 'unknown')),
  CONSTRAINT plan_stage_event_origin_chk CHECK (origin IN ('manual', 'gazette_auto', 'agent'))
);

CREATE INDEX plan_stage_event_plan_idx ON plan_stage_event (plan_id);

CREATE TABLE plan_milestone (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id text NOT NULL REFERENCES plan(id) ON DELETE CASCADE ON UPDATE CASCADE,
  stage text NOT NULL,
  expected_value text,
  expected_precision text NOT NULL,
  expected_from date GENERATED ALWAYS AS (fuzzy_from(expected_value, expected_precision)) STORED,
  expected_to date GENERATED ALWAYS AS (fuzzy_to(expected_value, expected_precision)) STORED,
  basis text NOT NULL,
  as_of_value text,
  as_of_precision text,
  as_of_from date GENERATED ALWAYS AS (fuzzy_from(as_of_value, as_of_precision)) STORED,
  as_of_to date GENERATED ALWAYS AS (fuzzy_to(as_of_value, as_of_precision)) STORED,
  source_id text REFERENCES source(id) ON UPDATE CASCADE,
  note text,
  CONSTRAINT plan_milestone_stage_chk CHECK (stage IN ('concept', 'plan_listed', 'prefeasibility', 'feasibility', 'strategic_eia', 'basic_plan', 'basic_design', 'eia', 'detail_design', 'construction', 'trial_run', 'opened', 'abandoned', 'dormant')),
  CONSTRAINT plan_milestone_expected_fuzzy_chk CHECK (fuzzy_valid(expected_value, expected_precision)),
  CONSTRAINT plan_milestone_expected_precision_chk CHECK (expected_precision IN ('day', 'month', 'half', 'year', 'unknown')),
  CONSTRAINT plan_milestone_basis_chk CHECK (basis IN ('official', 'press', 'estimate')),
  CONSTRAINT plan_milestone_as_of_fuzzy_chk CHECK (fuzzy_valid(as_of_value, as_of_precision)),
  CONSTRAINT plan_milestone_as_of_precision_chk CHECK (as_of_precision IN ('day', 'month', 'half', 'year', 'unknown')),
  CONSTRAINT plan_milestone_basis_source_chk CHECK (basis <> 'estimate' AND source_id IS NOT NULL)
);

CREATE INDEX plan_milestone_plan_idx ON plan_milestone (plan_id, stage);

CREATE TABLE plan_line (
  plan_id text REFERENCES plan(id) ON DELETE CASCADE ON UPDATE CASCADE,
  line_id text REFERENCES line(id) ON UPDATE CASCADE,
  role text NOT NULL DEFAULT 'new',
  from_line_station_id text REFERENCES line_station(id) ON UPDATE CASCADE,
  to_line_station_id text REFERENCES line_station(id) ON UPDATE CASCADE,
  note text,
  CONSTRAINT plan_line_role_chk CHECK (role IN ('new', 'extends', 'upgrades', 'replaces')),
  PRIMARY KEY (plan_id, line_id, role)
);

CREATE INDEX plan_line_line_idx ON plan_line (line_id);

CREATE TABLE plan_station (
  plan_id text REFERENCES plan(id) ON DELETE CASCADE ON UPDATE CASCADE,
  station_id text REFERENCES station(id) ON UPDATE CASCADE,
  role text NOT NULL DEFAULT 'new',
  CONSTRAINT plan_station_role_chk CHECK (role IN ('new', 'existing', 'closes', 'subject')),
  PRIMARY KEY (plan_id, station_id)
);

CREATE INDEX plan_station_station_idx ON plan_station (station_id);

CREATE TABLE plan_region (
  plan_id text REFERENCES plan(id) ON DELETE CASCADE ON UPDATE CASCADE,
  region_code text REFERENCES ref_region(code),
  PRIMARY KEY (plan_id, region_code)
);

CREATE TABLE plan_relation (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id text NOT NULL REFERENCES plan(id) ON DELETE CASCADE ON UPDATE CASCADE,
  target_plan_id text NOT NULL REFERENCES plan(id) ON UPDATE CASCADE,
  relation text NOT NULL,
  note text,
  source_id text NOT NULL REFERENCES source(id) ON UPDATE CASCADE,
  CONSTRAINT plan_relation_relation_chk CHECK (relation IN ('succeeded_by', 'part_of', 'same_corridor', 'related')),
  CONSTRAINT plan_relation_self_chk CHECK (plan_id <> target_plan_id),
  UNIQUE (plan_id, target_plan_id, relation)
);

CREATE TABLE plan_geometry (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id text NOT NULL REFERENCES plan(id) ON DELETE CASCADE ON UPDATE CASCADE,
  kind text NOT NULL,
  via_station_ids text[],
  geom geometry(MultiLineString, 4326),
  accuracy_m integer CHECK (accuracy_m >= 0),
  method_note text,
  source_id text NOT NULL REFERENCES source(id) ON UPDATE CASCADE,
  note text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app_user(id),
  updated_by uuid REFERENCES app_user(id),
  last_changeset_id text REFERENCES changeset(id) ON UPDATE CASCADE,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES app_user(id),
  delete_reason text,
  CONSTRAINT plan_geometry_kind_chk CHECK (kind IN ('schematic', 'traced', 'official')),
  CONSTRAINT plan_geometry_schematic_chk CHECK (kind <> 'schematic' OR (via_station_ids IS NOT NULL AND array_length(via_station_ids, 1) >= 2)),
  CONSTRAINT plan_geometry_geom_chk CHECK (kind = 'schematic' OR geom IS NOT NULL)
);

CREATE INDEX plan_geometry_plan_idx ON plan_geometry (plan_id);
CREATE INDEX plan_geometry_geom_idx ON plan_geometry USING gist (geom);

CREATE TABLE plan_watch_keyword (
  plan_id text REFERENCES plan(id) ON DELETE CASCADE ON UPDATE CASCADE,
  keyword text,
  PRIMARY KEY (plan_id, keyword)
);
