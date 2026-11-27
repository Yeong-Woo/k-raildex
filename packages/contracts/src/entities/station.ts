/**
 * 역 station (docs/03-data-model.md 4-5절). 역 = 환승 그룹, 공개 역 페이지 단위.
 * DB CHECK: geom 유무 = coord_source 유무, coord_basis 는 coord_source 'derived' 일 때만,
 * merge_into_id·coord_same_as_id 는 자기 자신 아님.
 */
import { z } from 'zod';
import { codes } from '../codes';
import { idSchema } from '../ids';
import {
  checkNotSelf,
  curatedFields,
  defineContract,
  issue,
  known,
  nameFields,
  nullish,
  optFuzzy,
  optText,
  pointSchema,
  recReadFields,
  regionCodeSchema,
  type RowCheck,
} from './common';

const shape = {
  id: idSchema('station'),
  ...nameFields,
  kind: z.enum(codes.stationKind.values).default('station'),
  region_code: nullish(regionCodeSchema),
  region_basis: nullish(z.enum(codes.regionBasis.values)),
  address: optText(),
  geom: nullish(pointSchema),
  coord_source: nullish(z.enum(codes.coordSource.values)),
  coord_basis: nullish(z.enum(codes.coordBasis.values)),
  coord_query: optText(),
  coord_same_as_id: nullish(idSchema('station')),
  coord_note: optText(),
  grade: optText(),
  history_text: optText(),
  intro_text: optText(),
  merge_into_id: nullish(idSchema('station')),
  /** 한국철도공사 정거장 등급(코레일 관리 역만, 0031) */
  korail_class: nullish(z.enum(codes.korailStationClass.values)),
  /** 관리역 등급 1~3급 — korail_class 관리역일 때만 */
  korail_mgmt_grade: nullish(z.number().int().min(1).max(3)),
  /** 이 역을 관할하는 관리역(V-H18) */
  managed_by_id: nullish(idSchema('station')),
  /** 노선별 역이 없는 역에서만(V-H13) */
  own_status: nullish(z.enum(codes.status.values)),
  own_opened: optFuzzy(),
  own_closed: optFuzzy(),
  ...curatedFields,
};

const checkStation: RowCheck = (row, ctx) => {
  if (known(row, 'geom', 'coord_source') && (row.geom == null) !== (row.coord_source == null))
    issue(ctx, ['coord_source'], 'geom 과 coord_source 는 함께 있거나 함께 없어야 함');
  if (known(row, 'coord_basis', 'coord_source') && row.coord_basis != null && row.coord_source !== 'derived')
    issue(ctx, ['coord_basis'], "coord_basis 는 coord_source 'derived' 일 때만 쓸 수 있음");
  checkNotSelf(row, ctx, 'merge_into_id');
  checkNotSelf(row, ctx, 'coord_same_as_id');
  checkNotSelf(row, ctx, 'managed_by_id');
  if (
    known(row, 'korail_mgmt_grade', 'korail_class') &&
    row.korail_mgmt_grade != null &&
    row.korail_class !== 'management'
  )
    issue(ctx, ['korail_mgmt_grade'], '관리역 등급은 정거장 등급이 관리역일 때만 쓸 수 있음');
};

const contract = defineContract(shape, recReadFields, checkStation);

export const StationCreateSchema = contract.create;
export const StationUpdateSchema = contract.update;
export const StationReadSchema = contract.read;
export type StationCreate = z.infer<typeof StationCreateSchema>;
export type StationUpdate = z.infer<typeof StationUpdateSchema>;
export type StationRead = z.infer<typeof StationReadSchema>;
