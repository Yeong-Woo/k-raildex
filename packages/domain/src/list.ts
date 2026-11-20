/**
 * 개체 목록·검색·참조 선택기(docs/04-api.md 4절 `GET /v1/admin/{type}`, `/lookup`).
 * 목록 항목은 가벼운 요약(id·이름·상태·검수·갱신 시각)이고 전체 Read 는 readEntity 로 따로 읽는다.
 * 정렬·필터 열은 DB 열 정보(schemaInfo)로 고른 스칼라 열만 허용한다(SQL 주입 방지).
 */
import { codeLabel, isCode, type EntityType } from '@k-raildex/contracts';
import type { Queryable } from './db';
import { DomainError } from './errors';
import { ENTITY_SPECS } from './mapping';
import { schemaInfo, tableColumns, type ColumnInfo } from './schema-info';

export const LIST_MAX_LIMIT = 500;
export const LIST_DEFAULT_LIMIT = 50;

export interface ListQuery {
  /** 이름·별칭·id(그리고 역은 역번호) 검색 */
  q?: string;
  /** 역은 v_station_status, 계획은 v_plan_stage 의 현재 단계, 나머지는 status 열 */
  status?: string;
  review_status?: string;
  /** 시·도 코드(region_code 열·line_region·plan_region) */
  region?: string;
  /** 권역 코드(파생 뷰) */
  area?: string;
  include_deleted?: boolean;
  /** 휴지통: 삭제된 것만 */
  deleted_only?: boolean;
  /** ISO 날짜·시각. updated_at >= 이 값 */
  updated_since?: string;
  /** 열 이름 또는 -열 이름(내림차순). 스칼라 열만 */
  sort?: string;
  limit?: number;
  offset?: number;
  /** 개체별 필터: 스칼라 열 = 값(예: line_station 의 line_id, line 의 category) */
  filters?: Record<string, string>;
}

export interface ListItem {
  id: string;
  type: EntityType;
  name_ko: string | null;
  name_en: string | null;
  /** 상태(역: 계산된 상태). 상태가 없는 개체는 null */
  status: string | null;
  /** 계획의 현재 단계(그 외 null) */
  stage: string | null;
  review_status: string | null;
  version: number;
  updated_at: string;
  deleted_at: string | null;
}

export interface ListResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface LookupItem {
  id: string;
  label: string;
  sublabel: string | null;
  deleted: boolean;
}

// ---------------------------------------------------------------------------
// 개체별 표현식
// ---------------------------------------------------------------------------

interface TypeExprs {
  /** 대표 이름(SQL, 별칭 t) */
  label: string;
  labelEn: string;
  /** 추가 JOIN */
  joins: string[];
  status: string;
  stage: string;
}

const SCALAR_TYPES = new Set([
  'text',
  'character varying',
  'integer',
  'bigint',
  'smallint',
  'numeric',
  'boolean',
  'date',
  'timestamp with time zone',
  'uuid',
]);

function scalarColumns(cols: Map<string, ColumnInfo>): Set<string> {
  return new Set([...cols.values()].filter((c) => SCALAR_TYPES.has(c.dataType)).map((c) => c.name));
}

function exprsFor(type: EntityType, cols: Map<string, ColumnInfo>): TypeExprs {
  const joins: string[] = [];
  let label = 't.name_ko';
  let labelEn = cols.has('name_en') ? 't.name_en' : 'NULL::text';
  switch (type) {
    case 'source':
    case 'event':
      label = 't.title';
      break;
    case 'route_map':
      label = 't.title_ko';
      labelEn = 't.title_en';
      break;
    case 'glossary_term':
      label = 't.term_ko';
      labelEn = 't.term_en';
      break;
    case 'train_number_range':
      label = `coalesce(t.code_prefix, '') || t.range_from::text || '~' || t.range_to::text`;
      break;
    case 'rolling_stock_range':
      label = `t.series || ' ' || coalesce(t.number_prefix, '') || t.number_from::text || '~' || t.number_to::text`;
      break;
    case 'line_station':
      joins.push('LEFT JOIN station ls_s ON ls_s.id = t.station_id');
      label = 'coalesce(t.name_ko, ls_s.name_ko)';
      labelEn = 'coalesce(t.name_en, ls_s.name_en)';
      break;
    default:
      break;
  }
  let status = cols.has('status') ? 't.status' : 'NULL::text';
  let stage = 'NULL::text';
  if (type === 'station') {
    joins.push('LEFT JOIN v_station_status vss ON vss.station_id = t.id');
    status = 'coalesce(vss.status, t.own_status)';
  }
  if (type === 'plan') {
    joins.push('LEFT JOIN v_plan_stage vps ON vps.plan_id = t.id');
    stage = 'vps.stage';
  }
  return { label, labelEn, joins, status, stage };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function badQuery(path: string, message: string): DomainError {
  return new DomainError('validation', message, { violations: [{ rule: 'query', path, message }] });
}

class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

/** q 검색 조건(이름·영문 이름·id·별칭, 역은 역번호) */
function searchCond(type: EntityType, ex: TypeExprs, q: string, p: Params): string {
  const like = p.add(`%${escapeLike(q)}%`);
  const conds = [
    `t.id ILIKE ${like}`,
    `${ex.label} ILIKE ${like}`,
    `${ex.labelEn} ILIKE ${like}`,
    `EXISTS (SELECT 1 FROM entity_name n WHERE n.entity_id = t.id AND n.name ILIKE ${like})`,
  ];
  if (type === 'station') {
    conds.push(
      `EXISTS (SELECT 1 FROM line_station x WHERE x.station_id = t.id AND x.deleted_at IS NULL AND x.station_code ILIKE ${like})`,
    );
  }
  if (type === 'line_station') conds.push(`t.station_code ILIKE ${like}`);
  return `(${conds.join(' OR ')})`;
}

function regionCond(type: EntityType, cols: Map<string, ColumnInfo>, region: string, p: Params): string {
  const v = p.add(region);
  if (cols.has('region_code')) return `t.region_code = ${v}`;
  if (type === 'line') return `EXISTS (SELECT 1 FROM line_region r WHERE r.line_id = t.id AND r.region_code = ${v})`;
  if (type === 'plan') return `EXISTS (SELECT 1 FROM plan_region r WHERE r.plan_id = t.id AND r.region_code = ${v})`;
  if (type === 'line_station') return `ls_s.region_code = ${v}`;
  throw badQuery('region', `${type} 는 region 필터를 지원하지 않음`);
}

function areaCond(type: EntityType, cols: Map<string, ColumnInfo>, area: string, p: Params): string {
  const v = p.add(area);
  const view: Partial<Record<EntityType, [string, string]>> = {
    station: ['v_station_area', 'station_id'],
    line: ['v_line_area', 'line_id'],
    plan: ['v_plan_area', 'plan_id'],
    service: ['v_service_area', 'service_id'],
  };
  const vw = view[type];
  if (vw) return `EXISTS (SELECT 1 FROM ${vw[0]} a WHERE a.${vw[1]} = t.id AND ${v} = ANY (a.areas))`;
  if (cols.has('area_code')) return `t.area_code = ${v}`;
  if (type === 'event') return `EXISTS (SELECT 1 FROM event_area a WHERE a.event_id = t.id AND a.area_code = ${v})`;
  throw badQuery('area', `${type} 는 area 필터를 지원하지 않음`);
}

// ---------------------------------------------------------------------------
// 목록
// ---------------------------------------------------------------------------

export async function listEntities(
  db: Queryable,
  type: EntityType,
  query: ListQuery = {},
): Promise<ListResult<ListItem>> {
  const spec = ENTITY_SPECS[type];
  const cols = tableColumns(await schemaInfo(db), spec.table);
  const scalars = scalarColumns(cols);
  const ex = exprsFor(type, cols);
  const limit = query.limit ?? LIST_DEFAULT_LIMIT;
  const offset = query.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIST_MAX_LIMIT)
    throw badQuery('limit', `limit 는 1~${LIST_MAX_LIMIT}`);
  if (!Number.isInteger(offset) || offset < 0) throw badQuery('offset', 'offset 는 0 이상');

  const p = new Params();
  const where: string[] = [];
  if (query.deleted_only) where.push('t.deleted_at IS NOT NULL');
  else if (!query.include_deleted) where.push('t.deleted_at IS NULL');

  const q = query.q?.trim();
  if (q) where.push(searchCond(type, ex, q, p));
  if (query.status) {
    if (type === 'plan') where.push(`vps.stage = ${p.add(query.status)}`);
    else if (ex.status === 'NULL::text') throw badQuery('status', `${type} 에는 상태가 없음`);
    else where.push(`${ex.status} = ${p.add(query.status)}`);
  }
  if (query.review_status) {
    if (!cols.has('review_status')) throw badQuery('review_status', `${type} 에는 검수 상태가 없음`);
    where.push(`t.review_status = ${p.add(query.review_status)}`);
  }
  if (query.region) where.push(regionCond(type, cols, query.region, p));
  if (query.area) where.push(areaCond(type, cols, query.area, p));
  if (query.updated_since) {
    const d = new Date(query.updated_since);
    if (Number.isNaN(d.getTime())) throw badQuery('updated_since', 'ISO 날짜·시각이 아님');
    where.push(`t.updated_at >= ${p.add(d.toISOString())}`);
  }
  for (const [k, v] of Object.entries(query.filters ?? {})) {
    if (!scalars.has(k)) throw badQuery(k, `알 수 없는 필터: ${k}`);
    where.push(`t."${k}"::text = ${p.add(v)}`);
  }

  // count 는 WHERE 매개변수만 쓴다(정렬·쪽 매개변수는 뒤에 붙는다)
  const whereValues = [...p.values];

  // 정렬
  let order: string;
  if (query.sort) {
    const desc = query.sort.startsWith('-');
    const field = desc ? query.sort.slice(1) : query.sort;
    let expr: string;
    if (field === 'name_ko' || field === 'label') expr = ex.label;
    else if (field === 'status') expr = ex.status;
    else if (field === 'stage' && type === 'plan') expr = 'vps.stage';
    else if (scalars.has(field)) expr = `t."${field}"`;
    else throw badQuery('sort', `정렬할 수 없는 필드: ${field}`);
    order = `${expr} ${desc ? 'DESC NULLS LAST' : 'ASC NULLS LAST'}, t.id`;
  } else if (q) {
    const qv = p.add(q);
    order = `(t.id = ${qv} OR ${ex.label} = ${qv}) DESC, similarity(${ex.label}, ${qv}) DESC, t.id`;
  } else {
    order = 't.id';
  }

  const from = `FROM "${spec.table}" t ${ex.joins.join(' ')}`;
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await db.query<{ n: number }>(`SELECT count(*)::int AS n ${from} ${whereSql}`, whereValues);
  const lim = p.add(limit);
  const off = p.add(offset);
  const { rows } = await db.query<{
    id: string;
    name_ko: string | null;
    name_en: string | null;
    status: string | null;
    stage: string | null;
    review_status: string | null;
    version: number;
    updated_at: Date;
    deleted_at: Date | null;
  }>(
    `SELECT t.id, ${ex.label} AS name_ko, ${ex.labelEn} AS name_en, ${ex.status} AS status, ${ex.stage} AS stage,
            ${cols.has('review_status') ? 't.review_status' : 'NULL::text'} AS review_status,
            t.version, t.updated_at, t.deleted_at
       ${from} ${whereSql} ORDER BY ${order} LIMIT ${lim} OFFSET ${off}`,
    p.values,
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      type,
      name_ko: r.name_ko,
      name_en: r.name_en,
      status: r.status,
      stage: r.stage,
      review_status: r.review_status,
      version: r.version,
      updated_at: new Date(r.updated_at).toISOString(),
      deleted_at: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
    })),
    total: total.rows[0]?.n ?? 0,
    limit,
    offset,
  };
}

/** 휴지통: 삭제된 개체(영구 삭제된 묘비는 제외). type 이 없으면 모든 종류를 삭제 시각 역순으로 */
export async function listTrash(
  db: Queryable,
  opts: { type?: EntityType; limit?: number; offset?: number } = {},
): Promise<ListResult<ListItem>> {
  const limit = opts.limit ?? LIST_DEFAULT_LIMIT;
  const offset = opts.offset ?? 0;
  if (opts.type) return listEntities(db, opts.type, { deleted_only: true, sort: '-deleted_at', limit, offset });
  const all: ListItem[] = [];
  for (const type of Object.keys(ENTITY_SPECS) as EntityType[]) {
    let off = 0;
    for (;;) {
      const r = await listEntities(db, type, { deleted_only: true, limit: LIST_MAX_LIMIT, offset: off });
      all.push(...r.items);
      off += r.items.length;
      if (off >= r.total || r.items.length === 0) break;
    }
  }
  all.sort((a, b) => (b.deleted_at ?? '').localeCompare(a.deleted_at ?? '') || a.id.localeCompare(b.id));
  return { items: all.slice(offset, offset + limit), total: all.length, limit, offset };
}

// ---------------------------------------------------------------------------
// 참조 선택기
// ---------------------------------------------------------------------------

function sublabelExpr(type: EntityType): string {
  switch (type) {
    case 'station':
      return `concat_ws(' · ',
        (SELECT string_agg(DISTINCT l.name_ko, '·') FROM line_station x JOIN line l ON l.id = x.line_id AND l.deleted_at IS NULL
          WHERE x.station_id = t.id AND x.deleted_at IS NULL),
        (SELECT r.short_ko FROM ref_region r WHERE r.code = t.region_code))`;
    case 'line_station':
      return `concat_ws(' · ', (SELECT l.name_ko FROM line l WHERE l.id = t.line_id), t.station_code)`;
    case 'line':
      return `(SELECT string_agg(r.short_ko, '·' ORDER BY r.ord) FROM line_region lr JOIN ref_region r ON r.code = lr.region_code WHERE lr.line_id = t.id)`;
    case 'source':
      return `t.publisher`;
    case 'plan':
      return `vps.stage`;
    case 'service':
      return `t.kind`;
    case 'glossary_term':
      return `t.section`;
    case 'train_number_range':
    case 'rolling_stock_range':
      return `(SELECT o.name_ko FROM operator o WHERE o.id = t.operator_id)`;
    default:
      return 'NULL::text';
  }
}

/** 참조 선택기: 활성 개체만. 결과는 id·라벨·보조 라벨(역: 노선들·시·도) */
export async function lookup(db: Queryable, type: EntityType, q: string, limit = 20): Promise<LookupItem[]> {
  const spec = ENTITY_SPECS[type];
  const cols = tableColumns(await schemaInfo(db), spec.table);
  const ex = exprsFor(type, cols);
  const p = new Params();
  const lim = Math.min(Math.max(1, Math.trunc(limit) || 20), 100);
  const where = ['t.deleted_at IS NULL'];
  const term = q.trim();
  let order = `${ex.label}, t.id`;
  if (term) {
    where.push(searchCond(type, ex, term, p));
    const qv = p.add(term);
    order = `(t.id = ${qv} OR ${ex.label} = ${qv}) DESC, similarity(${ex.label}, ${qv}) DESC, ${ex.label}, t.id`;
  }
  const { rows } = await db.query<{ id: string; label: string | null; sublabel: string | null; status: string | null }>(
    `SELECT t.id, ${ex.label} AS label, ${sublabelExpr(type)} AS sublabel, ${ex.status} AS status
       FROM "${spec.table}" t ${ex.joins.join(' ')}
      WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${p.add(lim)}`,
    p.values,
  );
  return rows.map((r) => {
    let sub = r.sublabel && r.sublabel.length ? r.sublabel : null;
    if (type === 'plan' && sub && isCode('planStage', sub)) sub = codeLabel('planStage', sub);
    if (type === 'service' && sub && isCode('serviceKind', sub)) sub = codeLabel('serviceKind', sub);
    return { id: r.id, label: r.label ?? r.id, sublabel: sub, deleted: false };
  });
}

/** 여러 id 의 종류·라벨(참조 목록 표시용). 영구 삭제된 묘비는 라벨 없이 id 로 */
export async function entityLabels(
  db: Queryable,
  ids: string[],
): Promise<Map<string, { type: EntityType; label: string; deleted: boolean }>> {
  const out = new Map<string, { type: EntityType; label: string; deleted: boolean }>();
  const uniq = [...new Set(ids)];
  if (!uniq.length) return out;
  const { rows } = await db.query<{ id: string; type: EntityType }>(`SELECT id, type FROM entity WHERE id = ANY ($1)`, [
    uniq,
  ]);
  const byType = new Map<EntityType, string[]>();
  for (const r of rows) {
    byType.set(r.type, [...(byType.get(r.type) ?? []), r.id]);
    out.set(r.id, { type: r.type, label: r.id, deleted: true });
  }
  for (const [type, list] of byType) {
    const spec = ENTITY_SPECS[type];
    const cols = tableColumns(await schemaInfo(db), spec.table);
    const ex = exprsFor(type, cols);
    const res = await db.query<{ id: string; label: string | null; deleted_at: Date | null }>(
      `SELECT t.id, ${ex.label} AS label, t.deleted_at FROM "${spec.table}" t ${ex.joins.join(' ')} WHERE t.id = ANY ($1)`,
      [list],
    );
    for (const r of res.rows) out.set(r.id, { type, label: r.label ?? r.id, deleted: r.deleted_at != null });
  }
  return out;
}
