-- 0011 OSM(ODbL, 자체 데이터와 분리) · 수집기·외부 API 탐색기 (docs/03-data-model.md 4-19·4-19-1절, docs/08)

CREATE SCHEMA osm;
CREATE SCHEMA ingest;

CREATE TABLE osm.extract (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL,
  bbox numeric[],
  fetched_at timestamptz NOT NULL,
  overpass_query text,
  sha256 text,
  note text
);

CREATE TABLE osm.way (
  id bigint PRIMARY KEY,
  extract_id bigint REFERENCES osm.extract(id),
  tags jsonb NOT NULL,
  is_construction boolean NOT NULL,
  geom geometry(LineString, 4326) NOT NULL
);

CREATE INDEX way_geom_idx ON osm.way USING gist (geom);

CREATE TABLE osm.relation (
  id bigint PRIMARY KEY,
  extract_id bigint REFERENCES osm.extract(id),
  tags jsonb NOT NULL
);

CREATE TABLE osm.relation_member (
  relation_id bigint REFERENCES osm.relation(id) ON DELETE CASCADE,
  way_id bigint NOT NULL,
  role text,
  seq integer NOT NULL,
  PRIMARY KEY (relation_id, seq)
);

CREATE TABLE ingest.run (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task text NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('schedule', 'manual', 'event')),
  status text NOT NULL CHECK (status IN ('running', 'done', 'failed', 'cancelled')),
  started_at timestamptz,
  finished_at timestamptz,
  params jsonb,
  stats jsonb,
  model text,
  prompt_version text,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(10,4),
  log text,
  error text,
  changeset_ids text[]
);

CREATE TABLE ingest.config (
  task text,
  key text,
  value jsonb NOT NULL,
  note text,
  PRIMARY KEY (task, key)
);

CREATE TABLE ingest.match_rule (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('merge', 'no_merge')),
  keys text[] NOT NULL,
  entity_id text REFERENCES entity(id) ON UPDATE CASCADE,
  note text NOT NULL
);

CREATE TABLE ingest.snapshot (
  task text,
  external_key text,
  payload jsonb NOT NULL,
  sha256 text NOT NULL,
  first_seen_run bigint,
  last_seen_run bigint,
  PRIMARY KEY (task, external_key)
);

CREATE TABLE ingest.watch (
  entity_id text REFERENCES entity(id) ON DELETE CASCADE ON UPDATE CASCADE,
  task text NOT NULL,
  next_check_at date,
  keywords text[],
  note text,
  PRIMARY KEY (entity_id, task)
);

CREATE TABLE ingest.api_endpoint (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  provider text NOT NULL,
  name_ko text NOT NULL,
  method text NOT NULL DEFAULT 'GET' CHECK (method IN ('GET', 'POST')),
  base_url text NOT NULL CHECK (base_url ~ '^https?://'),
  params jsonb NOT NULL DEFAULT '[]'::jsonb,
  key_param text,
  key_env text,
  response_format text NOT NULL,
  rows_path text,
  paging jsonb,
  daily_limit integer CHECK (daily_limit > 0),
  external_system text REFERENCES public.ref_external_system(code) ON UPDATE CASCADE,
  source_id text REFERENCES public.source(id) ON UPDATE CASCADE,
  doc_url text,
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
  CONSTRAINT api_endpoint_provider_chk CHECK (provider IN ('data_go_kr', 'kric', 'tago', 'vworld', 'seoul_open', 'law_go_kr', 'other')),
  CONSTRAINT api_endpoint_response_format_chk CHECK (response_format IN ('xml', 'json'))
);

CREATE TABLE ingest.api_call (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  endpoint_id text NOT NULL REFERENCES ingest.api_endpoint(id) ON UPDATE CASCADE,
  params jsonb NOT NULL,
  called_at timestamptz NOT NULL DEFAULT now(),
  origin text NOT NULL,
  status integer,
  elapsed_ms integer,
  result_code text,
  result_message text,
  response_body bytea,
  response_sha256 text,
  snapshot_document_id uuid REFERENCES public.document(id),
  CONSTRAINT api_call_origin_chk CHECK (origin IN ('admin', 'importer', 'agent'))
);

CREATE INDEX api_call_endpoint_idx ON ingest.api_call (endpoint_id, called_at);

CREATE TABLE ingest.api_preset (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  endpoint_id text NOT NULL REFERENCES ingest.api_endpoint(id) ON DELETE CASCADE ON UPDATE CASCADE,
  name text NOT NULL,
  params jsonb NOT NULL
);
