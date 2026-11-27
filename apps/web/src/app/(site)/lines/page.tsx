/**
 * 노선 목록(P1): 법적 분류 탭 + 권역 + 광역철도 지정 + 상태. 탭·필터는 링크(JS 없이 동작).
 * 지선(국토교통부 고시 노선번호로 계산, 2026-11-27): 기지선·연결선·삼각선은 본선이 목록에 있으면 본선 행 아래 접어 두고,
 * 그 밖의 지선(수인선·교외선 등)은 독립 행에 "○○ 지선" 표시만 한다.
 */
import type { Metadata } from 'next';
import { Fragment } from 'react';
import { codeLabel, codes } from '@k-raildex/contracts';
import { LineChip, ReviewBadge, StatusBadge, FuzzyDateText } from '@/components/badges';
import { FilterRow, LinkTabs } from '@/components/tabs';
import { getLines, getRegionIndex } from '@/lib/data';
import { areaCounts, areaLabel, areaMatches, byKo } from '@/lib/filters';
import { fmtKm, fmtNum } from '@/lib/format';
import { pageMeta } from '@/lib/site';
import { firstParam, paths, pickParam, withQuery } from '@/lib/urls';

export const metadata: Metadata = pageMeta(
  '노선',
  '대한민국 철도 물리 노선 목록 — 법적 분류(고속철도·일반철도·도시철도)·광역철도 지정·권역별, 역 수·연장·개통일과 출처.',
  '/lines/',
);

type SP = Promise<Record<string, string | string[] | undefined>>;
// 'freight' = 여객 미취급 노선(기존 `/lines/?class=freight#class-freight`, Q130 A). 법적 분류 묶음에서는 뺀다
const CLASSES = ['all', ...codes.railClass.values, 'freight'] as const;
type LineClass = (typeof CLASSES)[number];
const classLabel = (c: LineClass) =>
  c === 'all' ? '전체' : c === 'freight' ? '여객 미취급' : codeLabel('railClass', c);
const inClassOf = (l: { rail_class: string; passenger: boolean }, c: LineClass) =>
  c === 'all' || (c === 'freight' ? !l.passenger : l.passenger && l.rail_class === c);
const STATUSES = ['all', ...codes.status.values] as const;

export default async function LinesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const cls = pickParam(sp.class, CLASSES, 'all');
  const area = pickParam(sp.area, ['all', ...codes.area.values] as const, 'all');
  const status = pickParam(sp.status, STATUSES, 'all');
  const wide = firstParam(sp.wide) === '1';
  const current = { class: cls, area, status, wide: wide ? '1' : undefined };
  const defaults = { class: 'all', area: 'all', status: 'all' };
  const link = (change: Record<string, string | undefined>) => withQuery(paths.lines(), current, change, defaults);

  const [all, regions] = await Promise.all([getLines(), getRegionIndex()]);
  const base = all.filter((l) => (!wide || l.is_wide_area) && (status === 'all' || l.status === status));
  const inClass = base.filter((l) => inClassOf(l, cls));
  const matched = inClass.filter((l) => areaMatches(l.areas, area)).sort(byKo);
  // 시설 지선(기지선·연결선·삼각선) — 본선이 함께 보이면 본선 아래로 접는다
  const matchedIds = new Set(matched.map((l) => l.id));
  const folded = new Map<string, typeof matched>();
  for (const l of matched) {
    if (l.line_role && l.branch_of && matchedIds.has(l.branch_of.id)) {
      const list = folded.get(l.branch_of.id) ?? [];
      list.push(l);
      folded.set(l.branch_of.id, list);
    }
  }
  const foldedIds = new Set([...folded.values()].flat().map((l) => l.id));
  const shown = matched.filter((l) => !foldedIds.has(l.id));

  const classTabs = CLASSES.map((c) => ({
    value: c,
    label: classLabel(c),
    count: base.filter((l) => inClassOf(l, c)).length,
    href: link({ class: c }),
  }));
  const areaTabs = areaCounts(inClass).map((a) => ({ ...a, label: areaLabel(a.value), href: link({ area: a.value }) }));
  const statusTabs = STATUSES.filter((s) => s === 'all' || all.some((l) => l.status === s)).map((s) => ({
    value: s,
    label: s === 'all' ? '전체' : codeLabel('status', s),
    href: link({ status: s }),
  }));
  const groups = (cls === 'all' ? CLASSES.filter((c) => c !== 'all') : [cls]).map((c) => ({
    cls: c,
    items: shown.filter((l) => inClassOf(l, c)),
  }));

  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
      <div className="page-head">
        <h1>노선</h1>
        <p className="lead">
          선로 단위의 물리 노선입니다. 열차가 실제로 달리는 이름·구간은 <a href={paths.services()}>운행 계통</a>에서
          봅니다. 광역철도 = 노선의 법적 지정, 광역전철 = 운행 계통의 종류로 서로 다른 축입니다.
        </p>
      </div>
      <div className="filters">
        <FilterRow label="법적 분류">
          <LinkTabs items={classTabs} current={cls} label="법적 분류" />
        </FilterRow>
        <FilterRow label="권역">
          <LinkTabs items={areaTabs} current={area} label="권역" small anchor="area" />
        </FilterRow>
        <FilterRow label="상태">
          <LinkTabs items={statusTabs} current={status} label="상태" small />
          <ul className="tabs small" aria-label="광역철도 지정">
            <li>
              <a href={link({ wide: wide ? undefined : '1' })} aria-current={wide ? 'true' : undefined}>
                {wide ? '✓ ' : ''}광역철도 지정만
              </a>
            </li>
          </ul>
        </FilterRow>
      </div>
      <p className="muted num" style={{ fontSize: 'var(--kr-text-sm)' }} aria-live="polite">
        {fmtNum(matched.length)}개 노선
        {foldedIds.size ? ` (기지선·연결선·삼각선 ${fmtNum(foldedIds.size)}개는 본선 아래)` : ''}
      </p>
      {shown.length === 0 ? <p className="empty surface">조건에 맞는 노선이 없습니다.</p> : null}
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.cls} id={`class-${g.cls}`} className="section" style={{ marginTop: 'var(--kr-space-5)' }}>
            <div className="section-head">
              <h2>{classLabel(g.cls)}</h2>
              <span className="muted num">{fmtNum(g.items.length)}</span>
            </div>
            <div className="table-wrap">
              <table className="data cardify">
                <thead>
                  <tr>
                    <th scope="col">노선</th>
                    <th scope="col">분류</th>
                    <th scope="col">상태</th>
                    <th scope="col">지역</th>
                    <th scope="col" className="r">
                      역 수
                    </th>
                    <th scope="col" className="r">
                      연장(km)
                    </th>
                    <th scope="col">개통</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((l) => (
                    <Fragment key={l.id}>
                      <tr>
                        <td>
                          <LineChip line={l} short /> <a href={paths.line(l.id)}>{l.name_ko}</a>{' '}
                          <ReviewBadge status={l.review_status} />
                          {l.name_full && l.name_full !== l.name_ko ? (
                            <span className="name-sub">{l.name_full}</span>
                          ) : null}
                          {l.name_en ? <span className="name-sub">{l.name_en}</span> : null}
                        </td>
                        <td data-label="분류">
                          {codeLabel('lineCategory', l.category)}
                          {l.line_role ? ` · ${codeLabel('lineRole', l.line_role)}` : ''}
                          {l.branch_of ? (
                            <span className="name-sub">
                              <a href={paths.line(l.branch_of.id)}>{l.branch_of.name_ko}</a> 지선
                            </span>
                          ) : null}
                          {l.is_wide_area ? (
                            <>
                              {' '}
                              <span className="badge outline">광역철도 지정</span>
                            </>
                          ) : null}
                        </td>
                        <td data-label="상태">
                          <StatusBadge status={l.status} />
                          {l.target_open ? (
                            <span className="name-sub">
                              목표 <FuzzyDateText value={l.target_open} />
                            </span>
                          ) : null}
                        </td>
                        <td data-label="지역" style={{ fontSize: 'var(--kr-text-xs)' }}>
                          {l.regions.map((r) => regions.byCode.get(r)?.short_ko ?? r).join(', ') || '—'}
                        </td>
                        <td data-label="역 수" className="r num">
                          {fmtNum(l.station_count)}
                        </td>
                        <td data-label="연장" className="r num">
                          {fmtKm(l.length_km)}
                        </td>
                        <td data-label="개통" className="nowrap">
                          <FuzzyDateText value={l.opened} />
                        </td>
                      </tr>
                      {folded.get(l.id)?.length ? (
                        <tr className="branch-row" data-testid="line-branches">
                          <td colSpan={7}>
                            <details>
                              <summary>
                                {l.name_ko} 지선 {fmtNum(folded.get(l.id)!.length)}개(기지선·연결선·삼각선)
                              </summary>
                              <ul className="chips" style={{ marginTop: 'var(--kr-space-2)' }}>
                                {folded.get(l.id)!.map((b) => (
                                  <li key={b.id}>
                                    <a className="chip" href={paths.line(b.id)}>
                                      {b.name_ko}
                                      <span className="muted"> · {codeLabel('lineRole', b.line_role!)}</span>
                                      {b.status !== 'operating' ? (
                                        <>
                                          {' '}
                                          <StatusBadge status={b.status} />
                                        </>
                                      ) : null}
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
    </div>
  );
}
