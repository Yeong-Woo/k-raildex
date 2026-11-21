/**
 * 개통 예정(P2 `/upcoming/`): 미개통 계획(기대 일정 순, 공식·보도 근거만 — Q94) + 공사 중·계획 노선·역. 권역 필터는 링크(`?area=`).
 * 목표 미정은 맨 뒤. 기존 절 앵커 `#h-lines`·`#h-stations`·`#h-plans` 유지.
 */
import type { Metadata } from 'next';
import { codes, compareFuzzy } from '@k-raildex/contracts';
import { FuzzyDateText, StageBadge, StatusBadge, TargetText } from '@/components/badges';
import { FilterRow, LinkTabs } from '@/components/tabs';
import { getPlans, getUpcoming } from '@/lib/data';
import { areaCounts, areaLabel, areaMatches } from '@/lib/filters';
import { fmtNum } from '@/lib/format';
import { pageMeta } from '@/lib/site';
import { paths, pickParam, withQuery } from '@/lib/urls';

export const metadata: Metadata = pageMeta(
  '개통 예정',
  '개통을 앞둔 철도 계획·노선·역 — 공식 발표·보도로 확인한 개통 예정 순. 목표 미정은 따로.',
  '/upcoming/',
);

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function UpcomingPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const area = pickParam(sp.area, ['all', ...codes.area.values] as const, 'all');
  const [up, allPlans] = await Promise.all([getUpcoming(), getPlans()]);
  const planNames = new Map(allPlans.map((p) => [p.id, p.name_ko]));
  const link = (a: string) => withQuery(paths.upcoming(), {}, { area: a }, { area: 'all' });
  const byTarget = <T extends { target: { value: string | null; precision: string } | null }>(a: T, b: T) =>
    !a.target?.value ? 1 : !b.target?.value ? -1 : compareFuzzy(a.target as never, b.target as never);
  const plans = up.plans
    .filter((p) => areaMatches(p.areas, area))
    .map((p) => ({ ...p, target: p.target_open }))
    .sort(byTarget);
  const lines = up.lines
    .filter((l) => areaMatches(l.areas, area))
    .map((l) => ({ ...l, target: l.target_open }))
    .sort(byTarget);
  const stations = up.stations
    .filter((s) => areaMatches(s.areas, area))
    .map((s) => ({ ...s, target: s.target_open }))
    .sort(byTarget);
  const areaTabs = areaCounts([...up.plans, ...up.lines, ...up.stations]).map((a) => ({
    ...a,
    label: areaLabel(a.value),
    href: link(a.value),
  }));

  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
      <div className="page-head">
        <h1>개통 예정</h1>
        <p className="lead">
          아직 개통하지 않은 계획 사업과 공사 중·계획 노선·역을 개통 예정 순으로 봅니다. 개통 예정은 공식 발표·보도로
          확인한 것만 싣고(추정 없음) 발표 시점 기준이라 바뀔 수 있습니다. 연도별로는{' '}
          <a href={paths.futureMap()}>미래 지도</a>.
        </p>
      </div>
      <div className="filters">
        <FilterRow label="권역">
          <LinkTabs items={areaTabs} current={area} label="권역" small />
        </FilterRow>
      </div>
      <nav className="chips" aria-label="절">
        <a className="chip" href="#h-plans" style={{ paddingLeft: '0.6em' }}>
          계획 {plans.length}
        </a>
        <a className="chip" href="#h-lines" style={{ paddingLeft: '0.6em' }}>
          노선 {lines.length}
        </a>
        <a className="chip" href="#h-stations" style={{ paddingLeft: '0.6em' }}>
          역 {stations.length}
        </a>
      </nav>

      <section className="section" aria-labelledby="h-plans">
        <div className="section-head">
          <h2 id="h-plans">계획 사업</h2>
          <span className="muted num">{fmtNum(plans.length)}</span>
        </div>
        {plans.length === 0 ? (
          <p className="empty surface">해당하는 계획이 없습니다.</p>
        ) : (
          <ul className="ulist surface">
            {plans.map((p) => (
              <li key={p.id}>
                <span>
                  <a href={paths.plan(p.id)}>{p.name_ko}</a>
                  <span className="sub">
                    <StageBadge stage={p.stage} />
                    <span className="muted" style={{ fontSize: 'var(--kr-text-xs)' }}>
                      {p.areas.map(areaLabel).join(' · ')}
                    </span>
                  </span>
                </span>
                <span className="when">
                  <TargetText target={p.target_open} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section" aria-labelledby="h-lines">
        <div className="section-head">
          <h2 id="h-lines">노선</h2>
          <span className="muted num">{fmtNum(lines.length)}</span>
        </div>
        <EntityTable items={lines} kind="line" planNames={planNames} />
      </section>

      <section className="section" aria-labelledby="h-stations">
        <div className="section-head">
          <h2 id="h-stations">역</h2>
          <span className="muted num">{fmtNum(stations.length)}</span>
        </div>
        <EntityTable items={stations} kind="station" planNames={planNames} />
      </section>
      <p className="muted" style={{ fontSize: 'var(--kr-text-xs)' }}>
        폐선·폐역은 <a href={paths.closed()}>폐선·폐역</a>에 따로 모읍니다.
      </p>
    </div>
  );
}

function EntityTable({
  items,
  kind,
  planNames,
}: {
  items: {
    id: string;
    name_ko: string;
    status: 'operating' | 'suspended' | 'under_construction' | 'planned' | 'closed' | 'abandoned';
    target_open: { value: string | null; precision: 'day' | 'month' | 'half' | 'year' | 'unknown' } | null;
    areas: string[];
    plan_ids: string[];
  }[];
  kind: 'line' | 'station';
  planNames: Map<string, string>;
}) {
  if (items.length === 0) return <p className="empty surface">해당 항목이 없습니다.</p>;
  return (
    <div className="table-wrap">
      <table className="data cardify">
        <thead>
          <tr>
            <th scope="col">{kind === 'line' ? '노선' : '역'}</th>
            <th scope="col">상태</th>
            <th scope="col">개통 예정</th>
            <th scope="col">관련 계획</th>
          </tr>
        </thead>
        <tbody>
          {items.map((x) => (
            <tr key={x.id}>
              <td>
                <a href={kind === 'line' ? paths.line(x.id) : paths.station(x.id)}>{x.name_ko}</a>
              </td>
              <td data-label="상태">
                <StatusBadge status={x.status} />
              </td>
              <td data-label="개통 예정" className="nowrap">
                {x.target_open ? (
                  <FuzzyDateText value={x.target_open} withDday />
                ) : (
                  <span className="muted">목표 미정</span>
                )}
              </td>
              <td data-label="관련 계획" style={{ fontSize: 'var(--kr-text-xs)' }}>
                {x.plan_ids.length
                  ? x.plan_ids.map((id, i) => (
                      <span key={id}>
                        {i ? ', ' : ''}
                        <a href={paths.plan(id)}>{planNames.get(id) ?? id}</a>
                      </span>
                    ))
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
