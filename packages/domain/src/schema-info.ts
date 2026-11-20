/** DB 열 정보(information_schema) — 대응표가 열 종류를 자동 판별하는 데 쓴다. 연결마다 한 번 읽어 캐시 */
import type { Queryable } from './db';

export interface ColumnInfo {
  name: string;
  dataType: string; // information_schema.columns.data_type
  udt: string; // udt_name (geography, geometry, _text, _int8, _numeric …)
  generated: boolean;
}

export type SchemaInfo = Map<string, Map<string, ColumnInfo>>; // "schema.table" → 열

const cache = new WeakMap<object, Promise<SchemaInfo>>();

export function schemaInfo(db: Queryable): Promise<SchemaInfo> {
  const key = db as object;
  let p = cache.get(key);
  if (!p) {
    p = load(db);
    cache.set(key, p);
  }
  return p;
}

async function load(db: Queryable): Promise<SchemaInfo> {
  const { rows } = await db.query<{
    table_schema: string;
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
    is_generated: string;
  }>(
    `SELECT table_schema, table_name, column_name, data_type, udt_name, is_generated
       FROM information_schema.columns WHERE table_schema IN ('public', 'ingest', 'osm')`,
  );
  const out: SchemaInfo = new Map();
  for (const r of rows) {
    const key = `${r.table_schema}.${r.table_name}`;
    let t = out.get(key);
    if (!t) out.set(key, (t = new Map()));
    t.set(r.column_name, {
      name: r.column_name,
      dataType: r.data_type,
      udt: r.udt_name,
      generated: r.is_generated === 'ALWAYS',
    });
  }
  return out;
}

export function tableColumns(info: SchemaInfo, table: string): Map<string, ColumnInfo> {
  const t = info.get(table.includes('.') ? table : `public.${table}`);
  if (!t) throw new Error(`테이블 정보 없음: ${table}`);
  return t;
}
