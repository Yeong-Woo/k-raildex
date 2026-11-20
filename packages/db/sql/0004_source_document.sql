-- 0004 출처·원문 문서 (docs/03-data-model.md 4-2·4-3절)

CREATE TABLE source (
  id text PRIMARY KEY REFERENCES entity(id) ON UPDATE CASCADE,
  title text NOT NULL,
  publisher text NOT NULL,
  type text NOT NULL,
  url text,
  license text NOT NULL,
  license_class text NOT NULL,
  attribution text,
  published_value text,
  published_precision text,
  published_from date GENERATED ALWAYS AS (fuzzy_from(published_value, published_precision)) STORED,
  published_to date GENERATED ALWAYS AS (fuzzy_to(published_value, published_precision)) STORED,
  published_raw text,
  data_as_of text,
  retrieved_at date NOT NULL,
  refresh text,
  notice_number text,
  dataset_key text,
  download jsonb,
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
  CONSTRAINT source_id_chk CHECK (id ~ '^src-[a-z0-9]+(-{1,2}[a-z0-9]+)*$'),
  CONSTRAINT source_type_chk CHECK (type IN ('dataset_file', 'dataset_api', 'notice', 'law', 'press_release', 'official_page', 'news', 'map_image', 'manual', 'wiki')),
  CONSTRAINT source_license_class_chk CHECK (license_class IN ('public_work', 'kogl_1', 'kogl_2', 'kogl_3', 'kogl_4', 'open', 'restricted', 'unknown')),
  CONSTRAINT source_published_fuzzy_chk CHECK (fuzzy_valid(published_value, published_precision)),
  CONSTRAINT source_published_precision_chk CHECK (published_precision IN ('day', 'month', 'half', 'year', 'unknown')),
  CONSTRAINT source_refresh_chk CHECK (refresh IN ('yearly', 'quarterly', 'monthly', 'on_event', 'once')),
  CONSTRAINT source_review_status_chk CHECK (review_status IN ('verified', 'unverified', 'flagged'))
);

CREATE INDEX source_title_trgm_idx ON source USING gin (title gin_trgm_ops);

CREATE TABLE document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key text NOT NULL UNIQUE,
  filename text NOT NULL,
  mime text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  origin_url text,
  retrieved_at timestamptz,
  kind text NOT NULL,
  parent_document_id uuid REFERENCES document(id),
  page integer CHECK (page >= 1),
  bbox numeric[] CHECK (bbox IS NULL OR array_length(bbox, 1) = 4),
  license_class text NOT NULL,
  publishable boolean NOT NULL DEFAULT false,
  text_content text,
  text_tsv tsvector,
  pages integer,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES app_user(id),
  deleted_at timestamptz,
  CONSTRAINT document_kind_chk CHECK (kind IN ('original', 'text_extract', 'snapshot', 'page_image', 'figure_crop', 'upload')),
  CONSTRAINT document_license_class_chk CHECK (license_class IN ('public_work', 'kogl_1', 'kogl_2', 'kogl_3', 'kogl_4', 'open', 'restricted', 'unknown')),
  CONSTRAINT document_publishable_chk CHECK (NOT publishable OR license_class IN ('public_work', 'kogl_1', 'kogl_2', 'kogl_3', 'kogl_4', 'open')),
  CONSTRAINT document_derived_chk CHECK (kind NOT IN ('text_extract', 'page_image', 'figure_crop') OR parent_document_id IS NOT NULL)
);

CREATE INDEX document_sha_idx ON document (sha256);
CREATE INDEX document_parent_idx ON document (parent_document_id);
CREATE INDEX document_tsv_idx ON document USING gin (text_tsv);

CREATE TABLE source_document (
  source_id text REFERENCES source(id) ON DELETE CASCADE ON UPDATE CASCADE,
  document_id uuid REFERENCES document(id),
  role text NOT NULL,
  CONSTRAINT source_document_role_chk CHECK (role IN ('original', 'text_extract', 'snapshot', 'attachment')),
  PRIMARY KEY (source_id, document_id)
);

ALTER TABLE change_evidence ADD CONSTRAINT change_evidence_document_fk FOREIGN KEY (document_id) REFERENCES document(id);

ALTER TABLE ref_external_system ADD CONSTRAINT ref_external_system_source_fk FOREIGN KEY (source_id) REFERENCES source(id) ON UPDATE CASCADE;
