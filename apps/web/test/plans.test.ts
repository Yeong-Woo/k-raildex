import { describe, expect, it } from 'vitest';
import { areaMatches } from '../src/lib/filters';
import { comparePlans, planClassMatches, planMatches, STAGE_STRIP, stageStrip } from '../src/lib/plans';

describe('12칸 단계 진행 띠(06 4-1절)', () => {
  it('구상 → 개통 12칸', () => {
    expect(STAGE_STRIP).toHaveLength(12);
    expect(STAGE_STRIP[0]).toBe('concept');
    expect(STAGE_STRIP[11]).toBe('opened');
  });
  it('지난 칸·현재 칸·예정 칸, 도달 연도는 가장 이른 도달 이력', () => {
    const cells = stageStrip(
      'construction',
      [
        { stage: 'plan_listed', kind: 'reached', date: { value: '2011-04', precision: 'month' } },
        { stage: 'plan_listed', kind: 'reached', date: { value: '2006-03', precision: 'month' } },
        { stage: 'construction', kind: 'reached', date: { value: '2014-06-29', precision: 'day' } },
        { stage: 'basic_plan', kind: 'withdrawn', date: { value: '2001', precision: 'year' } },
      ],
      [{ stage: 'opened', expected: { value: '2027-04-01', precision: 'day' } }],
    );
    expect(cells.find((c) => c.stage === 'plan_listed')).toMatchObject({ state: 'done', year: '2006' });
    expect(cells.find((c) => c.stage === 'basic_plan')).toMatchObject({ state: 'done', year: null });
    expect(cells.filter((c) => c.state === 'current').map((c) => c.stage)).toEqual(['construction']);
    expect(cells.find((c) => c.stage === 'construction')?.year).toBe('2014');
    expect(cells.find((c) => c.stage === 'trial_run')?.state).toBe('todo');
    expect(cells.find((c) => c.stage === 'opened')).toMatchObject({ state: 'expected', year: '2027 예정' });
  });
  it('폐기·휴면은 현재 칸 없이 도달한 단계까지 done', () => {
    const cells = stageStrip('abandoned', [{ stage: 'feasibility', kind: 'reached', date: null }], []);
    expect(cells.some((c) => c.state === 'current')).toBe(false);
    expect(cells.filter((c) => c.state === 'done').map((c) => c.stage)).toEqual([
      'concept',
      'plan_listed',
      'prefeasibility',
      'feasibility',
    ]);
  });
});

describe('계획 목록 필터', () => {
  const p = {
    refs: [
      { program_id: 'pp-national-rail-4', program_short: '4차', class: 'new', category: null, section: null },
      { program_id: 'pp-national-rail-3', program_short: '3차', class: 'review', category: null, section: null },
    ],
    stage: 'basic_plan',
    areas: ['capital'],
    scope: 'line',
  } as const;
  const f = { program: 'pp-national-rail-4', cls: 'all', stage: 'all', area: 'all', scope: 'all' } as const;
  it('구분은 고른 차수의 반영 행 기준', () => {
    expect(planClassMatches(p as never, 'pp-national-rail-4', 'review')).toBe(false);
    expect(planClassMatches(p as never, 'pp-national-rail-3', 'review')).toBe(true);
    expect(planClassMatches(p as never, 'all', 'review')).toBe(true);
  });
  it('차수·단계 묶음·범위·권역', () => {
    expect(planMatches(p as never, f, areaMatches)).toBe(true);
    expect(planMatches(p as never, { ...f, program: 'pp-metro-seoul-2' }, areaMatches)).toBe(false);
    expect(planMatches(p as never, { ...f, stage: 'design' }, areaMatches)).toBe(true);
    expect(planMatches(p as never, { ...f, stage: 'build' }, areaMatches)).toBe(false);
    expect(planMatches(p as never, { ...f, scope: 'station' }, areaMatches)).toBe(false);
    expect(planMatches(p as never, { ...f, area: 'honam' }, areaMatches)).toBe(false);
  });
  it('정렬: 진행 중 단계 높은 것 먼저, 개통·폐기는 뒤', () => {
    const mk = (name_ko: string, stage_progress: number) => ({ name_ko, stage_progress }) as never;
    const sorted = [mk('가', 11), mk('나', 3), mk('다', 9), mk('라', -1)].sort(comparePlans);
    expect(sorted.map((x: { name_ko: string }) => x.name_ko)).toEqual(['다', '나', '가', '라']);
  });
});
