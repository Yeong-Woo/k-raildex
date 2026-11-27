/**
 * 시설 facility (docs/03-data-model.md 4-19절, id fac-, 0035 — 2026-11-27 사용자 지시).
 * 역 그룹과 별개인 철도 시설. 지금은 kind depot(차량기지)만. 붙은 기지선·담당 노선은 facility_line(role connects·serves).
 */
import { z } from 'zod';
import { codes } from '../codes';
import { idSchema } from '../ids';
import {
  checkUnique,
  curatedFields,
  defineContract,
  issue,
  keyBy,
  known,
  nameFieldsNoHanja,
  nullish,
  optFuzzy,
  optText,
  pointSchema,
  recReadFields,
  regionCodeSchema,
} from './common';

/** 시설 ↔ 노선 facility_line: serves 담당 노선(차량을 맡는 노선) / connects 붙은 선로(기지선 등) */
export const facilityLineSchema = z
  .object({
    line_id: idSchema('line'),
    role: z.enum(codes.facilityLineRole.values).default('serves'),
    note: optText(),
  })
  .strict();
export type FacilityLine = z.infer<typeof facilityLineSchema>;

/** 시설 OSM 선로 배정 facility_osm_map(0036): OSM id·이름만 보관(C-5). 시설 좌표 둘레 radius_m 안 기지 선로는 자동 */
export const facilityOsmMapSchema = z
  .object({
    way_names: z.array(z.string().min(1)).default([]),
    way_ids: z.array(z.number().int().positive()).default([]),
    radius_m: z.number().int().min(0).max(5000).default(800),
    note: optText(),
  })
  .strict();
export type FacilityOsmMap = z.infer<typeof facilityOsmMapSchema>;

const shape = {
  id: idSchema('facility'),
  ...nameFieldsNoHanja,
  kind: z.enum(codes.facilityKind.values).default('depot'),
  functions: z.array(z.enum(codes.facilityFunction.values)).default([]),
  operator_id: nullish(idSchema('operator')),
  status: z.enum(codes.status.values).default('operating'),
  opened: optFuzzy(),
  closed: optFuzzy(),
  region_code: nullish(regionCodeSchema),
  address: optText(),
  geom: nullish(pointSchema),
  coord_source: nullish(z.enum(codes.coordSource.values)),
  coord_basis: nullish(z.enum(codes.coordBasis.values)),
  coord_query: optText(),
  coord_note: optText(),
  description: optText(),
  ...curatedFields,
  lines: z.array(facilityLineSchema).default([]),
  osm_map: nullish(facilityOsmMapSchema),
};

const contract = defineContract(shape, recReadFields, (row, ctx) => {
  if (known(row, 'geom', 'coord_source') && (row.geom == null) !== (row.coord_source == null))
    issue(ctx, ['coord_source'], 'geom 과 coord_source 는 함께 있거나 함께 없어야 함');
  if (known(row, 'coord_basis', 'coord_source') && row.coord_basis != null && row.coord_source !== 'derived')
    issue(ctx, ['coord_basis'], "coord_basis 는 coord_source 'derived' 일 때만 쓸 수 있음");
  checkUnique(row, ctx, 'lines', keyBy('line_id', 'role'));
});

export const FacilityCreateSchema = contract.create;
export const FacilityUpdateSchema = contract.update;
export const FacilityReadSchema = contract.read;
export type FacilityCreate = z.infer<typeof FacilityCreateSchema>;
export type FacilityUpdate = z.infer<typeof FacilityUpdateSchema>;
export type FacilityRead = z.infer<typeof FacilityReadSchema>;
