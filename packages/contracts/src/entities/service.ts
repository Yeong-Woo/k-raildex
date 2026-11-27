/** 운행 계통 service (docs/03-data-model.md 4-9절) + service_line·stop_pattern·stop_pattern_stop */
import { z } from 'zod';
import { codes } from '../codes';
import { idSchema } from '../ids';
import {
  checkUnique,
  colorSchema,
  curatedFields,
  defineContract,
  keyBy,
  nameFields,
  nullish,
  optFuzzy,
  optText,
  recReadFields,
} from './common';

/** 정차 패턴. stops = 정차하는 노선역 id 순서(≥ 2, V-H05) */
export const stopPatternSchema = z
  .object({
    code: z.string().min(1),
    name_ko: z.string().min(1),
    name_en: optText(),
    type: z.enum(codes.stopPatternType.values),
    note: optText(),
    stops: z.array(idSchema('line_station')).min(2, { message: '정차 패턴 역은 2개 이상(V-H05)' }),
  })
  .strict();
export type StopPattern = z.infer<typeof stopPatternSchema>;

const shape = {
  id: idSchema('service'),
  ...nameFields,
  kind: z.enum(codes.serviceKind.values),
  train_class_id: nullish(idSchema('train_class')),
  status: z.enum(codes.status.values),
  color: nullish(colorSchema),
  opened: optFuzzy(),
  closed: optFuzzy(),
  successor_id: nullish(idSchema('service')),
  description: optText(),
  ...curatedFields,
  /** 소속 노선 id 순서(service_line.seq = 순서) */
  lines: z.array(idSchema('line')).default([]),
  stop_patterns: z.array(stopPatternSchema).default([]),
};

const contract = defineContract(shape, recReadFields, (row, ctx) => {
  checkUnique(row, ctx, 'lines');
  checkUnique(row, ctx, 'stop_patterns', keyBy('code'));
});

export const ServiceCreateSchema = contract.create;
export const ServiceUpdateSchema = contract.update;
export const ServiceReadSchema = contract.read;
export type ServiceCreate = z.infer<typeof ServiceCreateSchema>;
export type ServiceUpdate = z.infer<typeof ServiceUpdateSchema>;
export type ServiceRead = z.infer<typeof ServiceReadSchema>;
