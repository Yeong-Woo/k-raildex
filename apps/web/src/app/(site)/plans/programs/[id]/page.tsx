/** 상위 계획 상세: 기간·고시 이력·주요 수치·요지 + 실린 사업 표 + 출처 */
import type { Metadata } from 'next';
import { codeLabel } from '@k-raildex/contracts';
import { ReviewBadge, StageBadge, TargetText } from '@/components/badges';
import { Crumbs, Section, SourcesSection } from '@/components/detail';
import { BreadcrumbLd } from '@/components/json-ld';
import { ProgramFacts } from '@/components/program';
import { getProgram } from '@/lib/data';
import { comparePlans } from '@/lib/plans';
import { clip, pageMeta } from '@/lib/site';
import { groupSources } from '@/lib/sources';
import { paths } from '@/lib/urls';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const p = await getProgram(id);
  return pageMeta(
    p.name_ko,
    clip(
      `${p.name_ko} — ${codeLabel('planProgramKind', p.kind)}${p.period_from ? `(${p.period_from}~${p.period_to ?? ''})` : ''}. ${p.summary ?? ''} 실린 사업 ${p.plans.length}건.`,
    ),
    paths.planProgram(p.id),
  );
}

export default async function ProgramPage({ params }: { params: Params }) {
  const { id } = await params;
  const p = await getProgram(id);
  const src = groupSources(p.sources, p.id);
  const srcN = (sid: string | null) => (sid ? (src.find((g) => g.source_id === sid)?.n ?? null) : null);
  const path = paths.planProgram(p.id);
  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
      <BreadcrumbLd
        items={[
          { label: '계획', path: paths.plans() },
          { label: '상위 계획', path: paths.planPrograms() },
          { label: p.name_ko, path },
        ]}
      />
      <div className="page-head">
        <Crumbs
          items={[
            { href: paths.plans(), label: '계획' },
            { href: paths.planPrograms(), label: '상위 계획' },
            { label: p.name_ko },
          ]}
        />
        <h1>{p.name_ko}</h1>
        {p.name_full && p.name_full !== p.name_ko ? <p className="lead">{p.name_full}</p> : null}
        <div className="badges">
          <span className="badge outline">{codeLabel('planProgramKind', p.kind)}</span>
          <span className="badge outline">{codeLabel('planProgramStatus', p.status)}</span>
          <ReviewBadge status={p.review_status} />
        </div>
      </div>
      <Section id="summary" title="요지">
        <div className="surface" style={{ padding: 'var(--kr-space-4)' }}>
          <ProgramFacts p={p} srcN={srcN} />
        </div>
      </Section>
      <Section id="plans" title="실린 사업" sub={`${p.plans.length}건`}>
        {p.plans.length === 0 ? (
          <p className="note">이 계획에 연결된 사업 자료가 없습니다(미확인).</p>
        ) : (
          <div className="table-wrap">
            <table className="data cardify">
              <thead>
                <tr>
                  <th scope="col">사업</th>
                  <th scope="col">구분·구간</th>
                  <th scope="col">단계</th>
                  <th scope="col">개통 예정</th>
                </tr>
              </thead>
              <tbody>
                {[...p.plans].sort(comparePlans).map((x) => {
                  const r = x.refs.filter((y) => y.program_id === p.id);
                  return (
                    <tr key={x.id}>
                      <td>
                        <a href={paths.plan(x.id)}>{x.name_ko}</a>
                      </td>
                      <td data-label="구분·구간" style={{ fontSize: 'var(--kr-text-xs)' }}>
                        {[
                          ...new Set(
                            r.map((y) => (y.class ? codeLabel('planRefClass', y.class) : null)).filter(Boolean),
                          ),
                        ].join(' · ') || '—'}
                        {r[0]?.section ? <span className="name-sub">{r[0].section}</span> : null}
                      </td>
                      <td data-label="단계">
                        <StageBadge stage={x.stage} />
                      </td>
                      <td data-label="개통 예정">
                        <TargetText target={x.target_open} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <SourcesSection groups={src} title={p.name_ko} path={path} />
    </div>
  );
}
