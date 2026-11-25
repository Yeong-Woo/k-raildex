import { describe, expect, it } from 'vitest';
import { splitDayNote } from '../src';

describe('splitDayNote(Q111 A·Q139 B)', () => {
  it('해석만 짧게 보이고 원문은 따로', () => {
    expect(splitDayNote('운행정보 요일구분 "토요일+공휴일" — 토요일·공휴일 공통 다이아')).toEqual({
      shown: '토·공휴일 공통',
      original: '운행정보 요일구분 "토요일+공휴일"',
    });
    expect(splitDayNote('운행정보 요일구분 "평일" — 내선/외선은 정차 순서(역번호 증가 = 내선)로 판정').shown).toBe(
      '내·외선은 정차 순서로 추정',
    );
  });
  it('원문뿐이거나 비었을 때', () => {
    expect(splitDayNote('운행정보 요일구분 "평일"')).toEqual({ shown: null, original: '운행정보 요일구분 "평일"' });
    expect(splitDayNote(null)).toEqual({ shown: null, original: null });
    expect(splitDayNote('공휴일 특별 다이아')).toEqual({ shown: '공휴일 특별 다이아', original: null });
  });
});
