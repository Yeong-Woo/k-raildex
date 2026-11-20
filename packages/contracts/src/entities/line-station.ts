/**
 * 노선별 역 line_station (docs/03-data-model.md 4-6절). 내부 id(ls-), REC 없음(META 만).
 * 출처는 노선의 출처를 따르므로 sources 는 선택(노선과 다른 출처가 필요할 때만).
 */
import { z } from 'zod';
import { codes } from '../codes';
import { idSchema } from '../ids';
import {
  defineContract,
  metaReadFields,
  nameRefFields,
  nullish,
  optFuzzy,
  optText,
  pointSchema,
  sourceLinkSchema,
} from './common';

const shape = {
  id: idSchema('line_station'),
  line_id: idSchema('line'),
  station_id: idSchema('station'),
  seq: z.number().int().min(1),
  branch: optText(),
  km: nullish(z.number()),
  station_code: optText(),
  order_confirmed: z.boolean().default(true),
  /** 역 대표 이름과 다를 때만 */
  name_ko: nullish(z.string().min(1)),
  name_en: optText(),
  /** NULL 이면 노선 운영기관 */
  operator_id: nullish(idSchema('operator')),
  status: z.enum(codes.status.values),
  opened: optFuzzy(),
  closed: optFuzzy(),
  /** 승강장 위치(알 때만, 출처 field='geom') */
  geom: nullish(pointSchema),
  note: optText(),
  sources: z.array(sourceLinkSchema).default([]),
  ...nameRefFields,
};

const contract = defineContract(shape, metaReadFields);

export const LineStationCreateSchema = contract.create;
export const LineStationUpdateSchema = contract.update;
export const LineStationReadSchema = contract.read;
export type LineStationCreate = z.infer<typeof LineStationCreateSchema>;
export type LineStationUpdate = z.infer<typeof LineStationUpdateSchema>;
export type LineStationRead = z.infer<typeof LineStationReadSchema>;
