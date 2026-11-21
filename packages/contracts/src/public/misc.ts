/** 공개 API — 홈·권역·개통 예정·폐선·연표·번호 체계·검색·출처·노선도·용어·피드·사이트맵·지도 연도(docs/04-api.md 5절) */
import { z } from 'zod';
import { codes } from '../codes';
import {
  pubAreas,
  pubAttachmentSchema,
  pubDocumentSchema,
  pubEventSchema,
  pubFuzzy,
  pubList,
  pubNameSchema,
  pubRedirectSchema,
  pubRefSchema,
  pubSourceRefSchema,
  pubStage,
  pubStatus,
  pubTargetSchema,
  pubTimestamp,
} from './common';

const countMap = z.record(z.string(), z.number().int());

// ------------------------------------------------------------------ 권역·시·도

export const publicRegionSchema = z
  .object({
    code: z.string(),
    name_ko: z.string(),
    short_ko: z.string(),
    slug: z.string(),
    area_code: z.string(),
    stations: z.number().int(),
    lines: z.number().int(),
    plans: z.number().int(),
  })
  .strict();

export const publicAreaSchema = z
  .object({
    code: z.enum(codes.area.values),
    name_ko: z.string(),
    name_en: z.string().nullable(),
    lines: z.number().int(),
    stations: z.number().int(),
    services: z.number().int(),
    plans: z.number().int(),
    regions: z.array(publicRegionSchema),
  })
  .strict();
export const publicAreasSchema = z.object({ items: z.array(publicAreaSchema) }).strict();

// ------------------------------------------------------------------ 홈

export const publicChangeEntrySchema = z
  .object({
    version: z.number().int(),
    committed_at: pubTimestamp,
    entity_count: z.number().int(),
    /** 공개 개체만(삭제·내부 개체 제외), 최대 20개 */
    entities: z
      .array(
        z
          .object({
            id: z.string(),
            type: z.enum(codes.entityType.values),
            name_ko: z.string(),
            url_path: z.string().nullable(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

export const publicUpcomingPlanSchema = z
  .object({
    id: z.string(),
    name_ko: z.string(),
    stage: pubStage.nullable(),
    target_open: pubTargetSchema,
    areas: pubAreas,
  })
  .strict();

export const publicHomeSchema = z
  .object({
    data_version: z.number().int(),
    stats: z
      .object({
        lines: z.object({ total: z.number().int(), by_status: countMap }).strict(),
        stations: z.object({ total: z.number().int(), by_status: countMap }).strict(),
        services: z.object({ total: z.number().int(), by_kind: countMap }).strict(),
        plans: z.object({ total: z.number().int(), active: z.number().int(), by_stage: countMap }).strict(),
        plan_programs: z.number().int(),
        transfer_centers: z.number().int(),
        events: z.number().int(),
        glossary_terms: z.number().int(),
        sources: z.number().int(),
      })
      .strict(),
    areas: z.array(publicAreaSchema),
    upcoming: z.array(publicUpcomingPlanSchema),
    recent_changes: z.array(publicChangeEntrySchema),
  })
  .strict();
export type PublicHome = z.infer<typeof publicHomeSchema>;

// ------------------------------------------------------------------ 개통 예정·폐선

const upcomingEntity = z
  .object({
    id: z.string(),
    name_ko: z.string(),
    status: pubStatus,
    target_open: pubFuzzy,
    areas: pubAreas,
    plan_ids: z.array(z.string()),
  })
  .strict();

export const publicUpcomingSchema = z
  .object({
    lines: z.array(upcomingEntity),
    stations: z.array(upcomingEntity),
    plans: z.array(publicUpcomingPlanSchema),
  })
  .strict();

const closedEntity = z
  .object({ id: z.string(), name_ko: z.string(), opened: pubFuzzy, closed: pubFuzzy, areas: pubAreas })
  .strict();
export const publicClosedSchema = z
  .object({ lines: z.array(closedEntity), stations: z.array(closedEntity), services: z.array(closedEntity) })
  .strict();

// ------------------------------------------------------------------ 연표

export const publicTimelineSchema = pubList(pubEventSchema)
  .extend({ decades: z.array(z.object({ decade: z.number().int(), count: z.number().int() }).strict()) })
  .strict();

// ------------------------------------------------------------------ 번호 체계

export const publicTrainNumberRangeSchema = z
  .object({
    id: z.string(),
    operator: pubRefSchema,
    code_prefix: z.string().nullable(),
    range_from: z.number().int(),
    range_to: z.number().int(),
    group: z.enum(codes.tnrGroup.values),
    train_class: pubRefSchema.nullable(),
    route_text: z.string().nullable(),
    parity_rule: z.string().nullable(),
    valid_from: pubFuzzy,
    valid_to: pubFuzzy,
    note: z.string().nullable(),
    line_ids: z.array(z.string()),
    service_ids: z.array(z.string()),
    checked_at: z.string(),
    sources: z.array(pubSourceRefSchema),
  })
  .strict();

export const publicRollingStockRangeSchema = z
  .object({
    id: z.string(),
    operator: pubRefSchema,
    series: z.string(),
    number_prefix: z.string().nullable(),
    number_from: z.number().int(),
    number_to: z.number().int(),
    digits: z.number().int(),
    group: z.enum(codes.rsrGroup.values),
    model: z.string().nullable(),
    train_class: pubRefSchema.nullable(),
    number_rule: z.string().nullable(),
    status: z.enum(codes.rsrStatus.values),
    introduced: pubFuzzy,
    retired: pubFuzzy,
    owner_note: z.string().nullable(),
    formation: z
      .object({
        label: z.string().nullable(),
        from: z.string().nullable(),
        to: z.string().nullable(),
        count: z.number().int().nullable(),
        cars: z.number().int().nullable(),
        code_prefix: z.string().nullable(),
        note: z.string().nullable(),
      })
      .strict(),
    note: z.string().nullable(),
    line_ids: z.array(z.string()),
    service_ids: z.array(z.string()),
    checked_at: z.string(),
    sources: z.array(pubSourceRefSchema),
  })
  .strict();

export const publicTrainsSchema = z
  .object({
    train_number_ranges: z.array(publicTrainNumberRangeSchema),
    rolling_stock_ranges: z.array(publicRollingStockRangeSchema),
  })
  .strict();

export const publicTrainClassSchema = z
  .object({
    id: z.string(),
    name_ko: z.string(),
    name_en: z.string().nullable(),
    name_hanja: z.string().nullable(),
    name_full: z.string().nullable(),
    tier: z.enum(codes.trainClassTier.values),
    status: z.enum(codes.trainClassStatus.values),
    successor: pubRefSchema.nullable(),
    max_speed_kmh: z.number().int().nullable(),
    started: pubFuzzy,
    ended: pubFuzzy,
    description: z.string().nullable(),
    services: z.array(pubRefSchema),
    checked_at: z.string(),
    review_status: z.enum(codes.reviewStatus.values),
    names: z.array(pubNameSchema),
    sources: z.array(pubSourceRefSchema),
  })
  .strict();
export const publicTrainClassListSchema = z.object({ items: z.array(publicTrainClassSchema) }).strict();

/** 번호 찾기: 열차번호(열차번호대)와 차량번호(차량번호대)를 따로 — 열차번호 ≠ 차량번호(C-3) */
export const publicNumberSearchSchema = z
  .object({
    n: z.string(),
    train_number_ranges: z.array(publicTrainNumberRangeSchema),
    rolling_stock_ranges: z.array(publicRollingStockRangeSchema),
  })
  .strict();

// ------------------------------------------------------------------ 검색

export const publicSearchItemSchema = z
  .object({
    id: z.string(),
    type: z.enum(['station', 'line', 'service', 'plan', 'glossary_term']),
    name: z.string(),
    /** 일치한 이름(대표 이름과 다를 때, 내부 표기는 싣지 않음) */
    matched: z.string().nullable(),
    matched_kind: z.string().nullable(),
    station_codes: z.string().nullable(),
    areas: z.array(z.string()),
    url_path: z.string().nullable(),
    score: z.number(),
  })
  .strict();
export const publicSearchSchema = z
  .object({ q: z.string(), items: z.array(publicSearchItemSchema), total: z.number().int() })
  .strict();

// ------------------------------------------------------------------ 출처·노선도·용어

export const publicSourceSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    publisher: z.string(),
    type: z.enum(codes.sourceType.values),
    url: z.string().nullable(),
    license: z.string(),
    license_class: z.enum(codes.licenseClass.values),
    attribution: z.string().nullable(),
    published: pubFuzzy,
    published_raw: z.string().nullable(),
    data_as_of: z.string().nullable(),
    retrieved_at: z.string(),
    notice_number: z.string().nullable(),
    checked_at: z.string(),
    used_by: z.number().int(),
    documents: z.array(pubDocumentSchema),
  })
  .strict();
export const publicSourceListSchema = pubList(publicSourceSchema);

export const publicRouteMapSchema = z
  .object({
    id: z.string(),
    title_ko: z.string(),
    title_en: z.string().nullable(),
    publisher: z.string(),
    region: z.string().nullable(),
    mode: z.enum(codes.routeMapMode.values),
    url: z.string().nullable(),
    license: z.string(),
    attribution: z.string().nullable(),
    as_of: z.string().nullable(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    /** 공개 가능한 원본 이미지(변형 금지). 아니면 null — url 링크만 */
    document: pubDocumentSchema.nullable(),
    checked_at: z.string(),
    sources: z.array(pubSourceRefSchema),
    attachments: z.array(pubAttachmentSchema),
  })
  .strict();
export const publicRouteMapListSchema = z.object({ items: z.array(publicRouteMapSchema) }).strict();

export const publicTermSchema = z
  .object({
    id: z.string(),
    term_ko: z.string(),
    term_en: z.string().nullable(),
    section: z.string().nullable(),
    definition: z.string(),
    basis: z.string().nullable(),
    example: z.string().nullable(),
    caution: z.string().nullable(),
    names: z.array(pubNameSchema),
    checked_at: z.string(),
    sources: z.array(pubSourceRefSchema),
  })
  .strict();
export const publicTermListSchema = z.object({ items: z.array(publicTermSchema) }).strict();

// ------------------------------------------------------------------ 피드·사이트맵·리다이렉트

export const publicFeedSchema = z.object({ items: z.array(publicChangeEntrySchema) }).strict();

export const publicSitemapSchema = z
  .object({
    items: z.array(z.object({ path: z.string(), lastmod: z.string().nullable() }).strict()),
    total: z.number().int(),
  })
  .strict();

export const publicRedirectListSchema = z.object({ items: z.array(pubRedirectSchema) }).strict();

// ------------------------------------------------------------------ 지도 연도 슬라이더

export const publicMapTimelineSchema = z
  .object({
    stage_min: pubStage,
    current_year: z.number().int(),
    years: z.array(
      z
        .object({
          year: z.number().int(),
          count: z.number().int(),
          plans: z.array(
            z.object({ id: z.string(), name_ko: z.string(), stage: pubStage, delayed: z.boolean() }).strict(),
          ),
        })
        .strict(),
    ),
    undated: z.number().int(),
    undated_plans: z.array(z.object({ id: z.string(), name_ko: z.string(), stage: pubStage }).strict()),
  })
  .strict();

export const publicDocumentInfoSchema = pubDocumentSchema
  .extend({ source_ids: z.array(z.string()), page: z.number().int().nullable() })
  .strict();

export { pubEventSchema as publicEventSchema };
