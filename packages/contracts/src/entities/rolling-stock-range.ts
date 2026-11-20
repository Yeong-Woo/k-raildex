/** 차량번호대 rolling_stock_range (docs/03-data-model.md 4-14절) */
import { z } from 'zod';
import { codes } from '../codes';
import { idSchema } from '../ids';
import {
  checkRange,
  checkUnique,
  curatedFields,
  defineContract,
  nullish,
  optFuzzy,
  optInt,
  optText,
  recReadFields,
} from './common';

const shape = {
  id: idSchema('rolling_stock_range'),
  operator_id: idSchema('operator'),
  series: z.string().min(1),
  number_prefix: optText(),
  number_from: z.number().int(),
  number_to: z.number().int(),
  digits: z.number().int().positive(),
  group: z.enum(codes.rsrGroup.values),
  model: optText(),
  train_class_id: nullish(idSchema('train_class')),
  number_rule: optText(),
  status: z.enum(codes.rsrStatus.values),
  introduced: optFuzzy(),
  retired: optFuzzy(),
  owner_note: optText(),
  formation_label: optText(),
  formation_from: optText(),
  formation_to: optText(),
  formation_count: optInt(),
  formation_cars: optInt(),
  formation_code_prefix: optText(),
  formation_note: optText(),
  note: optText(),
  ...curatedFields,
  service_ids: z.array(idSchema('service')).default([]),
  line_ids: z.array(idSchema('line')).default([]),
};

const contract = defineContract(shape, recReadFields, (row, ctx) => {
  checkRange(row, ctx, 'number_from', 'number_to');
  checkUnique(row, ctx, 'service_ids');
  checkUnique(row, ctx, 'line_ids');
});

export const RollingStockRangeCreateSchema = contract.create;
export const RollingStockRangeUpdateSchema = contract.update;
export const RollingStockRangeReadSchema = contract.read;
export type RollingStockRangeCreate = z.infer<typeof RollingStockRangeCreateSchema>;
export type RollingStockRangeUpdate = z.infer<typeof RollingStockRangeUpdateSchema>;
export type RollingStockRangeRead = z.infer<typeof RollingStockRangeReadSchema>;
