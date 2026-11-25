/** 역 목록(P1): 정차 열차 기준 탭 + 권역 + 개통/미개통 + 찾기, 시·도·권역 페이지 링크 */
import type { Metadata } from 'next';
import { StationList } from '@/components/station-list';
import { getAreas, getStations } from '@/lib/data';
import { pageMeta } from '@/lib/site';
import { paths } from '@/lib/urls';

export const metadata: Metadata = pageMeta(
  '역',
  '대한민국 철도역 목록 — 정차 열차 기준(고속열차·일반열차·광역전철·도시철도), 권역·시·도별, 개통·미개통·폐지, 노선별 역번호.',
  '/stations/',
);

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function StationsPage({ searchParams }: { searchParams: SP }) {
  const [sp, items, areas] = await Promise.all([searchParams, getStations(), getAreas()]);
  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
      <div className="page-head">
        <h1>역</h1>
        <p className="lead">
          여객역 목록입니다. 구분은 그 역에 서는 열차(운행 계통) 기준이고, 정차 정보가 없으면 지나는 노선의 법적 분류로
          봅니다. 신호장·차량기지 같은 시설은 기본으로 빼고("시설" 필터로 볼 수 있음), 아직 개통하지 않은 역은
          &quot;미개통&quot; 탭에 따로 둡니다.
        </p>
        <nav aria-label="시·도별 역 목록" className="chips" style={{ marginTop: 'var(--kr-space-3)' }}>
          {areas
            .filter((a) => a.code !== 'national')
            .flatMap((a) => a.regions)
            .map((r) => (
              <a key={r.code} className="chip" style={{ paddingLeft: '0.6em' }} href={paths.stationRegion(r.slug)}>
                {r.short_ko} <span className="muted num">{r.stations}</span>
              </a>
            ))}
        </nav>
      </div>
      <StationList base={paths.stations()} items={items} sp={sp} />
    </div>
  );
}
