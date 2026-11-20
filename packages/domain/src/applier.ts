/**
 * 변경 묶음 적용기 — 모든 쓰기의 단일 경로(CLAUDE.md 4절, docs/04-api.md 7절).
 * 한 트랜잭션: 변경 묶음 기록 → op 실행(전/후 스냅샷) → Hard 검증 → change_op·data_version → COMMIT(지연 제약 V-H01).
 */
import { randomBytes } from 'node:crypto';
import { entityContracts, entityTypeOfId, isEntityId, type Code, type EntityType } from '@k-raildex/contracts';
import { z } from 'zod';
import type { Queryable } from './db';
import { DomainError, type Violation } from './errors';
import { ENTITY_SPECS, STOP_PATTERNS_FIELD, writeField, type ChildSpec } from './mapping';
import { findReferences } from './references';
import { readEntity, requireEntity, shapeOf, toCreateShape } from './repo';
import { schemaInfo, tableColumns } from './schema-info';
import { runHardRules } from './validation';

type AnyObject = Record<string, unknown>;

export type Op =
  | { op: 'create'; entity_type: EntityType; data: unknown }
  | { op: 'update'; entity_type: EntityType; id: string; data: unknown; expected_version?: number }
  | { op: 'delete'; entity_type: EntityType; id: string; reason?: string; expected_version?: number }
  | { op: 'restore'; entity_type: EntityType; id: string }
  | { op: 'purge'; entity_type: EntityType; id: string }
  | {
      op: 'rename_id';
      entity_type: EntityType;
      id: string;
      new_id: string;
      reason?: string;
      /** 되돌리기 전용: 리다이렉트로 예약된 옛 id(new_id)를 되찾는다 */
      reclaim?: boolean;
    }
  | { op: 'merge_station'; entity_type: 'station'; id: string; into_id: string; reason?: string };

export interface ChangesetInput {
  /** 없으면 cs-YYYY-MM-DD-<임의> */
  id?: string;
  title: string;
  rationale?: string;
  origin: Code<'changesetOrigin'>;
  author_id: string;
  ops: Op[];
  meta?: AnyObject;
  body?: unknown;
  /** origin revert: 되돌리는 변경 묶음 */
  reverts_changeset_id?: string;
  /** draft 제출 시점의 data_version(없으면 현재 최댓값) — 승인 때 충돌 검사 기준 */
  base_data_version?: number | null;
}

export interface ApproveOptions {
  comment?: string;
  /** 일부만 승인(op seq). 나머지는 새 draft 로(meta.split_from = 원래 id) */
  op_seqs?: number[];
  /** base_data_version 이후 변경 충돌 검사를 건너뛴다 */
  force?: boolean;
}

export interface ApproveResult extends ApplyResult {
  /** 일부 승인 때 나머지 op 로 만든 새 draft */
  remainder_changeset_id: string | null;
}

export interface OpResult {
  seq: number;
  op: Op['op'];
  entity_type: EntityType;
  entity_id: string;
  before: AnyObject | null;
  after: AnyObject | null;
  changed: boolean;
}

export interface ApplyResult {
  changeset_id: string;
  data_version: number | null;
  results: OpResult[];
}

export function newChangesetId(slug?: string): string {
  const d = new Date().toISOString().slice(0, 10);
  return `cs-${d}-${slug ?? randomBytes(4).toString('hex')}`;
}

// ---------------------------------------------------------------------------
// 공개 함수
// ---------------------------------------------------------------------------

/** 즉시 반영(관리자 편집·이관·기계적 갱신). dryRun 이면 결과만 보고 되돌린다 */
export async function applyChangeset(
  db: Queryable,
  input: ChangesetInput,
  opts: { dryRun?: boolean } = {},
): Promise<ApplyResult> {
  const id = input.id ?? newChangesetId();
  await db.query('BEGIN');
  try {
    await db.query(
      `INSERT INTO changeset (id, title, rationale, origin, status, author_id, body, meta, reverts_changeset_id)
       VALUES ($1, $2, $3, $4, 'applying', $5, $6, $7, $8)`,
      [
        id,
        input.title,
        input.rationale ?? null,
        input.origin,
        input.author_id,
        input.body === undefined ? null : JSON.stringify(input.body),
        input.meta ?? {},
        input.reverts_changeset_id ?? null,
      ],
    );
    const result = await executeOps(db, id, input.author_id, input.ops);
    await db.query(`UPDATE changeset SET status = 'applied', applied_at = now() WHERE id = $1`, [id]);
    if (opts.dryRun) {
      await db.query('ROLLBACK');
      return { ...result, data_version: null };
    }
    await commit(db);
    return result;
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

/** 검수 대기(draft)로 제출 — 수집기·에이전트·여러 건 입력. 형식만 검사하고 반영하지 않는다 */
export async function submitDraft(db: Queryable, input: ChangesetInput): Promise<string> {
  const id = input.id ?? newChangesetId();
  const violations = input.ops.flatMap((op, i) => checkOpShape(op, i));
  if (violations.length) throw new DomainError('validation', '제안 형식 오류', { violations });
  await db.query('BEGIN');
  try {
    // 제출 시점의 data_version — 승인 때 그 뒤에 같은 개체가 바뀌었는지 본다
    await db.query(
      `INSERT INTO changeset (id, title, rationale, origin, status, author_id, body, meta, base_data_version)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7,
               coalesce($8::bigint, (SELECT coalesce(max(version), 0) FROM data_version)))`,
      [
        id,
        input.title,
        input.rationale ?? null,
        input.origin,
        input.author_id,
        input.body === undefined ? null : JSON.stringify(input.body),
        input.meta ?? {},
        input.base_data_version ?? null,
      ],
    );
    for (const [i, op] of input.ops.entries()) {
      await db.query(
        `INSERT INTO change_op (changeset_id, seq, op, entity_type, entity_id, payload) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, i + 1, op.op, op.entity_type, opTargetId(op), JSON.stringify(op)],
      );
    }
    await db.query('COMMIT');
    return id;
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

/**
 * draft 승인 = 반영. 실패하면 changeset 은 failed(오류 기록), 원천은 그대로.
 * - base_data_version 이후 대상 개체가 다른 변경 묶음으로 바뀌었으면 409(version_conflict, draft 유지). force 면 건너뛴다.
 * - op_seqs: 그 op 만 승인하고 나머지는 새 draft(meta.split_from)로 옮긴다(근거 change_evidence 도 함께). 원래 묶음은 applied.
 */
export async function approveDraft(
  db: Queryable,
  changesetId: string,
  reviewerId: string,
  commentOrOpts: string | ApproveOptions = {},
): Promise<ApproveResult> {
  const opts: ApproveOptions = typeof commentOrOpts === 'string' ? { comment: commentOrOpts } : commentOrOpts;
  const { rows } = await db.query<{
    status: string;
    title: string;
    rationale: string | null;
    origin: string;
    author_id: string;
    base_data_version: string | null;
    meta: AnyObject;
  }>(`SELECT status, title, rationale, origin, author_id, base_data_version, meta FROM changeset WHERE id = $1`, [
    changesetId,
  ]);
  const cs = rows[0];
  if (!cs) throw new DomainError('not_found', `변경 묶음 ${changesetId} 가 없음`);
  if (cs.status !== 'draft') throw new DomainError('invalid_state', `검수 대기가 아님(${cs.status})`);
  const opsRes = await db.query<{ seq: number; payload: Op }>(
    `SELECT seq, payload FROM change_op WHERE changeset_id = $1 ORDER BY seq`,
    [changesetId],
  );
  const all = opsRes.rows;
  let selected = all;
  let rest: typeof all = [];
  if (opts.op_seqs) {
    const want = new Set(opts.op_seqs);
    const known = new Set(all.map((o) => o.seq));
    const bad = [...want].filter((s) => !known.has(s));
    if (!want.size || bad.length || want.size !== opts.op_seqs.length)
      throw new DomainError('validation', 'op_seqs 오류', {
        violations: [
          {
            rule: 'schema',
            path: 'op_seqs',
            message: bad.length ? `없는 seq: ${bad.join(', ')}` : '비었거나 중복된 seq',
          },
        ],
      });
    selected = all.filter((o) => want.has(o.seq));
    rest = all.filter((o) => !want.has(o.seq));
  }
  const ops = selected.map((r) => r.payload);
  if (!opts.force && cs.base_data_version != null) await checkBaseConflicts(db, Number(cs.base_data_version), ops);
  await db.query('BEGIN');
  try {
    await db.query(`UPDATE changeset SET status = 'applying' WHERE id = $1`, [changesetId]);
    let remainderId: string | null = null;
    if (rest.length) {
      remainderId = newChangesetId();
      await db.query(
        `INSERT INTO changeset (id, title, rationale, origin, status, author_id, body, meta, base_data_version)
         VALUES ($1, $2, $3, $4, 'draft', $5, NULL, $6, $7)`,
        [
          remainderId,
          `${cs.title} (나머지)`,
          cs.rationale,
          cs.origin,
          cs.author_id,
          { ...(cs.meta ?? {}), split_from: changesetId, split_seqs: rest.map((o) => o.seq) },
          cs.base_data_version,
        ],
      );
      for (const [i, o] of rest.entries()) {
        await db.query(
          `INSERT INTO change_op (changeset_id, seq, op, entity_type, entity_id, payload) VALUES ($1, $2, $3, $4, $5, $6)`,
          [remainderId, i + 1, o.payload.op, o.payload.entity_type, opTargetId(o.payload), JSON.stringify(o.payload)],
        );
      }
      // 근거: 나머지 op 의 것은 새 draft 로, 승인 op 의 것은 새 seq 로
      await db.query(
        `UPDATE change_evidence e SET changeset_id = $2, op_seq = m.n
           FROM unnest($3::int[], $4::int[]) AS m(o, n) WHERE e.changeset_id = $1 AND e.op_seq = m.o`,
        [changesetId, remainderId, rest.map((o) => o.seq), rest.map((_, i) => i + 1)],
      );
      await db.query(
        `UPDATE change_evidence e SET op_seq = m.n
           FROM unnest($2::int[], $3::int[]) AS m(o, n) WHERE e.changeset_id = $1 AND e.op_seq = m.o`,
        [changesetId, selected.map((o) => o.seq), selected.map((_, i) => i + 1)],
      );
      await db.query(
        `UPDATE changeset SET meta = meta || jsonb_build_object('approved_seqs', $2::jsonb, 'remainder_changeset_id', $3::text)
          WHERE id = $1`,
        [changesetId, JSON.stringify(selected.map((o) => o.seq)), remainderId],
      );
    }
    await db.query(`DELETE FROM change_op WHERE changeset_id = $1`, [changesetId]);
    const result = await executeOps(db, changesetId, reviewerId, ops);
    await db.query(
      `UPDATE changeset SET status = 'applied', applied_at = now(), reviewed_at = now(), review_comment = $2 WHERE id = $1`,
      [changesetId, opts.comment ?? null],
    );
    await commit(db);
    return { ...result, remainder_changeset_id: remainderId };
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    const message = e instanceof Error ? e.message : String(e);
    const details = e instanceof DomainError ? e.details : undefined;
    await db.query(`UPDATE changeset SET status = 'failed', error = $2, reviewed_at = now() WHERE id = $1`, [
      changesetId,
      details?.violations
        ? `${message}\n${details.violations.map((v) => `${v.rule} ${v.entity_id ?? ''} ${v.path}: ${v.message}`).join('\n')}`
        : message,
    ]);
    throw e;
  }
}

/** draft 의 대상 개체가 base_data_version 이후에 바뀌었으면 409 */
async function checkBaseConflicts(db: Queryable, base: number, ops: Op[]): Promise<void> {
  const targets = new Set<string>();
  for (const op of ops) {
    const id = opTargetId(op);
    if (id) targets.add(id);
    if (op.op === 'merge_station') targets.add(op.into_id);
  }
  if (!targets.size) return;
  const { rows } = await db.query<{ version: string; changeset_id: string | null; ids: string[] }>(
    `SELECT version, changeset_id, ARRAY(SELECT unnest(entity_ids) INTERSECT SELECT unnest($2::text[])) AS ids
       FROM data_version WHERE version > $1 AND entity_ids && $2::text[] ORDER BY version`,
    [base, [...targets]],
  );
  if (!rows.length) return;
  throw new DomainError(
    'version_conflict',
    `제출(data_version ${base}) 뒤에 대상 개체가 바뀜 — 다시 검토하거나 force`,
    {
      violations: rows.flatMap((r) =>
        r.ids.map((id) => ({
          rule: 'base_data_version',
          path: '',
          entity_id: id,
          message: `data_version ${r.version}(${r.changeset_id ?? '?'})에서 바뀜`,
        })),
      ),
    },
  );
}

export async function rejectDraft(db: Queryable, changesetId: string, comment: string): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE changeset SET status = 'rejected', reviewed_at = now(), review_comment = $2 WHERE id = $1 AND status = 'draft'`,
    [changesetId, comment],
  );
  if (!rowCount) throw new DomainError('invalid_state', `검수 대기 변경 묶음 ${changesetId} 가 없음`);
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

async function commit(db: Queryable): Promise<void> {
  try {
    await db.query('COMMIT');
  } catch (e) {
    const msg = (e as Error).message;
    // 지연 제약 트리거(V-H01 출처 필수)는 COMMIT 시점에 실패한다
    const m = /^(V-H\d+): (\S+)/.exec(msg);
    throw new DomainError('validation', '검증 실패', {
      violations: [{ rule: m?.[1] ?? 'db', path: '', entity_id: m?.[2], message: msg }],
    });
  }
}

function opTargetId(op: Op): string {
  if (op.op === 'create') return String((op.data as AnyObject | null)?.id ?? '');
  return op.id;
}

function zodViolations(err: z.ZodError, prefix = ''): Violation[] {
  return err.issues.map((i) => ({ rule: 'schema', path: prefix + i.path.join('.'), message: i.message }));
}

function checkOpShape(op: Op, i: number): Violation[] {
  const at = `ops.${i}.`;
  if (!(op.entity_type in entityContracts))
    return [{ rule: 'schema', path: `${at}entity_type`, message: '알 수 없는 개체 종류' }];
  const c = entityContracts[op.entity_type];
  if (op.op === 'create') {
    const r = c.create.safeParse(op.data);
    return r.success ? [] : zodViolations(r.error, `${at}data.`);
  }
  if (op.op === 'update') {
    const r = c.update.safeParse(op.data);
    return r.success ? [] : zodViolations(r.error, `${at}data.`);
  }
  return [];
}

async function executeOps(
  db: Queryable,
  changesetId: string,
  authorId: string,
  ops: Op[],
): Promise<Omit<ApplyResult, 'data_version'> & { data_version: number | null }> {
  const results: OpResult[] = [];
  const affected = new Set<string>();
  const ctx: Ctx = { db, changesetId, authorId, affected };
  for (const [i, op] of ops.entries()) {
    let r: Omit<OpResult, 'seq' | 'op'>;
    try {
      r = await runOp(ctx, op);
    } catch (e) {
      if (e instanceof z.ZodError)
        throw new DomainError('validation', `ops.${i}: 형식 오류`, { violations: zodViolations(e, `ops.${i}.`) });
      if (e instanceof DomainError) {
        (e as Error).message = `ops.${i}: ${e.message}`;
        throw e;
      }
      const pg = e as { code?: string; message: string; constraint?: string };
      if (pg.code && /^2[23]/.test(pg.code)) {
        // DB 제약 위반(CHECK·FK·UNIQUE 등)
        throw new DomainError('validation', `ops.${i}: DB 제약 위반`, {
          violations: [{ rule: pg.constraint ?? 'db', path: '', entity_id: opTargetId(op), message: pg.message }],
        });
      }
      throw e;
    }
    results.push({ seq: i + 1, op: op.op, ...r });
    affected.add(r.entity_id);
  }
  const violations = await runHardRules(db, [...affected]);
  if (violations.length) throw new DomainError('validation', 'Hard 검증 위반', { violations });
  for (const r of results) {
    await db.query(
      `INSERT INTO change_op (changeset_id, seq, op, entity_type, entity_id, payload, before, after)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        changesetId,
        r.seq,
        r.op,
        r.entity_type,
        r.entity_id,
        JSON.stringify(ops[r.seq - 1]),
        r.before && JSON.stringify(r.before),
        r.after && JSON.stringify(r.after),
      ],
    );
  }
  const changedIds = results.filter((r) => r.changed).map((r) => r.entity_id);
  let dataVersion: number | null = null;
  if (changedIds.length) {
    const v = await db.query<{ version: string }>(
      `INSERT INTO data_version (changeset_id, entity_ids) VALUES ($1, $2) RETURNING version`,
      [changesetId, [...new Set([...changedIds, ...affected])]],
    );
    dataVersion = Number(v.rows[0]!.version);
    await db.query(`SELECT pg_notify('data_changed', $1)`, [String(dataVersion)]);
  }
  return { changeset_id: changesetId, results, data_version: dataVersion };
}

interface Ctx {
  db: Queryable;
  changesetId: string;
  authorId: string;
  affected: Set<string>;
}

async function runOp(ctx: Ctx, op: Op): Promise<Omit<OpResult, 'seq' | 'op'>> {
  switch (op.op) {
    case 'create':
      return createEntity(ctx, op.entity_type, op.data);
    case 'update':
      return updateEntity(ctx, op.entity_type, op.id, op.data, op.expected_version);
    case 'delete':
      return softDelete(ctx, op.entity_type, op.id, op.reason, op.expected_version);
    case 'restore':
      return restore(ctx, op.entity_type, op.id);
    case 'purge':
      return purge(ctx, op.entity_type, op.id);
    case 'rename_id':
      return renameId(ctx, op.entity_type, op.id, op.new_id, op.reason, op.reclaim);
    case 'merge_station':
      return mergeStation(ctx, op.id, op.into_id, op.reason);
  }
}

// ---------------------------------------------------------------------------
// op 구현
// ---------------------------------------------------------------------------

async function createEntity(ctx: Ctx, type: EntityType, data: unknown): Promise<Omit<OpResult, 'seq' | 'op'>> {
  const parsed = entityContracts[type].create.parse(data) as AnyObject;
  const id = String(parsed.id);
  const exists = await ctx.db.query<{ deleted_at: string | null }>(`SELECT deleted_at FROM entity WHERE id = $1`, [id]);
  if (exists.rows[0]) {
    throw new DomainError(
      'id_taken',
      exists.rows[0].deleted_at ? `${id} 는 삭제된 id(영구 예약)` : `${id} 가 이미 있음`,
    );
  }
  await ctx.db.query(`INSERT INTO entity (id, type) VALUES ($1, $2)`, [id, type]);
  await writeMain(ctx, type, parsed, 'insert');
  await writeChildren(ctx, type, id, parsed, Object.keys(parsed));
  const after = await requireEntity(ctx.db, type, id);
  addRelated(ctx, type, after);
  return { entity_type: type, entity_id: id, before: null, after, changed: true };
}

async function updateEntity(
  ctx: Ctx,
  type: EntityType,
  id: string,
  data: unknown,
  expectedVersion?: number,
): Promise<Omit<OpResult, 'seq' | 'op'>> {
  const before = await requireEntity(ctx.db, type, id, { forUpdate: true });
  if (expectedVersion !== undefined && before.version !== expectedVersion) {
    throw new DomainError('version_conflict', `${id} 가 다른 변경으로 바뀜(현재 version ${String(before.version)})`, {
      current: before,
    });
  }
  const patch = entityContracts[type].update.parse(data) as AnyObject;
  const provided = Object.keys(patch).filter((k) => patch[k] !== undefined);
  // 합친 전체 행으로 교차 필드 검사(계약 create)
  const merged = entityContracts[type].create.parse({
    ...toCreateShape(type, before),
    ...pick(patch, provided),
  }) as AnyObject;
  const childFields = new Set([...ENTITY_SPECS[type].children.map((c) => c.field), STOP_PATTERNS_FIELD]);
  const changedScalars = provided.filter((k) => !childFields.has(k) && !same(before[k], merged[k]));
  const changedChildren = provided.filter((k) => childFields.has(k) && !same(before[k], merged[k]));
  if (changedScalars.length === 0 && changedChildren.length === 0) {
    return { entity_type: type, entity_id: id, before, after: before, changed: false };
  }
  await writeMain(ctx, type, merged, 'update', changedScalars);
  await writeChildren(ctx, type, id, merged, changedChildren, true);
  const after = await requireEntity(ctx.db, type, id);
  addRelated(ctx, type, before);
  addRelated(ctx, type, after);
  return { entity_type: type, entity_id: id, before, after, changed: true };
}

async function softDelete(
  ctx: Ctx,
  type: EntityType,
  id: string,
  reason?: string,
  expectedVersion?: number,
): Promise<Omit<OpResult, 'seq' | 'op'>> {
  const before = await requireEntity(ctx.db, type, id, { forUpdate: true });
  if (expectedVersion !== undefined && before.version !== expectedVersion) {
    throw new DomainError('version_conflict', `${id} 가 다른 변경으로 바뀜`, { current: before });
  }
  const refs = await findReferences(ctx.db, type, id, { activeOnly: true });
  if (type === 'line') {
    // 함께 휴지통으로 가는 노선별 역을 다른 개체(정차 패턴·시간표·계획 구간)가 가리키면 거부
    const lsIds = (
      await ctx.db.query<{ id: string }>(`SELECT id FROM line_station WHERE line_id = $1 AND deleted_at IS NULL`, [id])
    ).rows.map((r) => r.id);
    const own = new Set([id, ...lsIds]);
    for (const ls of lsIds) {
      for (const r of await findReferences(ctx.db, 'line_station', ls, { activeOnly: true })) {
        if (!r.owner_id || !own.has(r.owner_id)) refs.push(r);
      }
    }
  }
  if (refs.length)
    throw new DomainError('referenced', `${id} 를 가리키는 활성 행이 있어 삭제할 수 없음(V-H12)`, { references: refs });
  const table = ENTITY_SPECS[type].table;
  await ctx.db.query(
    `UPDATE "${table}" SET deleted_at = now(), deleted_by = $2, delete_reason = $3, last_changeset_id = $4, updated_by = $2 WHERE id = $1`,
    [id, ctx.authorId, reason ?? null, ctx.changesetId],
  );
  const after = await readEntity(ctx.db, type, id, { includeDeleted: true });
  return { entity_type: type, entity_id: id, before, after, changed: true };
}

async function restore(ctx: Ctx, type: EntityType, id: string): Promise<Omit<OpResult, 'seq' | 'op'>> {
  const before = await requireEntity(ctx.db, type, id, { includeDeleted: true, forUpdate: true });
  if (before.deleted_at == null) throw new DomainError('invalid_state', `${id} 는 휴지통에 없음`);
  const table = ENTITY_SPECS[type].table;
  await ctx.db.query(
    `UPDATE "${table}" SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL, last_changeset_id = $2, updated_by = $3 WHERE id = $1`,
    [id, ctx.changesetId, ctx.authorId],
  );
  const after = await requireEntity(ctx.db, type, id);
  addRelated(ctx, type, after);
  return { entity_type: type, entity_id: id, before, after, changed: true };
}

/** 영구 삭제: 휴지통에 있는 것만. 본 행·하위 행·공통 연결을 지우고 entity 행은 묘비로 남긴다(id 영구 예약) */
async function purge(ctx: Ctx, type: EntityType, id: string): Promise<Omit<OpResult, 'seq' | 'op'>> {
  const before = await requireEntity(ctx.db, type, id, { includeDeleted: true, forUpdate: true });
  if (before.deleted_at == null) throw new DomainError('invalid_state', `${id} 는 휴지통에 없음 — 먼저 삭제`);
  const refs = await findReferences(ctx.db, type, id, { activeOnly: false });
  if (refs.length)
    throw new DomainError('referenced', `${id} 를 가리키는 행이 있어 영구 삭제할 수 없음`, { references: refs });
  const table = ENTITY_SPECS[type].table;
  if (type === 'line') {
    const ls = await ctx.db.query<{ id: string }>(`SELECT id FROM line_station WHERE line_id = $1`, [id]);
    if (ls.rows.length) throw new DomainError('referenced', `노선별 역 ${ls.rows.length}개를 먼저 영구 삭제해야 함`);
  }
  await ctx.db.query(`DELETE FROM "${table}" WHERE id = $1`, [id]);
  for (const t of ['entity_name', 'external_ref', 'record_source', 'entity_attachment']) {
    await ctx.db.query(`DELETE FROM "${t}" WHERE entity_id = $1`, [id]);
  }
  await ctx.db.query(`DELETE FROM id_redirect WHERE new_id = $1`, [id]);
  return { entity_type: type, entity_id: id, before, after: null, changed: true };
}

async function renameId(
  ctx: Ctx,
  type: EntityType,
  id: string,
  newId: string,
  reason?: string,
  reclaim = false,
): Promise<Omit<OpResult, 'seq' | 'op'>> {
  if (!isEntityId(type, newId))
    throw new DomainError('validation', `새 id 형식 오류: ${newId}`, {
      violations: [{ rule: 'schema', path: 'new_id', message: 'id 형식' }],
    });
  const before = await requireEntity(ctx.db, type, id, { forUpdate: true });
  const taken = await ctx.db.query(`SELECT 1 FROM entity WHERE id = $1`, [newId]);
  if (taken.rowCount) throw new DomainError('id_taken', `${newId} 가 이미 있음(삭제된 id 포함)`);
  // 옛 id(리다이렉트로 예약됨)는 되돌리기에서만 되찾는다
  const redirected = await ctx.db.query<{ new_id: string }>(`SELECT new_id FROM id_redirect WHERE old_id = $1`, [
    newId,
  ]);
  if (redirected.rows[0]) {
    if (!reclaim || redirected.rows[0].new_id !== id)
      throw new DomainError('id_taken', `${newId} 는 예약된 옛 id(→ ${redirected.rows[0].new_id})`);
    await ctx.db.query(`DELETE FROM id_redirect WHERE old_id = $1`, [newId]);
  }
  // 모든 FK 가 ON UPDATE CASCADE 라 entity.id 한 행만 바꾸면 참조 전체로 전파된다
  await ctx.db.query(`UPDATE entity SET id = $2 WHERE id = $1`, [id, newId]);
  await ctx.db.query(`UPDATE id_redirect SET new_id = $2 WHERE new_id = $1`, [id, newId]);
  await ctx.db.query(`INSERT INTO id_redirect (old_id, new_id, reason) VALUES ($1, $2, $3)`, [
    id,
    newId,
    reason ?? null,
  ]);
  // 배열 열(계획 선형 경유역)은 FK 가 아니라 직접 바꾼다
  if (type === 'station') {
    await ctx.db.query(
      `UPDATE plan_geometry SET via_station_ids = array_replace(via_station_ids, $1, $2) WHERE $1 = ANY (via_station_ids)`,
      [id, newId],
    );
  }
  const table = ENTITY_SPECS[type].table;
  await ctx.db.query(`UPDATE "${table}" SET last_changeset_id = $2, updated_by = $3 WHERE id = $1`, [
    newId,
    ctx.changesetId,
    ctx.authorId,
  ]);
  const after = await requireEntity(ctx.db, type, newId);
  ctx.affected.add(newId);
  return { entity_type: type, entity_id: newId, before, after, changed: true };
}

/**
 * 역 병합(03 문서 9절): from 을 into 로 합친다. from 의 노선별 역은 into 아래로(같은 노선이 이미 있으면 그쪽으로 참조를 옮기고 from 쪽은 삭제),
 * from 을 가리키는 행은 into 로, from 의 이름은 into 의 옛 이름으로, id_redirect(from → into), from 은 소프트 삭제.
 */
async function mergeStation(
  ctx: Ctx,
  fromId: string,
  intoId: string,
  reason?: string,
): Promise<Omit<OpResult, 'seq' | 'op'>> {
  if (fromId === intoId) throw new DomainError('validation', '같은 역으로 병합할 수 없음');
  const db = ctx.db;
  const from = await requireEntity(db, 'station', fromId, { forUpdate: true });
  const intoBefore = await requireEntity(db, 'station', intoId, { forUpdate: true });
  const fromLs = await db.query<{ id: string; line_id: string }>(
    `SELECT id, line_id FROM line_station WHERE station_id = $1 AND deleted_at IS NULL`,
    [fromId],
  );
  for (const ls of fromLs.rows) {
    const twin = await db.query<{ id: string }>(
      `SELECT id FROM line_station WHERE station_id = $1 AND line_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [intoId, ls.line_id],
    );
    if (twin.rows[0]) {
      const t = twin.rows[0].id;
      await db.query(`UPDATE stop_pattern_stop SET line_station_id = $2 WHERE line_station_id = $1`, [ls.id, t]);
      await db.query(`UPDATE timetable_set SET line_station_id = $2 WHERE line_station_id = $1`, [ls.id, t]);
      await db.query(`UPDATE plan_line SET from_line_station_id = $2 WHERE from_line_station_id = $1`, [ls.id, t]);
      await db.query(`UPDATE plan_line SET to_line_station_id = $2 WHERE to_line_station_id = $1`, [ls.id, t]);
      await moveCommon(db, ls.id, t);
      await db.query(
        `UPDATE line_station SET deleted_at = now(), deleted_by = $2, delete_reason = $3, last_changeset_id = $4 WHERE id = $1`,
        [ls.id, ctx.authorId, `역 병합(${fromId} → ${intoId})`, ctx.changesetId],
      );
    } else {
      await db.query(`UPDATE line_station SET station_id = $2, last_changeset_id = $3 WHERE id = $1`, [
        ls.id,
        intoId,
        ctx.changesetId,
      ]);
    }
  }
  // from 을 가리키는 행 → into (PK 충돌이면 from 쪽 행을 지움)
  for (const [table, col, keyCols] of [
    ['plan_station', 'station_id', ['plan_id']],
    ['transfer_center_station', 'station_id', ['center_id']],
    ['event_target', 'entity_id', ['event_id']],
  ] as const) {
    await db.query(
      `DELETE FROM ${table} a USING ${table} b WHERE a.${col} = $1 AND b.${col} = $2 AND ${keyCols.map((k) => `a.${k} = b.${k}`).join(' AND ')}`,
      [fromId, intoId],
    );
    await db.query(`UPDATE ${table} SET ${col} = $2 WHERE ${col} = $1`, [fromId, intoId]);
  }
  await db.query(`UPDATE timetable_set SET station_id = $2 WHERE station_id = $1`, [fromId, intoId]);
  await db.query(`UPDATE timetable_entry SET dest_station_id = $2 WHERE dest_station_id = $1`, [fromId, intoId]);
  await db.query(`UPDATE station SET merge_into_id = NULL WHERE id = $1`, [fromId]);
  await db.query(`UPDATE station SET merge_into_id = $2 WHERE merge_into_id = $1`, [fromId, intoId]);
  await db.query(`UPDATE station SET coord_same_as_id = $2 WHERE coord_same_as_id = $1`, [fromId, intoId]);
  await db.query(`UPDATE line SET start_station_id = $2 WHERE start_station_id = $1`, [fromId, intoId]);
  await db.query(`UPDATE line SET end_station_id = $2 WHERE end_station_id = $1`, [fromId, intoId]);
  await db.query(
    `UPDATE plan_geometry SET via_station_ids = array_replace(via_station_ids, $1, $2) WHERE $1 = ANY (via_station_ids)`,
    [fromId, intoId],
  );
  await moveCommon(db, fromId, intoId, { keepSources: true });
  if (from.name_ko !== intoBefore.name_ko) {
    await db.query(
      `INSERT INTO entity_name (entity_id, name, kind, note, ord) VALUES ($1, $2, 'former', $3, 1000) ON CONFLICT DO NOTHING`,
      [intoId, from.name_ko, `역 병합(${fromId})`],
    );
  }
  await db.query(`UPDATE id_redirect SET new_id = $2 WHERE new_id = $1`, [fromId, intoId]);
  await db.query(`INSERT INTO id_redirect (old_id, new_id, reason) VALUES ($1, $2, $3)`, [
    fromId,
    intoId,
    reason ?? '역 병합',
  ]);
  await db.query(
    `UPDATE station SET deleted_at = now(), deleted_by = $2, delete_reason = $3, last_changeset_id = $4 WHERE id = $1`,
    [fromId, ctx.authorId, `역 병합 → ${intoId}`, ctx.changesetId],
  );
  await db.query(`UPDATE station SET last_changeset_id = $2, updated_by = $3 WHERE id = $1`, [
    intoId,
    ctx.changesetId,
    ctx.authorId,
  ]);
  const after = await requireEntity(db, 'station', intoId);
  ctx.affected.add(fromId);
  ctx.affected.add(intoId);
  for (const ls of fromLs.rows) ctx.affected.add(ls.id);
  return { entity_type: 'station', entity_id: intoId, before: { from, into: intoBefore }, after, changed: true };
}

/** 별칭·외부 코드·출처·첨부를 다른 개체로 옮긴다(중복은 버림) */
async function moveCommon(
  db: Queryable,
  fromId: string,
  toId: string,
  opts: { keepSources?: boolean } = {},
): Promise<void> {
  await db.query(
    `INSERT INTO entity_name (entity_id, name, kind, lang, valid_from_value, valid_from_precision, valid_to_value, valid_to_precision, source_id, note, ord)
     SELECT $2, name, kind, lang, valid_from_value, valid_from_precision, valid_to_value, valid_to_precision, source_id, note, ord + 500
       FROM entity_name WHERE entity_id = $1 ON CONFLICT DO NOTHING`,
    [fromId, toId],
  );
  await db.query(
    `INSERT INTO external_ref (entity_id, system, code, label, is_primary, source_id, note)
     SELECT $2, system, code, label, false, source_id, note FROM external_ref WHERE entity_id = $1 ON CONFLICT DO NOTHING`,
    [fromId, toId],
  );
  await db.query(`DELETE FROM external_ref WHERE entity_id = $1`, [fromId]);
  if (opts.keepSources) {
    await db.query(
      `INSERT INTO record_source (entity_id, source_id, field, locator, note, ord)
       SELECT $2, source_id, field, locator, note, ord + 500 FROM record_source r WHERE entity_id = $1
          AND NOT EXISTS (SELECT 1 FROM record_source x WHERE x.entity_id = $2 AND x.source_id = r.source_id AND coalesce(x.field, '') = coalesce(r.field, ''))`,
      [fromId, toId],
    );
  }
  await db.query(`UPDATE entity_attachment SET entity_id = $2 WHERE entity_id = $1`, [fromId, toId]);
}

// ---------------------------------------------------------------------------
// 쓰기 도우미
// ---------------------------------------------------------------------------

async function writeMain(
  ctx: Ctx,
  type: EntityType,
  row: AnyObject,
  mode: 'insert' | 'update',
  only?: string[],
): Promise<void> {
  const spec = ENTITY_SPECS[type];
  const cols = tableColumns(await schemaInfo(ctx.db), spec.table);
  const childFields = new Set([...spec.children.map((c) => c.field), STOP_PATTERNS_FIELD]);
  const fields = (only ?? Object.keys(shapeOf(type))).filter(
    (f) => !childFields.has(f) && (mode === 'insert' || f !== 'id'),
  );
  const writes = fields.flatMap((f) => writeField(f, row[f], cols));
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (mode === 'insert') {
    const names = [...writes.map((w) => `"${w.column}"`), 'created_by', 'updated_by', 'last_changeset_id'];
    const values = [...writes.map((w) => w.expr(p(w.value))), p(ctx.authorId), p(ctx.authorId), p(ctx.changesetId)];
    await ctx.db.query(`INSERT INTO "${spec.table}" (${names.join(', ')}) VALUES (${values.join(', ')})`, params);
  } else {
    const sets = [
      ...writes.map((w) => `"${w.column}" = ${w.expr(p(w.value))}`),
      `updated_by = ${p(ctx.authorId)}`,
      `last_changeset_id = ${p(ctx.changesetId)}`,
    ];
    await ctx.db.query(`UPDATE "${spec.table}" SET ${sets.join(', ')} WHERE id = ${p(row.id)}`, params);
  }
}

async function writeChildren(
  ctx: Ctx,
  type: EntityType,
  id: string,
  row: AnyObject,
  fields: string[],
  replace = false,
): Promise<void> {
  const spec = ENTITY_SPECS[type];
  for (const child of spec.children) {
    if (!fields.includes(child.field) || !(child.field in shapeOf(type))) continue;
    if (replace) await ctx.db.query(`DELETE FROM "${child.table}" WHERE "${child.fk}" = $1`, [id]);
    await insertChild(ctx, child, id, row[child.field]);
  }
  if (type === 'service' && fields.includes(STOP_PATTERNS_FIELD)) {
    if (replace) await ctx.db.query(`DELETE FROM stop_pattern WHERE service_id = $1`, [id]);
    const patterns = (row[STOP_PATTERNS_FIELD] as AnyObject[] | undefined) ?? [];
    for (const [i, pt] of patterns.entries()) {
      const r = await ctx.db.query<{ id: string }>(
        `INSERT INTO stop_pattern (service_id, code, name_ko, name_en, type, seq, note) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [id, pt.code, pt.name_ko, pt.name_en ?? null, pt.type, i + 1, pt.note ?? null],
      );
      const pid = r.rows[0]!.id;
      for (const [j, ls] of ((pt.stops as string[]) ?? []).entries()) {
        await ctx.db.query(`INSERT INTO stop_pattern_stop (pattern_id, seq, line_station_id) VALUES ($1, $2, $3)`, [
          pid,
          j + 1,
          ls,
        ]);
      }
    }
  }
}

async function insertChild(ctx: Ctx, child: ChildSpec, parentId: string, value: unknown): Promise<void> {
  const cols = tableColumns(await schemaInfo(ctx.db), child.table);
  const items: unknown[] =
    child.kind === 'single' ? (value == null ? [] : [value]) : ((value as unknown[] | undefined) ?? []);
  for (const [i, item] of items.entries()) {
    const params: unknown[] = [parentId];
    const names = [`"${child.fk}"`];
    const values = ['$1'];
    const add = (col: string, expr: (p: string) => string, v: unknown) => {
      params.push(v);
      names.push(`"${col}"`);
      values.push(expr(`$${params.length}`));
    };
    if (child.kind === 'values') {
      add(child.valueColumn!, (p) => p, item);
    } else {
      for (const [f, v] of Object.entries(item as AnyObject)) {
        for (const w of writeField(f, v, cols)) add(w.column, w.expr, w.value);
      }
    }
    if (child.orderColumn) add(child.orderColumn, (p) => p, i + 1);
    if (child.hasMeta) {
      add('created_by', (p) => p, ctx.authorId);
      add('updated_by', (p) => p, ctx.authorId);
      add('last_changeset_id', (p) => p, ctx.changesetId);
    }
    await ctx.db.query(`INSERT INTO "${child.table}" (${names.join(', ')}) VALUES (${values.join(', ')})`, params);
  }
}

/** 검증 범위에 관련 개체를 더한다(노선별 역 → 노선·역 등) */
function addRelated(ctx: Ctx, type: EntityType, row: AnyObject | null): void {
  if (!row) return;
  ctx.affected.add(String(row.id));
  if (type === 'line_station') {
    ctx.affected.add(String(row.line_id));
    ctx.affected.add(String(row.station_id));
  }
  for (const k of ['merge_into_id', 'coord_same_as_id', 'successor_id']) {
    const v = row[k];
    if (typeof v === 'string' && entityTypeOfId(v)) ctx.affected.add(v);
  }
}

function pick(o: AnyObject, keys: string[]): AnyObject {
  const out: AnyObject = {};
  for (const k of keys) out[k] = o[k];
  return out;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/** 비교용: 객체 키 정렬, undefined → null */
function normalize(v: unknown): unknown {
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    const out: AnyObject = {};
    for (const k of Object.keys(v as AnyObject).sort()) out[k] = normalize((v as AnyObject)[k]);
    return out;
  }
  return v;
}
