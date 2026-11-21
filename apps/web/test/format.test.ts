import { describe, expect, it } from 'vitest';
import {
  dday,
  fmtKm,
  fmtMinute,
  fuzzyDateTime,
  lineShortLabel,
  matchedKindLabel,
  serviceGroupOf,
  stopClassesOf,
  formatFuzzy,
  todayKst,
} from '../src/lib/format';

describe('fmtMinute', () => {
  it('하루 중 분을 시:분으로, 자정 넘김은 24시 이상 그대로', () => {
    expect(fmtMinute(330)).toBe('05:30');
    expect(fmtMinute(1478)).toBe('24:38');
    expect(fmtMinute(null)).toBe('—');
  });
});

describe('dday — 일 단위일 때만', () => {
  const today = '2026-11-21';
  it('일 단위 미래 날짜는 D-n', () => {
    expect(dday({ value: '2027-04-01', precision: 'day' }, today)).toBe('D-131');
    expect(dday({ value: '2026-11-21', precision: 'day' }, today)).toBe('D-day');
  });
  it('월·반기·연·미정, 지난 날짜는 없음', () => {
    expect(dday({ value: '2026-12', precision: 'month' }, today)).toBeNull();
    expect(dday({ value: '2027-H1', precision: 'half' }, today)).toBeNull();
    expect(dday({ value: '2030', precision: 'year' }, today)).toBeNull();
    expect(dday({ value: null, precision: 'unknown' }, today)).toBeNull();
    expect(dday({ value: '2020-01-01', precision: 'day' }, today)).toBeNull();
  });
  it('todayKst 는 서울 시간 기준 날짜', () => {
    expect(todayKst(new Date('2026-11-20T15:30:00Z'))).toBe('2026-11-21');
  });
});

describe('퍼지 날짜 표기', () => {
  it('contracts formatFuzzy 와 <time> 값', () => {
    expect(formatFuzzy({ value: '2028-H1', precision: 'half' })).toBe('2028년 상반기');
    expect(fuzzyDateTime({ value: '2028-H1', precision: 'half' })).toBe('2028');
    expect(fuzzyDateTime({ value: '2027-03', precision: 'month' })).toBe('2027-03');
    expect(fuzzyDateTime({ value: null, precision: 'unknown' })).toBeUndefined();
  });
});

describe('lineShortLabel', () => {
  it('호선 번호·GTX 문자·앞 두 글자', () => {
    expect(lineShortLabel('서울 지하철 2호선')).toBe('2');
    expect(lineShortLabel('GTX-A')).toBe('A');
    expect(lineShortLabel('신분당선')).toBe('신분');
    expect(lineShortLabel('경부선')).toBe('경부');
    expect(lineShortLabel('우이신설선')).toBe('우이');
  });
});

describe('분류 축', () => {
  it('운행 계통 열차/전철', () => {
    expect(serviceGroupOf('high_speed')).toBe('train');
    expect(serviceGroupOf('tourist')).toBe('train');
    expect(serviceGroupOf('wide_area')).toBe('metro');
    expect(serviceGroupOf('metro')).toBe('metro');
  });
  it('역 구분은 정차 계통 우선, 없으면 노선 분류', () => {
    expect(stopClassesOf(['metro', 'high_speed'], ['urban'])).toEqual(['high_speed', 'metro']);
    expect(stopClassesOf([], ['conventional'])).toEqual(['intercity']);
    expect(stopClassesOf(['tourist'], [])).toEqual(['intercity']);
  });
});

describe('기타', () => {
  it('fmtKm 소수 첫째 자리', () => {
    expect(fmtKm(48.84)).toBe('48.8');
    expect(fmtKm(null)).toBe('—');
  });
  it('검색 일치 종류 라벨', () => {
    expect(matchedKindLabel('name_en')).toBe('영문');
    expect(matchedKindLabel('alias_former')).toBe('옛 이름');
    expect(matchedKindLabel('alias_alias')).toBe('별칭');
    expect(matchedKindLabel('weird')).toBeNull();
  });
});
