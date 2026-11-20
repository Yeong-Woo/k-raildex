/**
 * 퍼지 날짜 (docs/03-data-model.md 2-3절). DB 함수 fuzzy_valid/from/to 와 같은 규칙.
 * - day: YYYY-MM-DD / month: YYYY-MM / half: YYYY-H1|H2 / year: YYYY / unknown: value 없음
 * - 값과 정밀도가 모두 없으면 "해당 없음"(null 로 표현)
 */
import { z } from 'zod';
import { codes, type Code } from './codes';

export type FuzzyPrecision = Code<'fuzzyPrecision'>;

export interface FuzzyDate {
  value: string | null;
  precision: FuzzyPrecision;
}

const PATTERN: Record<Exclude<FuzzyPrecision, 'unknown'>, RegExp> = {
  day: /^(\d{4})-(\d{2})-(\d{2})$/,
  month: /^(\d{4})-(\d{2})$/,
  half: /^(\d{4})-H([12])$/,
  year: /^(\d{4})$/,
};

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isValidFuzzy(value: string | null | undefined, precision: FuzzyPrecision | null | undefined): boolean {
  if (precision == null) return value == null;
  if (precision === 'unknown') return value == null;
  if (value == null) return false;
  const m = PATTERN[precision].exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  if (y < 1800 || y > 2200) return false;
  if (precision === 'day' || precision === 'month') {
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) return false;
    if (precision === 'day') {
      const d = Number(m[3]);
      if (d < 1 || d > daysInMonth(y, mo)) return false;
    }
  }
  return true;
}

/** 구간 시작(YYYY-MM-DD). unknown 이면 null */
export function fuzzyFrom(f: FuzzyDate | null | undefined): string | null {
  if (!f || f.precision === 'unknown' || f.value == null) return null;
  const v = f.value;
  switch (f.precision) {
    case 'day':
      return v;
    case 'month':
      return `${v}-01`;
    case 'half':
      return `${v.slice(0, 4)}-${v.endsWith('H1') ? '01' : '07'}-01`;
    case 'year':
      return `${v}-01-01`;
  }
}

/** 구간 끝(YYYY-MM-DD). unknown 이면 null */
export function fuzzyTo(f: FuzzyDate | null | undefined): string | null {
  if (!f || f.precision === 'unknown' || f.value == null) return null;
  const v = f.value;
  const y = Number(v.slice(0, 4));
  switch (f.precision) {
    case 'day':
      return v;
    case 'month': {
      const mo = Number(v.slice(5, 7));
      return iso(y, mo, daysInMonth(y, mo));
    }
    case 'half':
      return v.endsWith('H1') ? iso(y, 6, 30) : iso(y, 12, 31);
    case 'year':
      return iso(y, 12, 31);
  }
}

const PRECISION_RANK: Record<FuzzyPrecision, number> = { day: 0, month: 1, half: 2, year: 3, unknown: 4 };

/** 정렬: 시작일 오름차순, 같으면 정밀도 높은 것 먼저, unknown·null 은 맨 뒤 */
export function compareFuzzy(a: FuzzyDate | null | undefined, b: FuzzyDate | null | undefined): number {
  const fa = fuzzyFrom(a);
  const fb = fuzzyFrom(b);
  if (fa === null && fb === null) return 0;
  if (fa === null) return 1;
  if (fb === null) return -1;
  if (fa !== fb) return fa < fb ? -1 : 1;
  return PRECISION_RANK[a!.precision] - PRECISION_RANK[b!.precision];
}

/** 화면 표기: 2025-06-28 / 2027년 3월 / 2028년 상반기 / 2030년 / 미정 */
export function formatFuzzy(f: FuzzyDate | null | undefined): string {
  if (!f) return '';
  if (f.precision === 'unknown' || f.value == null) return '미정';
  const v = f.value;
  switch (f.precision) {
    case 'day':
      return v;
    case 'month':
      return `${v.slice(0, 4)}년 ${Number(v.slice(5, 7))}월`;
    case 'half':
      return `${v.slice(0, 4)}년 ${v.endsWith('H1') ? '상반기' : '하반기'}`;
    case 'year':
      return `${v}년`;
  }
}

export const fuzzyDateSchema = z
  .object({
    value: z.string().nullable(),
    precision: z.enum(codes.fuzzyPrecision.values),
  })
  .strict()
  .refine((f) => isValidFuzzy(f.value, f.precision), { message: '퍼지 날짜 형식이 정밀도와 맞지 않음' });
