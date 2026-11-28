/**
 * 식별자 규칙 (docs/03-data-model.md 2-1절). DB 트리거(entity_type_guard)와 같은 접두사 규칙.
 */
import { z } from 'zod';
import type { Code } from './codes';

export type EntityType = Code<'entityType'>;

export const ID_PREFIX: Readonly<Record<EntityType, string>> = {
  source: 'src',
  operator: 'op',
  station: 'stn',
  line_station: 'ls',
  line: 'line',
  train_class: 'tc',
  service: 'svc',
  plan_program: 'pp',
  plan: 'plan',
  event: 'evt',
  train_number_range: 'tnr',
  rolling_stock_range: 'rsn',
  transfer_center: 'xc',
  route_map: 'map',
  glossary_term: 'term',
  facility: 'fac',
};

/** 슬러그: 소문자·숫자·하이픈. 정거장(ls-)은 `--` 구분자를 허용한다 */
const SLUG = '[a-z0-9]+(?:-{1,2}[a-z0-9]+)*';

export function idPattern(type: EntityType): RegExp {
  return new RegExp(`^${ID_PREFIX[type]}-${SLUG}$`);
}

export function isEntityId(type: EntityType, id: string): boolean {
  return idPattern(type).test(id);
}

export function entityTypeOfId(id: string): EntityType | null {
  // 긴 접두사부터(line_station 'ls' 와 line 'line' 등 겹침 없음 보장 시험 있음)
  const entries = Object.entries(ID_PREFIX).sort((a, b) => b[1].length - a[1].length);
  for (const [type, prefix] of entries) {
    if (id.startsWith(`${prefix}-`) && isEntityId(type as EntityType, id)) return type as EntityType;
  }
  return null;
}

export const idSchema = (type: EntityType) =>
  z.string().regex(idPattern(type), { message: `${ID_PREFIX[type]}- 로 시작하는 id 형식이 아님` });

/** 정거장 id: ls-<노선 id 꼬리>--<역 id 꼬리>[-n] */
export function lineStationId(lineId: string, stationId: string, n = 1): string {
  const lineTail = lineId.replace(/^line-/, '');
  const stnTail = stationId.replace(/^stn-/, '');
  return `ls-${lineTail}--${stnTail}${n > 1 ? `-${n}` : ''}`;
}
