/** 운영기관 operator (docs/03-data-model.md 4-4절) */
import { z } from 'zod';
import { codes } from '../codes';
import { idSchema } from '../ids';
import { curatedFields, defineContract, nameFieldsNoHanja, nullish, optFuzzy, optText, recReadFields } from './common';

const shape = {
  id: idSchema('operator'),
  ...nameFieldsNoHanja,
  short_ko: optText(),
  kind: z.enum(codes.operatorKind.values),
  status: z.enum(codes.operatorStatus.values),
  merged_into_id: nullish(idSchema('operator')),
  founded: optFuzzy(),
  ended: optFuzzy(),
  homepage: optText(),
  ...curatedFields,
};

const contract = defineContract(shape, recReadFields);

export const OperatorCreateSchema = contract.create;
export const OperatorUpdateSchema = contract.update;
export const OperatorReadSchema = contract.read;
export type OperatorCreate = z.infer<typeof OperatorCreateSchema>;
export type OperatorUpdate = z.infer<typeof OperatorUpdateSchema>;
export type OperatorRead = z.infer<typeof OperatorReadSchema>;
