/**
 * 노선역 line_station (docs/03-data-model.md 4-6절) — 한 노선·한 운영기관의 역. 역 그룹(station)에 속한다. 내부 id(ls-), REC 없음(META 만).
 * 출처는 노선의 출처를 따르므로 sources 는 선택(노선과 다른 출처가 필요할 때만).
 */
import { z } from 'zod';
import { codes } from '../codes';
import { idSchema } from '../ids';
import {
  checkNotSelf,
  defineContract,
  issue,
  known,
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
  /** 지선(branch)이 갈라져 나오는 노선역(같은 노선, 지선 행 중 하나에만 — 정거장 앞뒤 계산 v_line_stop_link, 0042) */
  branch_from_id: nullish(idSchema('line_station')),
  km: nullish(z.number()),
  station_code: optText(),
  order_confirmed: z.boolean().default(true),
  /** V-S04 거리 확인: 앞 역과의 거리가 상한을 넘지만 맞다고 확인할 때의 앞 노선역 id. 앞 역이 바뀌면 효력 없음 */
  gap_confirmed_prev_id: nullish(idSchema('line_station')),
  /** 역 대표 이름과 다를 때만 */
  name_ko: nullish(z.string().min(1)),
  name_en: optText(),
  /** NULL 이면 노선 운영기관 */
  operator_id: nullish(idSchema('operator')),
  /** 한국철도공사 정거장 등급(직제상 지위) — 운영기관이 한국철도공사인 노선역만(V-H18, 0032) */
  korail_class: nullish(z.enum(codes.korailStationClass.values)),
  /** 관리역 1~3급 — korail_class 관리역일 때만 */
  korail_mgmt_grade: nullish(z.number().int().min(1).max(3)),
  /** 이 노선역을 관할하는 관리역(노선역, 예: 경인선 부천) */
  managed_by_id: nullish(idSchema('line_station')),
  status: z.enum(codes.status.values),
  opened: optFuzzy(),
  closed: optFuzzy(),
  /** 승강장 위치(알 때만, 출처 field='geom') */
  geom: nullish(pointSchema),
  note: optText(),
  sources: z.array(sourceLinkSchema).default([]),
  ...nameRefFields,
};

const contract = defineContract(shape, metaReadFields, (row, ctx) => {
  checkNotSelf(row, ctx, 'managed_by_id');
  checkNotSelf(row, ctx, 'branch_from_id');
  if (known(row, 'branch_from_id', 'branch') && row.branch_from_id != null && row.branch == null)
    issue(ctx, ['branch_from_id'], '갈라지는 노선역은 지선(branch) 행에만');
  if (
    known(row, 'korail_mgmt_grade', 'korail_class') &&
    row.korail_mgmt_grade != null &&
    row.korail_class !== 'management'
  )
    issue(ctx, ['korail_mgmt_grade'], '관리역 등급은 정거장 등급이 관리역일 때만 쓸 수 있음');
});

export const LineStationCreateSchema = contract.create;
export const LineStationUpdateSchema = contract.update;
export const LineStationReadSchema = contract.read;
export type LineStationCreate = z.infer<typeof LineStationCreateSchema>;
export type LineStationUpdate = z.infer<typeof LineStationUpdateSchema>;
export type LineStationRead = z.infer<typeof LineStationReadSchema>;
