/**
 * 용어(P2 `/terms/`, DB 용어 사전). 절별 목록, 항목 앵커 = 용어 id(`#term-…`, 검색 결과 링크) + 옛 앵커(github-slugger 제목 슬러그) 유지.
 */
import type { Metadata } from 'next';
import { SourceMini } from '@/components/source-mini';
import { getTerms, type Term } from '@/lib/data';
import { pageMeta } from '@/lib/site';
import { slugger, termSectionNo } from '@/lib/terms';

export const metadata: Metadata = pageMeta(
  '철도 용어',
  '고속철도·일반철도·도시철도·광역철도, 광역전철, 사업 단계, 노선과 운행 계통 등 철도 용어의 법령 기준 정의와 출처.',
  '/terms/',
);

export default async function TermsPage() {
  const terms = await getTerms();
  const sections: { no: number | null; name: string; items: Term[] }[] = [];
  for (const t of terms) {
    const name = t.section ?? '기타';
    let s = sections.find((x) => x.name === name);
    if (!s) {
      s = { no: termSectionNo(t.id), name, items: [] };
      sections.push(s);
    }
    s.items.push(t);
  }
  sections.sort((a, b) => (a.no ?? 99) - (b.no ?? 99));
  const slug = slugger();
  slug('철도 용어 사전');
  const withSlugs = sections.map((s) => ({
    ...s,
    slug: slug(s.no ? `${s.no}. ${s.name}` : s.name),
    items: s.items.map((t) => ({ t, slug: slug(t.term_ko) })),
  }));
  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
      <div className="page-head">
        <h1>철도 용어</h1>
        <p className="lead">
          법령·공식 자료의 정의를 우선하고 근거를 적었습니다. 통용 속칭과 법적 정의가 다르면 둘 다 적습니다. 노선(물리
          선로)과 운행 계통(열차가 다니는 이름)은 서로 다른 개념입니다.
        </p>
      </div>
      <nav className="surface" aria-label="목차" style={{ padding: 'var(--kr-space-4)' }}>
        <ol style={{ margin: 0, paddingLeft: '1.2em', columns: '16rem', fontSize: 'var(--kr-text-sm)' }}>
          {withSlugs.map((s) => (
            <li key={s.name}>
              <a href={`#sec-${s.no ?? s.slug}`}>{s.name}</a>
            </li>
          ))}
        </ol>
      </nav>
      {withSlugs.map((s) => (
        <section
          key={s.name}
          id={`sec-${s.no ?? s.slug}`}
          className="section"
          aria-labelledby={`sec-${s.no ?? s.slug}-h`}
        >
          <span id={s.slug} aria-hidden="true" />
          <div className="section-head">
            <h2 id={`sec-${s.no ?? s.slug}-h`}>{s.name}</h2>
          </div>
          <div className="surface">
            {s.items.map(({ t, slug: old }) => (
              <article key={t.id} id={t.id} className="term">
                {old !== t.id ? <span id={old} aria-hidden="true" /> : null}
                <h3>
                  {t.term_ko} {t.term_en ? <small className="muted">{t.term_en}</small> : null}
                </h3>
                <p>{t.definition}</p>
                <dl className="kv">
                  {t.basis ? (
                    <>
                      <dt>근거</dt>
                      <dd>{t.basis}</dd>
                    </>
                  ) : null}
                  {t.example ? (
                    <>
                      <dt>예</dt>
                      <dd>{t.example}</dd>
                    </>
                  ) : null}
                  {t.caution ? (
                    <>
                      <dt>주의</dt>
                      <dd>{t.caution}</dd>
                    </>
                  ) : null}
                  {t.names.length ? (
                    <>
                      <dt>다른 이름</dt>
                      <dd>{t.names.map((n) => n.name).join(', ')}</dd>
                    </>
                  ) : null}
                  <dt>출처</dt>
                  <dd>
                    <SourceMini sources={t.sources} checkedAt={t.checked_at} />
                  </dd>
                </dl>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
