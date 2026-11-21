/**
 * 계획 목록(P1): 차수 탭(상위 계획, `?program=`, 기본 제4차 국가철도망 — 기존 사이트와 같음) + 구분(`?class=`) + 단계(`?stage=` 묶음) +
 * 권역(`?area=`) + 범위(`?scope=`). 모두 링크(JS 없이 동작). 기존 앵커 `#program-<옛 id>` 는 페이지 스크립트가 새 앵커로 잇는다(Q69 A).
 */
import type { Metadata } from 'next';
import { codeLabel, codes } from '@k-raildex/contracts';
import { FuzzyDateText, ReviewBadge, StageBadge, TargetText } from '@/components/badges';
import { LegacyAnchors } from '@/components/legacy-anchors';
import { FilterRow, LinkTabs } from '@/components/tabs';
import { getPlans, getPrograms, getRegionIndex } from '@/lib/data';
import { areaCounts, areaLabel, areaMatches } from '@/lib/filters';
import { fmtNum } from '@/lib/format';
import {
  comparePlans,
  DEFAULT_PROGRAM,
  planClassMatches,
  planInProgram,
  planMatches,
  PROGRAM_GROUP_LABEL,
  programGroupOf,
  STAGE_FILTER_LABEL,
  STAGE_FILTERS,
  stageGroupOf,
  type PlanFilter,
  type StageFilter,
} from '@/lib/plans';
import { pageMeta } from '@/lib/site';
import { paths, pickParam, withQuery } from '@/lib/urls';

export const metadata: Metadata = pageMeta(
  '계획',
  '국가철도망·도시철도망 구축계획 등 상위 계획에 실린 철도 사업 — 차수·구분·단계·권역·범위별, 현재 단계와 개통 예정(공식·보도 근거)을 출처와 함께.',
  '/plans/',
);

type SP = Promise<Record<string, string | string[] | undefined>>;
const CLASSES = ['all', ...codes.planRefClass.values] as const;
const SCOPES = ['all', ...codes.planScope.values] as const;

export default async function PlansPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [plans, programs, regions] = await Promise.all([getPlans(), getPrograms(), getRegionIndex()]);
  const withPlans = programs.filter((pg) => plans.some((p) => planInProgram(p, pg.id))).sort((a, b) => a.ord - b.ord);
  const programIds = ['all', ...withPlans.map((p) => p.id)];
  const defProgram = withPlans.some((p) => p.id === DEFAULT_PROGRAM) ? DEFAULT_PROGRAM : 'all';
  const program = pickParam(sp.program, programIds, defProgram);
  const cls = pickParam(sp.class, CLASSES, 'all');
  const stage = pickParam(sp.stage, STAGE_FILTERS, 'all') as StageFilter;
  const area = pickParam(sp.area, ['all', ...codes.area.values] as const, 'all');
  const scope = pickParam(sp.scope, SCOPES, 'all');
  const current = { program, class: cls, stage, area, scope };
  const defaults = { program: defProgram, class: 'all', stage: 'all', area: 'all', scope: 'all' };
  const link = (change: Record<string, string | undefined>, hash?: string) =>
    withQuery(paths.plans(), current, change, defaults, hash);
  const f: PlanFilter = { program, cls, stage, area, scope };

  const inProgram = plans.filter((p) => planInProgram(p, program));
  const beforeArea = inProgram.filter((p) => planMatches(p, { ...f, area: 'all' }, areaMatches));
  const shown = beforeArea.filter((p) => areaMatches(p.areas, area)).sort(comparePlans);
  const prog = withPlans.find((p) => p.id === program);

  const groups = (['national_rail', 'metro_network', 'other'] as const)
    .map((g) => ({ g, items: withPlans.filter((p) => programGroupOf(p.kind) === g) }))
    .filter((x) => x.items.length);
  const classTabs = CLASSES.filter((c) => c === 'all' || inProgram.some((p) => planClassMatches(p, program, c))).map(
    (c) => ({
      value: c,
      label: c === 'all' ? '전체' : codeLabel('planRefClass', c),
      count: inProgram.filter((p) => planClassMatches(p, program, c)).length,
      href: link({ class: c }),
    }),
  );
  const stageTabs = STAGE_FILTERS.filter((s) => s === 'all' || inProgram.some((p) => stageGroupOf(p.stage) === s)).map(
    (s) => ({
      value: s,
      label: STAGE_FILTER_LABEL[s],
      count: s === 'all' ? inProgram.length : inProgram.filter((p) => stageGroupOf(p.stage) === s).length,
      href: link({ stage: s }),
    }),
  );
  const areaTabs = areaCounts(beforeArea).map((a) => ({
    ...a,
    label: areaLabel(a.value),
    href: link({ area: a.value }),
  }));
  const scopeTabs = SCOPES.filter((s) => s === 'all' || inProgram.some((p) => p.scope === s)).map((s) => ({
    value: s,
    label: s === 'all' ? '전체' : codeLabel('planScope', s),
    href: link({ scope: s }),
  }));
  const refsIn = (p: (typeof plans)[number]) => p.refs.filter((r) => program === 'all' || r.program_id === program);

  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
      <LegacyAnchors types={['plan_program']} />
      <div className="page-head">
        <h1>계획</h1>
        <p className="lead">
          상위 계획(국토종합계획 → 국가철도망 구축계획 → 도시철도망 구축계획 등)에 실린 철도 사업입니다. 사업마다 현재
          단계와 개통 예정(공식 발표·보도 근거만)을 출처와 함께 봅니다. 계획 체계와 고시 이력은{' '}
          <a href={paths.planPrograms()}>상위 계획</a>, 개통 순서는 <a href={paths.upcoming()}>개통 예정</a>,{' '}
          <a href={paths.futureMap()}>미래 지도</a>.
        </p>
      </div>
      <div className="filters">
        <div className="filter-row">
          <span className="label">차수</span>
          <div style={{ display: 'grid', gap: 'var(--kr-space-2)' }}>
            {groups.map(({ g, items }) => (
              <div key={g} className="prog-group">
                <span className="muted" style={{ fontSize: 'var(--kr-text-xs)', minWidth: '7em' }}>
                  {PROGRAM_GROUP_LABEL[g]}
                </span>
                <LinkTabs
                  small
                  label={PROGRAM_GROUP_LABEL[g]}
                  current={program}
                  items={items.map((p) => ({
                    value: p.id,
                    label: p.short ?? p.name_ko,
                    count: plans.filter((x) => planInProgram(x, p.id)).length,
                    href: link({ program: p.id, class: 'all' }),
                  }))}
                />
              </div>
            ))}
            <LinkTabs
              small
              label="차수 전체"
              current={program}
              items={[
                { value: 'all', label: '모든 계획', count: plans.length, href: link({ program: 'all', class: 'all' }) },
              ]}
            />
          </div>
        </div>
        {classTabs.length > 2 ? (
          <FilterRow label="구분">
            <LinkTabs items={classTabs} current={cls} label="구분" small />
          </FilterRow>
        ) : null}
        <FilterRow label="단계">
          <LinkTabs items={stageTabs} current={stage} label="단계" small />
        </FilterRow>
        <FilterRow label="권역">
          <LinkTabs items={areaTabs} current={area} label="권역" small />
        </FilterRow>
        {scopeTabs.length > 2 ? (
          <FilterRow label="범위">
            <LinkTabs items={scopeTabs} current={scope} label="범위" small />
          </FilterRow>
        ) : null}
      </div>
      {prog ? (
        <p className="note">
          <b>{prog.name_ko}</b>
          {prog.period_from ? ` (${prog.period_from}~${prog.period_to ?? ''})` : ''} ·{' '}
          {codeLabel('planProgramStatus', prog.status)}
          {prog.issuer ? ` · ${prog.issuer}` : ''} — <a href={paths.planProgram(prog.id)}>이 계획의 요지·고시 이력</a>
        </p>
      ) : null}
      <p className="muted num" style={{ fontSize: 'var(--kr-text-sm)' }} aria-live="polite">
        {fmtNum(shown.length)}개 사업
      </p>
      <section id={`program-${program}`} className="section" style={{ marginTop: 'var(--kr-space-3)' }}>
        {shown.length === 0 ? (
          <p className="empty surface">조건에 맞는 사업이 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table className="data cardify">
              <thead>
                <tr>
                  <th scope="col">사업</th>
                  <th scope="col">구분·구간</th>
                  <th scope="col">단계</th>
                  <th scope="col">개통 예정</th>
                  <th scope="col">지역</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const rs = refsIn(p);
                  return (
                    <tr key={p.id}>
                      <td>
                        <a href={paths.plan(p.id)}>{p.name_ko}</a> <ReviewBadge status={p.review_status} />
                        {p.name_full && p.name_full !== p.name_ko ? (
                          <span className="name-sub">{p.name_full}</span>
                        ) : null}
                        {program === 'all' && p.refs.length ? (
                          <span className="name-sub">
                            {[...new Set(p.refs.map((r) => r.program_short ?? r.program_id))].join(' · ')}
                          </span>
                        ) : null}
                      </td>
                      <td data-label="구분·구간" style={{ fontSize: 'var(--kr-text-xs)' }}>
                        {[
                          ...new Set(
                            rs.map((r) => (r.class ? codeLabel('planRefClass', r.class) : null)).filter(Boolean),
                          ),
                        ].join(' · ') || '—'}
                        {rs[0]?.section ? <span className="name-sub">{rs[0].section}</span> : null}
                        {p.scope !== 'line' ? (
                          <span className="name-sub">{codeLabel('planScope', p.scope)}</span>
                        ) : null}
                      </td>
                      <td data-label="단계">
                        <StageBadge stage={p.stage} />
                      </td>
                      <td data-label="개통 예정" className="nowrap">
                        {p.opened ? (
                          <>
                            개통 <FuzzyDateText value={p.opened} />
                          </>
                        ) : (
                          <TargetText target={p.target_open} />
                        )}
                      </td>
                      <td data-label="지역" style={{ fontSize: 'var(--kr-text-xs)' }}>
                        {p.regions.map((r) => regions.byCode.get(r)?.short_ko ?? r).join(', ') ||
                          (p.is_national ? '전국' : '—')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="muted" style={{ fontSize: 'var(--kr-text-xs)', marginTop: 'var(--kr-space-3)' }}>
        구분: 신규 = 계획 기간 안 추진, 추가검토 = 여건 변화 시 추진 검토, 기시행 = 계획 수립 때 이미 시행 중. 개통
        예정은 발표 시점 기준이며 바뀔 수 있습니다. 단계 배지는 색·선 모양·글자를 함께 씁니다.
      </p>
    </div>
  );
}
