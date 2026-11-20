-- 0005 공통 연결: 별칭·외부 코드·출처 연결·첨부 (docs/03-data-model.md 3절)

CREATE TABLE entity_name (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id text NOT NULL REFERENCES entity(id) ON DELETE CASCADE ON UPDATE CASCADE,
  name text NOT NULL,
  kind text NOT NULL,
  lang text NOT NULL DEFAULT 'ko',
  valid_from_value text,
  valid_from_precision text,
  valid_from_from date GENERATED ALWAYS AS (fuzzy_from(valid_from_value, valid_from_precision)) STORED,
  valid_from_to date GENERATED ALWAYS AS (fuzzy_to(valid_from_value, valid_from_precision)) STORED,
  valid_to_value text,
  valid_to_precision text,
  valid_to_from date GENERATED ALWAYS AS (fuzzy_from(valid_to_value, valid_to_precision)) STORED,
  valid_to_to date GENERATED ALWAYS AS (fuzzy_to(valid_to_value, valid_to_precision)) STORED,
  source_id text REFERENCES source(id) ON UPDATE CASCADE,
  note text,
  ord integer NOT NULL DEFAULT 0,
  CONSTRAINT entity_name_kind_chk CHECK (kind IN ('alias', 'former', 'sub', 'internal', 'abbr', 'legal', 'source_raw')),
  CONSTRAINT entity_name_lang_chk CHECK (lang IN ('ko', 'en', 'hanja')),
  CONSTRAINT entity_name_valid_from_fuzzy_chk CHECK (fuzzy_valid(valid_from_value, valid_from_precision)),
  CONSTRAINT entity_name_valid_from_precision_chk CHECK (valid_from_precision IN ('day', 'month', 'half', 'year', 'unknown')),
  CONSTRAINT entity_name_valid_to_fuzzy_chk CHECK (fuzzy_valid(valid_to_value, valid_to_precision)),
  CONSTRAINT entity_name_valid_to_precision_chk CHECK (valid_to_precision IN ('day', 'month', 'half', 'year', 'unknown')),
  UNIQUE (entity_id, name, kind)
);

CREATE INDEX entity_name_entity_idx ON entity_name (entity_id);
CREATE INDEX entity_name_trgm_idx ON entity_name USING gin (name gin_trgm_ops);

CREATE TABLE external_ref (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id text NOT NULL REFERENCES entity(id) ON DELETE CASCADE ON UPDATE CASCADE,
  system text NOT NULL REFERENCES ref_external_system(code) ON UPDATE CASCADE,
  code text NOT NULL,
  label text,
  is_primary boolean NOT NULL DEFAULT false,
  source_id text REFERENCES source(id) ON UPDATE CASCADE,
  note text,
  UNIQUE (system, code, entity_id)
);

CREATE INDEX external_ref_entity_idx ON external_ref (entity_id);
CREATE INDEX external_ref_code_idx ON external_ref (system, code);

CREATE TABLE record_source (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id text NOT NULL REFERENCES entity(id) ON DELETE CASCADE ON UPDATE CASCADE,
  source_id text NOT NULL REFERENCES source(id) ON UPDATE CASCADE,
  field text,
  locator text,
  note text,
  ord integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX record_source_uniq ON record_source (entity_id, source_id, coalesce(field, ''));
CREATE INDEX record_source_source_idx ON record_source (source_id);

CREATE TABLE entity_attachment (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id text NOT NULL REFERENCES entity(id) ON DELETE CASCADE ON UPDATE CASCADE,
  kind text NOT NULL,
  title text,
  quote text,
  url text,
  document_id uuid REFERENCES document(id),
  page integer CHECK (page >= 1),
  source_id text REFERENCES source(id) ON UPDATE CASCADE,
  is_public boolean NOT NULL DEFAULT false,
  origin text NOT NULL DEFAULT 'manual',
  ord integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app_user(id),
  updated_by uuid REFERENCES app_user(id),
  last_changeset_id text REFERENCES changeset(id) ON UPDATE CASCADE,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES app_user(id),
  delete_reason text,
  CONSTRAINT entity_attachment_kind_chk CHECK (kind IN ('quote', 'link', 'image', 'document')),
  CONSTRAINT entity_attachment_origin_chk CHECK (origin IN ('manual', 'agent')),
  CONSTRAINT entity_attachment_quote_chk CHECK (kind <> 'quote' OR quote IS NOT NULL),
  CONSTRAINT entity_attachment_link_chk CHECK (kind <> 'link' OR url IS NOT NULL),
  CONSTRAINT entity_attachment_doc_chk CHECK (kind NOT IN ('image', 'document') OR document_id IS NOT NULL)
);

CREATE INDEX entity_attachment_entity_idx ON entity_attachment (entity_id, ord);
