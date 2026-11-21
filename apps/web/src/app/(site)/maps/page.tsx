/**
 * 공식 노선도(P2 `/maps/`, 기존 승계): 게시 가능한 원본(embed + 공개 원문)은 변형 없이 그대로(CSS 폭만), 그 밖은 원본 링크만.
 * 원문 파일은 web Route Handler 로 중계(FR-WEB-002). 노선도별 근거 자료·출처 표기.
 */
import type { Metadata } from 'next';
import { codeLabel } from '@k-raildex/contracts';
import { DocumentLink } from '@/components/detail';
import { SourceMini } from '@/components/source-mini';
import { getRouteMaps } from '@/lib/data';
import { fmtDate } from '@/lib/format';
import { pageMeta } from '@/lib/site';
import { paths } from '@/lib/urls';

export const metadata: Metadata = pageMeta(
  '공식 노선도',
  '운영기관·지자체가 공개한 공식 철도 노선도 — 원본 그대로 게시하거나 원본 링크로 안내합니다.',
  '/maps/',
);

export default async function RouteMapsPage() {
  const maps = await getRouteMaps();
  const regions = [...new Set(maps.map((m) => m.region ?? '전국·기타'))];
  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
      <div className="page-head">
        <h1>공식 노선도</h1>
        <p className="lead">
          운영기관·지자체가 공개한 노선도입니다. 게시 조건이 허락하는 원본만 변형 없이 싣고, 나머지는 원본 위치로
          안내합니다. 지리 지도와 미래 노선은 <a href={paths.map()}>지도</a>.
        </p>
      </div>
      {regions.map((r) => (
        <section key={r} className="section" aria-labelledby={`h-${r}`}>
          <div className="section-head">
            <h2 id={`h-${r}`}>{r}</h2>
          </div>
          <div className="cards">
            {maps
              .filter((m) => (m.region ?? '전국·기타') === r)
              .map((m) => {
                const img =
                  m.mode === 'embed' && m.document && m.document.mime.startsWith('image/') ? m.document : null;
                return (
                  <article key={m.id} id={m.id} className="card">
                    <h3>
                      {m.url ? (
                        <a href={m.url} rel="noopener noreferrer" target="_blank">
                          {m.title_ko}
                        </a>
                      ) : (
                        m.title_ko
                      )}
                    </h3>
                    <p className="meta">
                      {m.publisher} · {codeLabel('routeMapMode', m.mode)}
                      {m.as_of ? ` · ${m.as_of} 기준` : ''} · 확인 {fmtDate(m.checked_at)}
                    </p>
                    {img ? (
                      <figure style={{ margin: 0 }}>
                        <a href={`${paths.document(img.id)}?disposition=inline`} target="_blank" rel="noopener">
                          <img
                            src={`${paths.document(img.id)}?disposition=inline`}
                            alt={m.title_ko}
                            width={m.width ?? undefined}
                            height={m.height ?? undefined}
                            loading="lazy"
                            style={{ width: '100%', height: 'auto' }}
                          />
                        </a>
                        <figcaption className="meta">{m.attribution ?? m.publisher}</figcaption>
                        <DocumentLink doc={img} />
                      </figure>
                    ) : (
                      <p style={{ margin: 0, fontSize: 'var(--kr-text-sm)' }}>
                        {m.url ? (
                          <a href={m.url} rel="noopener noreferrer" target="_blank">
                            원본 노선도 보기(외부)
                          </a>
                        ) : (
                          '원본 위치 미확인'
                        )}
                        {m.attribution ? <span className="name-sub">{m.attribution}</span> : null}
                      </p>
                    )}
                    <p className="meta">라이선스: {m.license}</p>
                    {m.attachments.length ? <p className="meta">근거 자료 {m.attachments.length}건</p> : null}
                    <p className="meta">
                      출처: <SourceMini sources={m.sources} />
                    </p>
                  </article>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}
