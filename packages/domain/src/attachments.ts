/**
 * 첨부 entity_attachment(docs/03-data-model.md 3-4절, Q77 A) — 모든 개체 공통.
 * 쓰기마다 변경 묶음(origin admin_edit, 되돌리기는 revert) 하나를 남긴다: change_op 1개(op 'update', 부모 개체 종류·id,
 * before/after = 그 개체의 첨부 목록 스냅샷 `{ attachments: [...] }`), data_version + NOTIFY data_changed.
 * 부모 개체 행(version)은 바꾸지 않는다. 낙관적 잠금은 첨부 행의 version(If-Match).
 * 공개 첨부의 문서 publishable(V-H15)·kind 별 필수 값은 DB 트리거·CHECK 가 강제하고 422 로 옮긴다.
 */
import { attachmentSchema, type EntityType } from '@k-raildex/contracts';
import { z } from 'zod';
import { newChangesetId } from './applier';
import type { Queryable } from './db';
import { DomainError } from './errors';

type AnyObject = Record<string, unknown>;

export interface AttachmentItem {
  id: number;
  version: number;
  kind: string;
  title: string | null;
  quote: string | null;
  url: string | null;
  document_id: string | null;
  page: number | null;
  source_id: string | null;
  is_public: boolean;
  origin: string;
  ord: number;
  created_at: string;
  updated_at: string;
}

export interface AttachmentWriteResult {
  item: AttachmentItem | null;
  changeset_id: string;
  data_version: number | null;
}

/** change_op.payload.attachment */
export interface AttachmentChange {
  action: 'create' | 'update' | 'delete' | 'restore';
  attachment_id: number;
  data?: AnyObject;
}

const FIELDS = ['kind', 'title', 'quote', 'url', 'document_id', 'page', 'source_id', 'is_public', 'origin'] as const;

const COLS = `a.id, a.version, a.kind, a.title, a.quote, a.url, a.document_id, a.page, a.source_id, a.is_public, a.origin, a.ord,
  a.created_at, a.updated_at`;

function shape(r: AnyObject): AttachmentItem {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
  return {
    id: Number(r.id),
    version: Number(r.version),
    kind: String(r.kind),
    title: (r.title as string | null) ?? null,
    quote: (r.quote as string | null) ?? null,
    url: (r.url as string | null) ?? null,
    document_id: (r.document_id as string | null) ?? null,
    page: (r.page as number | null) ?? null,
    source_id: (r.source_id as string | null) ?? null,
    is_public: Boolean(r.is_public),
    origin: String(r.origin),
    ord: Number(r.ord),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

const ordSchema = z.number().int().min(0).optional();

// ---------------------------------------------------------------------------
// 읽기
// ---------------------------------------------------------------------------

async function parentOf(db: Queryable, entityId: string, opts: { forWrite?: boolean } = {}): Promise<EntityType> {
  const { rows } = await db.query<{ type: EntityType; deleted_at: Date | null }>(
    `SELECT type, deleted_at FROM entity WHERE id = $1`,
    [entityId],
  );
  const e = rows[0];
  if (!e || (opts.forWrite && e.deleted_at)) throw new DomainError('not_found', `개체 ${entityId} 가 없음`);
  return e.type;
}

export async function listAttachments(
  db: Queryable,
  entityId: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<AttachmentItem[]> {
  await parentOf(db, entityId);
  return snapshot(db, entityId, opts.includeDeleted);
}

async function snapshot(db: Queryable, entityId: string, includeDeleted = false): Promise<AttachmentItem[]> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM entity_attachment a WHERE a.entity_id = $1${includeDeleted ? '' : ' AND a.deleted_at IS NULL'}
      ORDER BY a.ord, a.id`,
    [entityId],
  );
  return rows.map((r) => shape(r as AnyObject));
}

export async function getAttachment(
  db: Queryable,
  id: number,
  opts: { includeDeleted?: boolean; forUpdate?: boolean } = {},
): Promise<AttachmentItem & { entity_id: string; deleted_at: string | null }> {
  const { rows } = await db.query(
    `SELECT ${COLS}, a.entity_id, a.deleted_at FROM entity_attachment a
      WHERE a.id = $1${opts.includeDeleted ? '' : ' AND a.deleted_at IS NULL'}${opts.forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  const r = rows[0] as AnyObject | undefined;
  if (!r) throw new DomainError('not_found', `첨부 ${id} 가 없음`);
  return {
    ...shape(r),
    entity_id: String(r.entity_id),
    deleted_at: r.deleted_at == null ? null : new Date(r.deleted_at as string).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 쓰기
// ---------------------------------------------------------------------------

interface WriteCtx {
  db: Queryable;
  changesetId: string;
  authorId: string;
}

/**
 * 첨부 쓰기 한 건 = 변경 묶음 한 건. fn 이 첨부를 바꾸고 바뀐 첨부 id 를 돌려준다.
 */
async function inChangeset(
  db: Queryable,
  args: {
    parentId: string;
    authorId: string;
    title: string;
    origin: 'admin_edit' | 'revert';
    rationale?: string;
    revertsChangesetId?: string;
    meta?: AnyObject;
    change: (ctx: WriteCtx) => Promise<AttachmentChange>;
  },
): Promise<AttachmentWriteResult & { change: AttachmentChange }> {
  const changesetId = newChangesetId();
  await db.query('BEGIN');
  try {
    const parentType = await parentOf(db, args.parentId, { forWrite: true });
    await db.query(
      `INSERT INTO changeset (id, title, rationale, origin, status, author_id, reverts_changeset_id, meta)
       VALUES ($1, $2, $3, $4, 'applying', $5, $6, $7)`,
      [
        changesetId,
        args.title,
        args.rationale ?? null,
        args.origin,
        args.authorId,
        args.revertsChangesetId ?? null,
        args.meta ?? {},
      ],
    );
    // 같은 개체의 첨부 쓰기를 직렬화(스냅샷 일관성)
    await db.query(`SELECT 1 FROM entity WHERE id = $1 FOR UPDATE`, [args.parentId]);
    const before = await snapshot(db, args.parentId);
    let change: AttachmentChange;
    try {
      change = await args.change({ db, changesetId, authorId: args.authorId });
    } catch (e) {
      throw pgToDomain(e);
    }
    const after = await snapshot(db, args.parentId);
    await db.query(
      `INSERT INTO change_op (changeset_id, seq, op, entity_type, entity_id, payload, before, after)
       VALUES ($1, 1, 'update', $2, $3, $4, $5, $6)`,
      [
        changesetId,
        parentType,
        args.parentId,
        JSON.stringify({ op: 'update', entity_type: parentType, id: args.parentId, attachment: change }),
        JSON.stringify({ attachments: before }),
        JSON.stringify({ attachments: after }),
      ],
    );
    await db.query(`UPDATE changeset SET status = 'applied', applied_at = now() WHERE id = $1`, [changesetId]);
    const v = await db.query<{ version: string }>(
      `INSERT INTO data_version (changeset_id, entity_ids) VALUES ($1, $2) RETURNING version`,
      [changesetId, [args.parentId]],
    );
    const dataVersion = Number(v.rows[0]!.version);
    await db.query(`SELECT pg_notify('data_changed', $1)`, [String(dataVersion)]);
    await db.query('COMMIT');
    const item = change.action === 'delete' ? null : await getAttachment(db, change.attachment_id).then(strip);
    return { item, changeset_id: changesetId, data_version: dataVersion, change };
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

function strip(a: AttachmentItem & { entity_id?: string; deleted_at?: string | null }): AttachmentItem {
  const { entity_id: _e, deleted_at: _d, ...rest } = a;
  return rest;
}

function pgToDomain(e: unknown): unknown {
  const pg = e as { code?: string; message?: string; constraint?: string };
  if (pg && typeof pg.code === 'string' && /^(23|P0)/.test(pg.code)) {
    const m = /^(V-H\d+):/.exec(pg.message ?? '');
    return new DomainError('validation', '첨부 규칙 위반', {
      violations: [{ rule: m?.[1] ?? pg.constraint ?? 'db', path: '', message: pg.message ?? String(e) }],
    });
  }
  return e;
}

function zodToDomain(e: z.ZodError): DomainError {
  return new DomainError('validation', '첨부 형식 오류', {
    violations: e.issues.map((i) => ({ rule: 'schema', path: i.path.join('.'), message: i.message })),
  });
}

async function checkDocument(db: Queryable, documentId: string | null | undefined): Promise<void> {
  if (!documentId) return;
  const { rowCount } = await db.query(`SELECT 1 FROM document WHERE id = $1 AND deleted_at IS NULL`, [documentId]);
  if (!rowCount)
    throw new DomainError('validation', '첨부 문서가 없음', {
      violations: [{ rule: 'schema', path: 'document_id', message: `문서 ${documentId} 가 없거나 삭제됨` }],
    });
}

/** 본문(계약 attachmentSchema + 선택 ord) 해석 */
function parseCreate(body: unknown): { data: z.infer<typeof attachmentSchema>; ord: number | undefined } {
  const obj = (body && typeof body === 'object' ? { ...(body as AnyObject) } : {}) as AnyObject;
  const ordRaw = obj.ord;
  delete obj.ord;
  const ord = ordSchema.safeParse(ordRaw);
  if (!ord.success) throw zodToDomain(ord.error);
  const r = attachmentSchema.safeParse(obj);
  if (!r.success) throw zodToDomain(r.error);
  return { data: r.data, ord: ord.data };
}

export interface WriteMeta {
  rationale?: string;
  changeset_title?: string;
  meta?: AnyObject;
}

export async function createAttachment(
  db: Queryable,
  entityId: string,
  body: unknown,
  authorId: string,
  opts: WriteMeta = {},
): Promise<AttachmentWriteResult> {
  const { data, ord } = parseCreate(body);
  await checkDocument(db, data.document_id);
  return inChangeset(db, {
    parentId: entityId,
    authorId,
    title: opts.changeset_title ?? `${entityId} 첨부 추가`,
    origin: 'admin_edit',
    rationale: opts.rationale,
    meta: opts.meta,
    change: async (ctx) => {
      const r = await ctx.db.query<{ id: string }>(
        `INSERT INTO entity_attachment (entity_id, kind, title, quote, url, document_id, page, source_id, is_public, origin, ord,
                                        created_by, updated_by, last_changeset_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 coalesce($11, (SELECT coalesce(max(ord), -1) + 1 FROM entity_attachment WHERE entity_id = $1 AND deleted_at IS NULL)),
                 $12, $12, $13)
         RETURNING id`,
        [
          entityId,
          data.kind,
          data.title ?? null,
          data.quote ?? null,
          data.url ?? null,
          data.document_id ?? null,
          data.page ?? null,
          data.source_id ?? null,
          data.is_public,
          data.origin,
          ord ?? null,
          ctx.authorId,
          ctx.changesetId,
        ],
      );
      return {
        action: 'create',
        attachment_id: Number(r.rows[0]!.id),
        data: { ...data, ...(ord != null ? { ord } : {}) },
      };
    },
  });
}

export async function updateAttachment(
  db: Queryable,
  id: number,
  patch: unknown,
  expectedVersion: number | undefined,
  authorId: string,
  opts: WriteMeta = {},
): Promise<AttachmentWriteResult> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch))
    throw new DomainError('validation', '첨부 수정 본문은 객체');
  const p = { ...(patch as AnyObject) };
  const unknownKeys = Object.keys(p).filter((k) => k !== 'ord' && !(FIELDS as readonly string[]).includes(k));
  if (unknownKeys.length)
    throw new DomainError('validation', '첨부 형식 오류', {
      violations: unknownKeys.map((k) => ({ rule: 'schema', path: k, message: '알 수 없는 필드' })),
    });
  const current = await getAttachment(db, id);
  const merged: AnyObject = {};
  for (const f of FIELDS) merged[f] = f in p ? p[f] : current[f];
  const { data, ord } = parseCreate({ ...merged, ...('ord' in p ? { ord: p.ord } : {}) });
  await checkDocument(db, data.document_id);
  return inChangeset(db, {
    parentId: current.entity_id,
    authorId,
    title: opts.changeset_title ?? `${current.entity_id} 첨부 ${id} 수정`,
    origin: 'admin_edit',
    rationale: opts.rationale,
    meta: opts.meta,
    change: async (ctx) => {
      const row = await getAttachment(ctx.db, id, { forUpdate: true });
      if (expectedVersion !== undefined && row.version !== expectedVersion)
        throw new DomainError('version_conflict', `첨부 ${id} 가 다른 변경으로 바뀜(현재 version ${row.version})`, {
          current: { version: row.version },
        });
      await ctx.db.query(
        `UPDATE entity_attachment SET kind = $2, title = $3, quote = $4, url = $5, document_id = $6, page = $7, source_id = $8,
                is_public = $9, origin = $10, ord = coalesce($11, ord), updated_by = $12, last_changeset_id = $13
          WHERE id = $1`,
        [
          id,
          data.kind,
          data.title ?? null,
          data.quote ?? null,
          data.url ?? null,
          data.document_id ?? null,
          data.page ?? null,
          data.source_id ?? null,
          data.is_public,
          data.origin,
          ord ?? null,
          ctx.authorId,
          ctx.changesetId,
        ],
      );
      return { action: 'update', attachment_id: id, data: patch as AnyObject };
    },
  });
}

export async function deleteAttachment(
  db: Queryable,
  id: number,
  authorId: string,
  opts: WriteMeta & { expectedVersion?: number; reason?: string } = {},
): Promise<AttachmentWriteResult> {
  const current = await getAttachment(db, id);
  return inChangeset(db, {
    parentId: current.entity_id,
    authorId,
    title: opts.changeset_title ?? `${current.entity_id} 첨부 ${id} 삭제`,
    origin: 'admin_edit',
    rationale: opts.rationale,
    meta: opts.meta,
    change: async (ctx) => {
      const row = await getAttachment(ctx.db, id, { forUpdate: true });
      if (opts.expectedVersion !== undefined && row.version !== opts.expectedVersion)
        throw new DomainError('version_conflict', `첨부 ${id} 가 다른 변경으로 바뀜(현재 version ${row.version})`, {
          current: { version: row.version },
        });
      await ctx.db.query(
        `UPDATE entity_attachment SET deleted_at = now(), deleted_by = $2, delete_reason = $3, updated_by = $2, last_changeset_id = $4
          WHERE id = $1`,
        [id, ctx.authorId, opts.reason ?? null, ctx.changesetId],
      );
      return { action: 'delete', attachment_id: id };
    },
  });
}

// ---------------------------------------------------------------------------
// 되돌리기(revert.ts 가 부른다)
// ---------------------------------------------------------------------------

/**
 * 첨부 변경 op 되돌리기: 그 op 가 바꾼 첨부 하나를 op 전 상태로. op 뒤에 그 첨부가 다시 바뀌었으면 409.
 */
export async function revertAttachmentChange(
  db: Queryable,
  op: {
    changeset_id: string;
    seq: number;
    entity_id: string;
    payload: AnyObject;
    before: AnyObject | null;
    after: AnyObject | null;
  },
  authorId: string,
  opts: { title?: string; meta?: AnyObject } = {},
): Promise<AttachmentWriteResult> {
  const change = op.payload.attachment as AttachmentChange;
  const aid = change.attachment_id;
  const beforeList = ((op.before?.attachments as AttachmentItem[] | undefined) ?? []).find((a) => a.id === aid) ?? null;
  const afterList = ((op.after?.attachments as AttachmentItem[] | undefined) ?? []).find((a) => a.id === aid) ?? null;
  const row = await getAttachment(db, aid, { includeDeleted: true });
  return inChangeset(db, {
    parentId: row.entity_id,
    authorId,
    title: opts.title ?? `되돌리기: ${op.changeset_id} #${op.seq}(첨부 ${aid})`,
    origin: 'revert',
    revertsChangesetId: op.changeset_id,
    meta: { ...(opts.meta ?? {}), reverted_seq: op.seq },
    change: async (ctx) => {
      const cur = await getAttachment(ctx.db, aid, { includeDeleted: true, forUpdate: true });
      const conflict = () =>
        new DomainError('version_conflict', `첨부 ${aid} 가 그 뒤에 다시 바뀌어 되돌릴 수 없음`, {
          current: { version: cur.version },
        });
      switch (change.action) {
        case 'create':
        case 'restore':
          if (cur.deleted_at || (afterList && cur.version !== afterList.version)) throw conflict();
          await ctx.db.query(
            `UPDATE entity_attachment SET deleted_at = now(), deleted_by = $2, delete_reason = '되돌리기', updated_by = $2, last_changeset_id = $3
              WHERE id = $1`,
            [aid, ctx.authorId, ctx.changesetId],
          );
          return { action: 'delete', attachment_id: aid };
        case 'delete':
          if (!cur.deleted_at) throw conflict();
          await ctx.db.query(
            `UPDATE entity_attachment SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL, updated_by = $2, last_changeset_id = $3
              WHERE id = $1`,
            [aid, ctx.authorId, ctx.changesetId],
          );
          return { action: 'restore', attachment_id: aid };
        case 'update': {
          if (!beforeList || cur.deleted_at || (afterList && cur.version !== afterList.version)) throw conflict();
          const b = beforeList;
          await ctx.db.query(
            `UPDATE entity_attachment SET kind = $2, title = $3, quote = $4, url = $5, document_id = $6, page = $7, source_id = $8,
                    is_public = $9, origin = $10, ord = $11, updated_by = $12, last_changeset_id = $13 WHERE id = $1`,
            [
              aid,
              b.kind,
              b.title,
              b.quote,
              b.url,
              b.document_id,
              b.page,
              b.source_id,
              b.is_public,
              b.origin,
              b.ord,
              ctx.authorId,
              ctx.changesetId,
            ],
          );
          return { action: 'update', attachment_id: aid, data: { reverted_to_version: b.version } };
        }
      }
    },
  });
}

/** change_op 이 첨부 변경인가 */
export function isAttachmentOp(payload: unknown): boolean {
  return !!payload && typeof payload === 'object' && 'attachment' in (payload as AnyObject);
}
