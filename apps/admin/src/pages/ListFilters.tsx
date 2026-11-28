/** 목록 추가 필터(2026-11-28): 개체별로 시·도·권역·종류·노선·운영기관 등. 값은 URL 검색 매개변수 = API 목록 매개변수 */
import { useQuery } from '@tanstack/react-query';
import { codes, type CodeDomain, type EntityType } from '@k-raildex/contracts';
import { Select } from '@k-raildex/ui';
import { api, qs } from '../lib/api';
import { toSlug } from '../lib/entity-types';
import { useReference } from '../lib/reference';

export type ListFilter =
  | { key: string; label: string; kind: 'code'; domain: CodeDomain }
  | { key: string; label: string; kind: 'region' | 'area' | 'bool' }
  | { key: string; label: string; kind: 'ref'; target: EntityType };

const REGION: ListFilter = { key: 'region', label: '시·도', kind: 'region' };
const AREA: ListFilter = { key: 'area', label: '권역', kind: 'area' };
const LINE: ListFilter = { key: 'line', label: '노선', kind: 'ref', target: 'line' };
const OPERATOR: ListFilter = { key: 'operator', label: '운영기관', kind: 'ref', target: 'operator' };

/** 개체별 필터. key 는 API 목록 매개변수(region·area·line·operator) 또는 스칼라 열 이름 */
export const LIST_FILTERS: Partial<Record<EntityType, ListFilter[]>> = {
  station: [REGION, AREA, { key: 'kind', label: '역 종류', kind: 'code', domain: 'stationKind' }, LINE, OPERATOR],
  line_station: [
    LINE,
    REGION,
    OPERATOR,
    { key: 'korail_class', label: '정거장 등급', kind: 'code', domain: 'korailStationClass' },
    { key: 'order_confirmed', label: '순서 확정', kind: 'bool' },
  ],
  line: [
    REGION,
    AREA,
    { key: 'category', label: '범주', kind: 'code', domain: 'lineCategory' },
    { key: 'rail_class', label: '법적 분류', kind: 'code', domain: 'railClass' },
    { key: 'line_role', label: '시설 선로', kind: 'code', domain: 'lineRole' },
    OPERATOR,
    { ...LINE, label: '본선·합칠 노선' },
    { key: 'passenger_service', label: '여객 취급', kind: 'bool' },
    { key: 'is_wide_area', label: '광역철도', kind: 'bool' },
  ],
  service: [
    AREA,
    { key: 'kind', label: '종류', kind: 'code', domain: 'serviceKind' },
    { key: 'train_class_id', label: '열차 등급', kind: 'ref', target: 'train_class' },
    LINE,
    OPERATOR,
  ],
  facility: [{ key: 'kind', label: '시설 종류', kind: 'code', domain: 'facilityKind' }, REGION, OPERATOR, LINE],
};

interface Props {
  type: EntityType;
  values: Record<string, unknown>;
  onChange: (key: string, value: string | undefined) => void;
}

export function ListFilters({ type, values, onChange }: Props) {
  const defs = LIST_FILTERS[type];
  if (!defs) return null;
  return (
    <>
      {defs.map((d) => (
        <FilterSelect
          key={d.key}
          def={d}
          value={typeof values[d.key] === 'string' ? (values[d.key] as string) : ''}
          onChange={(v) => onChange(d.key, v || undefined)}
        />
      ))}
    </>
  );
}

function FilterSelect({ def, value, onChange }: { def: ListFilter; value: string; onChange: (v: string) => void }) {
  const ref = useReference();
  const refItems = useQuery({
    queryKey: ['filter-ref', def.kind === 'ref' ? def.target : null],
    enabled: def.kind === 'ref',
    staleTime: 5 * 60_000,
    queryFn: () =>
      api<{ items: { id: string; name_ko: string | null }[] }>(
        `/v1/admin/${toSlug((def as { target: EntityType }).target)}${qs({ sort: 'name_ko', limit: 500 })}`,
      ),
  });
  let options: { value: string; label: string }[];
  if (def.kind === 'code') {
    const t = codes[def.domain] as { values: readonly string[]; labels: Record<string, { ko: string }> };
    options = t.values.map((v) => ({ value: v, label: t.labels[v]?.ko ?? v }));
  } else if (def.kind === 'region') {
    options = (ref.data?.regions ?? []).map((r) => ({ value: r.code, label: r.name_ko }));
  } else if (def.kind === 'area') {
    options = (ref.data?.areas ?? []).map((a) => ({ value: a.code, label: a.name_ko }));
  } else if (def.kind === 'bool') {
    options = [
      { value: 'true', label: '예' },
      { value: 'false', label: '아니오' },
    ];
  } else {
    options = (refItems.data?.items ?? []).map((it) => ({ value: it.id, label: it.name_ko ?? it.id }));
  }
  return (
    <Select
      className={def.kind === 'ref' ? 'w-48' : 'w-36'}
      aria-label={def.label}
      title={def.label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{`${def.label}: 전체`}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
