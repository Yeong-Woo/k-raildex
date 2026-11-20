/** 표 안에서 쓰는 한 칸짜리 퍼지 날짜 입력: 글자 모양으로 정밀도를 정한다 */
import { isValidFuzzy, type FuzzyDate } from '@k-raildex/contracts';

/** 'YYYY-MM-DD' → day, 'YYYY-MM' → month, 'YYYY-H1' → half, 'YYYY' → year, '?'·'미상' → unknown, '' → null. 형식이 틀리면 undefined */
export function parseFuzzyText(text: string): FuzzyDate | null | undefined {
  const t = text.trim().toUpperCase();
  if (t === '') return null;
  if (t === '?' || t === '미상') return { value: null, precision: 'unknown' };
  const precision = /^\d{4}-\d{2}-\d{2}$/.test(t)
    ? 'day'
    : /^\d{4}-\d{2}$/.test(t)
      ? 'month'
      : /^\d{4}-H[12]$/.test(t)
        ? 'half'
        : /^\d{4}$/.test(t)
          ? 'year'
          : null;
  if (!precision || !isValidFuzzy(t, precision)) return undefined;
  return { value: t, precision };
}

export function fuzzyText(f: FuzzyDate | null | undefined): string {
  if (!f) return '';
  if (f.precision === 'unknown') return '?';
  return f.value ?? '';
}
