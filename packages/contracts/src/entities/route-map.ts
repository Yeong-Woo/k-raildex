/** 공개 노선도 route_map (docs/03-data-model.md 4-16절). DB CHECK: mode embed 면 document_id 필수 */
import { z } from 'zod';
import { codes } from '../codes';
import { idSchema } from '../ids';
import {
  curatedFields,
  defineContract,
  issue,
  known,
  nullish,
  optPositiveInt,
  optText,
  recReadFields,
  uuidSchema,
} from './common';

const shape = {
  id: idSchema('route_map'),
  title_ko: z.string().min(1),
  title_en: optText(),
  publisher: z.string().min(1),
  region: optText(),
  mode: z.enum(codes.routeMapMode.values),
  document_id: nullish(uuidSchema),
  url: z.string().min(1),
  license: z.string().min(1),
  attribution: z.string().min(1),
  as_of: optText(),
  width: optPositiveInt(),
  height: optPositiveInt(),
  ...curatedFields,
};

const contract = defineContract(shape, recReadFields, (row, ctx) => {
  if (known(row, 'mode', 'document_id') && row.mode === 'embed' && row.document_id == null)
    issue(ctx, ['document_id'], 'mode embed 는 document_id 가 필요함');
});

export const RouteMapCreateSchema = contract.create;
export const RouteMapUpdateSchema = contract.update;
export const RouteMapReadSchema = contract.read;
export type RouteMapCreate = z.infer<typeof RouteMapCreateSchema>;
export type RouteMapUpdate = z.infer<typeof RouteMapUpdateSchema>;
export type RouteMapRead = z.infer<typeof RouteMapReadSchema>;
