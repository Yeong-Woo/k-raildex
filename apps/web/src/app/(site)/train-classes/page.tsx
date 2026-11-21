/** 열차 등급(P2 `/train-classes/`): 등급 tier 순(고속 → 준고속 → 특급 → 일반 → 통근). 항목 앵커 = 등급 id(`#tc-…`, 기존 유지). 열차 등급 ≠ 차량 형식(C-3) */
import type { Metadata } from 'next';
import { codeLabel, codes } from '@k-raildex/contracts';
import { FuzzyDateText } from '@/components/badges';
import { SourceMini } from '@/components/source-mini';
import { getTrainClasses } from '@/lib/data';
import { pageMeta } from '@/lib/site';
import { paths } from '@/lib/urls';

export const metadata: Metadata = pageMeta(
  '열차 등급',
  'KTX·ITX·무궁화호 등 열차 등급(운임·서비스 등급)과 운행 계통 — 차량 형식과는 다른 개념.',
  '/train-classes/',
);

export default async function TrainClassesPage() {
  const items = await getTrainClasses();
  const tiers = codes.trainClassTier.values.filter((t) => items.some((c) => c.tier === t));
  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
      <div className="page-head">
        <h1>열차 등급</h1>
        <p className="lead">
          열차 등급은 운행 서비스의 등급(운임·정차 방식)이고 차량 형식과는 다릅니다. 번호 체계는{' '}
          <a href={paths.trains()}>열차번호·차량번호</a>.
        </p>
      </div>
      <nav className="chips" aria-label="등급 묶음">
        {tiers.map((t) => (
          <a key={t} className="chip" href={`#tier-${t}`} style={{ paddingLeft: '0.6em' }}>
            {codeLabel('trainClassTier', t)}
          </a>
        ))}
      </nav>
      {tiers.map((t) => (
        <section key={t} id={`tier-${t}`} className="section" aria-labelledby={`tier-${t}-h`}>
          <div className="section-head">
            <h2 id={`tier-${t}-h`}>{codeLabel('trainClassTier', t)}</h2>
          </div>
          <div className="cards">
            {items
              .filter((c) => c.tier === t)
              .map((c) => (
                <article key={c.id} id={c.id} className={`card${c.status === 'retired' ? ' nocolor' : ''}`}>
                  <h3>
                    {c.name_ko} {c.name_en ? <small className="muted">{c.name_en}</small> : null}
                  </h3>
                  <p className="meta">
                    {codeLabel('trainClassStatus', c.status)}
                    {c.max_speed_kmh ? ` · 최고 ${c.max_speed_kmh}km/h` : ''}
                    {c.started ? (
                      <>
                        {' '}
                        · <FuzzyDateText value={c.started} />~{c.ended ? <FuzzyDateText value={c.ended} /> : ''}
                      </>
                    ) : null}
                  </p>
                  {c.names.length ? <p className="meta">다른 이름: {c.names.map((n) => n.name).join(', ')}</p> : null}
                  {c.description ? <p style={{ fontSize: 'var(--kr-text-sm)', margin: 0 }}>{c.description}</p> : null}
                  {c.successor ? (
                    <p className="meta">
                      후속 등급: <a href={`#${c.successor.id}`}>{c.successor.name_ko}</a>
                    </p>
                  ) : null}
                  {c.services.length ? (
                    <p className="meta">
                      운행 계통:{' '}
                      {c.services.map((s, i) => (
                        <span key={s.id}>
                          {i ? ', ' : ''}
                          <a href={paths.service(s.id)}>{s.name_ko}</a>
                        </span>
                      ))}
                    </p>
                  ) : null}
                  <p className="meta">
                    출처: <SourceMini sources={c.sources} checkedAt={c.checked_at} />
                  </p>
                </article>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
