/**
 * 계산 규칙의 TS 구현 — DB 뷰(0013)와 같은 결과(교차 시험으로 보장). 관리 앱의 실시간 미리 보기에 쓴다.
 */
import { compareFuzzy, fuzzyFrom, PLAN_STAGE_PROGRESS, type Code, type FuzzyDate } from '@k-raildex/contracts';

type Stage = Code<'planStage'>;
type Status = Code<'status'>;

const STAGE_BY_PROGRESS = Object.entries(PLAN_STAGE_PROGRESS)
  .filter(([, p]) => p >= 0)
  .sort((a, b) => a[1] - b[1])
  .map(([s]) => s as Stage);

export interface StageEventLike {
  stage: Stage;
  kind: Code<'planStageEventKind'>;
  date: FuzzyDate;
}

/** 현재 단계: reached 최고 진행도 / withdrawn 직전 단계 / dormant 휴면 / abandoned 폐기(이후 reached 로 되살림) */
export function currentStage(events: StageEventLike[], override: Stage | null = null): Stage | null {
  if (override) return override;
  const sorted = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const fa = fuzzyFrom(a.e.date);
      const fb = fuzzyFrom(b.e.date);
      if (fa !== fb) {
        if (fa === null) return 1;
        if (fb === null) return -1;
        return fa < fb ? -1 : 1;
      }
      const pa = PLAN_STAGE_PROGRESS[a.e.stage];
      const pb = PLAN_STAGE_PROGRESS[b.e.stage];
      return pa !== pb ? pa - pb : a.i - b.i;
    })
    .map((x) => x.e);
  let best = -1;
  let cur: Stage | null = null;
  for (const e of sorted) {
    if (e.kind === 'reached') {
      if (e.stage === 'abandoned') cur = 'abandoned';
      else if (e.stage === 'dormant') cur = 'dormant';
      else {
        best = Math.max(best, PLAN_STAGE_PROGRESS[e.stage]);
        cur = STAGE_BY_PROGRESS[best] ?? null;
      }
    } else if (e.kind === 'withdrawn') {
      best = Math.max(PLAN_STAGE_PROGRESS[e.stage] - 1, 0);
      cur = STAGE_BY_PROGRESS[best] ?? null;
    } else {
      cur = 'dormant';
    }
  }
  return cur;
}

export interface MilestoneLike {
  stage: Stage;
  expected: FuzzyDate;
  as_of: FuzzyDate | null;
}

/** 개통 목표 = opened 기대 일정 중 발표 시점(as_of)이 가장 최근인 것(같으면 나중에 넣은 것) */
export function targetOpen(milestones: MilestoneLike[]): FuzzyDate | null {
  let best: { m: MilestoneLike; i: number } | null = null;
  milestones.forEach((m, i) => {
    if (m.stage !== 'opened') return;
    if (!best) {
      best = { m, i };
      return;
    }
    const c = compareFuzzy(m.as_of, best.m.as_of);
    // as_of 가 늦을수록 우선, 미상은 뒤
    const later = fuzzyFrom(m.as_of) !== null && (fuzzyFrom(best.m.as_of) === null || c > 0);
    if (later || (c === 0 && i > best.i)) best = { m, i };
  });
  return best ? (best as { m: MilestoneLike }).m.expected : null;
}

export interface LineStationLike {
  status: Status;
  opened: FuzzyDate | null;
  closed: FuzzyDate | null;
}

export interface StationStatusResult {
  status: Status | null;
  opened: FuzzyDate | null;
  closed: FuzzyDate | null;
}

const STATUS_PRIORITY: Status[] = ['operating', 'suspended', 'under_construction', 'planned', 'closed', 'abandoned'];

/** 역 상태·개통·폐지 = 노선별 역에서(가장 이른 개통, 모두 폐지면 가장 늦은 폐지). 노선별 역이 없으면 단독 값 */
export function stationStatus(lineStations: LineStationLike[], own: StationStatusResult): StationStatusResult {
  if (lineStations.length === 0) return own;
  const status = STATUS_PRIORITY.find((s) => lineStations.some((x) => x.status === s)) ?? 'abandoned';
  const opened =
    lineStations
      .map((x) => x.opened)
      .filter((d): d is FuzzyDate => d != null)
      .sort(compareFuzzy)[0] ?? null;
  let closed: FuzzyDate | null = null;
  if (lineStations.every((x) => x.status === 'closed' || x.status === 'abandoned')) {
    const cl = lineStations.map((x) => x.closed).filter((d): d is FuzzyDate => d != null);
    closed = cl.sort((a, b) => compareFuzzy(b, a))[0] ?? null;
  }
  return { status, opened, closed };
}
