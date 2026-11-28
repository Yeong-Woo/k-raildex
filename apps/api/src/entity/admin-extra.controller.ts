/**
 * 하위 자원·보조 경로(docs/04-api.md 4·4-1·4-3절): 휴지통, 참조, ID 변경, 역 병합, 노선역 목록, 참조 선택기, 코드값.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { codes, idSchema } from '@k-raildex/contracts';
import {
  listTrash,
  lookup,
  mergePreview,
  schemaCases,
  schemaGraph,
  schemaTrace,
  lineStops,
  stopNeighbors,
  TRACE_ROOT_TYPES,
} from '@k-raildex/domain';
import { z } from 'zod';
import { CurrentPrincipal, RequireScope, type Principal } from '../auth/principal';
import { boolParam, entityTypeParam, limitParam, offsetParam, writeOptionsSchema } from '../common/http';
import { EntityService } from './entity.service';

type Q = Record<string, string | undefined>;

const renameSchema = z.object({ new_id: z.string().min(1), reason: z.string().optional() }).strict();
const mergeSchema = z
  .object({ into_id: idSchema('station'), reason: z.string().optional(), source_id: idSchema('source').optional() })
  .strict();
const lineStationsPutSchema = z.object({ items: z.array(z.record(z.string(), z.unknown())) }).strict();

@Controller('v1/admin')
export class AdminExtraController {
  constructor(@Inject(EntityService) private readonly svc: EntityService) {}

  @Get('trash')
  @RequireScope('admin:read')
  async trash(@Query() query: Q) {
    const q = z.object({ type: z.string().optional(), limit: limitParam, offset: offsetParam }).parse(query);
    return listTrash(this.svc.db, {
      type: q.type ? entityTypeParam(q.type) : undefined,
      limit: q.limit,
      offset: q.offset,
    });
  }

  /** 데이터 스키마(관리 앱 "데이터 스키마"): 표·열·관계 */
  @Get('schema')
  @RequireScope('admin:read')
  async schema() {
    return schemaGraph(this.svc.db);
  }

  /** 관계 예시 경우(DB 에서 고른 개체) */
  @Get('schema/cases')
  @RequireScope('admin:read')
  async schemaCases() {
    return { items: await schemaCases(this.svc.db) };
  }

  /** 한 개체에서 계획·노선·노선역·역 그룹·시설·지도 선형·OSM relation 까지 관계 추적 */
  @Get('schema/trace')
  @RequireScope('admin:read')
  async schemaTrace(@Query() query: Q) {
    const q = z.object({ type: z.enum(TRACE_ROOT_TYPES), id: z.string().min(1) }).parse(query);
    return schemaTrace(this.svc.db, q.type, q.id);
  }

  @Get('lookup')
  @RequireScope('admin:read')
  async lookup(@Query() query: Q) {
    const q = z
      .object({
        type: z.string().min(1),
        q: z.string().default(''),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(query);
    return { items: await lookup(this.svc.db, entityTypeParam(q.type), q.q, q.limit) };
  }

  @Get('reference')
  @RequireScope('admin:read')
  async reference() {
    const codeLists = Object.fromEntries(
      Object.entries(codes).map(([domain, t]) => [
        domain,
        t.values.map((v) => {
          const info = (t.labels as Record<string, { ko: string; desc?: string }>)[v]!;
          return { value: v, label: info.ko, ...(info.desc ? { desc: info.desc } : {}) };
        }),
      ]),
    );
    const db = this.svc.db;
    const [areas, regions, systems] = await Promise.all([
      db.query(`SELECT code, name_ko, name_en, ord FROM ref_area ORDER BY ord`),
      db.query(`SELECT code, name_ko, short_ko, slug, area_code, ord FROM ref_region ORDER BY ord`),
      db.query(
        `SELECT code, name_ko, source_id, entity_type, multi_per_entity, multi_entity_per_code, note FROM ref_external_system ORDER BY code`,
      ),
    ]);
    return { codes: codeLists, areas: areas.rows, regions: regions.rows, external_systems: systems.rows };
  }

  @Get('entities/:id/references')
  @RequireScope('admin:read')
  async references(@Param('id') id: string, @Query('include_inactive') inactive: string | undefined) {
    const type = await this.svc.typeOfId(id);
    const items = await this.svc.references(type, id, !boolParam.parse(inactive));
    return { id, type, items, total: items.reduce((n, r) => n + r.count, 0) };
  }

  @Post('entities/:id/rename')
  @HttpCode(200)
  @RequireScope('admin:write')
  async rename(@Param('id') id: string, @Body() body: unknown, @Query() query: Q, @CurrentPrincipal() p: Principal) {
    const input = renameSchema.parse(body ?? {});
    const opts = writeOptionsSchema.parse(query);
    const type = await this.svc.typeOfId(id);
    const r = await this.svc.apply(
      p,
      [{ op: 'rename_id', entity_type: type, id, new_id: input.new_id, reason: input.reason }],
      opts,
      `ID 변경 ${id} → ${input.new_id}`,
    );
    return { ...this.svc.toWriteResponse(r, opts.dry_run), old_id: id };
  }

  /** 병합 미리 보기(저장 없음): 옮겨질 노선역·참조·거리 */
  @Get('stations/:id/merge-preview')
  @RequireScope('admin:read')
  async mergePreview(@Param('id') id: string, @Query('into_id') into: string | undefined) {
    return mergePreview(this.svc.db, id, idSchema('station').parse(into));
  }

  @Post('stations/:id/merge')
  @HttpCode(200)
  @RequireScope('admin:write')
  async merge(@Param('id') id: string, @Body() body: unknown, @Query() query: Q, @CurrentPrincipal() p: Principal) {
    const input = mergeSchema.parse(body ?? {});
    const opts = writeOptionsSchema.parse(query);
    const r = await this.svc.apply(
      p,
      [
        {
          op: 'merge_station',
          entity_type: 'station',
          id,
          into_id: input.into_id,
          reason: input.reason,
          source_id: input.source_id,
        },
      ],
      opts,
      `역 병합 ${id} → ${input.into_id}`,
    );
    return { ...this.svc.toWriteResponse(r, opts.dry_run), merged_id: id };
  }

  @Get('lines/:id/stations')
  @RequireScope('admin:read')
  async lineStations(@Param('id') id: string) {
    const items = await this.svc.lineStations(id);
    return { line_id: id, items, total: items.length };
  }

  /** 정거장 순서(0042): 노선역 + 노선 위 신호장·신호소·조차장, 앞뒤 정거장·거리(km 차이, 없으면 null) */
  @Get('lines/:id/stops')
  @RequireScope('admin:read')
  async lineStops(@Param('id') id: string) {
    const items = await lineStops(this.svc.db, id);
    return { line_id: id, items, total: items.length };
  }

  /** 한 정거장(역 그룹 station · 시설 facility)의 모든 노선 앞뒤 정거장 */
  @Get('stops/:type/:id/neighbors')
  @RequireScope('admin:read')
  async stopNeighbors(@Param('type') type: string, @Param('id') id: string) {
    const items = await stopNeighbors(this.svc.db, type, id);
    return { node_type: type, node_id: id, items, total: items.length };
  }

  @Put('lines/:id/stations')
  @RequireScope('admin:write')
  async replaceLineStations(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query() query: Q,
    @CurrentPrincipal() p: Principal,
  ) {
    const input = lineStationsPutSchema.parse(body ?? {});
    const opts = writeOptionsSchema.parse(query);
    const ops = await this.svc.planLineStationOps(id, input.items);
    if (!ops.length) {
      const items = await this.svc.lineStations(id);
      return { line_id: id, changeset_id: null, data_version: null, dry_run: opts.dry_run, ops: [], items };
    }
    const r = await this.svc.apply(p, ops, opts, `노선역 목록 교체 ${id}`);
    return {
      line_id: id,
      changeset_id: r.changeset_id,
      data_version: r.data_version,
      dry_run: opts.dry_run,
      ops: r.results.map((x) => ({ seq: x.seq, op: x.op, entity_id: x.entity_id, changed: x.changed })),
      items: opts.dry_run ? null : await this.svc.lineStations(id),
    };
  }
}
