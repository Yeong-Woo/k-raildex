/** 변환 공용 도구: 이관 리포트, 퍼지 날짜·시·도·검수 상태·출처·이름 변환 */
import type { FuzzyDate, SourceLink, EntityName } from '@k-raildex/contracts';
import { isValidFuzzy, codes } from '@k-raildex/contracts';
import { REGIONS, REGION_ALIASES } from '@k-raildex/db';
import type { LFuzzy, LName, LProvenance } from '../read/types';

/** 해석 실패·판정 불가 목록(대조 리포트에 그대로 싣는다) */
export class MigrationReport {
  readonly issues = new Map<string, string[]>();
  readonly stats = new Map<string, number>();

  add(category: string, item: string): void {
    const list = this.issues.get(category) ?? [];
    list.push(item);
    this.issues.set(category, list);
  }

  count(key: string, n = 1): void {
    this.stats.set(key, (this.stats.get(key) ?? 0) + n);
  }

  toJSON(): { issues: Record<string, string[]>; stats: Record<string, number> } {
    return {
      issues: Object.fromEntries([...this.issues.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
      stats: Object.fromEntries([...this.stats.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    };
  }
}

export class LegacyFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyFormatError';
  }
}

/** 정밀도 보정 기록(리포트에 싣는다) — fuzzy() 가 채운다 */
export const fuzzyRepairs: string[] = [];

/**
 * 퍼지 날짜 — 형식 오류는 중단(07 문서 3-1절).
 * 예외: 철도통합연표 원문의 "일 미상"(YYYY-MM-00, YYYY-00-00)은 값을 바꾸지 않는 정밀도 낮춤(월·연)으로 보정하고 기록한다.
 */
export function fuzzy(d: LFuzzy | null | undefined, where: string): FuzzyDate | null {
  if (d == null) return null;
  let value = d.value ?? null;
  let precision = d.precision as FuzzyDate['precision'];
  if (precision === 'day' && value) {
    const m = /^(\d{4})-(\d{2})-00$/.exec(value);
    if (m) {
      const repaired =
        m[2] === '00'
          ? { value: m[1]!, precision: 'year' as const }
          : { value: `${m[1]}-${m[2]}`, precision: 'month' as const };
      fuzzyRepairs.push(`${where}: ${value} → ${repaired.value}(${repaired.precision})`);
      value = repaired.value;
      precision = repaired.precision;
    }
  }
  if (!(codes.fuzzyPrecision.values as readonly string[]).includes(precision) || !isValidFuzzy(value, precision)) {
    throw new LegacyFormatError(`${where}: 퍼지 날짜 형식 오류 ${JSON.stringify(d)}`);
  }
  return { value, precision };
}

/** "2026-10-11" / "2026-10" / "2026" 문자열 → 퍼지 날짜. 해석 못 하면 null */
export function fuzzyFromString(s: string | null | undefined): FuzzyDate | null {
  if (!s) return null;
  const t = String(s).trim();
  const precision = /^\d{4}-\d{2}-\d{2}$/.test(t)
    ? 'day'
    : /^\d{4}-\d{2}$/.test(t)
      ? 'month'
      : /^\d{4}$/.test(t)
        ? 'year'
        : null;
  if (!precision || !isValidFuzzy(t, precision)) return null;
  return { value: t, precision };
}

const REGION_BY_NAME = new Map<string, string>([
  ...REGIONS.map((r) => [r.name, r.code] as [string, string]),
  ...Object.entries(REGION_ALIASES),
]);

/** 시·도 이름 → 코드. 모르면 null */
export function regionCode(name: string | null | undefined): string | null {
  if (!name) return null;
  return REGION_BY_NAME.get(name.trim()) ?? null;
}

export function regionCodes(names: string[] | undefined, where: string, report: MigrationReport): string[] {
  const out: string[] = [];
  for (const n of names ?? []) {
    const c = regionCode(n);
    if (!c) report.add('시·도 이름 해석 실패', `${where}: ${n}`);
    else if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** 기존 review_status(verified|auto) → 새 값. auto 는 검수 전(상속값은 버림, D-2) */
export function reviewStatus(v: string | undefined): 'verified' | 'unverified' {
  return v === 'verified' ? 'verified' : 'unverified';
}

/** provenance.sources → 레코드 출처(field 없음) */
export function recordSources(p: LProvenance | undefined): SourceLink[] {
  return [...new Set(p?.sources ?? [])].map((source_id) => ({ source_id, field: null, locator: null, note: null }));
}

/** REC 공통 열 */
export function rec(
  p: LProvenance,
  opts: { review?: string; editorNote?: string | null; extra?: Record<string, unknown> } = {},
): {
  checked_at: string;
  provenance_note: string | null;
  review_status: 'verified' | 'unverified';
  editor_note: string | null;
  extra: Record<string, unknown>;
  sources: SourceLink[];
} {
  return {
    checked_at: p.checked_at,
    provenance_note: p.note ?? null,
    review_status: reviewStatus(opts.review),
    editor_note: opts.editorNote ?? null,
    extra: opts.extra ?? {},
    sources: recordSources(p),
  };
}

/** name{} → 이름 열 */
export function nameCols(n: LName, withHanja = true): Record<string, string | null> {
  const out: Record<string, string | null> = {
    name_ko: n.ko,
    name_en: n.en ?? null,
    name_full: n.full ?? null,
  };
  if (withHanja) out.name_hanja = n.hanja ?? null;
  return out;
}

/** aliases[] → entity_name(kind alias). 같은 이름 중복은 한 번만(대표 이름과 같아도 기존처럼 둔다) */
export function aliasNames(aliases: string[] | undefined, _primary?: string): EntityName[] {
  const seen = new Set<string>();
  const out: EntityName[] = [];
  for (const a of aliases ?? []) {
    const t = a.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push({ name: t, kind: 'alias', lang: 'ko', valid_from: null, valid_to: null, source_id: null, note: null });
  }
  return out;
}

/** undefined 키를 지운 얕은 사본(extra 에 쓰기 전) */
export function compact(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

/** 기존 상위 계획 id(national_rail_4) → pp-national-rail-4 (Q69 A) */
export function programId(legacy: string): string {
  return `pp-${legacy.replace(/_/g, '-')}`;
}

/** 기존 환승센터 id(tc-seoul) → xc-seoul (Q69 A) */
export function transferCenterId(legacy: string): string {
  return legacy.replace(/^tc-/, 'xc-');
}
