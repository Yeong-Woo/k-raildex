/** 열차번호대 train_number_range (docs/03-data-model.md 4-13절) */
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
  optText,
  recReadFields,
} from './common';

const shape = {
  id: idSchema('train_number_range'),
  operator_id: idSchema('operator'),
  code_prefix: optText(),
  range_from: z.number().int(),
  range_to: z.number().int(),
  group: z.enum(codes.tnrGroup.values),
  train_class_id: nullish(idSchema('train_class')),
  route_text: optText(),
  parity_rule: nullish(z.enum(codes.parityRule.values)),
  valid_from: optFuzzy(),
  valid_to: optFuzzy(),
  note: optText(),
  ...curatedFields,
  service_ids: z.array(idSchema('service')).default([]),
  line_ids: z.array(idSchema('line')).default([]),
};

const contract = defineContract(shape, recReadFields, (row, ctx) => {
  checkRange(row, ctx, 'range_from', 'range_to');
  checkUnique(row, ctx, 'service_ids');
  checkUnique(row, ctx, 'line_ids');
});

export const TrainNumberRangeCreateSchema = contract.create;
export const TrainNumberRangeUpdateSchema = contract.update;
export const TrainNumberRangeReadSchema = contract.read;
export type TrainNumberRangeCreate = z.infer<typeof TrainNumberRangeCreateSchema>;
export type TrainNumberRangeUpdate = z.infer<typeof TrainNumberRangeUpdateSchema>;
export type TrainNumberRangeRead = z.infer<typeof TrainNumberRangeReadSchema>;
