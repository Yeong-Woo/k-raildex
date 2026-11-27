/** 공개 API — 노선·역·운행 계통·시간표(docs/04-api.md 5절, docs/06-public-web.md 2절) */
import { z } from 'zod';
import { codes } from '../codes';
import {
  pubAreas,
  pubDetailTail,
  pubEventSchema,
  pubFuzzy,
  pubList,
  pubRefSchema,
  pubStage,
  pubStatus,
  pubTargetSchema,
} from './common';

const lineCommon = {
  id: z.string(),
  name_ko: z.string(),
  name_en: z.string().nullable(),
  name_full: z.string().nullable(),
  category: z.enum(codes.lineCategory.values),
  rail_class: z.enum(codes.railClass.values),
  is_wide_area: z.boolean().nullable(),
  line_role: z.enum(codes.lineRole.values).nullable(),
  status: pubStatus,
  color: z.string().nullable(),
  length_km: z.number().nullable(),
  opened: pubFuzzy,
  closed: pubFuzzy,
  areas: pubAreas,
  regions: z.array(z.string()),
  operators: z.array(pubRefSchema.extend({ role: z.string().nullable() }).strict()),
  parent_line_id: z.string().nullable(),
  /** 국토교통부 고시 사업용철도 노선번호(본선 세 자리, 지선 다섯 자리) */
  line_no: z.string().nullable(),
  /** 본선 — 지선이면 노선번호 앞 세 자리가 같은 노선(v_line_branch, 0033) */
  branch_of: pubRefSchema.nullable(),
  review_status: z.enum(codes.reviewStatus.values),
};

export const publicLineListItemSchema = z
  .object({
    ...lineCommon,
    station_count: z.number().int(),
    target_open: pubFuzzy,
    /** 여객 취급 여부(false = 화물 전용 등, 노선 목록 "여객 미취급" 탭 — round-06 Q130 A) */
    passenger: z.boolean(),
  })
  .strict();
export const publicLineListSchema = pubList(publicLineListItemSchema);
export type PublicLineListItem = z.infer<typeof publicLineListItemSchema>;

/** 노선의 역 순서 한 칸(노선역 — 노선마다 이름·역번호·구간별 상태) */
export const publicLineStopSchema = z
  .object({
    station_id: z.string(),
    seq: z.number().int(),
    branch: z.string().nullable(),
    km: z.number().nullable(),
    station_code: z.string().nullable(),
    order_confirmed: z.boolean(),
    name_ko: z.string(),
    name_en: z.string().nullable(),
    status: pubStatus,
    opened: pubFuzzy,
    closed: pubFuzzy,
    operator: pubRefSchema.nullable(),
    /** 이 역의 다른 노선(환승) */
    transfer_line_ids: z.array(z.string()),
  })
  .strict();

export const publicPlanLinkSchema = z
  .object({
    plan_id: z.string(),
    name_ko: z.string(),
    role: z.string(),
    stage: pubStage.nullable(),
    target_open: pubTargetSchema.nullable(),
  })
  .strict();

export const publicLineDetailSchema = z
  .object({
    ...lineCommon,
    name_hanja: z.string().nullable(),
    wide_area_note: z.string().nullable(),
    passenger_service: z.boolean(),
    owner: z.string().nullable(),
    start_station: pubRefSchema.nullable(),
    end_station: pubRefSchema.nullable(),
    track: z.string().nullable(),
    electrification: z.string().nullable(),
    gauge_mm: z.number().nullable(),
    design_speed_kmh: z.number().nullable(),
    description: z.string().nullable(),
    target_open: pubFuzzy,
    region_names: z.array(z.object({ code: z.string(), name_ko: z.string() }).strict()),
    stations: z.array(publicLineStopSchema),
    child_lines: z.array(pubRefSchema.extend({ status: pubStatus }).strict()),
    /** 이 노선(본선)의 지선 — 고시 노선번호 순 */
    branches: z.array(
      pubRefSchema
        .extend({
          status: pubStatus,
          line_role: z.enum(codes.lineRole.values).nullable(),
          line_no: z.string().nullable(),
        })
        .strict(),
    ),
    services: z.array(pubRefSchema.extend({ kind: z.string(), status: pubStatus }).strict()),
    plans: z.array(publicPlanLinkSchema),
    events: z.array(pubEventSchema),
    ...pubDetailTail,
  })
  .strict();
export type PublicLineDetail = z.infer<typeof publicLineDetailSchema>;

// ------------------------------------------------------------------ 역

const coordSchema = z.object({ lat: z.number(), lng: z.number() }).strict();

export const publicStationListItemSchema = z
  .object({
    id: z.string(),
    name_ko: z.string(),
    name_en: z.string().nullable(),
    kind: z.enum(codes.stationKind.values),
    status: pubStatus,
    opened: pubFuzzy,
    closed: pubFuzzy,
    region_code: z.string().nullable(),
    areas: pubAreas,
    line_ids: z.array(z.string()),
    line_classes: z.array(z.string()),
    service_kinds: z.array(z.string()),
    station_codes: z.array(z.string()),
    coord: coordSchema.nullable(),
    /** 근사 좌표(coord_basis parcel·district·township) — 지도에서 회색 */
    approximate: z.boolean(),
    review_status: z.enum(codes.reviewStatus.values),
  })
  .strict();
export type PublicStationListItem = z.infer<typeof publicStationListItemSchema>;

/** 목록 탭 숫자(필터 결과 기준) */
export const facetSchema = z.record(z.string(), z.number().int());
export const publicStationListSchema = pubList(publicStationListItemSchema)
  .extend({
    facets: z
      .object({ status: facetSchema, area: facetSchema, line_class: facetSchema, service_kind: facetSchema })
      .strict(),
  })
  .strict();

export const publicStationLineSectionSchema = z
  .object({
    line_id: z.string(),
    line_name_ko: z.string(),
    line_color: z.string().nullable(),
    rail_class: z.string(),
    seq: z.number().int(),
    branch: z.string().nullable(),
    km: z.number().nullable(),
    station_code: z.string().nullable(),
    name_ko: z.string(),
    name_en: z.string().nullable(),
    status: pubStatus,
    opened: pubFuzzy,
    closed: pubFuzzy,
    operator: pubRefSchema.nullable(),
    prev: z.array(pubRefSchema),
    next: z.array(pubRefSchema),
  })
  .strict();

export const publicTimetableSummarySchema = z
  .object({
    set_id: z.string(),
    line_id: z.string().nullable(),
    service_id: z.string().nullable(),
    route_code: z.string().nullable(),
    day_type: z.enum(codes.dayType.values),
    direction: z.enum(codes.direction.values),
    direction_label: z.string().nullable(),
    /** 요일 설명 해석 부분을 짧게(splitDayNote shown, Q111 A·Q139 B). 원문 요일구분은 공개하지 않음 */
    day_note: z.string().nullable(),
    data_as_of: z.string().nullable(),
    source_id: z.string().nullable(),
    first_minute: z.number().int().nullable(),
    last_minute: z.number().int().nullable(),
    count: z.number().int(),
    by_hour: z.array(z.number().int()),
  })
  .strict();

/** 차량기지 정보(역 그룹 kind depot): 기능·운영기관·담당 노선·붙은 기지선(노선역의 노선) */
export const publicDepotSchema = z
  .object({
    functions: z.array(z.enum(codes.depotFunction.values)),
    operator: pubRefSchema.nullable(),
    opened: pubFuzzy,
    served_lines: z.array(pubRefSchema.extend({ color: z.string().nullable() }).strict()),
    connecting_lines: z.array(pubRefSchema.extend({ line_role: z.enum(codes.lineRole.values).nullable() }).strict()),
  })
  .strict();
export type PublicDepot = z.infer<typeof publicDepotSchema>;

export const publicStationDetailSchema = z
  .object({
    id: z.string(),
    name_ko: z.string(),
    name_en: z.string().nullable(),
    name_hanja: z.string().nullable(),
    name_full: z.string().nullable(),
    kind: z.enum(codes.stationKind.values),
    status: pubStatus,
    opened: pubFuzzy,
    closed: pubFuzzy,
    target_open: pubFuzzy,
    region: z.object({ code: z.string(), name_ko: z.string(), slug: z.string() }).strict().nullable(),
    address: z.string().nullable(),
    coord: coordSchema.nullable(),
    coord_source: z.string().nullable(),
    coord_basis: z.string().nullable(),
    approximate: z.boolean(),
    grade: z.string().nullable(),
    history_text: z.string().nullable(),
    intro_text: z.string().nullable(),
    areas: pubAreas,
    line_classes: z.array(z.string()),
    review_status: z.enum(codes.reviewStatus.values),
    lines: z.array(publicStationLineSectionSchema),
    services: z.array(pubRefSchema.extend({ kind: z.string(), assumed: z.boolean() }).strict()),
    timetables: z.array(publicTimetableSummarySchema),
    plans: z.array(publicPlanLinkSchema),
    transfer_centers: z.array(pubRefSchema.extend({ status: z.string() }).strict()),
    /** 차량기지(kind depot) 정보 — 아니면 null(0034) */
    depot: publicDepotSchema.nullable(),
    events: z.array(pubEventSchema),
    ...pubDetailTail,
  })
  .strict();
export type PublicStationDetail = z.infer<typeof publicStationDetailSchema>;

// ------------------------------------------------------------------ 운행 계통

const serviceCommon = {
  id: z.string(),
  name_ko: z.string(),
  name_en: z.string().nullable(),
  name_full: z.string().nullable(),
  kind: z.enum(codes.serviceKind.values),
  status: pubStatus,
  color: z.string().nullable(),
  train_class: pubRefSchema.nullable(),
  opened: pubFuzzy,
  closed: pubFuzzy,
  areas: pubAreas,
  line_ids: z.array(z.string()),
  review_status: z.enum(codes.reviewStatus.values),
};

export const publicServiceListItemSchema = z.object({ ...serviceCommon, stop_count: z.number().int() }).strict();
export const publicServiceListSchema = pubList(publicServiceListItemSchema);

export const publicStopPatternSchema = z
  .object({
    code: z.string(),
    name_ko: z.string(),
    name_en: z.string().nullable(),
    type: z.enum(codes.stopPatternType.values),
    note: z.string().nullable(),
    stops: z.array(
      z
        .object({
          station_id: z.string(),
          name_ko: z.string(),
          line_id: z.string(),
          station_code: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const publicServiceDetailSchema = z
  .object({
    ...serviceCommon,
    name_hanja: z.string().nullable(),
    description: z.string().nullable(),
    successor: pubRefSchema.nullable(),
    lines: z.array(pubRefSchema.extend({ color: z.string().nullable(), status: pubStatus }).strict()),
    stop_patterns: z.array(publicStopPatternSchema),
    /** 정차 패턴이 없어 소속 노선의 모든 역으로 본 경우 */
    stops_assumed: z.boolean(),
    train_number_ranges: z.array(
      z
        .object({
          id: z.string(),
          code_prefix: z.string().nullable(),
          range_from: z.number().int(),
          range_to: z.number().int(),
          group: z.string(),
          route_text: z.string().nullable(),
        })
        .strict(),
    ),
    events: z.array(pubEventSchema),
    ...pubDetailTail,
  })
  .strict();
export type PublicServiceDetail = z.infer<typeof publicServiceDetailSchema>;

// ------------------------------------------------------------------ 시간표

export const publicTimetableSchema = z
  .object({
    station: z.object({ id: z.string(), name_ko: z.string() }).strict(),
    sets: z.array(
      publicTimetableSummarySchema
        .omit({ by_hour: true, first_minute: true, last_minute: true, count: true })
        .extend({
          entries: z.array(
            z
              .object({
                minute: z.number().int(),
                dest_name: z.string().nullable(),
                dest_station_id: z.string().nullable(),
                train_no: z.string().nullable(),
                note: z.string().nullable(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type PublicTimetable = z.infer<typeof publicTimetableSchema>;
