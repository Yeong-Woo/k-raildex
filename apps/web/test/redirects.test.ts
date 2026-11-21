import { describe, expect, it } from 'vitest';
import { legacyAnchorScript, resolveRedirect, type RedirectEntry } from '../src/lib/redirects';

const list: RedirectEntry[] = [
  {
    old_id: 'national_rail_4',
    new_id: 'pp-national-rail-4',
    type: 'plan_program',
    url_path: '/plans/programs/#pp-national-rail-4',
  },
  { old_id: 'tc-bujeon', new_id: 'xc-bujeon', type: 'transfer_center', url_path: '/transfer-centers/xc-bujeon/' },
  {
    old_id: 'stn-bukchangwon',
    new_id: 'stn-changwonjungang',
    type: 'station',
    url_path: '/stations/stn-changwonjungang/',
  },
];
const map = new Map(list.map((r) => [r.old_id, r]));

describe('옛 id 301(FR-WEB-004, Q69 A)', () => {
  it('상세 경로', () => {
    expect(resolveRedirect('/transfer-centers/tc-bujeon/', '', map)).toBe('/transfer-centers/xc-bujeon/');
    expect(resolveRedirect('/stations/stn-bukchangwon/', '', map)).toBe('/stations/stn-changwonjungang/');
    expect(resolveRedirect('/plans/programs/national_rail_4/', '', map)).toBe('/plans/programs/pp-national-rail-4/');
  });
  it('쿼리 값(다른 쿼리는 유지)', () => {
    expect(resolveRedirect('/plans/', '?program=national_rail_4&area=capital', map)).toBe(
      '/plans/?program=pp-national-rail-4&area=capital',
    );
  });
  it('바꿀 것이 없으면 null', () => {
    expect(resolveRedirect('/stations/stn-dongtan/', '?q=동탄', map)).toBeNull();
    expect(resolveRedirect('/', '', map)).toBeNull();
    expect(resolveRedirect('/lines/line-a/extra/', '', map)).toBeNull();
  });
  it('옛 앵커 스크립트: 짝을 싣고 </script> 를 막는다', () => {
    const s = legacyAnchorScript([
      ['national_rail_4', 'pp-national-rail-4'],
      ['x</script>', 'y'],
    ]);
    expect(s).toContain('"national_rail_4":"pp-national-rail-4"');
    expect(s).not.toContain('</script>');
    expect(s).toContain("'program-'");
  });
});
