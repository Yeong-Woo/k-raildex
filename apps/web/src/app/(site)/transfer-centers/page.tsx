/** 환승센터·복합환승센터(P2 `/transfer-centers/`): 상태·종류·권역 필터(링크) + 표. 옛 id(`tc-`)는 proxy 가 301(Q69 A) */
import type { Metadata } from 'next';
import { codeLabel, codes } from '@k-raildex/contracts';
import { FuzzyDateText, ReviewBadge } from '@/components/badges';
import { FilterRow, LinkTabs } from '@/components/tabs';
import { getRegionIndex, getTransferCenters } from '@/lib/data';
import { areaCounts, areaLabel, byKo } from '@/lib/filters';
import { fmtNum } from '@/lib/format';
import { pageMeta } from '@/lib/site';
import { paths, pickParam, withQuery } from '@/lib/urls';

export const metadata: Metadata = pageMeta(
  '환승센터',
  '환승센터·복합환승센터 구축 기본계획(1~4차)에 실린 사업 — 상태·종류·권역별, 연계 역과 계획.',
  '/transfer-centers/',
);

type SP = Promise<Record<string, string | string[] | undefined>>;
const STATUSES = ['all', ...codes.transferCenterStatus.values] as const;
const KINDS = ['all', ...codes.transferCenterKind.values] as const;

export default async function TransferCentersPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const status = pickParam(sp.status, STATUSES, 'all');
  const kind = pickParam(sp.kind, KINDS, 'all');
  const area = pickParam(sp.area, ['all', ...codes.area.values] as const, 'all');
  const current = { status, kind, area };
  const defaults = { status: 'all', kind: 'all', area: 'all' };
  const link = (c: Record<string, string>) => withQuery(paths.transferCenters(), current, c, defaults);
  const [all, regions] = await Promise.all([getTransferCenters(), getRegionIndex()]);
  const withAreas = all.map((t) => ({ ...t, areas: t.area_code ? [t.area_code] : [] }));
  const base = withAreas.filter(
    (t) => (status === 'all' || t.status === status) && (kind === 'all' || t.kind === kind),
  );
  const shown = base.filter((t) => area === 'all' || t.area_code === area).sort(byKo);
  const statusTabs = STATUSES.filter((s) => s === 'all' || all.some((t) => t.status === s)).map((s) => ({
    value: s,
    label: s === 'all' ? '전체' : codeLabel('transferCenterStatus', s),
    count: s === 'all' ? all.length : all.filter((t) => t.status === s).length,
    href: link({ status: s }),
  }));
  const kindTabs = KINDS.filter((k) => k === 'all' || all.some((t) => t.kind === k)).map((k) => ({
    value: k,
    label: k === 'all' ? '전체' : codeLabel('transferCenterKind', k),
    href: link({ kind: k }),
  }));
  const areaTabs = areaCounts(base).map((a) => ({ ...a, label: areaLabel(a.value), href: link({ area: a.value }) }));
  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
      <div className="page-head">
        <h1>환승센터</h1>
        <p className="lead">
          철도역과 버스 등 다른 교통수단을 잇는 환승센터·복합환승센터 사업입니다(국토교통부 환승센터 및 복합환승센터
          구축 기본계획). 상위 계획은 <a href={paths.planPrograms('pp-transfer-center-4')}>상위 계획</a>.
        </p>
      </div>
      <div className="filters">
        <FilterRow label="상태">
          <LinkTabs items={statusTabs} current={status} label="상태" small />
        </FilterRow>
        <FilterRow label="종류">
          <LinkTabs items={kindTabs} current={kind} label="종류" small />
        </FilterRow>
        <FilterRow label="권역">
          <LinkTabs items={areaTabs} current={area} label="권역" small anchor="area" />
        </FilterRow>
      </div>
      <p className="muted num" style={{ fontSize: 'var(--kr-text-sm)' }}>
        {fmtNum(shown.length)}곳
      </p>
      {shown.length === 0 ? (
        <p className="empty surface">조건에 맞는 환승센터가 없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table className="data cardify">
            <thead>
              <tr>
                <th scope="col">사업</th>
                <th scope="col">종류</th>
                <th scope="col">상태</th>
                <th scope="col">지역</th>
                <th scope="col" className="r">
                  연계 역
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} id={t.id}>
                  <td>
                    <a href={paths.transferCenter(t.id)}>{t.name_ko}</a> <ReviewBadge status={t.review_status} />
                  </td>
                  <td data-label="종류">{codeLabel('transferCenterKind', t.kind)}</td>
                  <td data-label="상태">
                    <span className="badge outline">{codeLabel('transferCenterStatus', t.status)}</span>
                    {t.status_as_of ? (
                      <span className="name-sub">
                        <FuzzyDateText value={t.status_as_of} /> 기준
                      </span>
                    ) : null}
                  </td>
                  <td data-label="지역" style={{ fontSize: 'var(--kr-text-xs)' }}>
                    {t.region_code ? (regions.byCode.get(t.region_code)?.short_ko ?? t.region_code) : '—'}
                  </td>
                  <td data-label="연계 역" className="r num">
                    {t.station_ids.length || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
