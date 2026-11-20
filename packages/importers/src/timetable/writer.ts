/**
 * 시간표 쓰기(기계적 데이터 쓰기 경로, Q98 A). 한 트랜잭션에서 범위(scope) 안의 기존 세트를 지우고 새 세트·행(ord = 세트 안 순서)을 넣는다.
 * 실패하면 ROLLBACK — 이전 세트가 그대로 남는다(docs/08 5절). 개체가 아니므로 도메인 적용기·감사 기록을 거치지 않고
 * 세트의 import_run_id 로 수집 실행(ingest.run)에 묶는다. 같은 입력으로 다시 실행하면 같은 결과(멱등).
 */
import type { TimetableSet } from '@k-raildex/contracts';
import type { Queryable } from '@k-raildex/domain';

/** 지울 범위의 한 조건. 주어진 항목끼리 AND, 조건 목록끼리 OR. 빈 객체 = 그 출처 전체 */
export interface ScopeKey {
  station_id?: string;
  route_code?: string;
  /** 이 문자열이 route_code 로 시작하는 세트(TAGO 역 ID MTRS14409 → 노선코드 MTRS14) */
  route_prefix_of?: string;
}

export interface ReplaceScope {
  source_id: string;
  keys: ScopeKey[];
}

export interface WriteStats {
  deleted_sets: number;
  inserted_sets: number;
  inserted_entries: number;
}

const SET_COLS = 12;
const ENTRY_COLS = 7;

async function deleteScope(db: Queryable, scope: ReplaceScope, ids: string[]): Promise<number> {
  let n = 0;
  if (scope.keys.length) {
    const r = await db.query(
      `DELETE FROM timetable_set t
        USING unnest($2::text[], $3::text[], $4::text[]) AS k(station_id, route_code, prefix_of)
        WHERE t.source_id = $1
          AND (k.station_id IS NULL OR t.station_id = k.station_id)
          AND (k.route_code IS NULL OR t.route_code = k.route_code)
          AND (k.prefix_of IS NULL OR starts_with(k.prefix_of, t.route_code))`,
      [
        scope.source_id,
        scope.keys.map((k) => k.station_id ?? null),
        scope.keys.map((k) => k.route_code ?? null),
        scope.keys.map((k) => k.route_prefix_of ?? null),
      ],
    );
    n += r.rowCount ?? 0;
  }
  // 같은 출처의 같은 id 가 범위 밖에 남아 있으면(역 매핑이 바뀐 경우 등) 함께 지운다. 다른 출처의 같은 id 는 INSERT 에서 오류
  if (ids.length) {
    const r = await db.query(`DELETE FROM timetable_set WHERE source_id = $1 AND id = ANY($2::text[])`, [
      scope.source_id,
      ids,
    ]);
    n += r.rowCount ?? 0;
  }
  return n;
}

async function insertSets(db: Queryable, sets: TimetableSet[], runId: number | null): Promise<void> {
  for (let i = 0; i < sets.length; i += 500) {
    const chunk = sets.slice(i, i + 500);
    const params: unknown[] = [];
    const values = chunk.map((s) => {
      params.push(
        s.id,
        s.station_id,
        s.line_station_id ?? null,
        s.service_id ?? null,
        s.route_code,
        s.day_type,
        s.direction,
        s.direction_label ?? null,
        s.day_note ?? null,
        s.data_as_of ?? null,
        s.source_id,
        runId ?? s.import_run_id ?? null,
      );
      const b = params.length - SET_COLS;
      return `(${Array.from({ length: SET_COLS }, (_, j) => `$${b + j + 1}`).join(', ')})`;
    });
    await db.query(
      `INSERT INTO timetable_set (id, station_id, line_station_id, service_id, route_code, day_type, direction,
         direction_label, day_note, data_as_of, source_id, import_run_id) VALUES ${values.join(', ')}`,
      params,
    );
  }
}

async function insertEntries(db: Queryable, sets: TimetableSet[]): Promise<number> {
  let params: unknown[] = [];
  let values: string[] = [];
  let total = 0;
  const flush = async () => {
    if (!values.length) return;
    await db.query(
      `INSERT INTO timetable_entry (set_id, ord, minute, dest_name, dest_station_id, train_no, note) VALUES ${values.join(', ')}`,
      params,
    );
    params = [];
    values = [];
  };
  for (const s of sets) {
    for (const [j, e] of s.entries.entries()) {
      params.push(
        s.id,
        j + 1,
        e.minute,
        e.dest_name ?? null,
        e.dest_station_id ?? null,
        e.train_no ?? '',
        e.note ?? null,
      );
      const b = params.length - ENTRY_COLS;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`);
      total++;
      if (values.length >= 5000) await flush();
    }
  }
  await flush();
  return total;
}

/** 트랜잭션 없이 범위 교체(바깥에서 트랜잭션을 연 경우 — 이관 도구의 한 트랜잭션 적재 등) */
export async function replaceTimetableSetsNoTx(
  db: Queryable,
  scope: ReplaceScope,
  sets: TimetableSet[],
  runId: number | null,
): Promise<WriteStats> {
  for (const s of sets)
    if (s.source_id !== scope.source_id)
      throw new Error(`세트 출처가 범위와 다름: ${s.id} ${s.source_id} ≠ ${scope.source_id}`);
  const deleted = await deleteScope(
    db,
    scope,
    sets.map((s) => s.id),
  );
  await insertSets(db, sets, runId);
  const entries = await insertEntries(db, sets);
  return { deleted_sets: deleted, inserted_sets: sets.length, inserted_entries: entries };
}

/** 범위 교체(한 트랜잭션). db 는 단일 연결(pg.Client·PoolClient)이어야 한다 */
export async function replaceTimetableSets(
  db: Queryable,
  scope: ReplaceScope,
  sets: TimetableSet[],
  runId: number | null,
): Promise<WriteStats> {
  await db.query('BEGIN');
  try {
    const r = await replaceTimetableSetsNoTx(db, scope, sets, runId);
    await db.query('COMMIT');
    return r;
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  }
}
