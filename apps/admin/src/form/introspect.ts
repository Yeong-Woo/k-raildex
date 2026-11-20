/** zod 4 스키마 해석 — 하위 목록 편집기가 필드 위젯을 고르는 데 쓴다 */
import { codes, type CodeDomain, type EntityType, type Widget } from '@k-raildex/contracts';

type Def = {
  type: string;
  innerType?: Z;
  element?: Z;
  entries?: Record<string, string>;
  shape?: Record<string, Z>;
  checks?: { _zod: { def: { pattern?: RegExp } } }[];
};
export type Z = { _zod: { def: Def }; shape?: Record<string, Z> };

export function def(s: Z): Def {
  return s._zod.def;
}

/** default·nullable·optional·pipe 를 벗긴 스키마와 null 허용 여부 */
export function unwrap(s: Z): { base: Z; nullable: boolean } {
  let cur = s;
  let nullable = false;
  for (let i = 0; i < 10; i++) {
    const d = def(cur);
    if (d.type === 'nullable' || d.type === 'optional') nullable = true;
    if (
      (d.type === 'default' || d.type === 'nullable' || d.type === 'optional' || d.type === 'prefault') &&
      d.innerType
    ) {
      cur = d.innerType;
      continue;
    }
    break;
  }
  return { base: cur, nullable };
}

export function shapeOf(s: Z): Record<string, Z> {
  const b = unwrap(s).base;
  return (b.shape ?? def(b).shape ?? {}) as Record<string, Z>;
}

export function arrayElement(s: Z): Z | null {
  const b = unwrap(s).base;
  return def(b).type === 'array' ? (def(b).element ?? null) : null;
}

export function enumValues(s: Z): string[] | null {
  const b = unwrap(s).base;
  const d = def(b);
  return d.type === 'enum' && d.entries ? Object.values(d.entries) : null;
}

/** 값 목록이 같은 코드값 도메인(라벨용) */
export function codeDomainOf(values: string[]): CodeDomain | null {
  const key = [...values].sort().join('|');
  for (const [k, v] of Object.entries(codes)) if ([...v.values].sort().join('|') === key) return k as CodeDomain;
  return null;
}

const ID_FIELD_TARGET: Record<string, EntityType> = {
  source_id: 'source',
  status_source_id: 'source',
  program_id: 'plan_program',
  line_id: 'line',
  station_id: 'station',
  plan_id: 'plan',
  target_plan_id: 'plan',
  operator_id: 'operator',
  service_id: 'service',
  from_line_station_id: 'line_station',
  to_line_station_id: 'line_station',
  train_class_id: 'train_class',
};
const ID_LIST_TARGET: Record<string, EntityType> = {
  via_station_ids: 'station',
  stops: 'line_station',
  station_ids: 'station',
  plan_ids: 'plan',
  service_ids: 'service',
  line_ids: 'line',
};

/** 하위 객체 필드 → 위젯(메타데이터가 없는 하위 항목용 추론) */
export function inferWidget(name: string, s: Z): Widget {
  if (ID_FIELD_TARGET[name]) return { kind: 'ref', target: ID_FIELD_TARGET[name] };
  if (name === 'entity_id') return { kind: 'text' };
  if (name === 'document_id') return { kind: 'document' };
  if (ID_LIST_TARGET[name]) return { kind: 'refs', target: ID_LIST_TARGET[name] };
  if (name === 'region_code') return { kind: 'region' };
  const ev = enumValues(s);
  if (ev) {
    const d = codeDomainOf(ev);
    if (d) return { kind: 'code', domain: d };
  }
  const b = unwrap(s).base;
  const t = def(b).type;
  if (t === 'object') {
    const keys = Object.keys(shapeOf(b));
    if (keys.includes('precision') && keys.includes('value')) return { kind: 'fuzzy' };
    if (keys.includes('lat') && keys.includes('lng')) return { kind: 'point' };
    if (keys.includes('coordinates')) return { kind: 'json' };
    return { kind: 'json' };
  }
  if (t === 'array') {
    const el = arrayElement(b);
    if (el && def(unwrap(el).base).type === 'string') return { kind: 'string_list' };
    return { kind: 'json' };
  }
  if (t === 'number') return { kind: 'number' };
  if (t === 'boolean') return { kind: 'boolean' };
  return { kind: 'text' };
}

/** 하위 항목 필드 라벨(공통 이름) */
export const CHILD_LABELS: Record<string, string> = {
  program_id: '상위 계획',
  edition: '판',
  timing: '시기 구분',
  class: '구분',
  category: '문서 구분',
  section: '구간',
  content: '사업내용',
  length_km: '연장(km)',
  cost_100m_krw: '사업비(억원)',
  task_group: '추진과제',
  source_id: '출처',
  locator: '위치(쪽)',
  stage: '단계',
  kind: '종류',
  date: '날짜',
  note: '메모',
  origin: '기원',
  expected: '예정 시기',
  basis: '근거',
  as_of: '발표 시점',
  line_id: '노선',
  role: '역할',
  from_line_station_id: '구간 시작',
  to_line_station_id: '구간 끝',
  station_id: '역',
  target_plan_id: '대상 계획',
  relation: '관계',
  via_station_ids: '경유역',
  geom: '선형(GeoJSON)',
  accuracy_m: '오차(m)',
  method_note: '추출 방법',
  title: '제목',
  number: '번호',
  label: '항목',
  value: '값',
  operator_id: '운영기관',
  code: '코드',
  name_ko: '이름',
  name_en: '영문 이름',
  type: '유형',
  stops: '정차역(노선별 역)',
  entity_id: '대상 id',
  name_raw: '원문 사업명',
  rail_now: '철도 현황',
  rail_future: '철도 장래',
  page: '쪽',
  status: '상태',
  relation_ids: 'OSM relation id',
  way_names: 'OSM way 이름',
  bbox: '경계 상자',
  priority: '우선순위',
  include_construction: '공사 중 포함',
  document_id: '문서',
};
