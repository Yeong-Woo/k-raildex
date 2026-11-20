/**
 * 되돌리기(docs/04-api.md 4·4-2절): 적용된 변경 묶음(또는 그 안의 op 하나)의 역 op 를 만들어 새 변경 묶음(origin revert,
 * reverts_changeset_id)으로 적용한다. change_op 의 before/after 스냅샷을 쓴다.
 *
 * | 원래 op       | 역 op                                                                 |
 * | ------------- | --------------------------------------------------------------------- |
 * | create        | delete(소프트)                                                        |
 * | update        | update — 그 op 가 바꾼 필드(단순 값·하위 목록)만 before 값으로        |
 * | delete        | restore                                                               |
 * | restore       | delete                                                                |
 * | rename_id     | rename_id 새 id → 옛 id(리다이렉트를 걷어 낸다)                       |
 * | 첨부 변경     | 그 첨부 하나를 op 전 상태로(attachments.ts)                           |
 * | merge_station·purge | 되돌릴 수 없음(409)                                             |
 *
 * 충돌: update 는 그 op 가 바꾼 필드가 지금 after 값과 다르면(그 뒤에 다시 바뀜) 409.
 */
import type { EntityType } from '@k-raildex/contracts';
import { applyChangeset, type ApplyResult, type Op } from './applier';
import { isAttachmentOp, revertAttachmentChange, type AttachmentWriteResult } from './attachments';
import type { Queryable } from './db';
import { DomainError, type Violation } from './errors';
import { requireEntity, toCreateShape } from './repo';

type AnyObject = Record<string, unknown>;

interface OpRow {
  changeset_id: string;
  seq: number;
  op: string;
  entity_type: EntityType;
  entity_id: string;
  payload: AnyObject;
  before: AnyObject | null;
  after: AnyObject | null;
}

export interface RevertOptions {
  /** 이 op 하나만 */
  seq?: number;
  /** 단건 되돌리기에서 경로의 개체 id 와 맞는지 확인 */
  entity_id?: string;
  title?: string;
  rationale?: string;
  dryRun?: boolean;
}

export type RevertResult =
  | ({ kind: 'entity'; reverts_changeset_id: string } & ApplyResult)
  | ({ kind: 'attachment'; reverts_changeset_id: string } & AttachmentWriteResult);

/** 옛 id 면 지금 id 로(rename_id 뒤) */
async function currentId(db: Queryable, id: string): Promise<string> {
  const e = await db.query(`SELECT 1 FROM entity WHERE id = $1`, [id]);
  if (e.rowCount) return id;
  const r = await db.query<{ new_id: string }>(`SELECT new_id FROM id_redirect WHERE old_id = $1`, [id]);
  return r.rows[0]?.new_id ?? id;
}

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
const same = (a: unknown, b: unknown) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

async function inverseOp(db: Queryable, o: OpRow): Promise<Op | null> {
  const type = o.entity_type;
  switch (o.op) {
    case 'create':
      return {
        op: 'delete',
        entity_type: type,
        id: await currentId(db, o.entity_id),
        reason: `되돌리기(${o.changeset_id})`,
      };
    case 'delete':
      return { op: 'restore', entity_type: type, id: await currentId(db, o.entity_id) };
    case 'restore':
      return {
        op: 'delete',
        entity_type: type,
        id: await currentId(db, o.entity_id),
        reason: `되돌리기(${o.changeset_id})`,
      };
    case 'rename_id': {
      const oldId = String(o.before?.id ?? '');
      const newId = String(o.after?.id ?? o.entity_id);
      if (!oldId) throw new DomainError('invalid_state', `${o.changeset_id} #${o.seq}: 옛 id 를 알 수 없음`);
      return { op: 'rename_id', entity_type: type, id: newId, new_id: oldId, reason: '되돌리기', reclaim: true };
    }
    case 'update': {
      if (!o.before || !o.after) return null;
      const before = toCreateShape(type, o.before);
      const after = toCreateShape(type, o.after);
      const fields = Object.keys({ ...before, ...after }).filter((k) => k !== 'id' && !same(before[k], after[k]));
      if (!fields.length) return null;
      const id = await currentId(db, o.entity_id);
      const cur = toCreateShape(type, await requireEntity(db, type, id));
      const conflicts: Violation[] = fields
        .filter((k) => !same(cur[k], after[k]))
        .map((k) => ({
          rule: 'revert_conflict',
          path: k,
          entity_id: id,
          message: `${k} 가 ${o.changeset_id} 뒤에 다시 바뀜`,
        }));
      if (conflicts.length)
        throw new DomainError('version_conflict', `${id}: 그 뒤의 변경과 겹쳐 되돌릴 수 없음`, {
          violations: conflicts,
        });
      const data: AnyObject = {};
      for (const k of fields) data[k] = before[k] ?? null;
      return { op: 'update', entity_type: type, id, data };
    }
    case 'merge_station':
    case 'purge':
    case 'replace_children':
    default:
      throw new DomainError('invalid_state', `${o.changeset_id} #${o.seq}: ${o.op} 는 되돌릴 수 없음`);
  }
}

export async function revertChangeset(
  db: Queryable,
  changesetId: string,
  authorId: string,
  opts: RevertOptions = {},
): Promise<RevertResult> {
  const cs = await db.query<{ status: string; title: string }>(`SELECT status, title FROM changeset WHERE id = $1`, [
    changesetId,
  ]);
  if (!cs.rows[0]) throw new DomainError('not_found', `변경 묶음 ${changesetId} 가 없음`);
  if (cs.rows[0].status !== 'applied')
    throw new DomainError('invalid_state', `적용된 변경 묶음만 되돌릴 수 있음(${cs.rows[0].status})`);
  const prior = await db.query<{ id: string }>(
    `SELECT id FROM changeset WHERE reverts_changeset_id = $1 AND status = 'applied'
        AND (meta->>'reverted_seq' IS NULL ${opts.seq != null ? `OR meta->>'reverted_seq' = $2` : ''})`,
    opts.seq != null ? [changesetId, String(opts.seq)] : [changesetId],
  );
  if (prior.rows[0]) throw new DomainError('invalid_state', `이미 되돌림(${prior.rows[0].id})`);
  const { rows } = await db.query<OpRow>(
    `SELECT changeset_id, seq, op, entity_type, entity_id, payload, before, after FROM change_op
      WHERE changeset_id = $1 ${opts.seq != null ? 'AND seq = $2' : ''} ORDER BY seq DESC`,
    opts.seq != null ? [changesetId, opts.seq] : [changesetId],
  );
  if (!rows.length)
    throw new DomainError('not_found', `${changesetId} 에 op${opts.seq != null ? ` #${opts.seq}` : ''} 가 없음`);
  if (opts.entity_id) {
    const target = rows[0]!;
    const ids = new Set([target.entity_id, String(target.before?.id ?? ''), String(target.after?.id ?? '')]);
    if (!ids.has(opts.entity_id) && (await currentId(db, target.entity_id)) !== opts.entity_id)
      throw new DomainError('validation', `op #${target.seq} 의 대상은 ${target.entity_id}`, {
        violations: [{ rule: 'schema', path: 'seq', message: `대상 개체가 ${opts.entity_id} 가 아님` }],
      });
  }
  const title = opts.title ?? `되돌리기: ${cs.rows[0].title}${opts.seq != null ? ` #${opts.seq}` : ''}`;
  const meta = opts.seq != null ? { reverted_seq: opts.seq } : {};

  const attachmentOps = rows.filter((r) => isAttachmentOp(r.payload));
  if (attachmentOps.length) {
    if (rows.length > 1)
      throw new DomainError('invalid_state', '첨부 변경과 개체 변경이 섞인 묶음은 op 단위로 되돌릴 것');
    if (opts.dryRun) throw new DomainError('validation', '첨부 되돌리기는 dry_run 을 지원하지 않음');
    const r = await revertAttachmentChange(db, rows[0]!, authorId, { title, meta });
    return { kind: 'attachment', reverts_changeset_id: changesetId, ...r };
  }

  const ops: Op[] = [];
  for (const o of rows) {
    const inv = await inverseOp(db, o);
    if (inv) ops.push(inv);
  }
  if (!ops.length) throw new DomainError('invalid_state', '되돌릴 변경이 없음(값이 바뀌지 않은 op 뿐)');
  const r = await applyChangeset(
    db,
    {
      title,
      rationale: opts.rationale,
      origin: 'revert',
      author_id: authorId,
      ops,
      meta,
      reverts_changeset_id: changesetId,
    },
    { dryRun: opts.dryRun },
  );
  return { kind: 'entity', reverts_changeset_id: changesetId, ...r };
}
