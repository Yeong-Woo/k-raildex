import { describe, expect, it } from 'vitest';
import { anchorId, entityPath, issueUrl, paths, pickParam, withQuery } from '../src/lib/urls';

describe('경로는 끝 / 유지(FR-WEB-004)', () => {
  it('상세·목록 경로', () => {
    expect(paths.line('line-seoul-2')).toBe('/lines/line-seoul-2/');
    expect(paths.station('stn-dongtan')).toBe('/stations/stn-dongtan/');
    expect(paths.stationRegion('seoul')).toBe('/stations/region/seoul/');
    expect(paths.search('동탄')).toBe('/search/?q=%EB%8F%99%ED%83%84');
    expect(paths.futureMap()).toBe('/map/?at=future');
    expect(paths.map('line=line-seoul-2')).toBe('/map/#line=line-seoul-2');
    expect(paths.document('0e0e0e0e-0000-4000-8000-000000000000')).toBe(
      '/api/documents/0e0e0e0e-0000-4000-8000-000000000000/',
    );
  });
  it('개체 종류 → 경로', () => {
    expect(entityPath('plan', 'plan-x')).toBe('/plans/plan-x/');
    expect(entityPath('glossary_term', 'term-a')).toBe('/terms/#term-a');
    expect(entityPath('operator', 'op-x')).toBeNull();
  });
});

describe('withQuery — 탭 링크', () => {
  it('기본값·빈 값은 빼고 키 순서를 고정', () => {
    const cur = { class: 'all', area: 'capital', q: undefined };
    expect(withQuery('/lines/', cur, { class: 'urban' }, { class: 'all', area: 'all' })).toBe(
      '/lines/?area=capital&class=urban',
    );
    expect(withQuery('/lines/', cur, { area: 'all' }, { class: 'all', area: 'all' })).toBe('/lines/');
    expect(withQuery('/lines/', {}, { class: 'urban' }, {}, 'class-urban')).toBe('/lines/?class=urban#class-urban');
  });
  it('pickParam 은 허용 목록 밖이면 기본값', () => {
    expect(pickParam('urban', ['all', 'urban'] as const, 'all')).toBe('urban');
    expect(pickParam(['x', 'urban'], ['all', 'urban'] as const, 'all')).toBe('all');
    expect(pickParam(undefined, ['all'] as const, 'all')).toBe('all');
  });
});

describe('앵커·오류 제보', () => {
  it('anchorId', () => {
    expect(anchorId('class', 'High Speed')).toBe('class-high-speed');
  });
  it('issueUrl 은 주소가 없으면 null, 있으면 제목·본문 쿼리', () => {
    expect(issueUrl(undefined, 'x', '/')).toBeNull();
    const u = new URL(issueUrl('https://github.com/o/r/issues/new', '동탄역', '/stations/stn-dongtan/')!);
    expect(u.searchParams.get('title')).toBe('[오류 제보] 동탄역');
    expect(u.searchParams.get('body')).toContain('/stations/stn-dongtan/');
  });
});
