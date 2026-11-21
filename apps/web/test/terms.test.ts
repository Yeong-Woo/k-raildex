import { describe, expect, it } from 'vitest';
import { githubSlug, slugger, termSectionNo } from '../src/lib/terms';

describe('용어 옛 앵커(github-slugger 규칙)', () => {
  it('구두점 제거·공백 → -', () => {
    expect(githubSlug('경전철 (LRT)')).toBe('경전철-lrt');
    expect(githubSlug('광역전철 / 수도권 전철')).toBe('광역전철--수도권-전철');
    expect(githubSlug('1. 철도의 법적 분류')).toBe('1-철도의-법적-분류');
    expect(githubSlug('예비타당성조사 (예타)')).toBe('예비타당성조사-예타');
  });
  it('중복은 -1, -2', () => {
    const s = slugger();
    expect([s('철도'), s('철도'), s('철도')]).toEqual(['철도', '철도-1', '철도-2']);
  });
  it('용어 id 의 절 번호', () => {
    expect(termSectionNo('term-3-2')).toBe(3);
    expect(termSectionNo('x')).toBeNull();
  });
});
