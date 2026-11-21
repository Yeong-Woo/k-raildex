import { describe, expect, it } from 'vitest';
import { areaCounts, areaMatches, openedOf, textMatches } from '../src/lib/filters';

describe('권역 필터', () => {
  it('전국(national) 항목은 어느 권역에서도 보인다', () => {
    expect(areaMatches(['national'], 'honam')).toBe(true);
    expect(areaMatches(['capital'], 'honam')).toBe(false);
    expect(areaMatches([], 'all')).toBe(true);
  });
  it('권역 탭은 직접 항목이 있는 권역만, 숫자에는 전국 항목 포함', () => {
    const tabs = areaCounts([
      { areas: ['capital'] },
      { areas: ['capital', 'national'] },
      { areas: ['national'] },
      { areas: ['honam'] },
    ]);
    expect(tabs).toEqual([
      { value: 'all', count: 4 },
      { value: 'capital', count: 3 },
      { value: 'honam', count: 3 },
    ]);
  });
});

describe('개통 필터·이름 찾기', () => {
  it('openedOf', () => {
    expect(openedOf('operating')).toBe('opened');
    expect(openedOf('suspended')).toBe('opened');
    expect(openedOf('under_construction')).toBe('unopened');
    expect(openedOf('abandoned')).toBe('closed');
  });
  it('textMatches 는 공백·대소문자 무시', () => {
    expect(textMatches('seoul st', 'Seoul Station')).toBe(true);
    expect(textMatches('', 'x')).toBe(true);
    expect(textMatches('부산', '서울', null)).toBe(false);
  });
});
