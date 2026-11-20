/** 상위 계획 plan_program (docs/03-data-model.md 4-10절) + 고시·요점·수치 */
import { z } from 'zod';
import { fuzzyDateSchema } from '../fuzzy-date';
import { codes } from '../codes';
import { idSchema } from '../ids';
import {
  checkRange,
  curatedFields,
  defineContract,
  nameFieldsNoHanja,
  nullish,
  optInt,
  optText,
  recReadFields,
  regionCodeSchema,
} from './common';

/** 고시·공고 plan_program_notice (seq = 배열 순서) */
export const planProgramNoticeSchema = z
  .object({
    kind: z.enum(codes.noticeKind.values),
    title: z.string().min(1),
    number: optText(),
    date: fuzzyDateSchema,
    note: optText(),
    source_id: idSchema('source'),
  })
  .strict();
export type PlanProgramNotice = z.infer<typeof planProgramNoticeSchema>;

/** 주요 수치 plan_program_figure (seq = 배열 순서) */
export const planProgramFigureSchema = z
  .object({
    label: z.string().min(1),
    value: z.string().min(1),
    source_id: nullish(idSchema('source')),
  })
  .strict();
export type PlanProgramFigure = z.infer<typeof planProgramFigureSchema>;

const shape = {
  id: idSchema('plan_program'),
  ...nameFieldsNoHanja,
  kind: z.enum(codes.planProgramKind.values),
  short: z.string().min(1),
  round: nullish(z.number().int().min(1)),
  region_code: nullish(regionCodeSchema),
  period_from: optInt(),
  period_to: optInt(),
  issuer: optText(),
  legal_basis: optText(),
  status: z.enum(codes.planProgramStatus.values),
  parent_id: nullish(idSchema('plan_program')),
  summary: optText(),
  document_note: optText(),
  ord: z.number().int(),
  ...curatedFields,
  notices: z.array(planProgramNoticeSchema).default([]),
  /** 요점 plan_program_point.text (seq = 배열 순서) */
  points: z.array(z.string().min(1)).default([]),
  figures: z.array(planProgramFigureSchema).default([]),
};

const contract = defineContract(shape, recReadFields, (row, ctx) => {
  checkRange(row, ctx, 'period_from', 'period_to');
});

export const PlanProgramCreateSchema = contract.create;
export const PlanProgramUpdateSchema = contract.update;
export const PlanProgramReadSchema = contract.read;
export type PlanProgramCreate = z.infer<typeof PlanProgramCreateSchema>;
export type PlanProgramUpdate = z.infer<typeof PlanProgramUpdateSchema>;
export type PlanProgramRead = z.infer<typeof PlanProgramReadSchema>;
