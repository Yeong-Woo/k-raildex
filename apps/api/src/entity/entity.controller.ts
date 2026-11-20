/**
 * 개체 CRUD 공통 컨트롤러 `/v1/admin/:type`(docs/04-api.md 4절). :type 은 kebab-case 개체 종류(station, line-station …).
 * 고정 경로(/trash, /lookup, /changesets …)는 Fastify 라우터가 매개변수 경로보다 먼저 고른다.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { listEntities, type Op } from '@k-raildex/domain';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { CurrentPrincipal, RequireScope, type Principal } from '../auth/principal';
import {
  boolParam,
  entityTypeParam,
  etagOf,
  limitParam,
  offsetParam,
  parseIfMatch,
  writeOptionsSchema,
} from '../common/http';
import { EntityService } from './entity.service';

const LIST_KEYS = [
  'q',
  'status',
  'review_status',
  'region',
  'area',
  'include_deleted',
  'updated_since',
  'sort',
  'limit',
  'offset',
] as const;

const listQuerySchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  review_status: z.string().optional(),
  region: z.string().optional(),
  area: z.string().optional(),
  include_deleted: boolParam,
  updated_since: z.string().optional(),
  sort: z.string().optional(),
  limit: limitParam,
  offset: offsetParam,
});

const deleteQuerySchema = writeOptionsSchema.extend({ purge: boolParam, reason: z.string().optional() });
const deleteBodySchema = z.object({ reason: z.string().optional() }).loose().nullish();
const objectBody = z.record(z.string(), z.unknown());

type Q = Record<string, string | undefined>;

@Controller('v1/admin')
export class EntityController {
  constructor(@Inject(EntityService) private readonly svc: EntityService) {}

  @Get(':type')
  @RequireScope('admin:read')
  async list(@Param('type') rawType: string, @Query() query: Q) {
    const type = entityTypeParam(rawType);
    const q = listQuerySchema.parse(query);
    const filters: Record<string, string> = {};
    for (const [k, v] of Object.entries(query))
      if (!(LIST_KEYS as readonly string[]).includes(k) && typeof v === 'string') filters[k] = v;
    return listEntities(this.svc.db, type, { ...q, filters });
  }

  @Post(':type/validate')
  @HttpCode(200)
  @RequireScope('admin:write', 'proposal:write')
  async validate(
    @Param('type') rawType: string,
    @Query('id') id: string | undefined,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
  ) {
    const type = entityTypeParam(rawType);
    const data = objectBody.parse(body ?? {});
    const op: Op = id ? { op: 'update', entity_type: type, id, data } : { op: 'create', entity_type: type, data };
    return this.svc.validate(p, [op]);
  }

  @Get(':type/:id')
  @RequireScope('admin:read')
  async get(
    @Param('type') rawType: string,
    @Param('id') id: string,
    @Query('include_deleted') includeDeleted: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const type = entityTypeParam(rawType);
    const data = await this.svc.read(type, id, boolParam.parse(includeDeleted));
    const refs = await this.svc.references(type, id, true);
    void reply.header('ETag', etagOf(data.version));
    return {
      data,
      version: data.version,
      derived: await this.svc.derived(type, id),
      referenced_by: { total: refs.reduce((n, r) => n + r.count, 0), items: refs },
    };
  }

  @Post(':type')
  @RequireScope('admin:write')
  async create(
    @Param('type') rawType: string,
    @Body() body: unknown,
    @Query() query: Q,
    @CurrentPrincipal() p: Principal,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const type = entityTypeParam(rawType);
    const opts = writeOptionsSchema.parse(query);
    const data = objectBody.parse(body ?? {});
    const r = await this.svc.apply(p, [{ op: 'create', entity_type: type, data }], opts, `${type} 생성`);
    const out = this.svc.toWriteResponse(r, opts.dry_run);
    void reply.status(opts.dry_run ? 200 : 201);
    if (out.version != null) void reply.header('ETag', etagOf(out.version));
    return out;
  }

  @Patch(':type/:id')
  @RequireScope('admin:write')
  async update(
    @Param('type') rawType: string,
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
    @Query() query: Q,
    @CurrentPrincipal() p: Principal,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const type = entityTypeParam(rawType);
    const expected = parseIfMatch(ifMatch, true);
    const opts = writeOptionsSchema.parse(query);
    const data = objectBody.parse(body ?? {});
    const r = await this.svc.apply(
      p,
      [{ op: 'update', entity_type: type, id, data, expected_version: expected }],
      opts,
      `${type} ${id} 수정`,
    );
    const out = this.svc.toWriteResponse(r, opts.dry_run);
    if (out.version != null) void reply.header('ETag', etagOf(out.version));
    return out;
  }

  @Delete(':type/:id')
  @HttpCode(200)
  @RequireScope('admin:write')
  async remove(
    @Param('type') rawType: string,
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
    @Query() query: Q,
    @CurrentPrincipal() p: Principal,
  ) {
    const type = entityTypeParam(rawType);
    const opts = deleteQuerySchema.parse(query);
    if (opts.purge) {
      const r = await this.svc.apply(p, [{ op: 'purge', entity_type: type, id }], opts, `${type} ${id} 영구 삭제`);
      return { ...this.svc.toWriteResponse(r, opts.dry_run), id };
    }
    const reason = deleteBodySchema.parse(body)?.reason ?? opts.reason;
    const expected = parseIfMatch(ifMatch, false);
    const r = await this.svc.apply(
      p,
      [{ op: 'delete', entity_type: type, id, reason, expected_version: expected }],
      opts,
      `${type} ${id} 삭제`,
    );
    return this.svc.toWriteResponse(r, opts.dry_run);
  }

  @Post(':type/:id/restore')
  @HttpCode(200)
  @RequireScope('admin:write')
  async restore(
    @Param('type') rawType: string,
    @Param('id') id: string,
    @Query() query: Q,
    @CurrentPrincipal() p: Principal,
  ) {
    const type = entityTypeParam(rawType);
    const opts = writeOptionsSchema.parse(query);
    const r = await this.svc.apply(p, [{ op: 'restore', entity_type: type, id }], opts, `${type} ${id} 복구`);
    return this.svc.toWriteResponse(r, opts.dry_run);
  }

  @Get(':type/:id/history')
  @RequireScope('admin:read')
  async history(@Param('type') rawType: string, @Param('id') id: string, @Query() query: Q) {
    entityTypeParam(rawType);
    const { limit, offset } = z.object({ limit: limitParam, offset: offsetParam }).parse(query);
    return this.svc.history(id, limit, offset);
  }
}
