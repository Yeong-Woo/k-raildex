-- 0002 시스템·감사·전역 개체 레지스트리 (docs/03-data-model.md 2-2절, 4-20절)

CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  email text UNIQUE,
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  CONSTRAINT app_user_kind_chk CHECK (kind IN ('admin', 'system', 'agent', 'web'))
);

CREATE TABLE api_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id),
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT api_token_scopes_chk CHECK (scopes <@ ARRAY['public:read', 'admin:read', 'admin:write', 'proposal:write', 'system:write']::text[])
);

CREATE TABLE changeset (
  id text PRIMARY KEY,
  title text NOT NULL,
  rationale text,
  origin text NOT NULL,
  status text NOT NULL,
  author_id uuid NOT NULL REFERENCES app_user(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  applied_at timestamptz,
  review_comment text,
  error text,
  base_data_version bigint,
  reverts_changeset_id text REFERENCES changeset(id),
  body json,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT changeset_id_chk CHECK (id ~ '^cs-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+$'),
  CONSTRAINT changeset_origin_chk CHECK (origin IN ('admin_edit', 'bulk_import', 'importer', 'agent', 'legacy_migration', 'revert')),
  CONSTRAINT changeset_status_chk CHECK (status IN ('draft', 'applying', 'applied', 'failed', 'rejected', 'superseded'))
);

CREATE INDEX changeset_status_idx ON changeset (status, submitted_at);

CREATE TABLE change_op (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changeset_id text NOT NULL REFERENCES changeset(id) ON DELETE CASCADE ON UPDATE CASCADE,
  seq integer NOT NULL,
  op text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  payload jsonb NOT NULL,
  before jsonb,
  after jsonb,
  CONSTRAINT change_op_op_chk CHECK (op IN ('create', 'update', 'delete', 'restore', 'purge', 'merge_station', 'rename_id', 'replace_children')),
  CONSTRAINT change_op_entity_type_chk CHECK (entity_type IN ('source', 'operator', 'station', 'line_station', 'line', 'train_class', 'service', 'plan_program', 'plan', 'event', 'train_number_range', 'rolling_stock_range', 'transfer_center', 'route_map', 'glossary_term')),
  UNIQUE (changeset_id, seq)
);

CREATE INDEX change_op_entity_idx ON change_op (entity_id);

CREATE TABLE change_evidence (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changeset_id text NOT NULL REFERENCES changeset(id) ON DELETE CASCADE ON UPDATE CASCADE,
  op_seq integer,
  document_id uuid,
  url text,
  quote text NOT NULL,
  locator text,
  confidence numeric(3,2) CHECK (confidence BETWEEN 0 AND 1),
  note text
);

CREATE TABLE data_version (
  version bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changeset_id text REFERENCES changeset(id) ON UPDATE CASCADE,
  committed_at timestamptz NOT NULL DEFAULT now(),
  entity_ids text[] NOT NULL
);

CREATE TABLE app_setting (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entity (
  id text PRIMARY KEY,
  type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT entity_type_chk CHECK (type IN ('source', 'operator', 'station', 'line_station', 'line', 'train_class', 'service', 'plan_program', 'plan', 'event', 'train_number_range', 'rolling_stock_range', 'transfer_center', 'route_map', 'glossary_term'))
);

CREATE TABLE id_redirect (
  old_id text PRIMARY KEY,
  new_id text NOT NULL REFERENCES entity(id) ON UPDATE CASCADE,
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text
);
