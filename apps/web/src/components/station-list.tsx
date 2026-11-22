/**
 * 역 목록 화면(역 목록 /stations/ 와 시·도·권역 /stations/region/[slug]/ 공용).
 * 정차 열차 기준 탭(?class=) + 권역(?area=) + 개통 필터(?opened=, 기본 개통) + 이름·역번호 찾기(?q=). 모두 링크·GET 폼(JS 없이 동작).
 */
import type { StationItem } from '@/lib/data';
import { getLineIndex, getRegionIndex } from '@/lib/data';
import {
  areaCounts,
  areaLabel,
  areaMatches,
  byKo,
  OPENED_FILTERS,
  OPENED_LABEL,
  openedOf,
  textMatches,
  type OpenedFilter,
} from '@/lib/filters';
import { fmtNum, STOP_CLASS_LABEL, STOP_CLASS_ORDER, stopClassesOf } from '@/lib/format';
import { firstParam, pickParam, withQuery } from '@/lib/urls';
import { codes } from '@k-raildex/contracts';
import { StationTable } from './station-table';
import { FilterRow, LinkTabs } from './tabs';

type SP = Record<string, string | string[] | undefined>;

/** 한 쪽에 보이는 역 수(가나다순). 전부 그리면 HTML 이 수 MB 가 되어 LCP 목표(NFR-WEB-001)를 넘는다 */
const PAGE_SIZE = 150;

export async function StationList({
  base,
  items,
  sp,
  showAreaTabs = true,
}: {
  base: string;
  items: StationItem[];
  sp: SP;
  showAreaTabs?: boolean;
}) {
  const cls = pickParam(sp.class, ['all', ...STOP_CLASS_ORDER] as const, 'all');
  const area = pickParam(sp.area, ['all', ...codes.area.values] as const, 'all');
  const opened = pickParam<OpenedFilter>(sp.opened, OPENED_FILTERS, 'opened');
  const q = (firstParam(sp.q) ?? '').slice(0, 50);
  const pageNo = Math.max(1, Number.parseInt(firstParam(sp.page) ?? '1', 10) || 1);
  const current = { class: cls, area, opened, q: q || undefined, page: undefined as string | undefined };
  const defaults = { class: 'all', area: 'all', opened: 'opened' };
  const link = (change: Record<string, string | undefined>) => withQuery(base, current, change, defaults);

  const [lineIndex, regions] = await Promise.all([getLineIndex(), getRegionIndex()]);
  const withClass = items.map((s) => ({ s, classes: stopClassesOf(s.service_kinds, s.line_classes) }));
  const byOpened = withClass.filter(({ s }) => opened === 'all' || openedOf(s.status) === opened);
  const byText = byOpened.filter(({ s }) => textMatches(q, s.name_ko, s.name_en, ...s.station_codes));
  const inClass = byText.filter(({ classes }) => cls === 'all' || (classes as string[]).includes(cls));
  const shown = inClass
    .filter(({ s }) => areaMatches(s.areas, area))
    .map(({ s }) => s)
    .sort(byKo);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const pageItems = shown.slice((Math.min(pageNo, pages) - 1) * PAGE_SIZE, Math.min(pageNo, pages) * PAGE_SIZE);

  const classTabs = [
    { value: 'all', label: '전체', count: byText.length, href: link({ class: 'all' }) },
    ...STOP_CLASS_ORDER.map((c) => ({
      value: c,
      label: STOP_CLASS_LABEL[c],
      count: byText.filter(({ classes }) => classes.includes(c)).length,
      href: link({ class: c }),
    })),
  ];
  const areaTabs = areaCounts(inClass.map(({ s }) => s)).map((a) => ({
    ...a,
    label: areaLabel(a.value),
    href: link({ area: a.value }),
  }));
  const openedTabs = OPENED_FILTERS.map((o) => ({
    value: o,
    label: OPENED_LABEL[o],
    count: o === 'all' ? items.length : items.filter((s) => openedOf(s.status) === o).length,
    href: link({ opened: o }),
  }));

  return (
    <>
      <div className="filters">
        <FilterRow label="정차 열차">
          <LinkTabs items={classTabs} current={cls} label="정차 열차 기준 역 구분" />
        </FilterRow>
        {showAreaTabs ? (
          <FilterRow label="권역">
            <LinkTabs items={areaTabs} current={area} label="권역" small anchor="area" />
          </FilterRow>
        ) : null}
        <FilterRow label="개통">
          <LinkTabs items={openedTabs} current={opened} label="개통 여부" small />
          <form method="get" action={base} role="search" style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            {cls !== 'all' ? <input type="hidden" name="class" value={cls} /> : null}
            {area !== 'all' ? <input type="hidden" name="area" value={area} /> : null}
            {opened !== 'opened' ? <input type="hidden" name="opened" value={opened} /> : null}
            <label htmlFor="stn-q" className="sr-only">
              목록에서 역 이름·역번호 찾기
            </label>
            <input
              id="stn-q"
              name="q"
              defaultValue={q}
              placeholder="이름·역번호로 좁히기"
              className="search-btn"
              style={{ minWidth: '12rem', background: 'var(--kr-surface)', color: 'var(--kr-fg)' }}
            />
            <button className="btn" type="submit">
              좁히기
            </button>
          </form>
        </FilterRow>
      </div>
      <p className="muted num" style={{ fontSize: 'var(--kr-text-sm)' }}>
        {fmtNum(shown.length)}개 역{q ? ` · "${q}"` : ''}
        {pages > 1 ? ` · ${Math.min(pageNo, pages)}/${pages}쪽(가나다순)` : ''} · 초성·별칭 검색은{' '}
        <a href={`/search/${q ? `?q=${encodeURIComponent(q)}` : ''}`}>통합 검색</a>
      </p>
      <StationTable items={pageItems} lineIndex={lineIndex} regionByCode={regions.byCode} />
      {pages > 1 ? (
        <nav aria-label="쪽" style={{ marginTop: 'var(--kr-space-3)' }}>
          <LinkTabs
            small
            label="쪽 번호"
            current={String(Math.min(pageNo, pages))}
            items={Array.from({ length: pages }, (_, i) => ({
              value: String(i + 1),
              label: `${i * PAGE_SIZE + 1}–${Math.min((i + 1) * PAGE_SIZE, shown.length)}`,
              href: link({ page: i === 0 ? undefined : String(i + 1) }),
            }))}
          />
        </nav>
      ) : null}
    </>
  );
}
