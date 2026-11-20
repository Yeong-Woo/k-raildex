/** 개체 읽기: DB 행 → 계약 Read 모양(packages/contracts) */
import { entityContracts, type EntityType } from '@k-raildex/contracts';
import type { z } from 'zod';
import type { Queryable } from './db';
import { DomainError } from './errors';
import { ENTITY_SPECS, readField, selectExprs, STOP_PATTERNS_FIELD, type ChildSpec } from './mapping';
import { schemaInfo, tableColumns } from './schema-info';

type AnyObject = Record<string, unknown>;

/** zod 스키마의 객체 필드 목록(기본값·nullable·배열 래퍼를 벗긴 뒤) */
export function objectKeys(schema: unknown): string[] {
  let s = schema as { _zod?: { def: AnyObject }; shape?: AnyObject };
  for (let i = 0; i < 8 && s; i++) {
    if (s.shape && typeof s.shape === 'object') return Object.keys(s.shape);
    const def = s._zod?.def as AnyObject | undefined;
    if (!def) break;
    s = (def.innerType ?? def.element ?? def.in ?? def.schema) as typeof s;
  }
  return [];
}

export function shapeOf(type: EntityType): AnyObject {
  const s = entityContracts[type].create as unknown as { shape: AnyObject };
  return s.shape;
}

/** 하위 객체 항목의 필드 목록 */
function childFields(type: EntityType, field: string): string[] {
  return objectKeys(shapeOf(type)[field]);
}

const META_READ = ['version', 'created_at', 'updated_at', 'deleted_at', 'last_changeset_id'];

export interface ReadOptions {
  includeDeleted?: boolean;
  /** SELECT … FOR UPDATE (적용기가 잠글 때) */
  forUpdate?: boolean;
}

/** 개체 하나를 계약 Read 모양으로. 없으면 null */
export async function readEntity(
  db: Queryable,
  type: EntityType,
  id: string,
  opts: ReadOptions = {},
): Promise<AnyObject | null> {
  const spec = ENTITY_SPECS[type];
  const info = await schemaInfo(db);
  const cols = tableColumns(info, spec.table);
  const childFieldSet = new Set([...spec.children.map((c) => c.field), STOP_PATTERNS_FIELD]);
  const scalarFields = Object.keys(shapeOf(type)).filter((f) => !childFieldSet.has(f));
  const extra = [...META_READ, ...(spec.curated ? ['reviewed_at'] : [])];
  const exprs = selectExprs([...scalarFields, ...extra], cols);
  const { rows } = await db.query(
    `SELECT ${exprs.join(', ')} FROM "${spec.table}" t WHERE t.id = $1${opts.includeDeleted ? '' : ' AND t.deleted_at IS NULL'}${opts.forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  const row = rows[0] as AnyObject | undefined;
  if (!row) return null;
  const out: AnyObject = {};
  for (const f of [...scalarFields, ...extra]) out[f] = readField(f, row, cols);
  for (const child of spec.children) {
    if (!(child.field in shapeOf(type))) continue;
    out[child.field] = await readChild(db, type, child, id);
  }
  if (type === 'service') out[STOP_PATTERNS_FIELD] = await readStopPatterns(db, id);
  return out;
}

export async function requireEntity(
  db: Queryable,
  type: EntityType,
  id: string,
  opts: ReadOptions = {},
): Promise<AnyObject> {
  const e = await readEntity(db, type, id, opts);
  if (!e) throw new DomainError('not_found', `${type} ${id} 가 없음`);
  return e;
}

async function readChild(db: Queryable, type: EntityType, child: ChildSpec, id: string): Promise<unknown> {
  const info = await schemaInfo(db);
  const cols = tableColumns(info, child.table);
  const order = child.orderColumn ? `"${child.orderColumn}"` : (child.orderBy ?? '1');
  if (child.kind === 'values') {
    const { rows } = await db.query(
      `SELECT "${child.valueColumn}" AS v FROM "${child.table}" WHERE "${child.fk}" = $1 ORDER BY ${order}`,
      [id],
    );
    return rows.map((r) => (r as AnyObject).v);
  }
  const fields = childFields(type, child.field);
  const exprs = selectExprs(fields, cols);
  const { rows } = await db.query(
    `SELECT ${exprs.join(', ')} FROM "${child.table}" t WHERE t."${child.fk}" = $1 ORDER BY ${order}`,
    [id],
  );
  const items = rows.map((r) => {
    const o: AnyObject = {};
    for (const f of fields) o[f] = readField(f, r as AnyObject, cols);
    return o;
  });
  return child.kind === 'single' ? (items[0] ?? null) : items;
}

async function readStopPatterns(db: Queryable, serviceId: string): Promise<AnyObject[]> {
  const { rows } = await db.query<{
    id: number;
    code: string;
    name_ko: string;
    name_en: string | null;
    type: string;
    note: string | null;
  }>(`SELECT id, code, name_ko, name_en, type, note FROM stop_pattern WHERE service_id = $1 ORDER BY seq`, [serviceId]);
  const out: AnyObject[] = [];
  for (const p of rows) {
    const stops = await db.query<{ line_station_id: string }>(
      `SELECT line_station_id FROM stop_pattern_stop WHERE pattern_id = $1 ORDER BY seq`,
      [p.id],
    );
    out.push({
      code: p.code,
      name_ko: p.name_ko,
      name_en: p.name_en,
      type: p.type,
      note: p.note,
      stops: stops.rows.map((s) => s.line_station_id),
    });
  }
  return out;
}

/** 계약 Read 를 Create 입력 모양으로(메타 제거) — 수정 병합·되돌리기에 쓴다 */
export function toCreateShape(type: EntityType, read: AnyObject): AnyObject {
  const keys = new Set(Object.keys(shapeOf(type)));
  const out: AnyObject = {};
  for (const [k, v] of Object.entries(read)) if (keys.has(k)) out[k] = v;
  return out;
}

export type ReadOf<T extends EntityType> = z.infer<(typeof entityContracts)[T]['read']>;
