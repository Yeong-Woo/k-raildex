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
  checkUnique,
  curatedFields,
  defineContract,
  issue,
  keyBy,
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

/** 차량기지 정보 station_depot(0034) */
export const stationDepotSchema = z
  .object({
    functions: z.array(z.enum(codes.depotFunction.values)).default([]),
    operator_id: nullish(idSchema('operator')),
    opened: optFuzzy(),
    note: optText(),
  })
  .strict();
export type StationDepot = z.infer<typeof stationDepotSchema>;

/** 차량기지 담당 노선 station_depot_line(0034) */
export const stationDepotLineSchema = z.object({ line_id: idSchema('line'), note: optText() }).strict();

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
  /** 노선역이 없는 역에서만(V-H13) */
  own_status: nullish(z.enum(codes.status.values)),
  own_opened: optFuzzy(),
  own_closed: optFuzzy(),
  /** 차량기지 정보 — kind depot 일 때만(V-H19, 0034) */
  depot: nullish(stationDepotSchema),
  /** 차량기지가 차량을 맡는 노선 — kind depot 일 때만 */
  depot_lines: z.array(stationDepotLineSchema).default([]),
  ...curatedFields,
};

const checkStation: RowCheck = (row, ctx) => {
  if (known(row, 'geom', 'coord_source') && (row.geom == null) !== (row.coord_source == null))
    issue(ctx, ['coord_source'], 'geom 과 coord_source 는 함께 있거나 함께 없어야 함');
  if (known(row, 'coord_basis', 'coord_source') && row.coord_basis != null && row.coord_source !== 'derived')
    issue(ctx, ['coord_basis'], "coord_basis 는 coord_source 'derived' 일 때만 쓸 수 있음");
  checkNotSelf(row, ctx, 'merge_into_id');
  checkNotSelf(row, ctx, 'coord_same_as_id');
  checkUnique(row, ctx, 'depot_lines', keyBy('line_id'));
  if (known(row, 'kind', 'depot') && row.depot != null && row.kind !== 'depot')
    issue(ctx, ['depot'], '차량기지 정보는 역 종류가 차량기지일 때만 쓸 수 있음');
};

const contract = defineContract(shape, recReadFields, checkStation);

export const StationCreateSchema = contract.create;
export const StationUpdateSchema = contract.update;
export const StationReadSchema = contract.read;
export type StationCreate = z.infer<typeof StationCreateSchema>;
export type StationUpdate = z.infer<typeof StationUpdateSchema>;
export type StationRead = z.infer<typeof StationReadSchema>;
