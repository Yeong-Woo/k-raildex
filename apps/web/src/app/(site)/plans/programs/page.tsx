/**
 * 상위 계획 체계(P1 `/plans/programs/`): 종류별(국토종합계획 → 국가철도망 → 도시철도망 → 광역교통 → 환승센터 → 기타) 카드.
 * 카드 앵커 = 상위 계획 id(`#pp-…`) — 옛 앵커(`#national_rail_4`)는 페이지 스크립트가 잇는다(Q69 A). 상세는 `/plans/programs/<id>/`.
 */
import type { Metadata } from 'next';
import { codeLabel, codes } from '@k-raildex/contracts';
import { LegacyAnchors } from '@/components/legacy-anchors';
import { ProgramFacts } from '@/components/program';
import { getPrograms } from '@/lib/data';
import { pageMeta } from '@/lib/site';
import { paths } from '@/lib/urls';

export const metadata: Metadata = pageMeta(
  '상위 계획',
  '국토종합계획·국가철도망 구축계획·시도 도시철도망 구축계획·광역교통·환승센터 기본계획 — 차수별 기간·고시 이력·요지와 실린 철도 사업.',
  '/plans/programs/',
);

export default async function ProgramsPage() {
  const programs = [...(await getPrograms())].sort((a, b) => a.ord - b.ord);
  const kinds = codes.planProgramKind.values.filter((k) => programs.some((p) => p.kind === k));
  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
      <LegacyAnchors types={['plan_program']} />
      <div className="page-head">
        <h1>상위 계획</h1>
        <p className="lead">
          철도 사업은 국토종합계획 → 국가철도망 구축계획 → 시·도 도시철도망 구축계획·광역교통 시행계획 순으로 내려오는
          법정 계획에 실립니다. 계획마다 기간·고시 이력·요지를 두고, 실린 사업은 <a href={paths.plans()}>계획</a>{' '}
          목록에서 차수별로 봅니다.
        </p>
      </div>
      <nav className="chips" aria-label="종류">
        {kinds.map((k) => (
          <a key={k} className="chip" href={`#kind-${k}`} style={{ paddingLeft: '0.6em' }}>
            {codeLabel('planProgramKind', k)}
          </a>
        ))}
      </nav>
      {kinds.map((k) => (
        <section key={k} id={`kind-${k}`} className="section" aria-labelledby={`kind-${k}-h`}>
          <div className="section-head">
            <h2 id={`kind-${k}-h`}>{codeLabel('planProgramKind', k)}</h2>
          </div>
          <div className="cards">
            {programs
              .filter((p) => p.kind === k)
              .map((p) => (
                <article key={p.id} id={p.id} className="card">
                  <h3>
                    <a href={paths.planProgram(p.id)}>{p.name_ko}</a>
                  </h3>
                  {p.name_full && p.name_full !== p.name_ko ? <p className="meta">{p.name_full}</p> : null}
                  <ProgramFacts p={{ ...p, summary: null, points: [], figures: [], notices: p.notices.slice(-3) }} />
                </article>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
