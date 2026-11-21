/** 환승센터 상세(P2): 현재 상황(상태·기준일·출처 + 상태 이력) → 개발 계획(차수별 반영) → 연계 역·계획 → 근거 자료 → 출처 */
import type { Metadata } from 'next';
import { codeLabel, isCode } from '@k-raildex/contracts';
import { FuzzyDateText, ReviewBadge, StageBadge, StatusBadge } from '@/components/badges';
import { AttachmentsSection, DetailBand, Fact, PagePanel, Section, SourcesSection, Toc } from '@/components/detail';
import { BreadcrumbLd } from '@/components/json-ld';
import { getProgramIndex, getRegionIndex, getTransferCenter } from '@/lib/data';
import { fmtEok } from '@/lib/format';
import { clip, pageMeta } from '@/lib/site';
import { groupSources } from '@/lib/sources';
import { paths } from '@/lib/urls';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const t = await getTransferCenter(id);
  return pageMeta(
    t.name_ko,
    clip(
      `${t.name_ko} — ${codeLabel('transferCenterKind', t.kind)}, ${codeLabel('transferCenterStatus', t.status)}. 연계 역·계획과 기본계획 반영 내역, 출처.`,
    ),
    paths.transferCenter(t.id),
  );
}

export default async function TransferCenterPage({ params }: { params: Params }) {
  const { id } = await params;
  const [t, programs, regions] = await Promise.all([getTransferCenter(id), getProgramIndex(), getRegionIndex()]);
  const path = paths.transferCenter(t.id);
  const src = groupSources(t.sources, t.id);
  const srcN = (sid: string | null) => (sid ? (src.find((g) => g.source_id === sid)?.n ?? null) : null);
  const latestCost = [...t.plan_refs].reverse().find((r) => r.cost_100m_krw != null)?.cost_100m_krw ?? null;
  const tcClass = (c: string | null) =>
    c && isCode('tcPlanRefClass', c) ? codeLabel('tcPlanRefClass', c) : (c ?? '—');
  const tcStatus = (s: string) => (isCode('transferCenterStatus', s) ? codeLabel('transferCenterStatus', s) : s);
  return (
    <>
      <BreadcrumbLd
        items={[
          { label: '환승센터', path: paths.transferCenters() },
          { label: t.name_ko, path },
        ]}
      />
      <DetailBand
        colors={[null]}
        crumbs={[{ href: paths.transferCenters(), label: '환승센터' }, { label: t.name_ko }]}
        title={t.name_ko}
        sub={[t.name_full, t.name_en].filter(Boolean).join(' · ') || undefined}
        badges={
          <>
            <span className="badge outline">{codeLabel('transferCenterKind', t.kind)}</span>
            <span className="badge outline">{codeLabel('transferCenterStatus', t.status)}</span>
            {t.region_code ? (
              <span className="badge outline">{regions.byCode.get(t.region_code)?.name_ko ?? t.region_code}</span>
            ) : null}
            <ReviewBadge status={t.review_status} />
          </>
        }
        facts={
          <>
            <Fact label="상태" srcN={srcN(t.status_source_id)} note={t.status_as_of ? undefined : '기준일 미확인'}>
              {codeLabel('transferCenterStatus', t.status)}
              {t.status_as_of ? (
                <span className="src">
                  <FuzzyDateText value={t.status_as_of} /> 기준
                </span>
              ) : null}
            </Fact>
            <Fact label="연계 역">
              {t.stations.length}
              <small>곳</small>
            </Fact>
            <Fact label="반영 차수">
              {t.plan_refs.length ? `${new Set(t.plan_refs.map((r) => r.program_id)).size}개 계획` : '—'}
            </Fact>
            <Fact label="총사업비(최신)">
              {latestCost != null ? fmtEok(latestCost) : <span className="muted">미확인</span>}
            </Fact>
          </>
        }
      />
      <Toc
        items={[
          { id: 'status', label: '현재 상황' },
          { id: 'plan-refs', label: '개발 계획', count: t.plan_refs.length },
          { id: 'links', label: '연계', count: t.stations.length + t.plans.length },
          ...(t.attachments.length ? [{ id: 'evidence', label: '근거 자료', count: t.attachments.length }] : []),
          { id: 'sources', label: '출처', count: src.length },
        ]}
      />
      <div className="container two-col">
        <div>
          <Section id="status" title="현재 상황">
            {t.description ? <p className="prose-text">{t.description}</p> : null}
            {t.status_events.length ? (
              <ul className="hist surface" style={{ padding: 'var(--kr-space-2) var(--kr-space-4)' }}>
                {t.status_events.map((e, i) => (
                  <li key={i}>
                    <span className="num">
                      <FuzzyDateText value={e.date} />
                    </span>
                    <span>
                      <span className="badge outline">{tcStatus(e.status)}</span> {e.note}
                      {srcN(e.source_id) ? (
                        <sup className="ref">
                          <a href={`#src-${srcN(e.source_id)}`}>{srcN(e.source_id)}</a>
                        </sup>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="note">상태 변경 이력이 없습니다.</p>
            )}
          </Section>
          <Section id="plan-refs" title="개발 계획(기본계획 반영)">
            {t.plan_refs.length === 0 ? (
              <p className="note">기본계획 반영 기록이 없습니다.</p>
            ) : (
              <div className="table-wrap">
                <table className="data cardify">
                  <thead>
                    <tr>
                      <th scope="col">기본계획</th>
                      <th scope="col">구분</th>
                      <th scope="col">원문 사업명·철도</th>
                      <th scope="col" className="r">
                        총사업비(억 원)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.plan_refs.map((r, i) => (
                      <tr key={i}>
                        <td>
                          <a href={paths.planProgram(r.program_id)}>
                            {programs.get(r.program_id)?.name_ko ?? r.program_id}
                          </a>
                        </td>
                        <td data-label="구분">{tcClass(r.class)}</td>
                        <td data-label="원문 사업명·철도" style={{ fontSize: 'var(--kr-text-sm)' }}>
                          {r.name_raw ?? '—'}
                          {r.rail_now ? <span className="name-sub">철도 현황: {r.rail_now}</span> : null}
                          {r.rail_future ? <span className="name-sub">철도 장래: {r.rail_future}</span> : null}
                          {r.note ? <span className="name-sub">{r.note}</span> : null}
                        </td>
                        <td data-label="총사업비" className="r num">
                          {r.cost_100m_krw != null ? r.cost_100m_krw.toLocaleString('ko-KR') : '—'}
                          {srcN(r.source_id) ? (
                            <sup className="ref">
                              <a
                                href={`#src-${srcN(r.source_id)}`}
                                aria-label={`출처 ${srcN(r.source_id)}${r.page ? `, ${r.page}쪽` : ''}`}
                              >
                                {srcN(r.source_id)}
                              </a>
                            </sup>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          <Section id="links" title="연계 역·계획">
            {t.stations.length ? (
              <div className="surface">
                {t.stations.map((s) => (
                  <div className="svc" key={s.id}>
                    <span className="badge outline">역</span>
                    <a href={paths.station(s.id)}>{s.name_ko}</a>
                    {s.status !== 'operating' ? <StatusBadge status={s.status} /> : <span />}
                  </div>
                ))}
              </div>
            ) : (
              <p className="note">연계 역이 없습니다(미확인).</p>
            )}
            {t.plans.length ? (
              <div className="surface" style={{ marginTop: 'var(--kr-space-3)' }}>
                {t.plans.map((p) => (
                  <div className="svc" key={p.id}>
                    <span className="badge outline">계획</span>
                    <a href={paths.plan(p.id)}>{p.name_ko}</a>
                    <StageBadge stage={p.stage} />
                  </div>
                ))}
              </div>
            ) : null}
          </Section>
          <AttachmentsSection items={t.attachments} />
          <SourcesSection groups={src} title={t.name_ko} path={path} />
        </div>
        <aside className="aside" aria-label="환승센터 정보">
          {t.stations[0] ? (
            <div className="panel">
              <h3>지도</h3>
              <a
                className="btn"
                href={paths.map(`station=${encodeURIComponent(t.stations[0].id)}`)}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                연계 역 지도에서 보기
              </a>
            </div>
          ) : null}
          <PagePanel meta={t.meta} id={t.id} />
        </aside>
      </div>
    </>
  );
}
