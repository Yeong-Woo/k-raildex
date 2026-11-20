/** 노선 line (docs/03-data-model.md 4-7절) + line_region·line_operator·line_osm_map */
import { z } from 'zod';
import { codes } from '../codes';
import { idSchema } from '../ids';
import {
  bboxSchema,
  checkNotSelf,
  checkUnique,
  colorSchema,
  curatedFields,
  defineContract,
  keyBy,
  nameFields,
  nullish,
  optBool,
  optFuzzy,
  optPositiveInt,
  optText,
  recReadFields,
  regionCodeSchema,
} from './common';

/** 노선 운영기관 line_operator (순서 = 배열 순서 → ord) */
export const lineOperatorSchema = z
  .object({
    operator_id: idSchema('operator'),
    role: z.string().min(1).default('operator'),
    note: optText(),
  })
  .strict();
export type LineOperator = z.infer<typeof lineOperatorSchema>;

/** OSM 선형 배정 line_osm_map (OSM id 숫자만 보관, FR-DM-008) */
export const lineOsmMapSchema = z
  .object({
    relation_ids: z.array(z.number().int().positive()).default([]),
    way_names: z.array(z.string().min(1)).default([]),
    bbox: nullish(bboxSchema),
    priority: z.number().int().default(0),
    include_construction: z.boolean().default(true),
    note: optText(),
  })
  .strict();
export type LineOsmMap = z.infer<typeof lineOsmMapSchema>;

const shape = {
  id: idSchema('line'),
  ...nameFields,
  category: z.enum(codes.lineCategory.values),
  rail_class: z.enum(codes.railClass.values),
  is_wide_area: optBool(),
  wide_area_note: optText(),
  passenger_service: z.boolean().default(true),
  line_role: nullish(z.enum(codes.lineRole.values)),
  status: z.enum(codes.status.values),
  owner: optText(),
  start_station_id: nullish(idSchema('station')),
  end_station_id: nullish(idSchema('station')),
  length_km: nullish(z.number().min(0)),
  opened: optFuzzy(),
  closed: optFuzzy(),
  track: nullish(z.enum(codes.track.values)),
  electrification: optText(),
  gauge_mm: optPositiveInt(),
  design_speed_kmh: optPositiveInt(),
  color: nullish(colorSchema),
  description: optText(),
  /** 기존 공사 구간 노선 → 합칠 노선(Q22 A) */
  parent_line_id: nullish(idSchema('line')),
  ...curatedFields,
  regions: z.array(regionCodeSchema).default([]),
  operators: z.array(lineOperatorSchema).default([]),
  osm_map: nullish(lineOsmMapSchema),
};

const contract = defineContract(shape, recReadFields, (row, ctx) => {
  checkNotSelf(row, ctx, 'parent_line_id');
  checkUnique(row, ctx, 'regions');
  checkUnique(row, ctx, 'operators', keyBy('operator_id', 'role'));
});

export const LineCreateSchema = contract.create;
export const LineUpdateSchema = contract.update;
export const LineReadSchema = contract.read;
export type LineCreate = z.infer<typeof LineCreateSchema>;
export type LineUpdate = z.infer<typeof LineUpdateSchema>;
export type LineRead = z.infer<typeof LineReadSchema>;
