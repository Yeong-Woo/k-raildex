-- 0003 참조 테이블: 권역·시·도·외부 시스템 (docs/03-data-model.md 4-1절, 3-2절)

CREATE TABLE ref_area (
  code text PRIMARY KEY,
  name_ko text NOT NULL,
  name_en text,
  ord integer NOT NULL,
  CONSTRAINT ref_area_code_chk CHECK (code IN ('capital', 'southeast', 'daegyeong', 'chungcheong', 'honam', 'gangwon', 'jeju', 'national'))
);

CREATE TABLE ref_region (
  code text PRIMARY KEY,
  name_ko text NOT NULL UNIQUE,
  short_ko text NOT NULL,
  slug text NOT NULL UNIQUE,
  area_code text NOT NULL REFERENCES ref_area(code),
  ord integer NOT NULL,
  CONSTRAINT ref_region_code_chk CHECK (code ~ '^[0-9]{2}$')
);

CREATE TABLE ref_external_system (
  code text PRIMARY KEY,
  name_ko text NOT NULL,
  source_id text,
  entity_type text NOT NULL,
  multi_per_entity boolean NOT NULL DEFAULT true,
  multi_entity_per_code boolean NOT NULL DEFAULT false,
  note text,
  CONSTRAINT ref_external_system_entity_type_chk CHECK (entity_type IN ('source', 'operator', 'station', 'line_station', 'line', 'train_class', 'service', 'plan_program', 'plan', 'event', 'train_number_range', 'rolling_stock_range', 'transfer_center', 'route_map', 'glossary_term'))
);
