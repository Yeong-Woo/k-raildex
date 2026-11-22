/** 시·도 또는 권역별 역 목록(P1, /stations/region/[slug]/): slug = 시·도 slug(seoul…) 또는 권역 코드(capital…) */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { codeLabel, isCode } from '@k-raildex/contracts';
import { Crumbs } from '@/components/detail';
import { StationList } from '@/components/station-list';
import { getAreas, getStations } from '@/lib/data';
import { fmtNum } from '@/lib/format';
import { pageMeta } from '@/lib/site';
import { paths } from '@/lib/urls';

type Params = Promise<{ slug: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

/** 기존 `/stations/region/unknown/`(지역 미상 역) — 시·도가 없는 역 */
const UNKNOWN_SLUG = 'unknown';

async function resolve(slug: string) {
  const areas = await getAreas();
  if (slug === UNKNOWN_SLUG)
    return { kind: 'unknown' as const, code: slug, name: '지역 미상', area: null, region: null };
  if (isCode('area', slug) && slug !== 'national') {
    const a = areas.find((x) => x.code === slug);
    if (!a) return null;
    return { kind: 'area' as const, code: slug, name: codeLabel('area', slug), area: a, region: null };
  }
  for (const a of areas) {
    const r = a.regions.find((x) => x.slug === slug);
    if (r) return { kind: 'region' as const, code: r.code, name: r.name_ko, area: a, region: r };
  }
  return null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const r = await resolve(slug);
  if (!r) notFound();
  return pageMeta(
    `${r.name} 역`,
    `${r.name}의 철도역 목록 — 정차 열차 기준 구분, 노선별 역번호, 개통·미개통.`,
    paths.stationRegion(slug),
  );
}

export default async function RegionStationsPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const r = await resolve(slug);
  if (!r) notFound();
  const all = await getStations();
  const items =
    r.kind === 'unknown'
      ? all.filter((s) => s.region_code == null)
      : r.kind === 'area'
        ? all.filter((s) => s.areas.includes(r.code as never))
        : all.filter((s) => s.region_code === r.code);
  const siblings = r.area?.regions ?? [];
  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
      <div className="page-head">
        <Crumbs
          items={[
            { href: paths.stations(), label: '역' },
            ...(r.kind === 'region' ? [{ href: paths.stationRegion(r.area.code), label: r.area.name_ko }] : []),
            { label: r.name },
          ]}
        />
        <h1>{r.name} 역</h1>
        <p className="lead num">
          {r.kind === 'unknown'
            ? `시·도를 확인하지 못한 역 ${fmtNum(items.length)}`
            : r.kind === 'region' && r.region
              ? `여객역 ${fmtNum(r.region.stations)} · 노선 ${fmtNum(r.region.lines)} · 계획 ${fmtNum(r.region.plans)}`
              : `여객역 ${fmtNum(r.area.stations)} · 노선 ${fmtNum(r.area.lines)} · 운행 계통 ${fmtNum(r.area.services)} · 계획 ${fmtNum(r.area.plans)}`}
        </p>
        {siblings.length > 1 ? (
          <nav aria-label="같은 권역의 시·도" className="chips" style={{ marginTop: 'var(--kr-space-3)' }}>
            {siblings.map((x) => (
              <a
                key={x.code}
                className="chip"
                style={{ paddingLeft: '0.6em' }}
                href={paths.stationRegion(x.slug)}
                aria-current={x.slug === slug ? 'page' : undefined}
              >
                {x.short_ko} <span className="muted num">{x.stations}</span>
              </a>
            ))}
          </nav>
        ) : null}
      </div>
      <StationList base={paths.stationRegion(slug)} items={items} sp={sp} showAreaTabs={false} />
    </div>
  );
}
