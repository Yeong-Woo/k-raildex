import { describe, expect, it } from 'vitest';
import { parseFuzzyText, fuzzyText } from './fuzzy-text';
import { kmRegressions, rangeKeys, setStatusFor, toPutItems, type LsRow } from './line-stations';

describe('parseFuzzyText', () => {
  it('infers precision from the text shape', () => {
    expect(parseFuzzyText('2030-05-01')).toEqual({ value: '2030-05-01', precision: 'day' });
    expect(parseFuzzyText('2030-05')).toEqual({ value: '2030-05', precision: 'month' });
    expect(parseFuzzyText('2030-h2')).toEqual({ value: '2030-H2', precision: 'half' });
    expect(parseFuzzyText('2030')).toEqual({ value: '2030', precision: 'year' });
    expect(parseFuzzyText('?')).toEqual({ value: null, precision: 'unknown' });
    expect(parseFuzzyText('')).toBeNull();
    expect(parseFuzzyText('2030-13')).toBeUndefined();
    expect(fuzzyText({ value: null, precision: 'unknown' })).toBe('?');
  });
});

describe('line station helpers', () => {
  const row = (k: string, km: number | null, branch: string | null = null) =>
    ({ _key: k, km, branch, status: 'operating' }) as unknown as LsRow;

  it('flags km regressions per branch, following the first direction', () => {
    expect([...kmRegressions([row('a', 0), row('b', 2), row('c', 1), row('d', 3)])]).toEqual([2]);
    expect([...kmRegressions([row('a', 10), row('b', 8), row('c', 9)])]).toEqual([2]);
    expect([
      ...kmRegressions([row('a', 0), row('x', 5, 'B'), row('b', 2), row('y', 7, 'B'), row('z', 6, 'B')]),
    ]).toEqual([4]);
    expect(kmRegressions([row('a', null), row('b', 1)]).size).toBe(0);
  });

  it('selects ranges and bulk-sets status', () => {
    const rows = ['a', 'b', 'c', 'd'].map((k) => row(k, null));
    expect(rangeKeys(rows, 'c', 'a')).toEqual(['a', 'b', 'c']);
    expect(setStatusFor(rows, new Set(['b']), 'planned').map((r) => r.status)).toEqual([
      'operating',
      'planned',
      'operating',
      'operating',
    ]);
  });

  it('strips server-owned fields from the PUT body', () => {
    const body = toPutItems([
      { ...row('a', 1), id: 'ls-1', version: 2, seq: 1, station_name_ko: '가', line_id: 'l' } as LsRow,
    ]);
    expect(body[0]).toEqual({ id: 'ls-1', version: 2, km: 1, branch: null, status: 'operating' });
  });
});
