/**
 * 변경 묶음(docs/04-api.md 4-2절): 목록·상세·draft 제출·미리 보기·승인(일부 op_seqs, base_data_version 충돌 409)·반려·되돌리기.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { codes, type EntityType } from '@k-raildex/contracts';
import {
  applyChangeset,
  approveDraft,
  DomainError,
  rejectDraft,
  revertChangeset,
  submitDraft,
  type Op,
  type RevertResult,
} from '@k-raildex/domain';
import { z } from 'zod';
import { CurrentPrincipal, hasScope, RequireScope, type Principal } from '../auth/principal';
import { ApiError, domainErrorBody } from '../common/errors';
import { limitParam, offsetParam, writeOptionsSchema } from '../common/http';
import { DbService } from '../db/db.service';

type Q = Record<string, string | undefined>;

const entityType = z.enum(codes.entityType.values as unknown as [EntityType, ...EntityType[]]);
const opSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), entity_type: entityType, data: z.record(z.string(), z.unknown()) }).strict(),
  z
    .object({
      op: z.literal('update'),
      entity_type: entityType,
      id: z.string().min(1),
      data: z.record(z.string(), z.unknown()),
      expected_version: z.number().int().min(1).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('delete'),
      entity_type: entityType,
      id: z.string().min(1),
      reason: z.string().optional(),
      expected_version: z.number().int().min(1).optional(),
    })
    .strict(),
  z.object({ op: z.literal('restore'), entity_type: entityType, id: z.string().min(1) }).strict(),
  z.object({ op: z.literal('purge'), entity_type: entityType, id: z.string().min(1) }).strict(),
  z
    .object({
      op: z.literal('rename_id'),
      entity_type: entityType,
      id: z.string().min(1),
      new_id: z.string().min(1),
      reason: z.string().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal('merge_station'),
      entity_type: z.literal('station'),
      id: z.string().min(1),
      into_id: z.string().min(1),
      reason: z.string().optional(),
      source_id: z.string().min(1).optional(),
    })
    .strict(),
]);

const submitSchema = z
  .object({
    title: z.string().min(1),
    rationale: z.string().optional(),
    origin: z.enum(['admin_edit', 'bulk_import', 'importer', 'agent']).optional(),
    ops: z.array(opSchema).min(1),
    meta: z.record(z.string(), z.unknown()).optional(),
    body: z.unknown().optional(),
  })
  .strict();

const listSchema = z.object({
  status: z.enum(codes.changesetStatus.values).optional(),
  origin: z.enum(codes.changesetOrigin.values).optional(),
  limit: limitParam,
  offset: offsetParam,
});

@Controller('v1/admin/changesets')
export class ChangesetController {
  constructor(@Inject(DbService) private readonly dbs: DbService) {}

  @Get()
  @RequireScope('admin:read')
  async list(@Query() query: Q) {
    const q = listSchema.parse(query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) where.push(`c.status = $${params.push(q.status)}`);
    if (q.origin) where.push(`c.origin = $${params.push(q.origin)}`);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await this.dbs.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM changeset c ${w}`, params);
    const { rows } = await this.dbs.db.query(
      `SELECT c.id, c.title, c.rationale, c.origin, c.status, c.author_id, u.display_name AS author,
              c.submitted_at, c.reviewed_at, c.applied_at, c.review_comment, c.error,
              (SELECT count(*)::int FROM change_op o WHERE o.changeset_id = c.id) AS op_count
         FROM changeset c LEFT JOIN app_user u ON u.id = c.author_id ${w}
        ORDER BY c.submitted_at DESC, c.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, q.limit, q.offset],
    );
    return { items: rows, total: total.rows[0]?.n ?? 0, limit: q.limit, offset: q.offset };
  }

  @Get(':id')
  @RequireScope('admin:read')
  async get(@Param('id') id: string) {
    const cs = await this.dbs.db.query(
      `SELECT c.*, u.display_name AS author,
              (SELECT version FROM data_version dv WHERE dv.changeset_id = c.id ORDER BY version DESC LIMIT 1) AS data_version
         FROM changeset c LEFT JOIN app_user u ON u.id = c.author_id WHERE c.id = $1`,
      [id],
    );
    if (!cs.rows[0]) throw new DomainError('not_found', `변경 묶음 ${id} 가 없음`);
    const ops = await this.dbs.db.query(
      `SELECT seq, op, entity_type, entity_id, payload, before, after FROM change_op WHERE changeset_id = $1 ORDER BY seq`,
      [id],
    );
    const evidence = await this.dbs.db.query(
      `SELECT op_seq, document_id, url, quote, locator, confidence, note FROM change_evidence WHERE changeset_id = $1 ORDER BY id`,
      [id],
    );
    const row = cs.rows[0] as Record<string, unknown>;
    return {
      ...row,
      data_version: row.data_version == null ? null : Number(row.data_version),
      ops: ops.rows,
      evidence: evidence.rows,
    };
  }

  /** draft 제출(검수 대기). 관리자 또는 proposal:write 토큰 */
  @Post()
  @RequireScope('admin:write', 'proposal:write')
  async submit(@Body() body: unknown, @CurrentPrincipal() p: Principal) {
    const input = submitSchema.parse(body ?? {});
    const isAdmin = hasScope(p, ['admin:write']);
    const origin = isAdmin ? (input.origin ?? 'admin_edit') : 'agent';
    const id = await this.dbs.withClient((c) =>
      submitDraft(c, {
        title: input.title,
        rationale: input.rationale,
        origin,
        author_id: p.userId,
        ops: input.ops as Op[],
        meta: { ...(input.meta ?? {}), via: p.via, ...(p.tokenId ? { token_id: p.tokenId } : {}) },
        body: input.body,
      }),
    );
    return { id, status: 'draft', op_count: input.ops.length };
  }

  /** 현재 DB 에 적용했을 때의 결과(롤백). 검증 실패도 200 으로 결과에 싣는다 */
  @Post(':id/preview')
  @HttpCode(200)
  @RequireScope('admin:read')
  async preview(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    const { title, ops } = await this.draftOps(id);
    try {
      const r = await this.dbs.withClient((c) =>
        applyChangeset(
          c,
          { title: `미리 보기: ${title}`, origin: 'admin_edit', author_id: p.userId, ops },
          { dryRun: true },
        ),
      );
      return { id, ok: true, results: r.results };
    } catch (e) {
      if (e instanceof DomainError) return { id, ok: false, error: domainErrorBody(e).error };
      throw e;
    }
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequireScope('admin:write')
  async approve(@Param('id') id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    const input = z
      .object({
        comment: z.string().optional(),
        op_seqs: z.array(z.number().int().min(1)).min(1).optional(),
        force: z.boolean().optional(),
      })
      .strict()
      .nullish()
      .parse(body ?? null);
    const r = await this.dbs.withClient((c) =>
      approveDraft(c, id, p.userId, { comment: input?.comment, op_seqs: input?.op_seqs, force: input?.force }),
    );
    return {
      id,
      status: 'applied',
      changeset_id: r.changeset_id,
      data_version: r.data_version,
      remainder_changeset_id: r.remainder_changeset_id,
      results: r.results.map((x) => ({
        seq: x.seq,
        op: x.op,
        entity_type: x.entity_type,
        entity_id: x.entity_id,
        changed: x.changed,
        version: (x.after as { version?: number } | null)?.version ?? null,
      })),
    };
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequireScope('admin:write')
  async reject(@Param('id') id: string, @Body() body: unknown) {
    const input = z
      .object({ comment: z.string().min(1) })
      .strict()
      .parse(body ?? {});
    await this.dbs.withClient((c) => rejectDraft(c, id, input.comment));
    return { id, status: 'rejected' };
  }

  /** 되돌림 묶음 생성·적용(origin revert). dry_run 이면 결과만 */
  @Post(':id/revert')
  @HttpCode(200)
  @RequireScope('admin:write')
  async revert(@Param('id') id: string, @Body() body: unknown, @Query() query: Q, @CurrentPrincipal() p: Principal) {
    const opts = writeOptionsSchema.parse(query);
    const input = z
      .object({ rationale: z.string().optional(), title: z.string().min(1).optional() })
      .strict()
      .nullish()
      .parse(body ?? null);
    const r = await this.dbs.withClient((c) =>
      revertChangeset(c, id, p.userId, {
        title: input?.title ?? opts.changeset_title,
        rationale: input?.rationale ?? opts.rationale,
        dryRun: opts.dry_run,
      }),
    );
    return revertResponse(r, opts.dry_run);
  }

  private async draftOps(id: string): Promise<{ title: string; ops: Op[] }> {
    const cs = await this.dbs.db.query<{ status: string; title: string }>(
      `SELECT status, title FROM changeset WHERE id = $1`,
      [id],
    );
    if (!cs.rows[0]) throw new DomainError('not_found', `변경 묶음 ${id} 가 없음`);
    if (cs.rows[0].status !== 'draft')
      throw new ApiError(409, 'invalid_state', `검수 대기가 아님(${cs.rows[0].status})`);
    const ops = await this.dbs.db.query<{ payload: Op }>(
      `SELECT payload FROM change_op WHERE changeset_id = $1 ORDER BY seq`,
      [id],
    );
    return { title: cs.rows[0].title, ops: ops.rows.map((r) => r.payload) };
  }
}

export function revertResponse(r: RevertResult, dryRun: boolean) {
  if (r.kind === 'attachment')
    return {
      reverts_changeset_id: r.reverts_changeset_id,
      changeset_id: r.changeset_id,
      data_version: r.data_version,
      dry_run: false,
      results: [{ seq: 1, op: 'update', attachment: r.item }],
    };
  return {
    reverts_changeset_id: r.reverts_changeset_id,
    changeset_id: r.changeset_id,
    data_version: r.data_version,
    dry_run: dryRun,
    results: r.results.map((x) => ({
      seq: x.seq,
      op: x.op,
      entity_type: x.entity_type,
      entity_id: x.entity_id,
      changed: x.changed,
      version: (x.after as { version?: number } | null)?.version ?? null,
    })),
  };
}
