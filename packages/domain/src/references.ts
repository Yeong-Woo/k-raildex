/**
 * 개체를 가리키는 행 찾기 — 삭제 거부(V-H12)·[참조됨] 탭·영구 삭제 전 검사.
 * DB 외래 키 목록에서 이 개체(또는 entity 레지스트리)를 가리키는 열을 모두 찾고, 참조하는 행의 "소유 개체"를 판별한다.
 */
import type { EntityType } from '@k-raildex/contracts';
import type { Queryable } from './db';
import type { Reference } from './errors';
import { ENTITY_SPECS } from './mapping';

interface FkRef {
  schema: string;
  table: string;
  column: string;
}

/** 참조하는 행의 소유 개체 id 를 내는 SQL 식(r = 참조 테이블 별칭). null 이면 소유자 없음(항상 활성) */
function ownerExpr(table: string, column: string, targetTable: string): { expr: string | null; join?: string } {
  // 노선의 정거장은 노선의 하위로 본다(노선 삭제 시 함께 휴지통으로 — 0012 트리거)
  if (targetTable === 'line' && table === 'line_station' && column === 'line_id') return { expr: 'r.line_id' };
  const entityTable = Object.values(ENTITY_SPECS).find((s) => s.table === table);
  if (entityTable) return { expr: 'r.id' };
  for (const s of Object.values(ENTITY_SPECS)) {
    for (const c of s.children) {
      if (c.table === table) return { expr: `r."${c.fk}"` };
    }
  }
  switch (table) {
    case 'stop_pattern':
      return { expr: 'r.service_id' };
    case 'stop_pattern_stop':
      return { expr: 'sp.service_id', join: 'JOIN stop_pattern sp ON sp.id = r.pattern_id' };
    case 'entity_attachment':
    case 'event_target':
      return { expr: table === 'event_target' ? 'r.event_id' : 'r.entity_id' };
    default:
      void column;
      return { expr: null };
  }
}

/** 참조 검사에서 제외하는 열(리다이렉트·수집 설정 등 — 개체 삭제를 막지 않는다) */
const IGNORED = new Set(['public.id_redirect.new_id', 'ingest.watch.entity_id', 'ingest.match_rule.entity_id']);

async function fksTo(db: Queryable, table: string): Promise<FkRef[]> {
  const { rows } = await db.query<{ sch: string; tbl: string; col: string }>(
    `SELECT ns.nspname AS sch, cl.relname AS tbl, a.attname AS col
       FROM pg_constraint c
       JOIN pg_class cl ON cl.oid = c.conrelid
       JOIN pg_namespace ns ON ns.oid = cl.relnamespace
       JOIN pg_class tc ON tc.oid = c.confrelid
       JOIN pg_namespace tns ON tns.oid = tc.relnamespace AND tns.nspname = 'public'
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1 AND tc.relname IN ($1, 'entity')`,
    [table],
  );
  return rows
    .map((r) => ({ schema: r.sch, table: r.tbl, column: r.col }))
    .filter((r) => r.column !== 'id') // 개체 테이블의 PK(→ entity) 는 참조가 아니다
    .filter((r) => !IGNORED.has(`${r.schema}.${r.table}.${r.column}`));
}

/**
 * id 를 가리키는 행. activeOnly 면 소유 개체가 삭제되지 않은 것만, 자기 자신의 하위 행은 제외.
 */
export async function findReferences(
  db: Queryable,
  type: EntityType,
  id: string,
  opts: { activeOnly?: boolean } = { activeOnly: true },
): Promise<Reference[]> {
  const spec = ENTITY_SPECS[type];
  const out: Reference[] = [];
  for (const fk of await fksTo(db, spec.table)) {
    const own = ownerExpr(fk.table, fk.column, spec.table);
    const qualified = `"${fk.schema}"."${fk.table}"`;
    if (own.expr) {
      const activeCond = opts.activeOnly ? 'AND e.deleted_at IS NULL' : '';
      const { rows } = await db.query<{ owner_id: string; n: number }>(
        `SELECT ${own.expr} AS owner_id, count(*)::int AS n
           FROM ${qualified} r ${own.join ?? ''}
           JOIN entity e ON e.id = ${own.expr}
          WHERE r."${fk.column}" = $1 AND ${own.expr} <> $1 ${activeCond}
          GROUP BY 1`,
        [id],
      );
      for (const r of rows) out.push({ table: fk.table, column: fk.column, owner_id: r.owner_id, count: r.n });
    } else {
      const { rows } = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${qualified} r WHERE r."${fk.column}" = $1`,
        [id],
      );
      if (rows[0] && rows[0].n > 0) out.push({ table: fk.table, column: fk.column, owner_id: null, count: rows[0].n });
    }
  }
  return out;
}
