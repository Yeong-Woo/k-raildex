/**
 * 출처·라이선스(P2 `/sources/`, NFR-WEB-004): 공공누리 출처 표시·OSM ODbL·노선도 원본 조건 + 출처 전체 표(행 앵커 = 출처 id, 기존 유지).
 * 공개 가능 원문은 web Route Handler 로 내려받는다(FR-WEB-002). 유형 필터 `?type=`, 원문 있는 것만 `?docs=1`.
 */
import type { Metadata } from 'next';
import { codeLabel, codes } from '@k-raildex/contracts';
import { DocumentLink } from '@/components/detail';
import { FilterRow, LinkTabs } from '@/components/tabs';
import { getSources } from '@/lib/data';
import { fmtDate, fmtNum, formatFuzzy } from '@/lib/format';
import { pageMeta } from '@/lib/site';
import { firstParam, paths, pickParam, withQuery } from '@/lib/urls';

export const metadata: Metadata = pageMeta(
  '출처·라이선스',
  '한국철도도감이 쓰는 출처 전체 — 발행처·유형·라이선스·받은 날, 공개 가능한 원문 내려받기, 공공누리·OpenStreetMap(ODbL) 표기.',
  '/sources/',
);

type SP = Promise<Record<string, string | string[] | undefined>>;
const TYPES = ['all', ...codes.sourceType.values] as const;

export default async function SourcesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const type = pickParam(sp.type, TYPES, 'all');
  const docs = firstParam(sp.docs) === '1';
  const all = await getSources();
  const current = { type, docs: docs ? '1' : undefined };
  const link = (c: Record<string, string | undefined>) => withQuery(paths.sources(), current, c, { type: 'all' });
  const shown = all
    .filter((s) => (type === 'all' || s.type === type) && (!docs || s.documents.length > 0))
    .sort((a, b) => a.publisher.localeCompare(b.publisher, 'ko') || a.title.localeCompare(b.title, 'ko'));
  const typeTabs = TYPES.filter((t) => t === 'all' || all.some((s) => s.type === t)).map((t) => ({
    value: t,
    label: t === 'all' ? '전체' : codeLabel('sourceType', t),
    count: t === 'all' ? all.length : all.filter((s) => s.type === t).length,
    href: link({ type: t }),
  }));
  const docCount = all.filter((s) => s.documents.length).length;
  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
      <div className="page-head">
        <h1>출처·라이선스</h1>
        <p className="lead">
          모든 사실에는 출처와 확인일을 붙입니다. 출처 우선순위는 법령·고시 → 국토교통부·국가철도공단·운영기관 → 언론 →
          위키(보조) 입니다. 각 페이지의 “출처” 절이 필드 단위 출처를 보여 줍니다.
        </p>
      </div>
      <section className="section" aria-labelledby="h-kogl">
        <div className="section-head">
          <h2 id="h-kogl">표기·이용 조건</h2>
        </div>
        <div className="surface prose-text" style={{ padding: 'var(--kr-space-4)' }}>
          <p>
            <b>공공누리</b> — 공공기관 저작물은 각 출처 항목의 공공누리 유형에 따라 출처를 표시해 이용합니다.
            제4유형(출처표시·상업적 이용금지·변경금지) 원문은 변경하지 않은 원본 그대로, 비상업 조건으로만 내려받기를
            제공합니다.
          </p>
          <p>
            <b>OpenStreetMap</b> — 지도의 철도 선형 일부는 © OpenStreetMap 기여자이며 ODbL(Open Database License)을
            따릅니다. OSM 자료는 자체 데이터와 분리해 보관하고 지도에만 씁니다.
          </p>
          <p>
            <b>배경 지도</b> — VWorld(국토교통부 공간정보 오픈플랫폼). VWorld 를 쓸 수 없으면 OpenStreetMap 표준 타일.
          </p>
          <p>
            <b>공식 노선도</b> — <a href={paths.routeMaps()}>노선도</a> 페이지의 노선도는 원본을 변형하지 않고, 게시
            조건이 없는 것은 링크만 둡니다.
          </p>
          <p>
            <b>자체 데이터</b> — 정리·구조화한 자료는 출처 표시 조건으로 공개합니다. 다른 사이트(미래철도DB 등)의
            데이터는 복제하지 않습니다.
          </p>
        </div>
      </section>
      <section className="section" aria-labelledby="list">
        <div className="section-head">
          <h2 id="list">출처 목록</h2>
          <span className="muted num">{fmtNum(shown.length)}</span>
        </div>
        <div className="filters">
          <FilterRow label="유형">
            <LinkTabs items={typeTabs} current={type} label="유형" small />
          </FilterRow>
          <FilterRow label="원문">
            <ul className="tabs small" aria-label="원문">
              <li>
                <a href={link({ docs: docs ? undefined : '1' })} aria-current={docs ? 'true' : undefined}>
                  {docs ? '✓ ' : ''}내려받을 원문 있는 것만<span className="count">{docCount}</span>
                </a>
              </li>
            </ul>
          </FilterRow>
        </div>
        <div className="table-wrap">
          <table className="data cardify">
            <thead>
              <tr>
                <th scope="col">출처</th>
                <th scope="col">유형·라이선스</th>
                <th scope="col">날짜</th>
                <th scope="col" className="r">
                  쓰는 곳
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} id={s.id}>
                  <td>
                    {s.url ? (
                      <a href={s.url} rel="noopener noreferrer" target="_blank">
                        {s.title}
                      </a>
                    ) : (
                      s.title
                    )}
                    <span className="name-sub">
                      {s.publisher}
                      {s.notice_number ? ` · ${s.notice_number}` : ''}
                    </span>
                    {s.attribution ? <span className="name-sub">표기: {s.attribution}</span> : null}
                    {s.documents.map((d) => (
                      <div key={d.id}>
                        <DocumentLink doc={d} />
                      </div>
                    ))}
                  </td>
                  <td data-label="유형·라이선스" style={{ fontSize: 'var(--kr-text-xs)' }}>
                    {codeLabel('sourceType', s.type)}
                    <span className="name-sub">{s.license}</span>
                  </td>
                  <td data-label="날짜" style={{ fontSize: 'var(--kr-text-xs)' }} className="nowrap">
                    {s.published ? (
                      <>발행 {formatFuzzy(s.published)}</>
                    ) : s.published_raw ? (
                      <>발행 {s.published_raw}</>
                    ) : null}
                    <span className="name-sub">받은 날 {fmtDate(s.retrieved_at)}</span>
                    <span className="name-sub">확인 {fmtDate(s.checked_at)}</span>
                  </td>
                  <td data-label="쓰는 곳" className="r num">
                    {s.used_by}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
