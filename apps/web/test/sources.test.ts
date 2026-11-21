import { describe, expect, it } from 'vitest';
import type { PublicSourceRef } from '@k-raildex/contracts';
import { attachTimetableNotes, groupSources, sourceNumberFor } from '../src/lib/sources';

const ref = (o: Partial<PublicSourceRef>): PublicSourceRef => ({
  entity_id: 'stn-a',
  source_id: 'src-a',
  title: 'A',
  publisher: 'P',
  type: 'dataset_file',
  url: null,
  license: '공공누리 제1유형',
  license_class: 'kogl_1',
  attribution: null,
  published: null,
  retrieved_at: '2026-10-11',
  checked_at: '2026-10-11',
  field: null,
  locator: null,
  note: null,
  documents: [],
  ...o,
});

describe('groupSources', () => {
  it('같은 출처는 한 번호로 묶고 필드·하위 개체를 모은다', () => {
    const g = groupSources(
      [
        ref({ field: 'name_ko' }),
        ref({ source_id: 'src-b', title: 'B', field: 'coord' }),
        ref({ field: 'opened', entity_id: 'ls-x', checked_at: '2026-11-01' }),
      ],
      'stn-a',
    );
    expect(g.map((x) => [x.n, x.source_id])).toEqual([
      [1, 'src-a'],
      [2, 'src-b'],
    ]);
    expect(g[0]!.fields).toEqual(['name_ko', 'opened']);
    expect(g[0]!.entity_ids).toEqual(['ls-x']);
    expect(g[0]!.checked_at).toBe('2026-11-01');
    expect(sourceNumberFor(g, 'coord')).toBe(2);
    expect(sourceNumberFor(g, 'length_km')).toBeNull();
  });
  it('시간표 요일구분 원문은 해당 출처 항목에 붙인다(Q111 A)', () => {
    const g = groupSources([ref({ source_id: 'src-kric' })]);
    const orphan = attachTimetableNotes(g, [
      { set_id: 'tt-1', source_id: 'src-kric', day_note_original: '운행정보 요일구분 "토요일+공휴일"' },
      { set_id: 'tt-3', source_id: 'src-kric', day_note_original: '운행정보 요일구분 "토요일+공휴일"' },
      { set_id: 'tt-2', source_id: 'src-none', day_note_original: '운행정보 요일구분 "평일"' },
    ]);
    expect(g[0]!.extra_notes).toEqual(['운행정보 요일구분 "토요일+공휴일" (시간표 2개)']);
    expect(orphan).toEqual(['운행정보 요일구분 "평일" (시간표 1개)']);
  });
});
