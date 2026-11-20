-- 0012 트리거 (docs/03-data-model.md 2-2·2-5·2-6·8-2·9절)
-- 단일 행·교차 테이블 규칙 중 DB 가 강제할 수 있는 것. 나머지 도메인 규칙은 packages/domain 검증.

-- 개체 테이블 ↔ entity_type
CREATE TABLE entity_table (
  table_name text PRIMARY KEY,
  entity_type text NOT NULL UNIQUE,
  curated boolean NOT NULL          -- REC(출처 ≥1·checked_at) 대상
);
INSERT INTO entity_table (table_name, entity_type, curated) VALUES
  ('source', 'source', false),
  ('operator', 'operator', true),
  ('station', 'station', true),
  ('line_station', 'line_station', false),
  ('line', 'line', true),
  ('train_class', 'train_class', true),
  ('service', 'service', true),
  ('plan_program', 'plan_program', true),
  ('plan', 'plan', true),
  ('event', 'event', true),
  ('train_number_range', 'train_number_range', true),
  ('rolling_stock_range', 'rolling_stock_range', true),
  ('transfer_center', 'transfer_center', true),
  ('route_map', 'route_map', true),
  ('glossary_term', 'glossary_term', true);

-- 1) 개체 행의 id 는 같은 유형의 entity 행이어야 한다
CREATE OR REPLACE FUNCTION entity_type_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
  SELECT type INTO t FROM entity WHERE id = NEW.id;
  IF t IS DISTINCT FROM TG_ARGV[0] THEN
    RAISE EXCEPTION 'entity_type_guard: % 는 entity 유형 % 가 아님(실제 %)', NEW.id, TG_ARGV[0], coalesce(t, '없음')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- 2) 출처 ≥1 (V-H01): 커밋 시점에 검사하는 지연 제약 트리거
CREATE OR REPLACE FUNCTION require_record_source() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE eid text; deleted timestamptz; ok boolean;
BEGIN
  IF TG_TABLE_NAME = 'record_source' THEN
    eid := OLD.entity_id;
  ELSE
    eid := NEW.id;
  END IF;
  -- 커밋 시점의 최신 상태로 판단
  SELECT e.deleted_at INTO deleted FROM entity e
    JOIN entity_table et ON et.entity_type = e.type AND et.curated
   WHERE e.id = eid;
  IF NOT FOUND OR deleted IS NOT NULL THEN
    RETURN NULL;   -- 큐레이션 대상이 아니거나, 지워졌거나(퍼지·이름 변경 등), 삭제(휴지통)됨
  END IF;
  SELECT EXISTS (SELECT 1 FROM record_source WHERE entity_id = eid AND field IS NULL) INTO ok;
  IF NOT ok THEN
    RAISE EXCEPTION 'V-H01: % 에 레코드 출처(record_source, field 없음)가 하나도 없음', eid
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER record_source_required
  AFTER DELETE OR UPDATE OF entity_id, field ON record_source
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION require_record_source();

-- 3) 소프트 삭제를 entity 레지스트리에 동기화
CREATE OR REPLACE FUNCTION sync_entity_deleted() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    UPDATE entity SET deleted_at = NEW.deleted_at WHERE id = NEW.id;
  END IF;
  RETURN NULL;
END $$;

-- 노선을 지우면(복구하면) 그 노선별 역도 함께(같은 시각으로 지운 것만 복구)
CREATE OR REPLACE FUNCTION cascade_line_deleted() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE line_station SET deleted_at = NEW.deleted_at, deleted_by = NEW.deleted_by,
           delete_reason = coalesce(delete_reason, '노선과 함께 삭제')
     WHERE line_id = NEW.id AND deleted_at IS NULL;
  ELSIF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
    UPDATE line_station SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL
     WHERE line_id = NEW.id AND deleted_at = OLD.deleted_at;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER line_cascade_deleted AFTER UPDATE OF deleted_at ON line
  FOR EACH ROW EXECUTE FUNCTION cascade_line_deleted();

-- 4) updated_at·version 자동 갱신(If-Match 비교는 도메인 적용기가 한다)
CREATE OR REPLACE FUNCTION touch_meta() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;

-- 개체 테이블마다 1)~4) 트리거를 단다
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_name, entity_type, curated FROM entity_table LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF id ON %I FOR EACH ROW EXECUTE FUNCTION entity_type_guard(%L)',
                   r.table_name || '_entity_type_guard', r.table_name, r.entity_type);
    EXECUTE format('CREATE TRIGGER %I AFTER UPDATE OF deleted_at ON %I FOR EACH ROW EXECUTE FUNCTION sync_entity_deleted()',
                   r.table_name || '_sync_deleted', r.table_name);
    IF r.curated THEN
      EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_record_source()',
                     r.table_name || '_source_required', r.table_name);
    END IF;
  END LOOP;
  -- META(version·updated_at)가 있는 모든 테이블
  FOR r IN SELECT c.table_schema, c.table_name FROM information_schema.columns c
            JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
           WHERE c.column_name = 'version' AND t.table_type = 'BASE TABLE'
             AND c.table_schema IN ('public', 'ingest') LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION touch_meta()',
                   r.table_name || '_touch_meta', r.table_schema, r.table_name);
  END LOOP;
END $$;

-- 5) 첨부 공개 ↔ 문서 공개 가능(V-H15), 변경 금지 라이선스(kogl_3·4)에서 잘라 낸 그림은 공개 불가(Q75 A)
CREATE OR REPLACE FUNCTION attachment_public_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_public AND NEW.document_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM document WHERE id = NEW.document_id AND publishable AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'V-H15: 공개 첨부의 문서 % 가 공개 가능(publishable)이 아님', NEW.document_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entity_attachment_public_guard BEFORE INSERT OR UPDATE ON entity_attachment
  FOR EACH ROW EXECUTE FUNCTION attachment_public_guard();

CREATE OR REPLACE FUNCTION document_publishable_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.publishable AND NEW.kind = 'figure_crop' AND EXISTS (
       SELECT 1 FROM document p WHERE p.id = NEW.parent_document_id AND p.license_class IN ('kogl_3', 'kogl_4')) THEN
    RAISE EXCEPTION '변경 금지 라이선스 원본에서 잘라 낸 그림은 공개할 수 없음(%)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.publishable AND NOT NEW.publishable AND EXISTS (
       SELECT 1 FROM entity_attachment a WHERE a.document_id = NEW.id AND a.is_public AND a.deleted_at IS NULL) THEN
    RAISE EXCEPTION '공개 첨부가 쓰는 문서 % 를 비공개로 바꿀 수 없음 — 첨부를 먼저 비공개로', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_publishable_guard BEFORE INSERT OR UPDATE ON document
  FOR EACH ROW EXECUTE FUNCTION document_publishable_guard();

-- 6) 계획 선형: 경유역 존재·좌표 보유(V-H07). schematic 의 geom 이 비면 경유역 직선으로 채운다(표시용 곡선은 앱이 덮어씀)
CREATE OR REPLACE FUNCTION plan_geometry_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE missing text[];
BEGIN
  IF NEW.via_station_ids IS NOT NULL THEN
    SELECT array_agg(v) INTO missing FROM unnest(NEW.via_station_ids) v
     WHERE NOT EXISTS (SELECT 1 FROM station s WHERE s.id = v AND s.geom IS NOT NULL);
    IF missing IS NOT NULL THEN
      RAISE EXCEPTION 'V-H07: 계획 선형 경유역이 없거나 좌표가 없음: %', missing USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.kind = 'schematic' AND NEW.geom IS NULL THEN
    SELECT ST_Multi(ST_MakeLine(s.geom::geometry ORDER BY v.ord)) INTO NEW.geom
      FROM unnest(NEW.via_station_ids) WITH ORDINALITY AS v(id, ord)
      JOIN station s ON s.id = v.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_geometry_guard BEFORE INSERT OR UPDATE ON plan_geometry
  FOR EACH ROW EXECUTE FUNCTION plan_geometry_guard();

-- 7) 환승센터 반영 내역의 상위 계획은 kind transfer_center(V-H03)
CREATE OR REPLACE FUNCTION tc_plan_ref_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM plan_program WHERE id = NEW.program_id AND kind = 'transfer_center') THEN
    RAISE EXCEPTION 'V-H03: 환승센터 반영 내역의 상위 계획 % 는 kind transfer_center 가 아님', NEW.program_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transfer_center_plan_ref_guard BEFORE INSERT OR UPDATE ON transfer_center_plan_ref
  FOR EACH ROW EXECUTE FUNCTION tc_plan_ref_guard();
