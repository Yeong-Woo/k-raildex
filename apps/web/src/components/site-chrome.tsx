/** 머리·바닥(모든 페이지 공통). 비상업 고지와 출처·라이선스 문구(NFR-WEB-004)는 바닥에 늘 보인다 */
import { paths } from '@/lib/urls';
import { NavLinks, type NavItem } from './nav-links';
import { ThemeToggle } from './theme-toggle';

export const NAV: NavItem[] = [
  { href: paths.lines(), label: '노선', match: '/lines/' },
  { href: paths.stations(), label: '역', match: '/stations/' },
  { href: paths.services(), label: '운행 계통', match: '/services/' },
  { href: paths.plans(), label: '계획', match: '/plans/' },
  { href: paths.map(), label: '지도', match: '/map/' },
  { href: paths.timeline(), label: '연표', match: '/timeline/' },
];

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--kr-accent)" />
      <path
        d="M9 24 16 7l7 17M11.5 18h9"
        stroke="var(--kr-accent-fg)"
        strokeWidth="2.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="in">
        <a className="brand" href="/">
          <Logo />
          <span>한국철도도감</span>
        </a>
        <NavLinks items={NAV} />
        <div className="header-tools">
          <form
            className="search-btn header-search"
            action={paths.search()}
            method="get"
            role="search"
            aria-label="사이트 검색"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <label htmlFor="site-q" className="sr-only">
              역·노선·계획 검색
            </label>
            <input id="site-q" name="q" type="search" placeholder="역·노선·계획 검색" autoComplete="off" />
          </form>
          <a className="btn icon header-search-link" href={paths.search()} aria-label="검색">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </a>
          <a className="btn" href={paths.futureMap()} aria-label="미래 지도">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
            </svg>
            <span className="label">미래 지도</span>
          </a>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ dataVersion }: { dataVersion: number | null }) {
  return (
    <footer className="site-footer">
      <div className="container in">
        <span>한국철도도감 — 비상업 공개 자료. 광고·추적 없음.</span>
        <span>
          자체 데이터 출처·라이선스는 각 페이지 &quot;출처&quot; 절과 <a href={paths.sources()}>출처·라이선스</a> ·
          공공누리 저작물은 출처 표시 · 지도 선형 일부 © OpenStreetMap 기여자(ODbL)
        </span>
        <nav aria-label="더 보기" className="footer-links">
          <a href={paths.upcoming()}>개통 예정</a>
          <a href={paths.closed()}>폐선·폐역</a>
          <a href={paths.trains()}>열차번호</a>
          <a href={paths.trainClasses()}>열차 등급</a>
          <a href={paths.transferCenters()}>환승센터</a>
          <a href={paths.routeMaps()}>공식 노선도</a>
          <a href={paths.terms()}>용어</a>
          <a href="/changes.xml">변경 기록(Atom)</a>
          <a href={paths.about()}>소개·비상업 고지</a>
        </nav>
        {dataVersion != null ? <span className="num">데이터 판 #{dataVersion}</span> : null}
      </div>
    </footer>
  );
}
