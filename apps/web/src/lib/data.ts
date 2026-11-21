/** 화면별 데이터 읽기(서버 전용). 경로·규격은 docs/04-api.md 5절, packages/contracts/src/public */
import 'server-only';
import { cache } from 'react';
import { z } from 'zod';
import {
  publicAreasSchema,
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

const versionSchema = z.object({ data_version: z.number().int() }).strict();

export const getVersion = cache(async () => (await apiGet('/version', versionSchema)).data_version);
export const getHome = cache(() => apiGet('/home', publicHomeSchema));
export const getAreas = cache(async () => (await apiGet('/areas', publicAreasSchema)).items);

export const getLines = cache(() => apiGetAll<LineItem>('/lines', publicLineListSchema));
export const getStations = cache(() => apiGetAll<StationItem>('/stations', publicStationListSchema));
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
