import { describe, expect, it } from 'vitest';
import { compareFuzzy, formatFuzzy, fuzzyFrom, fuzzyTo, isValidFuzzy, type FuzzyDate } from '../src/fuzzy-date';
import { entityTypeOfId, ID_PREFIX, isEntityId, lineStationId } from '../src/ids';
import { codes, PLAN_STAGE_PROGRESS } from '../src/codes';

const f = (value: string | null, precision: FuzzyDate['precision']): FuzzyDate => ({ value, precision });

describe('fuzzy date', () => {
  it('validates by precision', () => {
    expect(isValidFuzzy('2024-02-29', 'day')).toBe(true);
    expect(isValidFuzzy('2023-02-29', 'day')).toBe(false);
    expect(isValidFuzzy('2027-03', 'month')).toBe(true);
    expect(isValidFuzzy('2027-13', 'month')).toBe(false);
    expect(isValidFuzzy('2028-H2', 'half')).toBe(true);
    expect(isValidFuzzy('2028-H3', 'half')).toBe(false);
    expect(isValidFuzzy('2030', 'year')).toBe(true);
    expect(isValidFuzzy(null, 'unknown')).toBe(true);
    expect(isValidFuzzy('2030', 'unknown')).toBe(false);
    expect(isValidFuzzy(null, null)).toBe(true);
    expect(isValidFuzzy('2030', null)).toBe(false);
  });

  it('computes ranges', () => {
    expect([fuzzyFrom(f('2028-H1', 'half')), fuzzyTo(f('2028-H1', 'half'))]).toEqual(['2028-01-01', '2028-06-30']);
    expect([fuzzyFrom(f('2028-H2', 'half')), fuzzyTo(f('2028-H2', 'half'))]).toEqual(['2028-07-01', '2028-12-31']);
    expect(fuzzyTo(f('2024-02', 'month'))).toBe('2024-02-29');
    expect(fuzzyTo(f('2030', 'year'))).toBe('2030-12-31');
    expect(fuzzyFrom(f(null, 'unknown'))).toBeNull();
  });

  it('sorts start date then precision, unknown last', () => {
    const list = [f(null, 'unknown'), f('2027', 'year'), f('2027-01-01', 'day'), f('2026-12', 'month')];
    expect(list.sort(compareFuzzy).map((x) => x.value)).toEqual(['2026-12', '2027-01-01', '2027', null]);
  });

  it('formats in Korean', () => {
    expect(formatFuzzy(f('2027-03', 'month'))).toBe('2027년 3월');
    expect(formatFuzzy(f('2028-H1', 'half'))).toBe('2028년 상반기');
    expect(formatFuzzy(f(null, 'unknown'))).toBe('미정');
  });
});

describe('ids', () => {
  it('has unique prefixes for every entity type', () => {
    const prefixes = Object.values(ID_PREFIX);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(Object.keys(ID_PREFIX).sort()).toEqual([...codes.entityType.values].sort());
  });

  it('validates and detects types', () => {
    expect(isEntityId('station', 'stn-seoul')).toBe(true);
    expect(isEntityId('station', 'stn-Seoul')).toBe(false);
    expect(isEntityId('plan_program', 'pp-national-rail-4')).toBe(true);
    expect(isEntityId('plan_program', 'national_rail_4')).toBe(false);
    expect(entityTypeOfId('ls-gyeongbu--seoul')).toBe('line_station');
    expect(entityTypeOfId('line-gyeongbu')).toBe('line');
    expect(entityTypeOfId('xc-daegok')).toBe('transfer_center');
    expect(entityTypeOfId('tc-ktx')).toBe('train_class');
  });

  it('builds line station ids', () => {
    expect(lineStationId('line-gyeongbu', 'stn-seoul')).toBe('ls-gyeongbu--seoul');
    expect(lineStationId('line-seoul-2', 'stn-city-hall-seoul', 2)).toBe('ls-seoul-2--city-hall-seoul-2');
  });
});

describe('codes', () => {
  it('orders plan stages by progress', () => {
    const progressing = codes.planStage.values.filter((s) => PLAN_STAGE_PROGRESS[s] >= 0);
    expect(progressing.map((s) => PLAN_STAGE_PROGRESS[s])).toEqual(progressing.map((_, i) => i));
  });
});
