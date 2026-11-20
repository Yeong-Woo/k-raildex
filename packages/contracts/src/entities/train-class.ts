/** 열차 등급 train_class (docs/03-data-model.md 4-8절) */
import { z } from 'zod';
import { codes } from '../codes';
import { idSchema } from '../ids';
import {
  curatedFields,
  defineContract,
  nameFields,
  nullish,
  optFuzzy,
  optPositiveInt,
  optText,
  recReadFields,
} from './common';

const shape = {
  id: idSchema('train_class'),
  ...nameFields,
  tier: z.enum(codes.trainClassTier.values),
  status: z.enum(codes.trainClassStatus.values).default('active'),
  successor_id: nullish(idSchema('train_class')),
  max_speed_kmh: optPositiveInt(),
  started: optFuzzy(),
  ended: optFuzzy(),
  description: optText(),
  ...curatedFields,
};

const contract = defineContract(shape, recReadFields);

export const TrainClassCreateSchema = contract.create;
export const TrainClassUpdateSchema = contract.update;
export const TrainClassReadSchema = contract.read;
export type TrainClassCreate = z.infer<typeof TrainClassCreateSchema>;
export type TrainClassUpdate = z.infer<typeof TrainClassUpdateSchema>;
export type TrainClassRead = z.infer<typeof TrainClassReadSchema>;
