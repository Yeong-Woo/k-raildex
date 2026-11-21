/** 통합 검색(P1): 역·노선·운행 계통·계획·용어. 초성·역번호·별칭은 공개 API(mv_search)가 맡는다. GET 폼이라 JS 없이 동작 */
import type { Metadata } from 'next';
import { codeLabel } from '@k-raildex/contracts';
import { LinkTabs } from '@/components/tabs';
import { search } from '@/lib/data';
import { areaLabel } from '@/lib/filters';
import { fmtNum, matchedKindLabel } from '@/lib/format';
import { pageMeta } from '@/lib/site';
import { entityPath, firstParam, paths, pickParam, withQuery } from '@/lib/urls';

type SP = Promise<Record<string, string | string[] | undefined>>;

const TYPES = ['all', 'station', 'line', 'service', 'plan', 'glossary_term'] as const;
type T = (typeof TYPES)[number];
const TYPE_LABEL: Record<T, string> = {
  all: '전체',
  station: '역',
  line: '노선',
  service: '운행 계통',
  plan: '계획',
  glossary_term: '용어',
};

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const q = (firstParam((await searchParams).q) ?? '').trim();
  return {
    ...pageMeta(q ? `"${q}" 검색` : '검색', '역·노선·운행 계통·계획·용어 통합 검색(초성·역번호·별칭).', '/search/'),
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const q = (firstParam(sp.q) ?? '').trim().slice(0, 100);
  const type = pickParam(sp.type, TYPES, 'all');
  const result = q ? await search(q) : null;
  const items = result?.items ?? [];
  const shown = type === 'all' ? items : items.filter((i) => i.type === type);

  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
      <div className="page-head">
        <h1>검색</h1>
        <p className="lead">
          역 이름·노선·운행 계통·계획·용어를 찾습니다. 초성(예: ㅅㅇㅇ)·역번호·옛 이름·영문 이름으로도 찾을 수 있습니다.
        </p>
      </div>
      <form className="bigsearch" action={paths.search()} method="get" role="search" style={{ marginLeft: 0 }}>
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
        <label htmlFor="search-q" className="sr-only">
          검색어
        </label>
        <input
          id="search-q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="역 이름, 노선, 계획, 역번호, 초성…"
          autoComplete="off"
          autoFocus={!q}
        />
        {type !== 'all' ? <input type="hidden" name="type" value={type} /> : null}
        <button type="submit" className="btn primary">
          검색
        </button>
      </form>
      {q ? (
        <>
          <div className="filters" style={{ marginTop: 'var(--kr-space-4)' }}>
            <LinkTabs
              label="종류"
              current={type}
              items={TYPES.map((t) => ({
                value: t,
                label: TYPE_LABEL[t],
                count: t === 'all' ? items.length : items.filter((i) => i.type === t).length,
                href: withQuery(paths.search(), { q }, { type: t }, { type: 'all' }),
              }))}
            />
          </div>
          <p className="muted" style={{ fontSize: 'var(--kr-text-sm)' }} aria-live="polite">
            &quot;{q}&quot; 검색 결과 {fmtNum(shown.length)}건
            {result && result.total > items.length ? ` (상위 ${items.length}건만 표시)` : ''}
          </p>
          {shown.length === 0 ? (
            <p className="empty surface">찾는 항목이 없습니다. 다른 이름·초성·역번호로 찾아보세요.</p>
          ) : (
            <ul className="results surface">
              {shown.map((i) => {
                const href = i.url_path ?? entityPath(i.type, i.id);
                return (
                  <li key={`${i.type}-${i.id}`}>
                    <span className="badge outline">{codeLabel('entityType', i.type)}</span>
                    {href ? <a href={href}>{i.name}</a> : <b>{i.name}</b>}
                    {i.station_codes ? <span className="muted num">{i.station_codes}</span> : null}
                    {i.matched && i.matched !== i.name ? (
                      <span className="sub">
                        일치: {i.matched}
                        {matchedKindLabel(i.matched_kind) ? ` (${matchedKindLabel(i.matched_kind)})` : ''}
                      </span>
                    ) : null}
                    {i.areas.length ? <span className="sub">{i.areas.map(areaLabel).join(' · ')}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <p className="muted" style={{ marginTop: 'var(--kr-space-4)' }}>
          검색어를 입력하세요. <a href={paths.lines()}>노선</a> · <a href={paths.stations()}>역</a> ·{' '}
          <a href={paths.services()}>운행 계통</a> 목록에서 둘러볼 수도 있습니다.
        </p>
      )}
    </div>
  );
}
