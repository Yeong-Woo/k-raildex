/**
 * 계획 상세(P1, docs/06 2절·4-1절): 12칸 단계 진행 띠 → 기대 일정 상자 → 단계 이력 타임라인(출처 배지) → 상위 계획 반영 내역 →
 * 노선·역 → 관련 계획·환승센터 → 연혁 → 근거 자료 → 출처. 옆 패널 "미래 지도에서 보기"(/map/?at=<연도>#plan=<id>).
 */
import type { Metadata } from 'next';
import { codeLabel, compareFuzzy, type FuzzyDate } from '@k-raildex/contracts';
import { STAGE_GROUP } from '@k-raildex/ui/tokens';
import { FuzzyDateText, LineChip, ReviewBadge, StageBadge, StatusBadge, TargetText } from '@/components/badges';
import { AttachmentsSection, DetailBand, Fact, PagePanel, Section, SourcesSection, Toc } from '@/components/detail';
import { EventList } from '@/components/events';
import { BreadcrumbLd } from '@/components/json-ld';
import { ExpectBox, LineStyleLegend, StageStrip, StageTimeline, type TimelineItem } from '@/components/plan';
import { getLineIndex, getPlan, getProgramIndex } from '@/lib/data';
import { areaLabel } from '@/lib/filters';
import { fmtEok, fmtKm, formatFuzzy } from '@/lib/format';
import { stageLabel, stageStrip } from '@/lib/plans';
import { clip, pageMeta } from '@/lib/site';
import { groupSources, sourceNumberFor } from '@/lib/sources';
import { paths, withQuery } from '@/lib/urls';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const p = await getPlan(id);
  const t = p.target_open?.value ? ` 개통 예정 ${formatFuzzy(p.target_open as FuzzyDate)}.` : '';
  const desc = clip(
    `${p.name_ko}${p.name_full && p.name_full !== p.name_ko ? `(${p.name_full})` : ''} — 현재 단계 ${stageLabel(p.stage)}.${t} 단계 이력·기대 일정·상위 계획 반영 내역과 출처.`,
  );
  return pageMeta(p.name_ko, desc, paths.plan(p.id));
}

export default async function PlanPage({ params }: { params: Params }) {
  const { id } = await params;
  const [p, programs, lineIndex] = await Promise.all([getPlan(id), getProgramIndex(), getLineIndex()]);
  const path = paths.plan(p.id);
  const src = groupSources(p.sources, p.id);
  const srcOf = (sid: string | null) => (sid ? (src.find((g) => g.source_id === sid) ?? null) : null);
  const group = p.stage ? STAGE_GROUP[p.stage] : 'early';
  const stopped = p.stage === 'abandoned' || p.stage === 'dormant' ? p.stage : null;
  const cells = stageStrip(p.stage, p.stage_events, p.milestones);

  // 반영 내역: 최신 차수 먼저(상위 계획 ord)
  const refs = [...p.refs].sort(
    (a, b) => (programs.get(b.program_id)?.ord ?? 0) - (programs.get(a.program_id)?.ord ?? 0),
  );
  const latestRef = refs.find((r) => r.length_km != null || r.cost_100m_krw != null) ?? refs[0];
  const firstProgram = refs[0] ? programs.get(refs[0].program_id) : undefined;

  const currentEvent = p.stage
    ? [...p.stage_events]
        .filter((e) => e.stage === p.stage && e.kind === 'reached')
        .sort((a, b) => compareFuzzy(a.date, b.date))[0]
    : undefined;
  const newStations = p.stations.filter((s) => s.role === 'new');

  // 기대 일정 상자: 개통 예정(target_open) + 나머지 기대 일정
  const opening = p.milestones.find((m) => m.stage === 'opened');
  const expected = p.target_open?.value
    ? {
        value: p.target_open.value,
        precision: p.target_open.precision,
        basis: p.target_open.basis,
        as_of: p.target_open.as_of,
        delayed: p.target_open.delayed,
        stage: 'opened' as const,
        note: opening?.note ?? null,
        source: srcOf(p.target_open.source_id),
      }
    : null;
  const otherMilestones = p.milestones.filter((m) => m.stage !== 'opened');

  // 단계 이력(최신순) + 아직 오지 않은 기대 일정(점선)
  const tl: TimelineItem[] = [
    ...p.milestones
      .filter((m) => !p.stage_events.some((e) => e.stage === m.stage && e.kind === 'reached'))
      .map((m, i) => ({
        key: `m-${i}`,
        date: m.expected,
        stage: m.stage,
        title: `${codeLabel('planStage', m.stage)} 예정${m.note ? ` — ${m.note}` : ''}`,
        future: true,
        kindLabel: `기대 일정 · ${codeLabel('milestoneBasis', m.basis)}`,
        source: srcOf(m.source_id),
      })),
    ...p.stage_events.map((e, i) => ({
      key: `e-${i}`,
      date: e.date,
      stage: e.stage,
      title: e.note ?? `${codeLabel('planStage', e.stage)} ${codeLabel('planStageEventKind', e.kind)}`,
      kindLabel: e.kind !== 'reached' ? codeLabel('planStageEventKind', e.kind) : undefined,
      source: srcOf(e.source_id),
    })),
  ].sort((a, b) => (!a.date?.value ? 1 : !b.date?.value ? -1 : compareFuzzy(b.date, a.date)));

  const crumbs = [
    { href: paths.plans(), label: '계획' },
    ...(firstProgram
      ? [{ href: withQuery(paths.plans(), {}, { program: firstProgram.id }), label: firstProgram.name_ko }]
      : []),
    { label: p.name_ko },
  ];
  const mapYear = p.target_open?.value?.slice(0, 4);

  return (
    <>
      <BreadcrumbLd
        items={[
          { label: '계획', path: paths.plans() },
          ...(firstProgram ? [{ label: firstProgram.name_ko, path: `/plans/?program=${firstProgram.id}` }] : []),
          { label: p.name_ko, path },
        ]}
      />
      <DetailBand
        colors={[`var(--kr-stage-${group})`]}
        crumbs={crumbs}
        title={p.name_ko}
        sub={
          [p.name_full && p.name_full !== p.name_ko ? p.name_full : null, p.name_en].filter(Boolean).join(' · ') ||
          undefined
        }
        badges={
          <>
            <StageBadge stage={p.stage} />
            <span className="badge outline">{codeLabel('planScope', p.scope)}</span>
            {p.areas.map((a) => (
              <span key={a} className="badge outline">
                {areaLabel(a)}
              </span>
            ))}
            {refs.length ? (
              <span className="badge outline">
                {[
                  ...new Set(refs.map((r) => r.program_short ?? programs.get(r.program_id)?.short ?? r.program_id)),
                ].join('·')}{' '}
                수록
              </span>
            ) : null}
            {p.target_open?.delayed ? <span className="badge delayed">지연</span> : null}
            <ReviewBadge status={p.review_status} />
          </>
        }
        after={<StageStrip cells={cells} stopped={stopped} />}
        facts={
          <>
            <Fact label="현재 단계" note={currentEvent?.date ? `${formatFuzzy(currentEvent.date)}부터` : undefined}>
              {stageLabel(p.stage)}
            </Fact>
            <Fact
              label={p.opened ? '개통' : '개통 예정'}
              note={
                p.target_open?.basis
                  ? `${codeLabel('milestoneBasis', p.target_open.basis)}${p.target_open.as_of ? ` · ${formatFuzzy(p.target_open.as_of)} 발표` : ''}`
                  : undefined
              }
              srcN={p.target_open?.source_id ? (srcOf(p.target_open.source_id)?.n ?? null) : null}
            >
              {p.opened ? <FuzzyDateText value={p.opened} /> : <TargetText target={p.target_open} />}
            </Fact>
            <Fact label="연장" note={latestRef?.program_short ? `${latestRef.program_short} 표기` : undefined}>
              {latestRef?.length_km != null ? (
                <>
                  {fmtKm(latestRef.length_km)}
                  <small>km</small>
                </>
              ) : (
                <span className="muted">미확인</span>
              )}
            </Fact>
            <Fact
              label="신설 역"
              note={p.stations.length > newStations.length ? `관련 역 ${p.stations.length}개` : undefined}
            >
              {newStations.length}
              <small>개</small>
            </Fact>
            <Fact
              label="사업비"
              note={latestRef?.program_short ? `${latestRef.program_short} 표기` : undefined}
              srcN={sourceNumberFor(src, 'cost_100m_krw')}
            >
              {latestRef?.cost_100m_krw != null ? (
                fmtEok(latestRef.cost_100m_krw)
              ) : (
                <span className="muted">미확인</span>
              )}
            </Fact>
          </>
        }
      />
      <Toc
        items={[
          { id: 'expected', label: '기대 일정' },
          { id: 'stages', label: '단계 이력', count: tl.length },
          { id: 'refs', label: '반영 내역', count: refs.length },
          { id: 'network', label: '노선·역', count: p.lines.length + p.stations.length },
          ...(p.relations.length || p.transfer_centers.length
            ? [{ id: 'related', label: '관련 계획', count: p.relations.length + p.transfer_centers.length }]
            : []),
          { id: 'history', label: '연혁', count: p.events.length },
          ...(p.attachments.length ? [{ id: 'evidence', label: '근거 자료', count: p.attachments.length }] : []),
          { id: 'sources', label: '출처', count: src.length },
        ]}
      />
      <div className="container two-col">
        <div>
          <Section id="expected" title="기대 일정">
            {expected ? (
              <ExpectBox e={expected} />
            ) : p.opened ? (
              <p className="note">
                <FuzzyDateText value={p.opened} /> 개통했습니다.
              </p>
            ) : (
              <p className="note">
                공식 발표·보도로 확인한 개통 예정이 없습니다(목표 미정). 추정 일정은 싣지 않습니다.
              </p>
            )}
            {otherMilestones.length ? (
              <ul className="ulist surface" style={{ marginTop: 'var(--kr-space-3)' }}>
                {otherMilestones.map((m, i) => (
                  <li key={i}>
                    <span>
                      <StageBadge stage={m.stage} /> {codeLabel('planStage', m.stage)} 예정
                      {m.note ? <span className="sub">{m.note}</span> : null}
                    </span>
                    <span className="when num">
                      <FuzzyDateText value={m.expected} /> · {codeLabel('milestoneBasis', m.basis)}
                      {m.source_id && srcOf(m.source_id) ? (
                        <sup className="ref">
                          <a href={`#src-${srcOf(m.source_id)!.n}`}>{srcOf(m.source_id)!.n}</a>
                        </sup>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="muted" style={{ fontSize: 'var(--kr-text-xs)', marginTop: 'var(--kr-space-2)' }}>
              개통 예정은 발표 시점 기준이며 바뀔 수 있습니다.
            </p>
          </Section>

          <Section id="stages" title="단계 이력" sub="날짜·출처가 있는 것만 · 최신순">
            <StageTimeline items={tl} />
          </Section>

          <Section id="refs" title="상위 계획 반영 내역" sub={refs.length ? `${refs.length}건` : undefined}>
            {refs.length === 0 ? (
              <p className="note">상위 계획에 실린 기록이 없습니다.</p>
            ) : (
              <div className="table-wrap">
                <table className="data cardify">
                  <thead>
                    <tr>
                      <th scope="col">상위 계획</th>
                      <th scope="col">구분</th>
                      <th scope="col">구간·내용</th>
                      <th scope="col" className="r">
                        연장
                      </th>
                      <th scope="col" className="r">
                        사업비(억 원)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {refs.map((r, i) => {
                      const sg = srcOf(r.source_id);
                      return (
                        <tr key={`${r.program_id}-${i}`}>
                          <td>
                            <a href={withQuery(paths.plans(), {}, { program: r.program_id })}>{r.program_name_ko}</a>
                            {r.edition ? <span className="name-sub">{r.edition}</span> : null}
                            {r.task_group ? <span className="name-sub">{r.task_group}</span> : null}
                          </td>
                          <td data-label="구분">
                            {r.class ? codeLabel('planRefClass', r.class) : '—'}
                            {r.category ? (
                              <span className="name-sub">{codeLabel('planRefCategory', r.category)}</span>
                            ) : null}
                            {r.timing ? <span className="name-sub">{r.timing}</span> : null}
                          </td>
                          <td data-label="구간·내용">
                            {r.section ?? '—'}
                            {r.content ? <span className="name-sub">{r.content}</span> : null}
                          </td>
                          <td data-label="연장" className="r num nowrap">
                            {r.length_km != null ? `${fmtKm(r.length_km)} km` : '—'}
                          </td>
                          <td data-label="사업비" className="r num nowrap">
                            {r.cost_100m_krw != null ? r.cost_100m_krw.toLocaleString('ko-KR') : '—'}
                            {sg ? (
                              <sup className="ref">
                                <a
                                  href={`#src-${sg.n}`}
                                  aria-label={`출처 ${sg.n}${r.locator ? `, ${r.locator}` : ''}`}
                                >
                                  {sg.n}
                                </a>
                              </sup>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section id="network" title="노선·역" sub={`노선 ${p.lines.length} · 역 ${p.stations.length}`}>
            {p.lines.length ? (
              <div className="surface">
                {p.lines.map((l) => (
                  <div className="svc" key={`${l.line_id}-${l.role}`}>
                    <span className="badge outline">{codeLabel('planLineRole', l.role)}</span>
                    <span>
                      <LineChip line={{ id: l.line_id, name_ko: l.name_ko, color: l.color }} />
                      {l.from_station && l.to_station ? (
                        <span className="name-sub">
                          {l.from_station.name_ko} ~ {l.to_station.name_ko}
                        </span>
                      ) : null}
                      {l.note ? <span className="name-sub">{l.note}</span> : null}
                    </span>
                    <StatusBadge status={l.status} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="note">연결된 노선이 없습니다.</p>
            )}
            {p.stations.length ? (
              <div className="surface stations-new" style={{ marginTop: 'var(--kr-space-3)' }}>
                {p.stations.map((s) => (
                  <span key={`${s.station_id}-${s.role}`}>
                    <a className={s.role === 'new' ? 'stn' : 'stn ex'} href={paths.station(s.station_id)}>
                      {s.name_ko}
                    </a>
                    {s.role !== 'new' ? <small className="muted"> {codeLabel('planStationRole', s.role)}</small> : null}
                  </span>
                ))}
              </div>
            ) : null}
            {p.stations.length ? (
              <p className="muted" style={{ fontSize: 'var(--kr-text-xs)', marginTop: 'var(--kr-space-2)' }}>
                굵은 테두리 = 신설 역, 가는 테두리 = 기존·환승·폐역 예정 역(역할 표기). 순서는 이름순이며 실제 정거장
                순서와 다를 수 있습니다.
              </p>
            ) : null}
          </Section>

          {p.relations.length || p.transfer_centers.length ? (
            <Section id="related" title="관련 계획">
              {p.relations.length ? (
                <ul className="ulist surface">
                  {p.relations.map((r) => (
                    <li key={`${r.plan_id}-${r.relation}-${r.direction}`}>
                      <span>
                        <a href={paths.plan(r.plan_id)}>{r.name_ko}</a>
                        {r.note ? <span className="sub">{r.note}</span> : null}
                      </span>
                      <span className="when">
                        {r.direction === 'in' ? '선행 · ' : ''}
                        {codeLabel('planRelation', r.relation)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {p.transfer_centers.length ? (
                <>
                  <h3 style={{ fontSize: 'var(--kr-text-sm)', margin: 'var(--kr-space-4) 0 var(--kr-space-2)' }}>
                    연계 환승센터
                  </h3>
                  <div className="chips">
                    {p.transfer_centers.map((t) => (
                      <a key={t.id} className="chip" href={paths.transferCenter(t.id)} style={{ paddingLeft: '0.6em' }}>
                        {t.name_ko}
                      </a>
                    ))}
                  </div>
                </>
              ) : null}
            </Section>
          ) : null}

          <Section id="history" title="연혁" sub={p.events.length ? `${p.events.length}건` : undefined}>
            <EventList events={p.events} />
          </Section>

          {p.description || p.operator_text || p.meta.provenance_note ? (
            <section className="section" id="details">
              <details className="more">
                <summary>사업 설명·식별자(상세)</summary>
                <div className="body">
                  {p.description ? <p className="prose-text">{p.description}</p> : null}
                  <dl className="kv">
                    {p.operator_text ? (
                      <>
                        <dt>운영 예정</dt>
                        <dd>{p.operator_text}</dd>
                      </>
                    ) : null}
                    {p.shape ? (
                      <>
                        <dt>지도 선형</dt>
                        <dd>
                          {p.shape.quality}
                          {p.shape.odbl ? ' (© OpenStreetMap 기여자, ODbL)' : ''}
                        </dd>
                      </>
                    ) : null}
                    {p.names.length ? (
                      <>
                        <dt>다른 이름</dt>
                        <dd>{p.names.map((n) => n.name).join(', ')}</dd>
                      </>
                    ) : null}
                    <dt>식별자</dt>
                    <dd>
                      <code>{p.id}</code>
                    </dd>
                  </dl>
                  {p.meta.provenance_note ? (
                    <p className="prose-text muted" style={{ fontSize: 'var(--kr-text-xs)' }}>
                      출처 메모: {p.meta.provenance_note}
                    </p>
                  ) : null}
                </div>
              </details>
            </section>
          ) : null}

          <AttachmentsSection items={p.attachments} />
          <SourcesSection groups={src} title={p.name_ko} path={path} />
        </div>
        <aside className="aside" aria-label="계획 정보">
          <div className="panel">
            <h3>미래 지도</h3>
            <p style={{ margin: '0 0 var(--kr-space-3)', fontSize: 'var(--kr-text-sm)' }}>
              {p.shape
                ? mapYear
                  ? `${mapYear}년 지도에 이 계획을 더해 봅니다.`
                  : '목표 미정 칸에서 이 계획을 봅니다.'
                : '지도에 그릴 선형이 아직 없습니다(위치 미확인).'}
            </p>
            <a className="btn primary" href={p.map_path} style={{ width: '100%', justifyContent: 'center' }}>
              미래 지도에서 보기
            </a>
          </div>
          <div className="panel">
            <h3>선 모양 = 단계</h3>
            <LineStyleLegend />
          </div>
          {p.lines.length ? (
            <div className="panel">
              <h3>관련 노선</h3>
              <div className="chips">
                {p.lines.map((l) => {
                  const ref = lineIndex.get(l.line_id);
                  return (
                    <LineChip
                      key={l.line_id}
                      line={{ id: l.line_id, name_ko: l.name_ko, color: ref?.color ?? l.color }}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}
          <PagePanel meta={p.meta} id={p.id} />
        </aside>
      </div>
    </>
  );
}
