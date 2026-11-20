/**
 * 여러 건 입력(docs/04-api.md 4-2절, FR-ADM-085): 붙여 넣은 표(TSV)·CSV → 열 대응 추정·값 해석 → draft 변경 묶음(origin bulk_import).
 * 반영은 변경 묶음 승인(POST /v1/admin/changesets/:id/approve)으로 한다.
 */
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import {
  BULK_TARGET_LABELS,
  BULK_TARGETS,
  bulkFields,
  parseBulk,
  submitBulk,
  type BulkTarget,
} from '@k-raildex/domain';
import { z } from 'zod';
import { CurrentPrincipal, RequireScope, type Principal } from '../auth/principal';
import { ApiError } from '../common/errors';
import { DbService } from '../db/db.service';

const target = z.enum(BULK_TARGETS as unknown as [BulkTarget, ...BulkTarget[]]);
const mapping = z.array(z.string().min(1).nullable()).max(500);
const defaults = z
  .object({
    source_id: z.string().min(1).nullable().optional(),
    checked_at: z.iso.date().nullable().optional(),
  })
  .strict();

const baseSchema = z.object({
  entity_type: target.optional(),
  mode: target.optional(),
  mapping: mapping.optional(),
  defaults: defaults.optional(),
});

const parseSchema = baseSchema.extend({ text: z.string().min(1).max(10_000_000) }).strict();
const submitSchema = baseSchema
  .extend({
    text: z.string().min(1).max(10_000_000).optional(),
    rows: z.array(z.array(z.string())).min(1).max(100_000).optional(),
    exclude: z.array(z.number().int().min(1)).optional(),
    title: z.string().min(1).optional(),
    rationale: z.string().optional(),
  })
  .strict();

function targetOf(b: { entity_type?: BulkTarget; mode?: BulkTarget }): BulkTarget {
  const t = b.entity_type ?? b.mode;
  if (!t) throw new ApiError(400, 'bad_request', 'entity_type 또는 mode 가 필요함');
  if (b.entity_type && b.mode && b.entity_type !== b.mode)
    throw new ApiError(400, 'bad_request', 'entity_type 과 mode 는 하나만');
  return t;
}

@Controller('v1/admin/bulk')
export class BulkController {
  constructor(@Inject(DbService) private readonly dbs: DbService) {}

  /** 대상 목록과 입력 가능 필드(열 대응 선택지) */
  @Get('targets')
  @RequireScope('admin:read')
  targets() {
    return { items: BULK_TARGETS.map((t) => ({ target: t, label: BULK_TARGET_LABELS[t], fields: bulkFields(t) })) };
  }

  @Post('parse')
  @HttpCode(200)
  @RequireScope('admin:read')
  async parse(@Body() body: unknown) {
    const b = parseSchema.parse(body ?? {});
    return parseBulk(this.dbs.db, targetOf(b), { text: b.text, mapping: b.mapping, defaults: b.defaults ?? undefined });
  }

  @Post('submit')
  @RequireScope('admin:write')
  async submit(@Body() body: unknown, @CurrentPrincipal() p: Principal) {
    const b = submitSchema.parse(body ?? {});
    if (!b.text && !b.rows) throw new ApiError(400, 'bad_request', 'text 또는 rows 가 필요함');
    const r = await this.dbs.withClient((c) =>
      submitBulk(c, {
        target: targetOf(b),
        text: b.text,
        rows: b.rows,
        mapping: b.mapping,
        defaults: b.defaults ?? undefined,
        exclude: b.exclude,
        title: b.title,
        rationale: b.rationale,
        author_id: p.userId,
      }),
    );
    return { ...r, status: 'draft' };
  }
}
