import { describe, expect, it } from 'vitest';
import {
  dataQuery,
  hashString,
  lineKey,
  mapDiff,
  mapHref,
  parseAt,
  parseHash,
  parseStageKey,
  previousAt,
  stepAt,
  targetLabel,
  yearRange,
} from '../src/lib/map-years';

const YEARS = yearRange([2026, 2027, 2030, 2036, 2019], 2026);

describe('연도 범위(FR-WEB-020)', () => {
  it('올해 ~ 가장 늦은 개통 예정 연도, 지난 연도는 무시', () => {
    expect(YEARS[0]).toBe(2026);
    expect(YEARS.at(-1)).toBe(2036);
    expect(YEARS).toHaveLength(11);
  });
  it('자료가 없으면 올해 + 1 까지', () => {
    expect(yearRange([], 2026)).toEqual([2026, 2027]);
  });
});

describe('at 해석', () => {
  it('연도·future·현재', () => {
    expect(parseAt('2030', YEARS)).toEqual({ mode: 'year', year: 2030 });
    expect(parseAt('future', YEARS)).toEqual({ mode: 'future' });
    expect(parseAt(null, YEARS)).toEqual({ mode: 'current' });
    expect(parseAt('abc', YEARS)).toEqual({ mode: 'current' });
  });
  it('범위 밖 연도는 끝으로', () => {
    expect(parseAt('2001', YEARS)).toEqual({ mode: 'year', year: 2026 });
    expect(parseAt('2099', YEARS)).toEqual({ mode: 'year', year: 2036 });
  });
});

describe('연도 이동(←/→, ‹ ›)', () => {
  it('연도 사이와 목표 미정 칸', () => {
    expect(stepAt({ mode: 'year', year: 2030 }, YEARS, 1)).toEqual({ mode: 'year', year: 2031 });
    expect(stepAt({ mode: 'year', year: 2036 }, YEARS, 1)).toEqual({ mode: 'future' });
    expect(stepAt({ mode: 'future' }, YEARS, 1)).toEqual({ mode: 'future' });
    expect(stepAt({ mode: 'future' }, YEARS, -1)).toEqual({ mode: 'year', year: 2036 });
    expect(stepAt({ mode: 'year', year: 2026 }, YEARS, -1)).toEqual({ mode: 'year', year: 2026 });
  });
  it('현재에서 → 는 첫 연도', () => {
    expect(stepAt({ mode: 'current' }, YEARS, 1)).toEqual({ mode: 'year', year: 2026 });
  });
  it('비교 기준(앞 칸)', () => {
    expect(previousAt({ mode: 'year', year: 2030 }, YEARS)).toEqual({ mode: 'year', year: 2029 });
    expect(previousAt({ mode: 'year', year: 2026 }, YEARS)).toEqual({ mode: 'year', year: 2025 });
    expect(previousAt({ mode: 'future' }, YEARS)).toEqual({ mode: 'year', year: 2036 });
    expect(previousAt({ mode: 'current' }, YEARS)).toBeNull();
  });
});

describe('단계 필터·URL', () => {
  it('단계 키 기본값 = 기본계획 이상', () => {
    expect(parseStageKey(undefined)).toBe('basic');
    expect(parseStageKey('feasibility')).toBe('feasibility');
    expect(parseStageKey('x')).toBe('basic');
  });
  it('사이트 URL 은 기본값을 빼고 해시를 붙인다', () => {
    expect(mapHref({ mode: 'year', year: 2030 }, 'basic')).toBe('/map/?at=2030');
    expect(mapHref({ mode: 'future' }, 'all', 'plan=plan-gtx-c')).toBe('/map/?at=future&stage=all#plan=plan-gtx-c');
    expect(mapHref({ mode: 'current' }, 'basic')).toBe('/map/');
  });
  it('자료 쿼리: 현재 = at 없음, future = 목표 미정 포함', () => {
    expect(dataQuery({ mode: 'current' }, 'basic')).toBe('');
    expect(dataQuery({ mode: 'year', year: 2030 }, 'feasibility')).toBe('?at=2030&stage_min=feasibility');
    expect(dataQuery({ mode: 'future' }, 'all')).toBe('?at=future&stage_min=concept&include_undated=true');
  });
  it('해시 #line= #station= #plan=', () => {
    expect(parseHash('#plan=plan-gtx-c')).toEqual({ plan: 'plan-gtx-c' });
    expect(parseHash('#line=line-seoul-2&station=stn-x&foo=1')).toEqual({ line: 'line-seoul-2', station: 'stn-x' });
    expect(parseHash('')).toEqual({});
    expect(hashString({ station: 'stn-x', line: 'line-a' })).toBe('line=line-a&station=stn-x');
  });
});

describe('생기는·사라지는 노선·역(FR-WEB-026)', () => {
  const L = (feature_id: string, line_id: string | null, plan_id: string | null, name_ko: string) => ({
    feature_id,
    line_id,
    plan_id,
    name_ko,
  });
  it('계획 선(plan:)과 노선 선(line:)은 같은 물리 노선이면 같은 것', () => {
    expect(lineKey(L('plan:p1', 'line-a', 'p1', 'A'))).toBe(lineKey(L('line:line-a', 'line-a', null, 'A')));
  });
  it('차이 목록(가나다순)', () => {
    const d = mapDiff(
      {
        lines: [L('line:line-a', 'line-a', null, '가선'), L('line:line-old', 'line-old', null, '옛선')],
        stations: [
          { station_id: 's1', name_ko: '갑' },
          { station_id: 's-old', name_ko: '폐역' },
        ],
      },
      {
        lines: [
          L('plan:p-a', 'line-a', 'p-a', '가선 연장'),
          L('plan:p-new', null, 'p-new', '나선'),
          L('plan:p-b', null, 'p-b', '다선'),
        ],
        stations: [
          { station_id: 's1', name_ko: '갑' },
          { station_id: 's2', name_ko: '을', plan_ids: ['p-new'] },
        ],
      },
    );
    expect(d.addedLines.map((x) => x.name)).toEqual(['나선', '다선']);
    expect(d.addedLines[0]).toMatchObject({ kind: 'plan', id: 'p-new' });
    expect(d.removedLines).toEqual([{ key: 'line:line-old', name: '옛선', kind: 'line', id: 'line-old' }]);
    expect(d.addedStations).toEqual([{ key: 's2', name: '을', kind: 'station', id: 's2', plan_id: 'p-new' }]);
    expect(d.removedStations.map((x) => x.id)).toEqual(['s-old']);
  });
  it('개통 예정 표기', () => {
    expect(targetLabel('2031-09', 'month')).toBe('2031년 9월');
    expect(targetLabel('2027-H2', 'half')).toBe('2027년 하반기');
    expect(targetLabel(null, null)).toBe('목표 미정');
  });
});
