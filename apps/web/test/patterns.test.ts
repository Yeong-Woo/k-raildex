import { describe, expect, it } from 'vitest';
import { serviceHoursAt, stopMatrix } from '../src/lib/patterns';

const st = (id: string) => ({ station_id: id, name_ko: id.toUpperCase(), line_id: 'l1', station_code: null });

describe('stopMatrix', () => {
  it('가장 긴 패턴을 뼈대로, 다른 패턴에만 있는 역은 앞 역 뒤에 끼운다', () => {
    const rows = stopMatrix([
      { code: 'exp', name_ko: '급행', stops: [st('a'), st('c'), st('x'), st('e')] },
      { code: 'loc', name_ko: '완행', stops: [st('a'), st('b'), st('c'), st('d'), st('e')] },
    ]);
    expect(rows.map((r) => r.station_id)).toEqual(['a', 'b', 'c', 'x', 'd', 'e']);
    expect(rows.find((r) => r.station_id === 'b')!.stops).toEqual({ exp: false, loc: true });
    expect(rows.find((r) => r.station_id === 'x')!.stops).toEqual({ exp: true, loc: false });
  });
  it('패턴이 없으면 빈 표', () => {
    expect(stopMatrix([])).toEqual([]);
  });
});

describe('serviceHoursAt', () => {
  it('이 운행 계통 것만, 평균 배차 = 운행 시간 / (편수 - 1)', () => {
    const base = { day_type: 'weekday', direction: 'up', direction_label: null, day_note: null, data_as_of: null };
    const h = serviceHoursAt('stn-a', 'A', 'svc-1', [
      { ...base, service_id: 'svc-1', first_minute: 330, last_minute: 1410, count: 109 },
      { ...base, service_id: 'svc-2', first_minute: 300, last_minute: 1400, count: 10 },
      { ...base, service_id: 'svc-1', direction: 'down', first_minute: 600, last_minute: 600, count: 1 },
    ]);
    expect(h).toHaveLength(2);
    expect(h[0]!.headway).toBe(10);
    expect(h[1]!.headway).toBeNull();
  });
});
