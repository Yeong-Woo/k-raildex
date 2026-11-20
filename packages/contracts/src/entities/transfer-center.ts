/** 환승센터 transfer_center (docs/03-data-model.md 4-15절, id xc-) */
import { z } from 'zod';
import { fuzzyDateSchema } from '../fuzzy-date';
import { codes } from '../codes';
import { idSchema } from '../ids';
import {
  areaCodeSchema,
  checkUnique,
  curatedFields,
  defineContract,
  nameFieldsNoHanja,
  nullish,
  optFuzzy,
  optText,
  recReadFields,
  regionCodeSchema,
} from './common';

/** 상위 계획 반영 내역 transfer_center_plan_ref (seq = 배열 순서). 상위 계획 kind 검사는 V-H03(도메인) */
export const transferCenterPlanRefSchema = z
  .object({
    program_id: idSchema('plan_program'),
    class: z.enum(codes.tcPlanRefClass.values),
    name_raw: z.string().min(1),
    cost_100m_krw: nullish(z.number()),
    rail_now: optText(),
    rail_future: optText(),
    page: optText(),
    note: optText(),
    source_id: idSchema('source'),
  })
  .strict();
export type TransferCenterPlanRef = z.infer<typeof transferCenterPlanRefSchema>;

/** 상태 이력 transfer_center_status_event */
export const transferCenterStatusEventSchema = z
  .object({
    status: z.enum(codes.transferCenterStatus.values),
    date: fuzzyDateSchema,
    note: optText(),
    source_id: idSchema('source'),
  })
  .strict();
export type TransferCenterStatusEvent = z.infer<typeof transferCenterStatusEventSchema>;

const shape = {
  id: idSchema('transfer_center'),
  ...nameFieldsNoHanja,
  kind: z.enum(codes.transferCenterKind.values),
  region_code: nullish(regionCodeSchema),
  area_code: nullish(areaCodeSchema),
  status: z.enum(codes.transferCenterStatus.values),
  status_as_of: optFuzzy(),
  status_source_id: idSchema('source'),
  description: optText(),
  ...curatedFields,
  plan_refs: z.array(transferCenterPlanRefSchema).default([]),
  status_events: z.array(transferCenterStatusEventSchema).default([]),
  station_ids: z.array(idSchema('station')).default([]),
  plan_ids: z.array(idSchema('plan')).default([]),
};

const contract = defineContract(shape, recReadFields, (row, ctx) => {
  checkUnique(row, ctx, 'station_ids');
  checkUnique(row, ctx, 'plan_ids');
});

export const TransferCenterCreateSchema = contract.create;
export const TransferCenterUpdateSchema = contract.update;
export const TransferCenterReadSchema = contract.read;
export type TransferCenterCreate = z.infer<typeof TransferCenterCreateSchema>;
export type TransferCenterUpdate = z.infer<typeof TransferCenterUpdateSchema>;
export type TransferCenterRead = z.infer<typeof TransferCenterReadSchema>;
