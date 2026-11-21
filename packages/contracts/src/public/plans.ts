/** 공개 API — 계획 사업·상위 계획·환승센터(docs/04-api.md 5절) */
import { z } from 'zod';
import { codes } from '../codes';
import {
  pubAreas,
  pubDetailTail,
  pubEventSchema,
  pubFuzzy,
  pubList,
  pubRefSchema,
  pubSourceRefSchema,
  pubStage,
  pubStatus,
  pubTargetSchema,
} from './common';

const planRefSummary = z
  .object({
    program_id: z.string(),
    program_short: z.string().nullable(),
    class: z.enum(codes.planRefClass.values).nullable(),
    category: z.enum(codes.planRefCategory.values).nullable(),
    section: z.string().nullable(),
  })
  .strict();

const planCommon = {
  id: z.string(),
  name_ko: z.string(),
  name_en: z.string().nullable(),
  name_full: z.string().nullable(),
  scope: z.enum(codes.planScope.values),
  stage: pubStage.nullable(),
  /** 0(구상)~11(개통), 폐기·휴면 -1 */
  stage_progress: z.number().int(),
  target_open: pubTargetSchema.nullable(),
  opened: pubFuzzy,
  areas: pubAreas,
  regions: z.array(z.string()),
  is_national: z.boolean(),
  color: z.string().nullable(),
  review_status: z.enum(codes.reviewStatus.values),
};

export const publicPlanListItemSchema = z
  .object({
    ...planCommon,
    refs: z.array(planRefSummary),
    lines: z.array(z.object({ line_id: z.string(), role: z.enum(codes.planLineRole.values) }).strict()),
    station_count: z.number().int(),
  })
  .strict();
export const publicPlanListSchema = pubList(publicPlanListItemSchema);
export type PublicPlanListItem = z.infer<typeof publicPlanListItemSchema>;

export const publicPlanDetailSchema = z
  .object({
    ...planCommon,
    description: z.string().nullable(),
    operator_text: z.string().nullable(),
    stage_events: z.array(
      z
        .object({
          stage: pubStage,
          kind: z.enum(codes.planStageEventKind.values),
          date: pubFuzzy,
          note: z.string().nullable(),
          source_id: z.string().nullable(),
        })
        .strict(),
    ),
    /** 기대 일정(Q88·Q94 — 공식·보도 근거만) */
    milestones: z.array(
      z
        .object({
          stage: pubStage,
          expected: pubFuzzy,
          basis: z.enum(codes.milestoneBasis.values),
          as_of: pubFuzzy,
          source_id: z.string().nullable(),
          note: z.string().nullable(),
        })
        .strict(),
    ),
    refs: z.array(
      planRefSummary
        .extend({
          program_name_ko: z.string(),
          edition: z.string().nullable(),
          timing: z.string().nullable(),
          content: z.string().nullable(),
          length_km: z.number().nullable(),
          cost_100m_krw: z.number().nullable(),
          task_group: z.string().nullable(),
          source_id: z.string().nullable(),
          locator: z.string().nullable(),
        })
        .strict(),
    ),
    lines: z.array(
      z
        .object({
          line_id: z.string(),
          name_ko: z.string(),
          status: pubStatus,
          color: z.string().nullable(),
          role: z.enum(codes.planLineRole.values),
          from_station: pubRefSchema.nullable(),
          to_station: pubRefSchema.nullable(),
          note: z.string().nullable(),
        })
        .strict(),
    ),
    stations: z.array(
      z
        .object({
          station_id: z.string(),
          name_ko: z.string(),
          status: pubStatus,
          role: z.enum(codes.planStationRole.values),
        })
        .strict(),
    ),
    relations: z.array(
      z
        .object({
          plan_id: z.string(),
          name_ko: z.string(),
          relation: z.enum(codes.planRelation.values),
          /** out = 이 계획 → 상대, in = 상대 → 이 계획 */
          direction: z.enum(['out', 'in']),
          note: z.string().nullable(),
        })
        .strict(),
    ),
    transfer_centers: z.array(pubRefSchema.extend({ status: z.string() }).strict()),
    /** 미래 지도 표시 선형 품질(없으면 지도에 선 없음) */
    shape: z.object({ quality: z.string(), odbl: z.boolean() }).strict().nullable(),
    map_path: z.string(),
    events: z.array(pubEventSchema),
    ...pubDetailTail,
  })
  .strict();
export type PublicPlanDetail = z.infer<typeof publicPlanDetailSchema>;

// ------------------------------------------------------------------ 상위 계획

export const publicPlanProgramSchema = z
  .object({
    id: z.string(),
    name_ko: z.string(),
    name_en: z.string().nullable(),
    name_full: z.string().nullable(),
    kind: z.enum(codes.planProgramKind.values),
    short: z.string().nullable(),
    round: z.number().int().nullable(),
    region_code: z.string().nullable(),
    period_from: z.number().int().nullable(),
    period_to: z.number().int().nullable(),
    issuer: z.string().nullable(),
    legal_basis: z.string().nullable(),
    status: z.enum(codes.planProgramStatus.values),
    parent_id: z.string().nullable(),
    summary: z.string().nullable(),
    document_note: z.string().nullable(),
    ord: z.number().int(),
    plan_count: z.number().int(),
    notices: z.array(
      z
        .object({
          kind: z.enum(codes.noticeKind.values),
          title: z.string().nullable(),
          number: z.string().nullable(),
          date: pubFuzzy,
          note: z.string().nullable(),
          source_id: z.string().nullable(),
        })
        .strict(),
    ),
    figures: z.array(z.object({ label: z.string(), value: z.string(), source_id: z.string().nullable() }).strict()),
    points: z.array(z.string()),
    sources: z.array(pubSourceRefSchema),
    checked_at: z.string(),
    review_status: z.enum(codes.reviewStatus.values),
  })
  .strict();
export const publicPlanProgramListSchema = pubList(publicPlanProgramSchema);
export const publicPlanProgramDetailSchema = publicPlanProgramSchema
  .extend({ plans: z.array(publicPlanListItemSchema) })
  .strict();

// ------------------------------------------------------------------ 환승센터

const tcCommon = {
  id: z.string(),
  name_ko: z.string(),
  name_en: z.string().nullable(),
  name_full: z.string().nullable(),
  kind: z.enum(codes.transferCenterKind.values),
  region_code: z.string().nullable(),
  area_code: z.string().nullable(),
  status: z.enum(codes.transferCenterStatus.values),
  status_as_of: pubFuzzy,
  station_ids: z.array(z.string()),
  review_status: z.enum(codes.reviewStatus.values),
};
export const publicTransferCenterListItemSchema = z.object(tcCommon).strict();
export const publicTransferCenterListSchema = pubList(publicTransferCenterListItemSchema);
export const publicTransferCenterDetailSchema = z
  .object({
    ...tcCommon,
    description: z.string().nullable(),
    status_source_id: z.string().nullable(),
    stations: z.array(pubRefSchema.extend({ status: pubStatus }).strict()),
    plans: z.array(pubRefSchema.extend({ stage: pubStage.nullable() }).strict()),
    plan_refs: z.array(
      z
        .object({
          program_id: z.string(),
          class: z.string().nullable(),
          name_raw: z.string().nullable(),
          cost_100m_krw: z.number().nullable(),
          rail_now: z.string().nullable(),
          rail_future: z.string().nullable(),
          page: z.string().nullable(),
          note: z.string().nullable(),
          source_id: z.string().nullable(),
        })
        .strict(),
    ),
    status_events: z.array(
      z
        .object({
          status: z.string(),
          date: pubFuzzy,
          note: z.string().nullable(),
          source_id: z.string().nullable(),
        })
        .strict(),
    ),
    ...pubDetailTail,
  })
  .strict();
export type PublicTransferCenterDetail = z.infer<typeof publicTransferCenterDetailSchema>;
