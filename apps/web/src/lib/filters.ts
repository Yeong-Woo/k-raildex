/**
 * 목록 필터 규칙(순수 함수 — test/filters.test.ts). 기능 명세는 docs/legacy/design/site-structure.md 13-1절:
 * - 권역 필터 기본값은 전체. `national`(전국) 항목은 어느 권역 탭에서도 보인다.
 * - 분류 탭 숫자는 권역과 무관한 전체 합계, 권역 탭 숫자는 현재 분류 탭 기준.
 */
import { codes, type Code } from '@k-raildex/contracts';

export type AreaCode = Code<'area'>;
export const AREA_TABS = codes.area.values.filter((a) => a !== 'national');

export function areaMatches(areas: readonly string[], area: string): boolean {
  if (area === 'all') return true;
  return areas.includes(area) || areas.includes('national');
}

/** 권역 탭 목록(전체 + 직접 항목이 있는 권역) */
export function areaCounts<T extends { areas: readonly string[] }>(
  items: readonly T[],
): { value: string; count: number }[] {
  const out: { value: string; count: number }[] = [{ value: 'all', count: items.length }];
  for (const a of AREA_TABS) {
    if (!items.some((i) => i.areas.includes(a))) continue;
    out.push({ value: a, count: items.filter((i) => areaMatches(i.areas, a)).length });
  }
  return out;
}

export function areaLabel(value: string): string {
  if (value === 'all') return '전체';
  return (codes.area.labels as Record<string, { ko: string }>)[value]?.ko ?? value;
}

/** 개통 필터(역 목록): 개통 = 운영 중·휴업, 미개통 = 공사 중·계획, 폐지 = 폐지·계획 폐기 */
export type OpenedFilter = 'opened' | 'unopened' | 'closed' | 'all';
export const OPENED_FILTERS: readonly OpenedFilter[] = ['opened', 'unopened', 'closed', 'all'];
export const OPENED_LABEL: Record<OpenedFilter, string> = {
  opened: '개통',
  unopened: '미개통',
  closed: '폐지',
  all: '전체',
};
export function openedOf(status: Code<'status'>): Exclude<OpenedFilter, 'all'> {
  if (status === 'operating' || status === 'suspended') return 'opened';
  if (status === 'planned' || status === 'under_construction') return 'unopened';
  return 'closed';
}

/** 간단한 이름 찾기(목록 안 좁히기): 공백 무시, 대소문자 무시 */
export function textMatches(q: string, ...fields: (string | null | undefined)[]): boolean {
  const n = q.replace(/\s+/g, '').toLowerCase();
  if (!n) return true;
  return fields.some((f) => f != null && f.replace(/\s+/g, '').toLowerCase().includes(n));
}

/** 한국어 이름 정렬 */
export const byKo = <T extends { name_ko: string }>(a: T, b: T) => a.name_ko.localeCompare(b.name_ko, 'ko');
