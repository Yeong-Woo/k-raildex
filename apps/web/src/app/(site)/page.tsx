/** 홈(P1): 소개, 검색, 통계, 권역·시·도별 집계, 개통 예정, 최근 변경, 미래 지도 진입 */
import type { Metadata } from 'next';
import { codeLabel, isCode } from '@k-raildex/contracts';
import { STAGE_GROUP, type StageGroup } from '@k-raildex/ui/tokens';
import { StageBadge, TargetText } from '@/components/badges';
import { getHome } from '@/lib/data';
import { fmtMonthDay, fmtNum } from '@/lib/format';
import { pageMeta } from '@/lib/site';
import { entityPath, paths } from '@/lib/urls';

export const metadata: Metadata = {
  ...pageMeta(
    '한국철도도감 — 대한민국 철도의 지금과 앞으로',
    '대한민국 철도의 노선·역·운행 계통·시간표와 계획 사업(단계·기대 일정·근거 고시)을 출처와 함께 정리한 비상업 공개 자료.',
    '/',
  ),
  title: { absolute: '한국철도도감 — 대한민국 철도의 지금과 앞으로' },
};

const GROUP_LABEL: Record<StageGroup, string> = {
  early: '구상·계획 반영',
  study: '타당성 조사',
  design: '기본계획·설계',
  build: '공사·시운전',
  open: '개통',
  stopped: '폐기·휴면',
};

export default async function HomePage() {
  const home = await getHome();
  const s = home.stats;
  const byGroup = new Map<StageGroup, number>();
  for (const [stage, n] of Object.entries(s.plans.by_stage)) {
    if (!isCode('planStage', stage)) continue;
    const g = STAGE_GROUP[stage];
    byGroup.set(g, (byGroup.get(g) ?? 0) + n);
  }
  const groupMax = Math.max(1, ...byGroup.values());
  const building = (s.plans.by_stage.construction ?? 0) + (s.plans.by_stage.trial_run ?? 0);

  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>대한민국 철도의 지금과 앞으로</h1>
          <p>
            노선·역·운행 계통·열차와 계획 사업을 <b>출처와 함께</b> 정리합니다.
          </p>
          <form className="bigsearch" action={paths.search()} method="get" role="search">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <label htmlFor="home-q" className="sr-only">
              검색어
            </label>
            <input
              id="home-q"
              name="q"
              type="search"
              placeholder="역 이름, 노선, 계획, 역번호, 초성(ㅅㅇㅇ)…"
              autoComplete="off"
            />
            <button type="submit" className="btn primary">
              검색
            </button>
          </form>
          <nav className="quick" aria-label="바로 가기">
            <a href={paths.futureMap()}>미래 지도</a>
            <a href={paths.upcoming()}>개통 예정</a>
            <a href={paths.plans()}>계획 사업</a>
            <a href={paths.timeline()}>연표</a>
          </nav>
          <div className="stats" role="list" aria-label="수록 현황">
            <div role="listitem">
              <b>{fmtNum(s.lines.total)}</b>
              <span>노선</span>
            </div>
            <div role="listitem">
              <b>{fmtNum(s.stations.total)}</b>
              <span>역</span>
            </div>
            <div role="listitem">
              <b>{fmtNum(s.services.total)}</b>
              <span>운행 계통</span>
            </div>
            <div role="listitem">
              <b>{fmtNum(s.plans.total)}</b>
              <span>계획 사업</span>
            </div>
            <div role="listitem">
              <b>{fmtNum(building)}</b>
              <span>공사 중 계획</span>
            </div>
            <div role="listitem">
              <b>{fmtNum(s.sources)}</b>
              <span>출처</span>
            </div>
          </div>
        </div>
      </section>

      <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
        <section className="section" aria-label="둘러보기">
          <div className="entries">
            <a className="entry" href={paths.lines()}>
              <span className="n">{fmtNum(s.lines.total)}</span>
              <b>노선</b>
              <span>법적 분류·권역별 물리 노선</span>
            </a>
            <a className="entry" href={paths.stations()}>
              <span className="n">{fmtNum(s.stations.total)}</span>
              <b>역</b>
              <span>노선별 역번호·시간표</span>
            </a>
            <a className="entry" href={paths.services()}>
              <span className="n">{fmtNum(s.services.total)}</span>
              <b>운행 계통</b>
              <span>열차·광역전철 정차 패턴</span>
            </a>
            <a className="entry" href={paths.plans()}>
              <span className="n">{fmtNum(s.plans.total)}</span>
              <b>계획</b>
              <span>단계·기대 일정·근거 고시</span>
            </a>
            <a className="entry" href={paths.timeline()}>
              <span className="n">{fmtNum(s.events)}</span>
              <b>연표</b>
              <span>개통·폐지·고시 이력</span>
            </a>
            <a className="entry" href="/trains/">
              <b>열차 번호</b>
              <span>번호 체계·번호 찾기</span>
            </a>
          </div>
        </section>

        <section className="section surface feature" aria-labelledby="future-h">
          <div className="txt">
            <div className="eyebrow">미래 지도</div>
            <h2 id="future-h" style={{ marginTop: 'var(--kr-space-1)' }}>
              앞으로 생길 철도는?
            </h2>
            <p className="muted" style={{ fontSize: 'var(--kr-text-sm)' }}>
              연도를 고르면 그때까지 개통 예정인 노선이 더해집니다. 선 모양은 사업 단계, 이름은 늘 함께 표시합니다. 개통
              예정은 발표 시점 기준이며 바뀔 수 있습니다.
            </p>
            <a className="btn primary" href={paths.futureMap()}>
              미래 지도 열기
            </a>
          </div>
          <div style={{ padding: 'var(--kr-space-6)', background: 'var(--kr-surface-sunken)' }}>
            <div className="eyebrow" style={{ marginBottom: 'var(--kr-space-2)' }}>
              단계별 계획 사업 수 (진행 중 {fmtNum(s.plans.active)})
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--kr-space-2)' }}>
              {(Object.keys(GROUP_LABEL) as StageGroup[]).map((g) => {
                const n = byGroup.get(g) ?? 0;
                return (
                  <li
                    key={g}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '7.5rem 1fr 3rem',
                      gap: 8,
                      alignItems: 'center',
                      fontSize: 'var(--kr-text-sm)',
                    }}
                  >
                    <span className={`stage-${g}`} style={{ fontWeight: 600 }}>
                      {GROUP_LABEL[g]}
                    </span>
                    <span
                      aria-hidden="true"
                      style={{
                        height: 10,
                        borderRadius: 3,
                        background: `var(--kr-stage-${g})`,
                        width: `${(n / groupMax) * 100}%`,
                        minWidth: n ? 4 : 0,
                      }}
                    />
                    <span className="num" style={{ textAlign: 'right' }}>
                      {fmtNum(n)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <div className="split section">
          <section aria-labelledby="up-h">
            <div className="section-head">
              <h2 id="up-h">개통 예정</h2>
              <span className="muted" style={{ fontSize: 'var(--kr-text-sm)' }}>
                기대 일정 가까운 순
              </span>
              <a className="more" href={paths.upcoming()}>
                전체
              </a>
            </div>
            {home.upcoming.length === 0 ? (
              <p className="note">개통 예정이 공개된 계획이 없습니다.</p>
            ) : (
              <ul className="ulist surface">
                {home.upcoming.map((p) => (
                  <li key={p.id}>
                    <div>
                      <a href={paths.plan(p.id)}>{p.name_ko}</a>
                      <div className="sub">
                        <StageBadge stage={p.stage} />
                      </div>
                    </div>
                    <span className="when">
                      <TargetText target={p.target_open} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="chg-h">
            <div className="section-head">
              <h2 id="chg-h">최근 변경</h2>
              <span className="muted" style={{ fontSize: 'var(--kr-text-sm)' }}>
                데이터 판 단위
              </span>
            </div>
            {home.recent_changes.length === 0 ? (
              <p className="note">최근 변경이 없습니다.</p>
            ) : (
              <ul className="ulist clist surface">
                {home.recent_changes.map((c) => (
                  <li key={c.version}>
                    <time dateTime={c.committed_at}>{fmtMonthDay(c.committed_at)}</time>
                    <span>
                      {c.entities.slice(0, 4).map((e, i) => {
                        const href = e.url_path ?? entityPath(e.type, e.id);
                        return (
                          <span key={e.id}>
                            {i > 0 ? ', ' : ''}
                            <span className="muted" style={{ fontSize: 'var(--kr-text-xs)' }}>
                              {codeLabel('entityType', e.type)}{' '}
                            </span>
                            {href ? <a href={href}>{e.name_ko}</a> : e.name_ko}
                          </span>
                        );
                      })}
                      {c.entity_count > 4 ? <span className="muted"> 외 {fmtNum(c.entity_count - 4)}건</span> : null}
                      <span className="muted num" style={{ fontSize: 'var(--kr-text-xs)' }}>
                        {' '}
                        · 판 #{c.version}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="section" aria-labelledby="area-h">
          <div className="section-head">
            <h2 id="area-h">권역별</h2>
            <span className="muted" style={{ fontSize: 'var(--kr-text-sm)' }}>
              역 수는 여객역 기준 · 시·도를 누르면 그 지역 역 목록
            </span>
          </div>
          <div className="lines-grid">
            {home.areas
              .filter((a) => a.code !== 'national')
              .map((a) => (
                <div key={a.code} className="panel">
                  <h3>
                    <a href={paths.stationRegion(a.code)}>{a.name_ko}</a>
                  </h3>
                  <p className="muted num" style={{ fontSize: 'var(--kr-text-xs)', margin: '0 0 var(--kr-space-2)' }}>
                    노선 {fmtNum(a.lines)} · 역 {fmtNum(a.stations)} · 운행 계통 {fmtNum(a.services)} · 계획{' '}
                    {fmtNum(a.plans)}
                  </p>
                  <div className="regions">
                    {a.regions.map((r) => (
                      <a key={r.code} href={paths.stationRegion(r.slug)}>
                        {r.short_ko}
                        <span>역 {fmtNum(r.stations)}</span>
                      </a>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </section>
      </div>
    </>
  );
}
