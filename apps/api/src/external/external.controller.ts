/**
 * 외부 API 탐색기(docs/04-api.md 4-2-1절, FR-ADM-100~106). 등록된 엔드포인트만 호출하고, 키는 서버가 환경 변수에서 붙인 뒤
 * 저장·응답에서 가린다. 결과는 DB 개체를 바꾸지 않는다(스냅샷 문서로만 남김).
 */
import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import {
  API_PROVIDER_LABELS,
  API_PROVIDERS,
  ALL_PAGES_DEFAULT_CAP,
  ALL_PAGES_MAX_CAP,
  callAllPages,
  callEndpoint,
  compareApiCall,
  createApiEndpoint,
  createApiPreset,
  deleteApiEndpoint,
  deleteApiPreset,
  externalCodesFor,
  getApiCall,
  getApiEndpoint,
  keyStatuses,
  listApiCalls,
  listApiEndpoints,
  listApiPresets,
  PROVIDER_COMMON_KEY_ENV,
  seedApiCatalog,
  snapshotApiCall,
  updateApiEndpoint,
  updateApiPreset,
  type ObjectStore,
} from '@k-raildex/domain';
import { z } from 'zod';
import { CurrentPrincipal, RequireScope, type Principal } from '../auth/principal';
import { ApiError } from '../common/errors';
import { boolParam, limitParam, offsetParam, parseIfMatch } from '../common/http';
import { DbService } from '../db/db.service';
import { EXTERNAL_HTTP, OBJECT_STORE, type ExternalHttp } from '../tokens';
import { parseXml } from './xml';

type Q = Record<string, string | undefined>;

const idParam = (raw: string) => {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) throw new ApiError(404, 'not_found', `없음: ${raw}`);
  return n;
};

@Controller('v1/admin/external')
export class ExternalController {
  constructor(
    @Inject(DbService) private readonly dbs: DbService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(EXTERNAL_HTTP) private readonly http: ExternalHttp,
  ) {}

  private get opts() {
    return { fetchImpl: this.http.fetchImpl, env: this.http.env, parseXml, origin: 'admin' as const };
  }

  @Get('providers')
  @RequireScope('admin:read')
  providers() {
    return {
      items: API_PROVIDERS.map((p) => ({
        code: p,
        label: API_PROVIDER_LABELS[p],
        common_key_env: PROVIDER_COMMON_KEY_ENV[p],
      })),
    };
  }

  // --- 카탈로그 ---

  @Get('endpoints')
  @RequireScope('admin:read')
  async listEndpoints(@Query('include_deleted') includeDeleted: string | undefined) {
    const items = await listApiEndpoints(this.dbs.db, {
      includeDeleted: boolParam.parse(includeDeleted),
      env: this.http.env,
    });
    return { items };
  }

  @Get('endpoints/:id')
  @RequireScope('admin:read')
  async getEndpoint(@Param('id') id: string) {
    return getApiEndpoint(this.dbs.db, id, { env: this.http.env });
  }

  @Post('endpoints')
  @RequireScope('admin:write')
  async createEndpoint(@Body() body: unknown, @CurrentPrincipal() p: Principal) {
    const e = await createApiEndpoint(this.dbs.db, body ?? {}, p.userId);
    return getApiEndpoint(this.dbs.db, e.id, { env: this.http.env });
  }

  @Patch('endpoints/:id')
  @RequireScope('admin:write')
  async updateEndpoint(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentPrincipal() p: Principal,
  ) {
    await updateApiEndpoint(this.dbs.db, id, body ?? {}, p.userId, parseIfMatch(ifMatch, false));
    return getApiEndpoint(this.dbs.db, id, { env: this.http.env });
  }

  @Delete('endpoints/:id')
  @HttpCode(204)
  @RequireScope('admin:write')
  async deleteEndpoint(
    @Param('id') id: string,
    @Query('reason') reason: string | undefined,
    @CurrentPrincipal() p: Principal,
  ) {
    await deleteApiEndpoint(this.dbs.db, id, p.userId, reason);
  }

  /** 초기 카탈로그(FR-ADM-106) 다시 넣기 — id 기준 upsert, 삭제한 항목은 건너뜀 */
  @Post('catalog/seed')
  @HttpCode(200)
  @RequireScope('admin:write')
  async seed(@CurrentPrincipal() p: Principal) {
    return this.dbs.withClient((c) => seedApiCatalog(c, p.userId));
  }

  // --- 호출 ---

  @Post('endpoints/:id/call')
  @HttpCode(200)
  @RequireScope('admin:write')
  async call(@Param('id') id: string, @Body() body: unknown) {
    return callEndpoint(this.dbs.db, id, body ?? {}, this.opts);
  }

  @Post('endpoints/:id/call-all-pages')
  @HttpCode(200)
  @RequireScope('admin:write')
  async callAll(@Param('id') id: string, @Body() body: unknown, @Query() query: Q) {
    const q = z
      .object({ max_pages: z.coerce.number().int().min(1).max(ALL_PAGES_MAX_CAP).default(ALL_PAGES_DEFAULT_CAP) })
      .parse(query);
    return callAllPages(this.dbs.db, id, body ?? {}, { ...this.opts, maxPages: q.max_pages });
  }

  @Get('calls')
  @RequireScope('admin:read')
  async listCalls(@Query() query: Q) {
    const q = z
      .object({ endpoint_id: z.string().min(1).optional(), limit: limitParam, offset: offsetParam })
      .parse(query);
    return listApiCalls(this.dbs.db, q);
  }

  @Get('calls/:id')
  @RequireScope('admin:read')
  async getCall(@Param('id') id: string) {
    return getApiCall(this.dbs.db, idParam(id), { parseXml });
  }

  @Post('calls/:id/snapshot')
  @RequireScope('admin:write')
  async snapshot(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    const r = await this.dbs.withClient((c) => snapshotApiCall(c, this.store, idParam(id), p.userId));
    return { ...r.document, existing: !r.created };
  }

  @Post('calls/:id/compare')
  @HttpCode(200)
  @RequireScope('admin:read')
  async compare(@Param('id') id: string) {
    return compareApiCall(this.dbs.db, idParam(id), { parseXml });
  }

  /** 역 선택기 → 외부 코드(역과 그 노선별 역의 external_ref) */
  @Get('ref-codes')
  @RequireScope('admin:read')
  async refCodes(@Query() query: Q) {
    const q = z.object({ entity_id: z.string().min(1), system: z.string().min(1) }).parse(query);
    return { items: await externalCodesFor(this.dbs.db, q.entity_id, q.system) };
  }

  // --- 즐겨찾기 ---

  @Get('presets')
  @RequireScope('admin:read')
  async presets(@Query('endpoint_id') endpointId: string | undefined) {
    return { items: await listApiPresets(this.dbs.db, endpointId || undefined) };
  }

  @Get('endpoints/:id/presets')
  @RequireScope('admin:read')
  async endpointPresets(@Param('id') id: string) {
    return { items: await listApiPresets(this.dbs.db, id) };
  }

  @Post('endpoints/:id/presets')
  @RequireScope('admin:write')
  async createPreset(@Param('id') id: string, @Body() body: unknown) {
    return createApiPreset(this.dbs.db, id, body ?? {});
  }

  @Patch('presets/:pid')
  @RequireScope('admin:write')
  async updatePreset(@Param('pid') pid: string, @Body() body: unknown) {
    return updateApiPreset(this.dbs.db, idParam(pid), body ?? {});
  }

  @Delete('presets/:pid')
  @HttpCode(204)
  @RequireScope('admin:write')
  async deletePreset(@Param('pid') pid: string) {
    await deleteApiPreset(this.dbs.db, idParam(pid));
  }

  // --- 키 상태 ---

  @Get('keys')
  @RequireScope('admin:read')
  async keys() {
    return { items: await keyStatuses(this.dbs.db, this.http.env) };
  }
}
