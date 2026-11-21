/**
 * 계획 화면 규칙(순수 함수 — test/plans.test.ts).
 * - 12칸 단계 진행 띠(06 문서 4-1절): 칸마다 도달 연도(단계 이력 중 '도달'), 현재 칸, 기대 일정이 있는 앞 칸("예정")
 * - 목록 필터(06 문서 2절 `/plans/`: 차수·구분·단계·권역·범위) — 기존 사이트 기본 차수는 제4차 국가철도망(legacy site-structure 1절)
 */
import {
  codeLabel,
  PLAN_STAGE_PROGRESS,
  type Code,
  type FuzzyDate,
  type PublicPlanListItem,
} from '@k-raildex/contracts';
import { STAGE_GROUP, type StageGroup } from '@k-raildex/ui/tokens';

type Stage = Code<'planStage'>;

/** 진행 띠 12칸 순서(구상 → 개통). 폐기·휴면은 띠 밖 */
export const STAGE_STRIP: readonly Stage[] = (Object.keys(PLAN_STAGE_PROGRESS) as Stage[])
  .filter((s) => PLAN_STAGE_PROGRESS[s] >= 0)
  .sort((a, b) => PLAN_STAGE_PROGRESS[a] - PLAN_STAGE_PROGRESS[b]);

/** 띠 칸에 쓰는 짧은 이름 */
export const STAGE_STRIP_LABEL: Readonly<Record<Stage, string>> = {
  concept: '구상',
  plan_listed: '계획 반영',
  prefeasibility: '사전타당성',
  feasibility: '예비타당성',
  strategic_eia: '전략환경',
  basic_plan: '기본계획',
  basic_design: '기본설계',
  eia: '환경영향',
  detail_design: '실시설계',
  construction: '공사',
  trial_run: '시운전',
  opened: '개통',
  abandoned: '폐기',
  dormant: '휴면',
};

export type StripState = 'done' | 'current' | 'expected' | 'todo';

export interface StripCell {
  stage: Stage;
  n: number;
  label: string;
  state: StripState;
  /** 도달 연도(단계 이력) 또는 기대 연도("2027 예정") */
  year: string | null;
}

interface StageEventLike {
  stage: Stage;
  kind: string;
  date: FuzzyDate | null;
}
interface MilestoneLike {
  stage: Stage;
  expected: FuzzyDate | null;
}

const yearOf = (f: FuzzyDate | null | undefined) => (f?.value ? f.value.slice(0, 4) : null);

/**
 * 12칸 띠. 현재 단계 = stage(폐기·휴면이면 도달 이력 중 가장 높은 단계까지만 done, 현재 칸 없음).
 * 도달 연도는 가장 이른 '도달' 이력, 현재 단계 뒤 칸은 기대 일정(milestones)이 있으면 expected.
 */
export function stageStrip(
  stage: Stage | null,
  events: readonly StageEventLike[],
  milestones: readonly MilestoneLike[],
): StripCell[] {
  const reached = new Map<Stage, string>();
  for (const e of events) {
    if (e.kind !== 'reached') continue;
    const y = yearOf(e.date);
    if (!y) {
      if (!reached.has(e.stage)) reached.set(e.stage, '');
      continue;
    }
    const prev = reached.get(e.stage);
    if (!prev || y < prev) reached.set(e.stage, y);
  }
  const stopped = !stage || PLAN_STAGE_PROGRESS[stage] < 0;
  const cur = stopped
    ? Math.max(-1, ...[...reached.keys()].map((s) => PLAN_STAGE_PROGRESS[s]).filter((n) => n >= 0))
    : PLAN_STAGE_PROGRESS[stage];
  const expected = new Map<Stage, string>();
  for (const m of milestones) {
    const y = yearOf(m.expected);
    if (y && !expected.has(m.stage)) expected.set(m.stage, y);
  }
  return STAGE_STRIP.map((s, i) => {
    const p = PLAN_STAGE_PROGRESS[s];
    let state: StripState;
    if (p < cur || (stopped && p === cur)) state = 'done';
    else if (p === cur) state = 'current';
    else state = expected.has(s) ? 'expected' : 'todo';
    const year = state === 'expected' ? `${expected.get(s)} 예정` : reached.get(s) ? (reached.get(s) as string) : null;
    return { stage: s, n: i + 1, label: STAGE_STRIP_LABEL[s], state, year };
  });
}

// ------------------------------------------------------------------ 목록 필터

/** 기존 사이트 기본 차수(제4차 국가철도망, legacy `national_rail_4` → Q69 A `pp-national-rail-4`) */
export const DEFAULT_PROGRAM = 'pp-national-rail-4';

export type StageFilter = StageGroup | 'all';
export const STAGE_FILTERS: readonly StageFilter[] = ['all', 'early', 'study', 'design', 'build', 'open', 'stopped'];
export const STAGE_FILTER_LABEL: Record<StageFilter, string> = {
  all: '전체',
  early: '구상·계획 반영',
  study: '타당성 조사',
  design: '기본계획·설계',
  build: '공사·시운전',
  open: '개통',
  stopped: '폐기·휴면',
};

export function stageGroupOf(stage: Stage | null): StageGroup | null {
  return stage ? STAGE_GROUP[stage] : null;
}

export interface PlanFilter {
  /** 'all' 또는 상위 계획 id */
  program: string;
  /** 'all' 또는 planRefClass(선택한 차수 안의 구분) */
  cls: string;
  stage: StageFilter;
  area: string;
  scope: string;
}

type PlanLike = Pick<PublicPlanListItem, 'refs' | 'stage' | 'areas' | 'scope'>;

export function planInProgram(p: Pick<PlanLike, 'refs'>, program: string): boolean {
  return program === 'all' || p.refs.some((r) => r.program_id === program);
}

/** 구분 일치: 차수를 고르면 그 차수 반영 행의 구분, 전체면 아무 반영 행 */
export function planClassMatches(p: Pick<PlanLike, 'refs'>, program: string, cls: string): boolean {
  if (cls === 'all') return true;
  return p.refs.some((r) => (program === 'all' || r.program_id === program) && r.class === cls);
}

export function planMatches(p: PlanLike, f: PlanFilter, areaMatches: (areas: readonly string[], a: string) => boolean) {
  return (
    planInProgram(p, f.program) &&
    planClassMatches(p, f.program, f.cls) &&
    (f.stage === 'all' || stageGroupOf(p.stage) === f.stage) &&
    (f.scope === 'all' || p.scope === f.scope) &&
    areaMatches(p.areas, f.area)
  );
}

/** 정렬: 단계 진행도 높은 것 먼저(개통 제외는 앞), 같으면 이름 */
export function comparePlans(a: PublicPlanListItem, b: PublicPlanListItem): number {
  const pa = a.stage_progress < 0 ? -2 : a.stage_progress === 11 ? -1 : a.stage_progress;
  const pb = b.stage_progress < 0 ? -2 : b.stage_progress === 11 ? -1 : b.stage_progress;
  return pb - pa || a.name_ko.localeCompare(b.name_ko, 'ko');
}

/** 상위 계획 탭 묶음(기존 Q96: 국가철도망 / 시·도 도시철도망 / 기타) */
export function programGroupOf(kind: string): 'national_rail' | 'metro_network' | 'other' {
  return kind === 'national_rail' ? 'national_rail' : kind === 'metro_network' ? 'metro_network' : 'other';
}
export const PROGRAM_GROUP_LABEL = { national_rail: '국가철도망', metro_network: '시·도 도시철도망', other: '기타' };

export function stageLabel(s: Stage | null): string {
  return s ? codeLabel('planStage', s) : '단계 미확인';
}
