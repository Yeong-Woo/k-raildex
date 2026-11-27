/**
 * 공개 읽기 API(docs/04-api.md 5절, WP 6.4~6.6) — 공개 사이트 SSR 서버 전용(C-11: 인터넷에 노출하지 않는다).
 * 인증: API 토큰 범위 `public:read`(관리자·개발 우회는 모든 범위). 읽기 모델은 packages/domain/src/public.
 * 모든 응답에 X-Data-Version·ETag·Cache-Control, If-None-Match 가 맞으면 304(public-cache.ts).
 */
import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import { codes } from '@k-raildex/contracts';
import {
  findRedirect,
  listRedirects,
  parseMapAt,
  parseStageMin,
  publicAreas,
  publicClosed,
  publicDocument,
  publicFeed,
  publicHome,
  publicLine,
  publicLines,
  publicMapLines,
  publicMapPlans,
  publicMapService,
  publicMapStations,
  publicMapDepots,
  facilityTracks,
  publicFacility,
  publicMapTimeline,
  publicNumberSearch,
  publicPlan,
  publicPlanProgram,
  publicPlanPrograms,
  publicPlans,
  publicRouteMaps,
  publicSearch,
  publicService,
  publicServices,
  publicSitemap,
  publicSources,
  publicStation,
  publicStations,
  publicTerms,
  publicTimeline,
  publicTimetable,
  publicTrainClasses,
  publicTrains,
  publicTransferCenter,
  publicTransferCenters,
  publicUpcoming,
  type ObjectStore,
  type PublicMapAt,
} from '@k-raildex/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RequireScope } from '../auth/principal';
import { ApiError } from '../common/errors';
import { boolParam, offsetParam } from '../common/http';
import { DbService } from '../db/db.service';
import { contentDisposition } from '../document/document.controller';
import { OBJECT_STORE } from '../tokens';
import { PublicCache } from './public-cache';

type Q = Record<string, string | undefined>;
type Req_ = FastifyRequest;
type Rep = FastifyReply;

/** 공개 목록 기본 500(최대, FR-API-005) */
const page = { limit: z.coerce.number().int().min(1).max(500).default(500), offset: offsetParam };
const optBool = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1'));
const enumOf = <T extends string>(values: readonly T[]) => z.enum(values as [T, ...T[]]).optional();
const area = enumOf(codes.area.values);

const lineQuery = z.object({
  ...page,
  rail_class: enumOf(codes.railClass.values),
  category: enumOf(codes.lineCategory.values),
  status: enumOf(codes.status.values),
  area,
  region: z.string().optional(),
  is_wide_area: optBool,
  q: z.string().optional(),
});
const stationQuery = z.object({
  ...page,
  area,
  region: z.string().optional(),
  status: enumOf(codes.status.values),
  opened: z.enum(['opened', 'unopened', 'closed']).optional(),
  line_class: enumOf(codes.railClass.values),
  service_kind: enumOf(codes.serviceKind.values),
  line_id: z.string().optional(),
  q: z.string().optional(),
  include_facilities: boolParam,
});
const serviceQuery = z.object({
  ...page,
  kind: enumOf(codes.serviceKind.values),
  status: enumOf(codes.status.values),
  area,
  line_id: z.string().optional(),
  train_class_id: z.string().optional(),
});
const planQuery = z.object({
  ...page,
  program_id: z.string().optional(),
  stage: enumOf(codes.planStage.values),
  stage_min: enumOf(codes.planStage.values),
  state: z.enum(['active', 'opened', 'abandoned', 'dormant']).optional(),
  area,
  region: z.string().optional(),
  scope: enumOf(codes.planScope.values),
  ref_class: enumOf(codes.planRefClass.values),
  category: enumOf(codes.planRefCategory.values),
  line_id: z.string().optional(),
  station_id: z.string().optional(),
  has_target: optBool,
  q: z.string().optional(),
});
const timelineQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: offsetParam,
  decade: z.coerce.number().int().optional(),
  year: z.coerce.number().int().optional(),
  type: enumOf(codes.eventType.values),
  target: z.string().optional(),
  area,
  include_derived: optBool,
  /** true = 날짜를 모르는 사건만(연표 "연도 미상", Q117 A) */
  undated: optBool,
});

@Controller('v1/public')
@RequireScope('public:read')
export class PublicController {
  constructor(
    @Inject(DbService) private readonly dbs: DbService,
    @Inject(PublicCache) private readonly cache: PublicCache,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
  ) {}

  private get db() {
    return this.dbs.db;
  }

  /** 현재 데이터 판(공개 사이트 캐시 태그용) */
  @Get('version')
  async version(@Req() req: Req_, @Res() rep: Rep) {
    return this.cache.serve(req, rep, async (version) => ({ data_version: version }));
  }

  @Get('home')
  async home(@Req() req: Req_, @Res() rep: Rep) {
    return this.cache.serve(req, rep, (v) => publicHome(this.db, v));
  }

  @Get('areas')
  async areas(@Req() req: Req_, @Res() rep: Rep) {
    return this.cache.serve(req, rep, () => publicAreas(this.db));
  }

  // ---------------------------------------------------------------- 노선·역·운행 계통

  @Get('lines')
  async lines(@Req() req: Req_, @Res() rep: Rep, @Query() q: Q) {
    const query = lineQuery.parse(q);
    return this.cache.serve(req, rep, () => publicLines(this.db, query));
  }

  @Get('lines/:id')
  async line(@Req() req: Req_, @Res() rep: Rep, @Param('id') id: string) {
    return this.cache.serve(req, rep, () => publicLine(this.db, id), { id });
  }

  @Get('stations')
  async stations(@Req() req: Req_, @Res() rep: Rep, @Query() q: Q) {
    const query = stationQuery.parse(q);
    return this.cache.serve(req, rep, () => publicStations(this.db, query));
  }

  @Get('stations/:id')
  async station(@Req() req: Req_, @Res() rep: Rep, @Param('id') id: string) {
    return this.cache.serve(req, rep, () => publicStation(this.db, id), { id });
  }

  @Get('services')
  async services(@Req() req: Req_, @Res() rep: Rep, @Query() q: Q) {
    const query = serviceQuery.parse(q);
    return this.cache.serve(req, rep, () => publicServices(this.db, query));
  }

  @Get('services/:id')
  async service(@Req() req: Req_, @Res() rep: Rep, @Param('id') id: string) {
    return this.cache.serve(req, rep, () => publicService(this.db, id), { id });
  }

  @Get('timetable/:station_id')
  async timetable(@Req() req: Req_, @Res() rep: Rep, @Param('station_id') id: string) {
    return this.cache.serve(req, rep, () => publicTimetable(this.db, id), { id });
  }

  // ---------------------------------------------------------------- 계획

  @Get('plans')
  async plans(@Req() req: Req_, @Res() rep: Rep, @Query() q: Q) {
    const query = planQuery.parse(q);
    return this.cache.serve(req, rep, () => publicPlans(this.db, query));
  }

  @Get('plans/:id')
  async plan(@Req() req: Req_, @Res() rep: Rep, @Param('id') id: string) {
    return this.cache.serve(req, rep, () => publicPlan(this.db, id), { id });
  }

  @Get('plan-programs')
  async planPrograms(@Req() req: Req_, @Res() rep: Rep, @Query() q: Q) {
    const query = z
      .object({ ...page, kind: enumOf(codes.planProgramKind.values), status: enumOf(codes.planProgramStatus.values) })
      .parse(q);
    return this.cache.serve(req, rep, () => publicPlanPrograms(this.db, query));
  }

  @Get('plan-programs/:id')
  async planProgram(@Req() req: Req_, @Res() rep: Rep, @Param('id') id: string) {
    return this.cache.serve(req, rep, () => publicPlanProgram(this.db, id), { id });
  }

  @Get('transfer-centers')
  async transferCenters(@Req() req: Req_, @Res() rep: Rep, @Query() q: Q) {
    const query = z
      .object({
        ...page,
        status: enumOf(codes.transferCenterStatus.values),
        kind: enumOf(codes.transferCenterKind.values),
        area,
        region: z.string().optional(),
      })
      .parse(q);
    return this.cache.serve(req, rep, () => publicTransferCenters(this.db, query));
  }

  /** 시설(차량기지 등, 0035) */
  @Get('facilities/:id')
  async facility(@Req() req: Req_, @Res() rep: Rep, @Param('id') id: string) {
    return this.cache.serve(req, rep, () => publicFacility(this.db, id), { id });
  }

  @Get('transfer-centers/:id')
  async transferCenter(@Req() req: Req_, @Res() rep: Rep, @Param('id') id: string) {
    return this.cache.serve(req, rep, () => publicTransferCenter(this.db, id), { id });
  }

  // ---------------------------------------------------------------- 개통 예정·폐선·연표

  @Get('upcoming')
  async upcoming(@Req() req: Req_, @Res() rep: Rep, @Query() q: Q) {
    const query = z.object({ area }).parse(q);
    return this.cache.serve(req, rep, () => publicUpcoming(this.db, query));
  }

  @Get('closed')
  async closed(@Req() req: Req_, @Res() rep: Rep) {
    return this.cache.serve(req, rep, () => publicClosed(this.db));
  }

  @Get('timeline')
  async timeline(@Req() req: Req_, @Res() rep: Rep, @Query() q: Q) {
    const query = timelineQuery.parse(q);
    return this.cache.serve(req, rep, () => publicTimeline(this.db, query));
  }

  // ---------------------------------------------------------------- 번호 체계

  @Get('trains')
  async trains(@Req() req: Req_, @Res() rep: Rep) {
    return this.cache.serve(req, rep, () => publicTrains(this.db));
  }

  @Get('train-classes')
  async trainClasses(@Req() req: Req_, @Res() rep: Rep) {
    return this.cache.serve(req, rep, () => publicTrainClasses(this.db));
  }

  @Get('numbers/search')
  async numberSearch(@Req() req: Req_, @Res() rep: Rep, @Query() q: Q) {
    const { n } = z.object({ n: z.string().min(1).max(20) }).parse(q);
    return this.cache.serve(req, rep, () => publicNumberSearch(this.db, n));
  }

  // ---------------------------------------------------------------- 검색

  @Get('search')
  async search(@Req() req: Req_, @Res() rep: Rep, @Query() q: Q) {
    const query = z
      .object({
        q: z.string().max(100).default(''),
        type: z.enum(['station', 'line', 'service', 'plan', 'glossary_term']).optional(),
        area,
        limit: z.coerce.number().int().min(1).max(100).default(30),
      })
      .parse(q);
    return this.cache.serve(req, rep, () => publicSearch(this.db, query), { kind: 'mv' });
  }

  // ---------------------------------------------------------------- 지도

  @Get('map/stations.geojson')
  async mapStations(@Req() req: Req_, @Res() rep: Rep, @Query() q: Q) {
    const at = mapAt(q);
    return this.cache.serve(req, rep, () => publicMapStations(this.db, at), {
      kind: at.mode === 'current' ? 'mv' : 'map',
      contentType: GEOJSON,
    });
  }

  /** 차량기지(현재, 0034) */
  @Get('map/depots.geojson')
  async mapDepots(@Req() req: Req_, @Res() rep: Rep) {
    return this.cache.serve(req, rep, () => publicMapDepots(this.db), { kind: 'map', contentType: GEOJSON });
  }

  /** 시설 OSM 선로(차량기지 안 선로·기지선, 0036 — ODbL) */
  @Get('map/facility-tracks.geojson')
  async mapFacilityTracks(@Req() req: Req_, @Res() rep: Rep) {
    return this.cache.serve(req, rep, () => facilityTracks(this.db), { kind: 'map', contentType: GEOJSON });
  }

  @Get('map/lines.geojson')
  async mapLines(@Req() req: Req_, @Res() rep: Rep, @Query() q: Q) {
    const at = mapAt(q);
    return this.cache.serve(req, rep, () => publicMapLines(this.db, at), {
      kind: at.mode === 'current' ? 'mv' : 'map',
      contentType: GEOJSON,
    });
  }

  /** 계획 선형. at 없으면 올해(개통 예정이 올해 이전인 것 + 지연) */
  @Get('map/plans.geojson')
  async mapPlans(@Req() req: Req_, @Res() rep: Rep, @Query() q: Q) {
    const query = {
      year: parseMapAt(q.at),
      stage_min: parseStageMin(q.stage_min),
      include_undated: boolParam.parse(q.include_undated),
    };
    return this.cache.serve(req, rep, () => publicMapPlans(this.db, query), { kind: 'map', contentType: GEOJSON });
  }

  /** 운행 계통 선형(지도 강조, FR-WEB-029) */
  @Get('map/services/:id.geojson')
  async mapService(@Req() req: Req_, @Res() rep: Rep, @Param('id') id: string) {
    return this.cache.serve(req, rep, () => publicMapService(this.db, id), { id, kind: 'mv', contentType: GEOJSON });
  }

  @Get('map/timeline')
  async mapTimeline(@Req() req: Req_, @Res() rep: Rep, @Query() q: Q) {
    const stage = parseStageMin(q.stage_min);
    return this.cache.serve(req, rep, () => publicMapTimeline(this.db, stage), { kind: 'map' });
  }

  // ---------------------------------------------------------------- 원문·출처·노선도·용어

  /** 원문 정보(다운로드 전 표시용: 파일 이름·크기·라이선스·고지) */
  @Get('documents/:id/info')
  async documentInfo(@Req() req: Req_, @Res() rep: Rep, @Param('id') id: string) {
    return this.cache.serve(req, rep, async () => {
      const d = await publicDocument(this.db, id);
      if (!d) return null;
      const { storage_key: _k, sha256: _s, ...rest } = d;
      return rest;
    });
  }

  /** 공개 가능(publishable·공개 라이선스) 원문 다운로드(Q39·Q75 A). 아니면 404. 저장소에서 스트리밍 */
  @Get('documents/:id')
  async document(@Req() req: Req_, @Res() rep: Rep, @Param('id') id: string, @Query('disposition') disp?: string) {
    const d = await publicDocument(this.db, id);
    if (!d) throw new ApiError(404, 'not_found', '공개 원문이 없음');
    const etag = `"${d.sha256}"`;
    void rep
      .header('etag', etag)
      .header('cache-control', 'public, max-age=3600')
      .header('x-license-class', d.license_class)
      .header('x-content-type-options', 'nosniff');
    if (d.notice) void rep.header('x-license-notice', encodeURIComponent(d.notice));
    const h = req.headers['if-none-match'];
    if (typeof h === 'string' && h.split(',').some((x) => x.trim() === etag)) return rep.status(304).send();
    const stream = await this.store.getStream(d.storage_key);
    return rep
      .type(d.mime)
      .header('content-length', String(d.size_bytes))
      .header('content-disposition', contentDisposition(disp === 'inline' ? 'inline' : 'attachment', d.filename))
      .send(stream);
  }

  @Get('sources')
  async sources(@Req() req: Req_, @Res() rep: Rep, @Query() q: Q) {
    const query = z
      .object({
        ...page,
        type: enumOf(codes.sourceType.values),
        q: z.string().optional(),
        with_documents: optBool,
      })
      .parse(q);
    return this.cache.serve(req, rep, () => publicSources(this.db, query));
  }

  @Get('route-maps')
  async routeMaps(@Req() req: Req_, @Res() rep: Rep) {
    return this.cache.serve(req, rep, () => publicRouteMaps(this.db));
  }

  @Get('terms')
  async terms(@Req() req: Req_, @Res() rep: Rep) {
    return this.cache.serve(req, rep, () => publicTerms(this.db));
  }

  // ---------------------------------------------------------------- 피드·사이트맵·리다이렉트

  @Get('feed/changes')
  async feed(@Req() req: Req_, @Res() rep: Rep, @Query() q: Q) {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(q);
    return this.cache.serve(req, rep, () => publicFeed(this.db, limit));
  }

  @Get('sitemap-entries')
  async sitemap(@Req() req: Req_, @Res() rep: Rep) {
    return this.cache.serve(req, rep, () => publicSitemap(this.db));
  }

  /** 옛 id 전체(공개 사이트 미들웨어가 경로·쿼리 301 과 옛 앵커 연결에 쓴다) */
  @Get('redirects')
  async redirects(@Req() req: Req_, @Res() rep: Rep) {
    return this.cache.serve(req, rep, async () => ({ items: await listRedirects(this.db) }));
  }

  /** 옛 id → 새 id 정보(200). 리다이렉트가 없으면 404 */
  @Get('redirects/:old_id')
  async redirect(@Req() req: Req_, @Res() rep: Rep, @Param('old_id') oldId: string) {
    return this.cache.serve(req, rep, () => findRedirect(this.db, oldId));
  }
}

const GEOJSON = 'application/geo+json; charset=utf-8';

/** at 없음 = 현재 지도(물리화 뷰), at=연도|future = 시점별 지도 */
function mapAt(q: Q): PublicMapAt {
  if (q.at === undefined || q.at === '' || q.at === 'current' || q.at === 'now') return { mode: 'current' };
  return {
    mode: 'at',
    year: parseMapAt(q.at),
    stage_min: parseStageMin(q.stage_min),
    include_undated: boolParam.parse(q.include_undated),
  };
}
