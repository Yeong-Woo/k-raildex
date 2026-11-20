/**
 * 계획 사업 plan (docs/03-data-model.md 4-11절) + 반영 내역·단계 이력·기대 일정·노선·역·지역·관계·선형·감시 키워드.
 */
import { z } from 'zod';
import { fuzzyDateSchema } from '../fuzzy-date';
import { codes } from '../codes';
import { idSchema } from '../ids';
import {
  checkUnique,
  colorSchema,
  curatedFields,
  defineContract,
  issue,
  keyBy,
  multiLineStringSchema,
  nameFieldsNoHanja,
  nullish,
  optFuzzy,
  optText,
  recReadFields,
  regionCodeSchema,
} from './common';

/** 상위 계획 반영 내역 plan_ref (seq = 배열 순서) */
export const planRefSchema = z
  .object({
    program_id: idSchema('plan_program'),
    edition: optText(),
    timing: optText(),
    class: z.enum(codes.planRefClass.values),
    category: nullish(z.enum(codes.planRefCategory.values)),
    section: optText(),
    content: optText(),
    length_km: nullish(z.number()),
    cost_100m_krw: nullish(z.number()),
    task_group: optText(),
    source_id: idSchema('source'),
    locator: optText(),
  })
  .strict();
export type PlanRef = z.infer<typeof planRefSchema>;

/** 단계 이력 plan_stage_event (날짜·출처 필수) */
export const planStageEventSchema = z
  .object({
    stage: z.enum(codes.planStage.values),
    kind: z.enum(codes.planStageEventKind.values).default('reached'),
    date: fuzzyDateSchema,
    note: optText(),
    source_id: idSchema('source'),
    origin: z.enum(codes.planStageEventOrigin.values).default('manual'),
  })
  .strict();
export type PlanStageEvent = z.infer<typeof planStageEventSchema>;

/** 기대 일정 plan_milestone. Q94 A: basis 'estimate' 금지, 출처 필수(DB CHECK) */
export const planMilestoneSchema = z
  .object({
    stage: z.enum(codes.planStage.values),
    expected: fuzzyDateSchema,
    basis: z.enum(codes.milestoneBasis.values),
    as_of: optFuzzy(),
    source_id: nullish(idSchema('source')),
    note: optText(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.basis === 'estimate') issue(ctx, ['basis'], "basis 'estimate' 는 쓰지 않음(Q94 A)");
    if (m.source_id == null) issue(ctx, ['source_id'], '기대 일정은 출처가 필요함(Q94 A, V-H16)');
  });
export type PlanMilestone = z.infer<typeof planMilestoneSchema>;

/** 계획 ↔ 노선 plan_line (Q90 A) */
export const planLineSchema = z
  .object({
    line_id: idSchema('line'),
    role: z.enum(codes.planLineRole.values).default('new'),
    from_line_station_id: nullish(idSchema('line_station')),
    to_line_station_id: nullish(idSchema('line_station')),
    note: optText(),
  })
  .strict();
export type PlanLine = z.infer<typeof planLineSchema>;

/** 계획 ↔ 역(그룹) plan_station (Q72 A·Q90 A) */
export const planStationSchema = z
  .object({
    station_id: idSchema('station'),
    role: z.enum(codes.planStationRole.values).default('new'),
  })
  .strict();
export type PlanStation = z.infer<typeof planStationSchema>;

/** 계획 관계 plan_relation (대상 ≠ 자신 — 계획 수준에서 검사) */
export const planRelationSchema = z
  .object({
    target_plan_id: idSchema('plan'),
    relation: z.enum(codes.planRelation.values),
    note: optText(),
    source_id: idSchema('source'),
  })
  .strict();
export type PlanRelation = z.infer<typeof planRelationSchema>;

/** 계획 선형 plan_geometry (Q89 A). schematic = 경유역 ≥ 2, 그 밖 = geom 필수 */
export const planGeometrySchema = z
  .object({
    kind: z.enum(codes.planGeometryKind.values),
    via_station_ids: nullish(z.array(idSchema('station'))),
    geom: nullish(multiLineStringSchema),
    accuracy_m: nullish(z.number().int().min(0)),
    method_note: optText(),
    source_id: idSchema('source'),
    note: optText(),
  })
  .strict()
  .superRefine((g, ctx) => {
    if (g.kind === 'schematic' && (g.via_station_ids == null || g.via_station_ids.length < 2))
      issue(ctx, ['via_station_ids'], 'schematic 선형은 경유역이 2개 이상 필요함');
    if (g.kind !== 'schematic' && g.geom == null) issue(ctx, ['geom'], `${g.kind} 선형은 geom 이 필요함`);
  });
export type PlanGeometry = z.infer<typeof planGeometrySchema>;

const shape = {
  id: idSchema('plan'),
  ...nameFieldsNoHanja,
  scope: z.enum(codes.planScope.values).default('line'),
  /** 실제 개통 */
  opened: optFuzzy(),
  operator_text: optText(),
  description: optText(),
  is_national: z.boolean().default(false),
  /** 현재 단계 수동 지정(예외용, Q28 A) */
  stage_override: nullish(z.enum(codes.planStage.values)),
  /** 공식 노선색이 있을 때만(Q91 A) */
  color: nullish(colorSchema),
  ...curatedFields,
  refs: z.array(planRefSchema).default([]),
  stage_events: z.array(planStageEventSchema).default([]),
  milestones: z.array(planMilestoneSchema).default([]),
  lines: z.array(planLineSchema).default([]),
  stations: z.array(planStationSchema).default([]),
  regions: z.array(regionCodeSchema).default([]),
  relations: z.array(planRelationSchema).default([]),
  geometries: z.array(planGeometrySchema).default([]),
  watch_keywords: z.array(z.string().min(1)).default([]),
};

const contract = defineContract(shape, recReadFields, (row, ctx) => {
  const relations = row.relations;
  if (typeof row.id === 'string' && Array.isArray(relations)) {
    relations.forEach((r: PlanRelation, i) => {
      if (r.target_plan_id === row.id)
        issue(ctx, ['relations', i, 'target_plan_id'], '자기 자신과의 관계는 둘 수 없음');
    });
  }
  checkUnique(row, ctx, 'lines', keyBy('line_id', 'role'));
  checkUnique(row, ctx, 'stations', keyBy('station_id'));
  checkUnique(row, ctx, 'regions');
  checkUnique(row, ctx, 'relations', keyBy('target_plan_id', 'relation'));
  checkUnique(row, ctx, 'watch_keywords');
});

export const PlanCreateSchema = contract.create;
export const PlanUpdateSchema = contract.update;
export const PlanReadSchema = contract.read;
export type PlanCreate = z.infer<typeof PlanCreateSchema>;
export type PlanUpdate = z.infer<typeof PlanUpdateSchema>;
export type PlanRead = z.infer<typeof PlanReadSchema>;
