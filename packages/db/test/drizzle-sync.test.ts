/**
 * Drizzle 테이블 정의 ↔ 실제 DB(sql/*.sql 적용 결과) 동기화 검사.
 * 기본 테이블(BASE TABLE)만 비교한다 — 뷰·구체화 뷰는 Drizzle 에 정의하지 않는다.
 */
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import type pg from 'pg';
import { eq, is, type SQL } from 'drizzle-orm';
import { PgDialect, PgTable, getTableConfig, type PgColumn } from 'drizzle-orm/pg-core';
import { createDb } from '../src/client';
import * as schema from '../src/schema';
import { freshDb } from './db';

/** 비교 대상에서 빼는 기본 테이블(내부 관리용·PostGIS) */
const EXCLUDED = new Set(['public.schema_migration', 'public.entity_table', 'public.spatial_ref_sys']);

let client: pg.Client;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ client, close } = await freshDb());
});
afterAll(async () => close());

const dialect = new PgDialect();
const tables = Object.values(schema as Record<string, unknown>).filter((v): v is PgTable => is(v, PgTable));
const qname = (s: string | undefined, t: string) => `${s ?? 'public'}.${t}`;
const normType = (t: string) => t.toLowerCase().replace(/\s+/g, '');
const normExpr = (e: string) => e.toLowerCase().replace(/\s+/g, '');
const ACTIONS: Record<string, string> = {
  a: 'no action',
  r: 'restrict',
  c: 'cascade',
  n: 'set null',
  d: 'set default',
};

interface ColInfo {
  type: string;
  notNull: boolean;
  default: boolean;
  identity: boolean;
  generated: string | null;
}

function describeCol(c: ColInfo): string {
  return [
    c.type,
    c.notNull ? 'not null' : 'null',
    c.default ? 'default' : '',
    c.identity ? 'identity' : '',
    c.generated ? `generated(${c.generated})` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function drizzleCol(col: PgColumn): ColInfo {
  return {
    type: normType(col.getSQLType()),
    notNull: col.notNull,
    default: col.default !== undefined,
    identity: col.generatedIdentity?.type === 'always',
    generated: col.generated
      ? normExpr(
          dialect.sqlToQuery(
            typeof col.generated.as === 'function' ? (col.generated.as as () => SQL)() : (col.generated.as as SQL),
          ).sql,
        )
      : null,
  };
}

async function dbColumns(): Promise<Map<string, Map<string, ColInfo>>> {
  const { rows } = await client.query<{
    tbl: string;
    col: string;
    type: string;
    is_nullable: string;
    column_default: string | null;
    is_identity: string;
    is_generated: string;
    generation_expression: string | null;
  }>(
    `SELECT c.table_schema || '.' || c.table_name AS tbl, c.column_name AS col,
            format_type(a.atttypid, a.atttypmod) AS type,
            c.is_nullable, c.column_default, c.is_identity, c.is_generated, c.generation_expression
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
       JOIN pg_attribute a
         ON a.attrelid = (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass
        AND a.attname = c.column_name
      WHERE c.table_schema IN ('public', 'osm', 'ingest')`,
  );
  const out = new Map<string, Map<string, ColInfo>>();
  for (const r of rows) {
    if (EXCLUDED.has(r.tbl)) continue;
    if (!out.has(r.tbl)) out.set(r.tbl, new Map());
    out.get(r.tbl)!.set(r.col, {
      type: normType(r.type),
      notNull: r.is_nullable === 'NO',
      default: r.column_default !== null,
      identity: r.is_identity === 'YES',
      generated: r.is_generated === 'ALWAYS' ? normExpr(r.generation_expression ?? '') : null,
    });
  }
  return out;
}

describe('Drizzle 스키마 ↔ DB 동기화', () => {
  it('테이블 집합이 같다', async () => {
    const db = await dbColumns();
    const dz = tables.map((t) => {
      const c = getTableConfig(t);
      return qname(c.schema, c.name);
    });
    expect(new Set(dz).size, '중복 테이블 정의').toBe(dz.length);
    const missingInDrizzle = [...db.keys()].filter((k) => !dz.includes(k)).sort();
    const missingInDb = dz.filter((k) => !db.has(k)).sort();
    expect({ missingInDrizzle, missingInDb }).toEqual({ missingInDrizzle: [], missingInDb: [] });
  });

  it('열 이름·형식·NULL 여부·기본값·identity·생성 열이 같다', async () => {
    const db = await dbColumns();
    const diffs: string[] = [];
    let compared = 0;
    for (const t of tables) {
      const cfg = getTableConfig(t);
      const name = qname(cfg.schema, cfg.name);
      const dbCols = db.get(name);
      if (!dbCols) continue; // 테이블 집합 시험에서 보고
      const pkCols = new Set(cfg.primaryKeys.flatMap((pk) => pk.columns.map((c) => c.name)));
      const seen = new Set<string>();
      for (const col of cfg.columns) {
        seen.add(col.name);
        const actual = dbCols.get(col.name);
        if (!actual) {
          diffs.push(`${name}.${col.name}: DB 에 없음`);
          continue;
        }
        const expected = drizzleCol(col);
        if (pkCols.has(col.name)) expected.notNull = true;
        compared++;
        const a = describeCol(actual);
        const e = describeCol(expected);
        if (a !== e) diffs.push(`${name}.${col.name}: DB [${a}] ≠ Drizzle [${e}]`);
      }
      for (const c of dbCols.keys()) if (!seen.has(c)) diffs.push(`${name}.${c}: Drizzle 에 없음`);
    }
    expect(diffs).toEqual([]);
    expect(compared).toBeGreaterThan(500);
  });

  it('기본 키가 같다', async () => {
    const { rows } = await client.query<{ tbl: string; cols: string[] }>(
      `SELECT n.nspname || '.' || r.relname AS tbl,
              array_agg(a.attname::text ORDER BY a.attname) AS cols
         FROM pg_constraint c
         JOIN pg_class r ON r.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = r.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'p' AND n.nspname IN ('public', 'osm', 'ingest')
        GROUP BY 1`,
    );
    const db = new Map(rows.filter((r) => !EXCLUDED.has(r.tbl)).map((r) => [r.tbl, r.cols.join(',')]));
    const diffs: string[] = [];
    for (const t of tables) {
      const cfg = getTableConfig(t);
      const name = qname(cfg.schema, cfg.name);
      const cols = [
        ...cfg.columns.filter((c) => c.primary).map((c) => c.name),
        ...cfg.primaryKeys.flatMap((pk) => pk.columns.map((c) => c.name)),
      ]
        .sort()
        .join(',');
      if (db.get(name) !== cols) diffs.push(`${name}: DB (${db.get(name)}) ≠ Drizzle (${cols})`);
    }
    expect(diffs).toEqual([]);
  });

  it('외래 키(대상·ON UPDATE·ON DELETE)가 같다', async () => {
    const { rows } = await client.query<{ fk: string }>(
      `SELECT format('%s.%s(%s)->%s.%s(%s) upd=%s del=%s',
                     n.nspname, r.relname,
                     (SELECT string_agg(attname, ',' ORDER BY k.i) FROM unnest(c.conkey) WITH ORDINALITY k(n, i)
                        JOIN pg_attribute ON attrelid = c.conrelid AND attnum = k.n),
                     fn.nspname, fr.relname,
                     (SELECT string_agg(attname, ',' ORDER BY k.i) FROM unnest(c.confkey) WITH ORDINALITY k(n, i)
                        JOIN pg_attribute ON attrelid = c.confrelid AND attnum = k.n),
                     c.confupdtype, c.confdeltype) AS fk
         FROM pg_constraint c
         JOIN pg_class r ON r.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = r.relnamespace
         JOIN pg_class fr ON fr.oid = c.confrelid
         JOIN pg_namespace fn ON fn.oid = fr.relnamespace
        WHERE c.contype = 'f' AND n.nspname IN ('public', 'osm', 'ingest')`,
    );
    const db = rows
      .map((r) =>
        r.fk.replace(/upd=(\w) del=(\w)$/, (_m, u: string, d: string) => `upd=${ACTIONS[u]} del=${ACTIONS[d]}`),
      )
      .filter((fk) => !EXCLUDED.has(fk.slice(0, fk.indexOf('('))))
      .sort();
    const dz: string[] = [];
    for (const t of tables) {
      const cfg = getTableConfig(t);
      for (const fk of cfg.foreignKeys) {
        const ref = fk.reference();
        const ft = getTableConfig(ref.foreignTable);
        dz.push(
          `${qname(cfg.schema, cfg.name)}(${ref.columns.map((c) => c.name).join(',')})->` +
            `${qname(ft.schema, ft.name)}(${ref.foreignColumns.map((c) => c.name).join(',')}) ` +
            `upd=${fk.onUpdate ?? 'no action'} del=${fk.onDelete ?? 'no action'}`,
        );
      }
    }
    dz.sort();
    const onlyDb = db.filter((x) => !dz.includes(x));
    const onlyDrizzle = dz.filter((x) => !db.includes(x));
    expect({ onlyDb, onlyDrizzle }).toEqual({ onlyDb: [], onlyDrizzle: [] });
    expect(db.length).toBeGreaterThan(100);
  });
});

describe('사용자 정의 형식', () => {
  it('geographyPoint 는 { lat, lng } 로 읽고 쓴다', async () => {
    const db = createDb(client);
    // 레코드 출처 요구는 커밋 시점 검사 — 트랜잭션 안에서 확인하고 롤백한다
    await client.query('BEGIN');
    try {
      await db.insert(schema.entity).values({ id: 'stn-drizzle-a', type: 'station' });
      await db.insert(schema.station).values({
        id: 'stn-drizzle-a',
        nameKo: '드리즐',
        geom: { lat: 37.5547, lng: 126.9707 },
        coordSource: 'manual',
        checkedAt: '2026-11-20',
        ownOpenedValue: '1900-07',
        ownOpenedPrecision: 'month',
      });
      const [row] = await db
        .select({
          geom: schema.station.geom,
          lat: schema.latOf(schema.station.geom),
          from: schema.station.ownOpenedFrom,
          to: schema.station.ownOpenedTo,
          extra: schema.station.extra,
        })
        .from(schema.station)
        .where(eq(schema.station.id, 'stn-drizzle-a'));
      expect(row?.geom).toEqual({ lat: 37.5547, lng: 126.9707 });
      expect(Number(row?.lat)).toBeCloseTo(37.5547, 6);
      expect(row?.from).toBe('1900-07-01');
      expect(row?.to).toBe('1900-07-31');
      expect(row?.extra).toEqual({});
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('추론 형식', () => {
    expectTypeOf<typeof schema.line.$inferSelect.openedFrom>().toEqualTypeOf<string | null>();
    expectTypeOf<typeof schema.plan.$inferSelect.nameKo>().toEqualTypeOf<string>();
    expectTypeOf<typeof schema.station.$inferSelect.nameHanja>().toEqualTypeOf<string | null>();
    expectTypeOf<typeof schema.planMilestone.$inferSelect.expectedPrecision>().toEqualTypeOf<string>();
    expectTypeOf<typeof schema.line.$inferSelect.lengthKm>().toEqualTypeOf<number | null>();
  });
});
