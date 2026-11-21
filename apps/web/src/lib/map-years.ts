/**
 * 미래 지도 규칙(순수 함수 — test/map-years.test.ts). docs/06 3절 FR-WEB-020~026.
 * - URL: `?at=2030`(연도) | `?at=future`(목표 미정까지 전부) | 없음(현재), `&stage=feasibility|all`(기본 = 기본계획 이상)
 * - 연도 범위: 올해 ~ 가장 늦은 개통 예정 연도 + "목표 미정" 칸
 * - 해시 `#line= #station= #plan=` 강조
 * - 선택 연도에 생기는·사라지는 노선·역 목록(지도 대체 정보, FR-WEB-026) = 앞 칸과의 차이
 */
import { formatFuzzy, isCode } from '@k-raildex/contracts';

export type MapAt = { mode: 'current' } | { mode: 'year'; year: number } | { mode: 'future' };

export type StageKey = 'basic' | 'feasibility' | 'all';
export const STAGE_KEYS: readonly StageKey[] = ['basic', 'feasibility', 'all'];
/** 단계 필터(FR-WEB-022·Q88) → API stage_min */
export const STAGE_MIN: Record<StageKey, string> = { basic: 'basic_plan', feasibility: 'feasibility', all: 'concept' };
export const STAGE_KEY_LABEL: Record<StageKey, string> = {
  basic: '기본계획 이상',
  feasibility: '예비타당성조사 이상',
  all: '전체(휴면·폐기 제외)',
};

export function parseStageKey(raw: string | null | undefined): StageKey {
  return raw === 'feasibility' || raw === 'all' ? raw : 'basic';
}

/** 슬라이더 연도들: 올해 ~ max(데이터의 가장 늦은 연도, 올해 + 1) */
export function yearRange(dataYears: readonly number[], currentYear: number): number[] {
  const max = Math.max(currentYear + 1, ...dataYears.filter((y) => y >= currentYear));
  return Array.from({ length: max - currentYear + 1 }, (_, i) => currentYear + i);
}

/** `at` 값 해석. 범위 밖 연도는 가장 가까운 끝으로, 지난 연도는 올해로 */
export function parseAt(raw: string | null | undefined, years: readonly number[]): MapAt {
  if (raw === 'future') return { mode: 'future' };
  if (!raw || !/^\d{4}$/.test(raw) || years.length === 0) return { mode: 'current' };
  const y = Number(raw);
  const lo = years[0]!;
  const hi = years[years.length - 1]!;
  return { mode: 'year', year: Math.min(hi, Math.max(lo, y)) };
}

export function atParam(at: MapAt): string | undefined {
  return at.mode === 'current' ? undefined : at.mode === 'future' ? 'future' : String(at.year);
}

/** 슬라이더 칸: 연도들 + 'future'(목표 미정). 현재 지도는 슬라이더 밖(현재/미래 전환) */
export function stepAt(at: MapAt, years: readonly number[], delta: number): MapAt {
  const slots: MapAt[] = [...years.map((year) => ({ mode: 'year', year }) as MapAt), { mode: 'future' }];
  const idx =
    at.mode === 'future'
      ? slots.length - 1
      : at.mode === 'year'
        ? Math.max(0, years.indexOf(at.year))
        : delta > 0
          ? -1
          : 0;
  const next = Math.min(slots.length - 1, Math.max(0, idx + delta));
  return slots[next]!;
}

/** 앞 칸(차이 비교 기준). 첫 연도는 비교 대상 없음(null) — 그해 개통 예정은 timeline 목록으로 */
export function previousAt(at: MapAt, years: readonly number[]): MapAt | null {
  if (at.mode === 'current') return null;
  if (at.mode === 'future') return years.length ? { mode: 'year', year: years[years.length - 1]! } : null;
  const i = years.indexOf(at.year);
  return i > 0 ? { mode: 'year', year: years[i - 1]! } : { mode: 'year', year: at.year - 1 };
}

/** 사이트 URL(`/map/?at=…&stage=…#…`) */
export function mapHref(at: MapAt, stage: StageKey, hash?: string): string {
  const qs = new URLSearchParams();
  const a = atParam(at);
  if (a) qs.set('at', a);
  if (stage !== 'basic') qs.set('stage', stage);
  const s = qs.toString();
  return `/map/${s ? `?${s}` : ''}${hash ? `#${hash}` : ''}`;
}

/** Route Handler 쿼리(`/api/map/<kind>/?…`). 현재 지도는 at 없음 */
export function dataQuery(at: MapAt, stage: StageKey): string {
  const qs = new URLSearchParams();
  const a = atParam(at);
  if (a) {
    qs.set('at', a);
    qs.set('stage_min', STAGE_MIN[stage]);
    if (a === 'future') qs.set('include_undated', 'true');
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export interface MapHash {
  line?: string;
  station?: string;
  plan?: string;
}

/** `#line=x`, `#station=y&plan=z` 처럼 여러 개도 */
export function parseHash(hash: string): MapHash {
  const out: MapHash = {};
  const h = hash.replace(/^#/, '');
  for (const part of h.split('&')) {
    const [k, v] = part.split('=');
    if (!v) continue;
    const val = decodeURIComponent(v);
    if (k === 'line' || k === 'station' || k === 'plan') out[k] = val;
  }
  return out;
}

export function hashString(h: MapHash): string {
  return (['line', 'station', 'plan'] as const)
    .filter((k) => h[k])
    .map((k) => `${k}=${encodeURIComponent(h[k]!)}`)
    .join('&');
}

// ------------------------------------------------------------------ 생기는·사라지는 노선·역

export interface LineFeatureProps {
  feature_id: string;
  line_id: string | null;
  plan_id: string | null;
  name_ko: string;
  stage?: string | null;
  status?: string | null;
  delayed?: boolean;
  target_value?: string | null;
  target_precision?: string | null;
}
export interface StationFeatureProps {
  station_id: string;
  name_ko: string;
  future?: boolean;
  plan_ids?: string[];
}

export interface DiffItem {
  key: string;
  name: string;
  /** 링크 대상 */
  kind: 'line' | 'plan' | 'station';
  id: string;
  plan_id?: string | null;
}
export interface MapDiff {
  addedLines: DiffItem[];
  removedLines: DiffItem[];
  addedStations: DiffItem[];
  removedStations: DiffItem[];
}

/** 같은 물리 노선은 계획 선(plan:…)과 노선 선(line:…)이 같은 것으로 본다 */
export function lineKey(p: LineFeatureProps): string {
  return p.line_id ? `line:${p.line_id}` : p.plan_id ? `plan:${p.plan_id}` : p.feature_id;
}

function lineItem(p: LineFeatureProps): DiffItem {
  return p.plan_id
    ? { key: lineKey(p), name: p.name_ko, kind: 'plan', id: p.plan_id, plan_id: p.plan_id }
    : { key: lineKey(p), name: p.name_ko, kind: 'line', id: p.line_id ?? p.feature_id };
}

const byName = (a: DiffItem, b: DiffItem) => a.name.localeCompare(b.name, 'ko');

export function mapDiff(
  prev: { lines: readonly LineFeatureProps[]; stations: readonly StationFeatureProps[] },
  next: { lines: readonly LineFeatureProps[]; stations: readonly StationFeatureProps[] },
): MapDiff {
  const pl = new Map(prev.lines.map((p) => [lineKey(p), p]));
  const nl = new Map(next.lines.map((p) => [lineKey(p), p]));
  const ps = new Map(prev.stations.map((s) => [s.station_id, s]));
  const ns = new Map(next.stations.map((s) => [s.station_id, s]));
  const st = (s: StationFeatureProps): DiffItem => ({
    key: s.station_id,
    name: s.name_ko,
    kind: 'station',
    id: s.station_id,
    plan_id: s.plan_ids?.[0] ?? null,
  });
  return {
    addedLines: [...nl]
      .filter(([k]) => !pl.has(k))
      .map(([, p]) => lineItem(p))
      .sort(byName),
    removedLines: [...pl]
      .filter(([k]) => !nl.has(k))
      .map(([, p]) => lineItem(p))
      .sort(byName),
    addedStations: [...ns]
      .filter(([k]) => !ps.has(k))
      .map(([, s]) => st(s))
      .sort(byName),
    removedStations: [...ps]
      .filter(([k]) => !ns.has(k))
      .map(([, s]) => st(s))
      .sort(byName),
  };
}

/** 퍼지 개통 예정 표기(지도 속성 target_value/precision) */
export function targetLabel(value: string | null | undefined, precision: string | null | undefined): string {
  if (!precision || precision === 'unknown' || !value || !isCode('fuzzyPrecision', precision)) return '목표 미정';
  return formatFuzzy({ value, precision });
}
