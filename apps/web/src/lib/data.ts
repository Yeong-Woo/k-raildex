/** 화면별 데이터 읽기(서버 전용). 경로·규격은 docs/04-api.md 5절, packages/contracts/src/public */
import 'server-only';
import { cache } from 'react';
import { z } from 'zod';
import {
  publicAreasSchema,
  publicClosedSchema,
  publicFeedSchema,
  publicMapTimelineSchema,
  publicNumberSearchSchema,
  publicPlanDetailSchema,
  publicPlanListSchema,
  publicPlanProgramDetailSchema,
  publicPlanProgramListSchema,
  publicRedirectListSchema,
  publicRouteMapListSchema,
  publicSitemapSchema,
  publicSourceListSchema,
  publicTermListSchema,
  publicTimelineSchema,
  publicTrainClassListSchema,
  publicTrainsSchema,
  publicTransferCenterDetailSchema,
  publicTransferCenterListSchema,
  publicUpcomingSchema,
  publicHomeSchema,
  publicLineDetailSchema,
  publicLineListSchema,
  publicSearchSchema,
  publicServiceDetailSchema,
  publicServiceListSchema,
  publicStationDetailSchema,
  publicStationListSchema,
  publicTimetableSchema,
  type PublicLineListItem,
  type PublicPlanListItem,
} from '@k-raildex/contracts';
import { apiGet, apiGetAll } from './api';

export type LineItem = PublicLineListItem;
export type StationItem = z.infer<typeof publicStationListSchema>['items'][number];
export type ServiceItem = z.infer<typeof publicServiceListSchema>['items'][number];
export type Areas = z.infer<typeof publicAreasSchema>['items'];
export type Home = z.infer<typeof publicHomeSchema>;
export type LineDetail = z.infer<typeof publicLineDetailSchema>;
export type StationDetail = z.infer<typeof publicStationDetailSchema>;
export type ServiceDetail = z.infer<typeof publicServiceDetailSchema>;
export type SearchResult = z.infer<typeof publicSearchSchema>;
export type Timetable = z.infer<typeof publicTimetableSchema>;
export type PlanItem = PublicPlanListItem;
export type PlanDetail = z.infer<typeof publicPlanDetailSchema>;
export type Program = z.infer<typeof publicPlanProgramListSchema>['items'][number];
export type ProgramDetail = z.infer<typeof publicPlanProgramDetailSchema>;
export type TransferCenterItem = z.infer<typeof publicTransferCenterListSchema>['items'][number];
export type TransferCenterDetail = z.infer<typeof publicTransferCenterDetailSchema>;
export type Upcoming = z.infer<typeof publicUpcomingSchema>;
export type Closed = z.infer<typeof publicClosedSchema>;
export type TimelinePage = z.infer<typeof publicTimelineSchema>;
export type Trains = z.infer<typeof publicTrainsSchema>;
export type TrainClass = z.infer<typeof publicTrainClassListSchema>['items'][number];
export type RouteMap = z.infer<typeof publicRouteMapListSchema>['items'][number];
export type Term = z.infer<typeof publicTermListSchema>['items'][number];
export type SourceItem = z.infer<typeof publicSourceListSchema>['items'][number];
export type FeedEntry = z.infer<typeof publicFeedSchema>['items'][number];
export type MapTimeline = z.infer<typeof publicMapTimelineSchema>;

const versionSchema = z.object({ data_version: z.number().int() }).strict();

export const getVersion = cache(async () => (await apiGet('/version', versionSchema)).data_version);
export const getHome = cache(() => apiGet('/home', publicHomeSchema));
export const getAreas = cache(async () => (await apiGet('/areas', publicAreasSchema)).items);

export const getLines = cache(() => apiGetAll<LineItem>('/lines', publicLineListSchema));
export const getStations = cache(() => apiGetAll<StationItem>('/stations', publicStationListSchema));
/** 시설(신호장·차량기지 등) 포함 — 역 목록 "시설" 필터(?kind=with|only, Q130 A) */
export const getStationsWithFacilities = cache(() =>
  apiGetAll<StationItem>('/stations', publicStationListSchema, { include_facilities: true }),
);
export const getServices = cache(() => apiGetAll<ServiceItem>('/services', publicServiceListSchema));

export const getLine = cache((id: string) =>
  apiGet(`/lines/${encodeURIComponent(id)}`, publicLineDetailSchema, { tags: [`kr-id:${id}`] }),
);
export const getStation = cache((id: string) =>
  apiGet(`/stations/${encodeURIComponent(id)}`, publicStationDetailSchema, { tags: [`kr-id:${id}`] }),
);
/** 다른 화면에서 곁들여 읽을 때(없으면 null, 301 은 따라가지 않음) */
export const findStation = cache((id: string) =>
  apiGet(`/stations/${encodeURIComponent(id)}`, publicStationDetailSchema, { tags: [`kr-id:${id}`], nullOn404: true }),
);
export const getService = cache((id: string) =>
  apiGet(`/services/${encodeURIComponent(id)}`, publicServiceDetailSchema, { tags: [`kr-id:${id}`] }),
);
export const getTimetable = cache((stationId: string) =>
  apiGet(`/timetable/${encodeURIComponent(stationId)}`, publicTimetableSchema, {
    tags: [`kr-id:${stationId}`],
    nullOn404: true,
  }),
);
export const search = cache((q: string, type?: string) =>
  apiGet('/search', publicSearchSchema, { query: { q, type, limit: 100 } }),
);

export interface LineRef {
  id: string;
  name_ko: string;
  color: string | null;
  status: LineItem['status'];
  rail_class: LineItem['rail_class'];
}

/** 노선 id → 이름·색(환승 칩·목록용) */
export const getLineIndex = cache(async (): Promise<Map<string, LineRef>> => {
  const lines = await getLines();
  return new Map(
    lines.map((l) => [
      l.id,
      { id: l.id, name_ko: l.name_ko, color: l.color, status: l.status, rail_class: l.rail_class },
    ]),
  );
});

export interface RegionRef {
  code: string;
  name_ko: string;
  short_ko: string;
  slug: string;
  area_code: string;
}

/** 시·도 코드·slug → 이름 */
export const getRegionIndex = cache(async () => {
  const areas = await getAreas();
  const byCode = new Map<string, RegionRef>();
  const bySlug = new Map<string, RegionRef>();
  for (const a of areas)
    for (const r of a.regions) {
      const ref = { code: r.code, name_ko: r.name_ko, short_ko: r.short_ko, slug: r.slug, area_code: r.area_code };
      byCode.set(r.code, ref);
      bySlug.set(r.slug, ref);
    }
  return { byCode, bySlug };
});

// ------------------------------------------------------------------ 계획·상위 계획·환승센터(WP 7.3)

export const getPlans = cache(() => apiGetAll<PlanItem>('/plans', publicPlanListSchema));
export const getPlan = cache((id: string) =>
  apiGet(`/plans/${encodeURIComponent(id)}`, publicPlanDetailSchema, { tags: [`kr-id:${id}`] }),
);
/** 다른 화면에서 곁들여 읽을 때(없으면 null) */
export const findPlan = cache((id: string) =>
  apiGet(`/plans/${encodeURIComponent(id)}`, publicPlanDetailSchema, { tags: [`kr-id:${id}`], nullOn404: true }),
);
export const getPrograms = cache(() => apiGetAll<Program>('/plan-programs', publicPlanProgramListSchema));
export const getProgram = cache((id: string) =>
  apiGet(`/plan-programs/${encodeURIComponent(id)}`, publicPlanProgramDetailSchema, { tags: [`kr-id:${id}`] }),
);
export const getTransferCenters = cache(() =>
  apiGetAll<TransferCenterItem>('/transfer-centers', publicTransferCenterListSchema),
);
export const getTransferCenter = cache((id: string) =>
  apiGet(`/transfer-centers/${encodeURIComponent(id)}`, publicTransferCenterDetailSchema, { tags: [`kr-id:${id}`] }),
);

// ------------------------------------------------------------------ P2(WP 7.4)

export const getUpcoming = cache(() => apiGet('/upcoming', publicUpcomingSchema));
export const getClosed = cache(() => apiGet('/closed', publicClosedSchema));
/** area = 권역 코드(기존 `?area=`, Q130 A) */
export const getTimelineDecade = cache(async (decade: number, area?: string) => {
  const a = area ? { area } : {};
  const first = await apiGet('/timeline', publicTimelineSchema, { query: { decade, limit: 500, offset: 0, ...a } });
  const items = [...first.items];
  for (let offset = 500; items.length < first.total; offset += 500) {
    const page = await apiGet('/timeline', publicTimelineSchema, { query: { decade, limit: 500, offset, ...a } });
    if (page.items.length === 0) break;
    items.push(...page.items);
  }
  return { items, total: first.total, decades: first.decades };
});
/** 날짜 미상 기록 전부(Q117 A, 공개 API `undated=true`). area = 권역 코드(기존 `?area=`) */
export const getTimelineUndated = cache(async (area?: string) => {
  const items: Awaited<ReturnType<typeof apiGet<typeof publicTimelineSchema>>>['items'] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await apiGet('/timeline', publicTimelineSchema, {
      query: { undated: 'true', limit: 500, offset, ...(area ? { area } : {}) },
    });
    items.push(...page.items);
    if (page.items.length === 0 || items.length >= page.total) break;
  }
  return items;
});
/** 날짜 미상 기록 수(연대 줄의 "연도 미상" 칸) */
export const getTimelineUndatedCount = cache(
  async () => (await apiGet('/timeline', publicTimelineSchema, { query: { undated: 'true', limit: 1 } })).total,
);
/** 연대 목록만(항목 1건) */
export const getTimelineDecades = cache(
  async () => (await apiGet('/timeline', publicTimelineSchema, { query: { limit: 1 } })).decades,
);
export const getTrains = cache(() => apiGet('/trains', publicTrainsSchema));
export const getTrainClasses = cache(async () => (await apiGet('/train-classes', publicTrainClassListSchema)).items);
export const searchNumber = cache((n: string) => apiGet('/numbers/search', publicNumberSearchSchema, { query: { n } }));
export const getRouteMaps = cache(async () => (await apiGet('/route-maps', publicRouteMapListSchema)).items);
export const getTerms = cache(async () => (await apiGet('/terms', publicTermListSchema)).items);
export const getSources = cache(() => apiGetAll<SourceItem>('/sources', publicSourceListSchema));
export const getMapTimeline = cache((stageMin: string) =>
  apiGet('/map/timeline', publicMapTimelineSchema, { query: { stage_min: stageMin } }),
);

// ------------------------------------------------------------------ 피드·사이트맵·리다이렉트(WP 7.5)

export const getFeed = cache(
  async (limit = 50) => (await apiGet('/feed/changes', publicFeedSchema, { query: { limit } })).items,
);
export const getSitemapEntries = cache(async () => (await apiGet('/sitemap-entries', publicSitemapSchema)).items);
export const getRedirectList = cache(async () => (await apiGet('/redirects', publicRedirectListSchema)).items);

/** 상위 계획 id → 이름·약칭 */
export const getProgramIndex = cache(async () => new Map((await getPrograms()).map((p) => [p.id, p])));
