/**
 * 공개 읽기 모델 공통(docs/04-api.md 5절). 공개 응답 규칙:
 * - 소프트 삭제된 행·삭제된 부모의 하위 행 제외(뷰가 이미 제외하는 것은 뷰로)
 * - 내부 필드(editor_note·extra·작성자·변경 묶음 id·감시 키워드)와 내부 별칭(internal·source_raw)은 싣지 않는다
 * - 첨부는 is_public 이고 원문이 publishable 인 것만, 원문 다운로드는 publishable·공개 가능 라이선스만(Q75 A)
 */
import type { pubNameSchema } from '@k-raildex/contracts';
import {
  PUBLISHABLE_LICENSE_CLASSES,
  type EntityType,
  type PublicAttachment,
  type PublicEvent,
  type PublicRedirect,
  type PublicSourceRef,
} from '@k-raildex/contracts';
import type { z } from 'zod';
import type { Queryable } from '../db';

/** 퍼지 날짜 열 쌍 → JSON 표현식({value, precision} | null) */
export const fz = (col: string): string =>
  `CASE WHEN ${col}_precision IS NULL THEN NULL ELSE json_build_object('value', ${col}_value, 'precision', ${col}_precision) END`;

/** SQL 리터럴 목록 */
const lit = (vs: readonly string[]): string => vs.map((v) => `'${v}'`).join(', ');

export const PUBLISHABLE_SQL = lit(PUBLISHABLE_LICENSE_CLASSES);

/** 공공누리 4유형 고지(NFR-WEB-004) */
export const KOGL4_NOTICE =
  '공공누리 제4유형: 출처표시·상업적 이용금지·변경금지 — 원문을 바꾸지 않고 비상업적으로만 이용';

/** 공개 원문 JSON(별칭 d) — publishable·공개 가능 라이선스·삭제 안 됨 조건은 호출 쪽 WHERE 에 */
export const DOC_JSON = `json_build_object('id', d.id, 'filename', d.filename, 'mime', d.mime, 'size_bytes', d.size_bytes,
  'kind', d.kind, 'license_class', d.license_class,
  'notice', CASE WHEN d.license_class = 'kogl_4' THEN '${KOGL4_NOTICE}' END,
  'download_path', '/v1/public/documents/' || d.id)`;

/** 공개 원문 조건(별칭 d): figure_crop 은 kogl_3·4 원본에서 나온 것이면 공개 불가(트리거와 같은 규칙) */
export const DOC_PUBLIC = `d.publishable AND d.deleted_at IS NULL AND d.license_class IN (${PUBLISHABLE_SQL})
  AND (d.kind <> 'figure_crop' OR NOT EXISTS (SELECT 1 FROM document pd WHERE pd.id = d.parent_document_id
       AND (pd.license_class IN ('kogl_3', 'kogl_4') OR pd.deleted_at IS NOT NULL)))`;

/** 출처(별칭 s)의 공개 원문 목록 JSON */
export const SOURCE_DOCS_JSON = `coalesce((SELECT json_agg(${DOC_JSON} ORDER BY d.created_at, d.id)
  FROM source_document sd JOIN document d ON d.id = sd.document_id WHERE sd.source_id = s.id AND ${DOC_PUBLIC}), '[]'::json)`;

/** 공개 URL 경로(공개 사이트 라우트, 06 문서 2절) */
export function urlPath(type: EntityType | string, id: string): string | null {
  switch (type) {
    case 'line':
      return `/lines/${id}/`;
    case 'station':
      return `/stations/${id}/`;
    case 'service':
      return `/services/${id}/`;
    case 'plan':
      return `/plans/${id}/`;
    case 'plan_program':
      return `/plans/programs/#${id}`;
    case 'transfer_center':
      return `/transfer-centers/${id}/`;
    case 'glossary_term':
      return `/terms/#${id}`;
    case 'route_map':
      return `/maps/#${id}`;
    case 'train_class':
      return `/train-classes/#${id}`;
    case 'train_number_range':
    case 'rolling_stock_range':
      return `/trains/#${id}`;
    case 'source':
      return `/sources/#${id}`;
    case 'event':
      return `/timeline/#${id}`;
    default:
      return null; // operator(공개 페이지 없음, Q32 A)·line_station(내부 id)
  }
}

/** SQL 판 urlPath(별칭의 type·id 열) */
export const URL_PATH_SQL = (type: string, id: string): string => `CASE ${type}
  WHEN 'line' THEN '/lines/' || ${id} || '/' WHEN 'station' THEN '/stations/' || ${id} || '/'
  WHEN 'service' THEN '/services/' || ${id} || '/' WHEN 'plan' THEN '/plans/' || ${id} || '/'
  WHEN 'plan_program' THEN '/plans/programs/#' || ${id} WHEN 'transfer_center' THEN '/transfer-centers/' || ${id} || '/'
  WHEN 'glossary_term' THEN '/terms/#' || ${id} WHEN 'route_map' THEN '/maps/#' || ${id}
  WHEN 'train_class' THEN '/train-classes/#' || ${id}
  WHEN 'train_number_range' THEN '/trains/#' || ${id} WHEN 'rolling_stock_range' THEN '/trains/#' || ${id}
  WHEN 'source' THEN '/sources/#' || ${id} WHEN 'event' THEN '/timeline/#' || ${id} END`;

/** 현재 데이터 판(data_version 최대값)과 DB 기준 오늘 날짜 — 공개 응답 ETag 의 재료 */
export async function dataVersion(db: Queryable): Promise<{ version: number; today: string }> {
  const { rows } = await db.query<{ v: number; today: string }>(
    `SELECT coalesce((SELECT max(version) FROM data_version), 0)::int AS v, current_date::text AS today`,
  );
  return { version: rows[0]!.v, today: rows[0]!.today };
}

// ------------------------------------------------------------------ 없는 id 해석(FR-API-007)

export type Missing =
  { kind: 'moved'; redirect: PublicRedirect } | { kind: 'gone'; id: string } | { kind: 'not_found'; id: string };

/**
 * 공개 개체가 없을 때의 응답 종류: id_redirect 가 있으면 moved(301), 삭제된 개체면 gone(410), 아니면 not_found(404).
 * 리다이렉트는 사슬(옛 → 중간 → 새)을 끝까지 따라간다.
 */
export async function resolveMissing(db: Queryable, id: string): Promise<Missing> {
  const r = await findRedirect(db, id);
  if (r) return { kind: 'moved', redirect: r };
  const { rows } = await db.query<{ deleted: boolean }>(
    `SELECT deleted_at IS NOT NULL AS deleted FROM entity WHERE id = $1`,
    [id],
  );
  if (rows[0]?.deleted) return { kind: 'gone', id };
  return { kind: 'not_found', id };
}

/** 옛 id → 현재 id(삭제되지 않은 개체까지 따라감). 없으면 null */
export async function findRedirect(db: Queryable, oldId: string): Promise<PublicRedirect | null> {
  const { rows } = await db.query<{
    old_id: string;
    new_id: string;
    reason: string | null;
    type: string;
    deleted: boolean;
  }>(
    `WITH RECURSIVE chain AS (
       SELECT r.old_id, r.new_id, r.reason, 1 AS depth FROM id_redirect r WHERE r.old_id = $1
       UNION ALL
       SELECT c.old_id, r.new_id, c.reason, c.depth + 1 FROM chain c JOIN id_redirect r ON r.old_id = c.new_id WHERE c.depth < 10
     )
     SELECT c.old_id, c.new_id, c.reason, e.type, e.deleted_at IS NOT NULL AS deleted
       FROM chain c JOIN entity e ON e.id = c.new_id ORDER BY c.depth DESC LIMIT 1`,
    [oldId],
  );
  const r = rows[0];
  if (!r || r.deleted) return null;
  return {
    old_id: r.old_id,
    new_id: r.new_id,
    type: r.type as PublicRedirect['type'],
    url_path: urlPath(r.type, r.new_id),
    reason: r.reason,
  };
}

export async function listRedirects(db: Queryable): Promise<PublicRedirect[]> {
  const { rows } = await db.query<{ old_id: string; new_id: string; reason: string | null; type: string }>(
    `WITH RECURSIVE chain AS (
       SELECT r.old_id, r.new_id, r.reason, 1 AS depth FROM id_redirect r
       UNION ALL
       SELECT c.old_id, r.new_id, c.reason, c.depth + 1 FROM chain c JOIN id_redirect r ON r.old_id = c.new_id WHERE c.depth < 10
     )
     SELECT DISTINCT ON (c.old_id) c.old_id, c.new_id, c.reason, e.type
       FROM chain c JOIN entity e ON e.id = c.new_id AND e.deleted_at IS NULL
      WHERE NOT EXISTS (SELECT 1 FROM id_redirect r2 WHERE r2.old_id = c.new_id)
      ORDER BY c.old_id, c.depth DESC`,
  );
  return rows.map((r) => ({ ...r, type: r.type as PublicRedirect['type'], url_path: urlPath(r.type, r.new_id) }));
}

// ------------------------------------------------------------------ 공통 하위 목록

function group<T extends { entity_id: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const a = m.get(r.entity_id);
    if (a) a.push(r);
    else m.set(r.entity_id, [r]);
  }
  return m;
}

/** 개체들의 출처(출처 정보 + 공개 원문). 개체 id 순서대로 이어 붙인다 */
export async function sourcesOf(db: Queryable, ids: readonly string[]): Promise<PublicSourceRef[]> {
  if (!ids.length) return [];
  const { rows } = await db.query<{ j: PublicSourceRef }>(
    `SELECT json_build_object('entity_id', rs.entity_id, 'source_id', s.id, 'title', s.title, 'publisher', s.publisher,
              'type', s.type, 'url', s.url, 'license', s.license, 'license_class', s.license_class, 'attribution', s.attribution,
              'published', ${fz('s.published')}, 'retrieved_at', s.retrieved_at, 'checked_at', s.checked_at,
              'field', rs.field, 'locator', rs.locator, 'note', rs.note, 'documents', ${SOURCE_DOCS_JSON}) AS j
       FROM record_source rs JOIN source s ON s.id = rs.source_id AND s.deleted_at IS NULL
      WHERE rs.entity_id = ANY ($1::text[])
      ORDER BY array_position($1::text[], rs.entity_id), rs.ord, rs.id`,
    [ids],
  );
  return rows.map((r) => r.j);
}

/** 출처 id 목록(하위 행 source_id 등)의 출처 정보 — 개체 연결이 아닌 출처(entity_id = 출처 id) */
export async function sourcesById(db: Queryable, sourceIds: readonly string[]): Promise<PublicSourceRef[]> {
  const ids = [...new Set(sourceIds.filter(Boolean))];
  if (!ids.length) return [];
  const { rows } = await db.query<{ j: PublicSourceRef }>(
    `SELECT json_build_object('entity_id', s.id, 'source_id', s.id, 'title', s.title, 'publisher', s.publisher,
              'type', s.type, 'url', s.url, 'license', s.license, 'license_class', s.license_class, 'attribution', s.attribution,
              'published', ${fz('s.published')}, 'retrieved_at', s.retrieved_at, 'checked_at', s.checked_at,
              'field', NULL, 'locator', NULL, 'note', NULL, 'documents', ${SOURCE_DOCS_JSON}) AS j
       FROM source s WHERE s.id = ANY ($1::text[]) AND s.deleted_at IS NULL ORDER BY s.id`,
    [ids],
  );
  return rows.map((r) => r.j);
}

/** 하위 행이 가리키는 출처 중 개체 출처 목록에 없는 것을 더한다(단계 이력·기대 일정·고시 등의 근거) */
export async function withChildSources(
  db: Queryable,
  base: PublicSourceRef[],
  childSourceIds: readonly (string | null | undefined)[],
): Promise<PublicSourceRef[]> {
  const have = new Set(base.map((s) => s.source_id));
  const extra = await sourcesById(
    db,
    childSourceIds.filter((x): x is string => !!x && !have.has(x)),
  );
  return [...base, ...extra];
}

export async function attachmentsOf(db: Queryable, ids: readonly string[]): Promise<PublicAttachment[]> {
  if (!ids.length) return [];
  const { rows } = await db.query<{ j: PublicAttachment }>(
    `SELECT json_build_object('id', a.id, 'entity_id', a.entity_id, 'kind', a.kind, 'title', a.title, 'quote', a.quote,
              'url', a.url, 'page', a.page, 'source_id', a.source_id,
              'document', CASE WHEN d.id IS NOT NULL THEN ${DOC_JSON} END) AS j
       FROM entity_attachment a
       LEFT JOIN document d ON d.id = a.document_id
      WHERE a.entity_id = ANY ($1::text[]) AND a.is_public AND a.deleted_at IS NULL
        AND (a.document_id IS NULL OR (${DOC_PUBLIC}))
      ORDER BY array_position($1::text[], a.entity_id), a.ord, a.id`,
    [ids],
  );
  return rows.map((r) => r.j);
}

export type PublicName = z.infer<typeof pubNameSchema>;

/** 공개 별칭(내부 표기·원문 이름 제외) — entity_id 별 */
export async function namesOf(db: Queryable, ids: readonly string[]): Promise<Map<string, PublicName[]>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query<PublicName & { entity_id: string }>(
    `SELECT n.entity_id, n.name, n.kind, n.lang, ${fz('n.valid_from')} AS valid_from, ${fz('n.valid_to')} AS valid_to, n.note
       FROM entity_name n WHERE n.entity_id = ANY ($1::text[]) AND n.kind NOT IN ('internal', 'source_raw')
      ORDER BY n.entity_id, n.ord, n.id`,
    [ids],
  );
  const m = new Map<string, PublicName[]>();
  for (const [k, v] of group(rows))
    m.set(
      k,
      v.map(({ entity_id: _e, ...rest }) => rest),
    );
  return m;
}

/**
 * 연표 색인(대상 id → 항목). v_event_all 은 파생 이벤트를 매번 전부 계산하므로(수십 ms) 데이터 판·날짜·DB 단위로
 * 한 번 읽어 프로세스 메모리에 둔다(값을 저장하지 않는 캐시 — 판이 바뀌면 다시 계산).
 */
let eventIndex: { key: string; byTarget: Map<string, PublicEvent[]> } | null = null;

export async function eventsOf(db: Queryable, id: string): Promise<PublicEvent[]> {
  const k = await db.query<{ k: string }>(
    `SELECT current_database() || ':' || coalesce(inet_server_port()::text, '') || ':' ||
            coalesce((SELECT max(version) FROM data_version), 0) || ':' || current_date AS k`,
  );
  const key = k.rows[0]!.k;
  if (eventIndex?.key !== key) {
    const { rows } = await db.query<PublicEvent>(
      `SELECT e.id, e.type, ${fz('e.date')} AS date, e.title, e.note, e.derived, e.targets
         FROM v_event_all e ORDER BY fuzzy_from(e.date_value, e.date_precision) NULLS LAST, e.id`,
    );
    const byTarget = new Map<string, PublicEvent[]>();
    for (const e of rows)
      for (const t of new Set(e.targets)) {
        const list = byTarget.get(t);
        if (list) list.push(e);
        else byTarget.set(t, [e]);
      }
    eventIndex = { key, byTarget };
  }
  return eventIndex.byTarget.get(id) ?? [];
}

/** REC 공개 부분(별칭 t) */
export const REC_JSON = (t: string): string =>
  `json_build_object('checked_at', ${t}.checked_at, 'provenance_note', ${t}.provenance_note, 'review_status', ${t}.review_status, 'updated_at', ${t}.updated_at)`;

/** 개통 예정 JSON: v_plan_target_open(별칭 t). delayed = 예정 끝이 지났는데 미개통 */
export const TARGET_JSON = (t: string, stage: string): string =>
  `CASE WHEN ${t}.plan_id IS NULL THEN NULL ELSE json_build_object('value', ${t}.value, 'precision', ${t}.precision,
     'basis', ${t}.basis, 'as_of', ${fz(`${t}.as_of`)}, 'source_id', ${t}.source_id,
     'delayed', (${t}.date_to IS NOT NULL AND ${t}.date_to < current_date AND ${stage} IS DISTINCT FROM 'opened')) END`;

/** 목록 페이지 매기기(FR-API-005, limit ≤ 500) */
export interface Page {
  limit: number;
  offset: number;
}

export function paginate<T>(all: T[], p: Page): { items: T[]; total: number; limit: number; offset: number } {
  return { items: all.slice(p.offset, p.offset + p.limit), total: all.length, limit: p.limit, offset: p.offset };
}
