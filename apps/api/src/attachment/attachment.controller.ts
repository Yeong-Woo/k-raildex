/**
 * 첨부(docs/04-api.md 4-1절, docs/05-admin-app.md FR-ADM-061). 쓰기마다 변경 묶음 하나(도메인 attachments.ts).
 */
import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { createAttachment, deleteAttachment, listAttachments, updateAttachment } from '@k-raildex/domain';
import { z } from 'zod';
import { CurrentPrincipal, RequireScope, type Principal } from '../auth/principal';
import { boolParam, parseIfMatch } from '../common/http';
import { DbService } from '../db/db.service';

type Q = Record<string, string | undefined>;

const writeQuery = z.object({
  rationale: z.string().optional(),
  changeset_title: z.string().min(1).optional(),
  reason: z.string().optional(),
});
const aidParam = z.coerce.number().int().min(1);

@Controller('v1/admin')
export class AttachmentController {
  constructor(@Inject(DbService) private readonly dbs: DbService) {}

  private meta(p: Principal) {
    return { via: p.via, ...(p.tokenId ? { token_id: p.tokenId } : {}) };
  }

  @Get('entities/:id/attachments')
  @RequireScope('admin:read')
  async list(@Param('id') id: string, @Query('include_deleted') includeDeleted: string | undefined) {
    const items = await listAttachments(this.dbs.db, id, { includeDeleted: boolParam.parse(includeDeleted) });
    return { entity_id: id, items, total: items.length };
  }

  @Post('entities/:id/attachments')
  @RequireScope('admin:write')
  async create(@Param('id') id: string, @Body() body: unknown, @Query() query: Q, @CurrentPrincipal() p: Principal) {
    const q = writeQuery.parse(query);
    const r = await this.dbs.withClient((c) =>
      createAttachment(c, id, body ?? {}, p.userId, { ...q, meta: this.meta(p) }),
    );
    return { ...r.item, changeset_id: r.changeset_id, data_version: r.data_version };
  }

  @Patch('attachments/:aid')
  @RequireScope('admin:write')
  async update(
    @Param('aid') aid: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
    @Query() query: Q,
    @CurrentPrincipal() p: Principal,
  ) {
    const id = aidParam.parse(aid);
    const expected = parseIfMatch(ifMatch, true);
    const q = writeQuery.parse(query);
    const r = await this.dbs.withClient((c) =>
      updateAttachment(c, id, body ?? {}, expected, p.userId, { ...q, meta: this.meta(p) }),
    );
    return { ...r.item, changeset_id: r.changeset_id, data_version: r.data_version };
  }

  @Delete('attachments/:aid')
  @HttpCode(200)
  @RequireScope('admin:write')
  async remove(
    @Param('aid') aid: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Query() query: Q,
    @CurrentPrincipal() p: Principal,
  ) {
    const id = aidParam.parse(aid);
    const q = writeQuery.parse(query);
    const r = await this.dbs.withClient((c) =>
      deleteAttachment(c, id, p.userId, {
        ...q,
        expectedVersion: parseIfMatch(ifMatch, false),
        meta: this.meta(p),
      }),
    );
    return { id, deleted: true, changeset_id: r.changeset_id, data_version: r.data_version };
  }
}
