/** 역 상세(P1): 노선별 절(이름·역번호·개통일·운영기관·이웃 역), 정차 운행 계통, 시간표, 관련 계획·환승센터, 연혁, 근거 자료, 출처 */
import type { Metadata } from 'next';
import { codeLabel, codes, isCode } from '@k-raildex/contracts';
import { FuzzyDateText, LineChip, ReviewBadge, StageBadge, StatusBadge, TargetText } from '@/components/badges';
import { AttachmentsSection, DetailBand, PagePanel, Section, SourcesSection, Toc } from '@/components/detail';
import { EventList } from '@/components/events';
import { TimetableFull } from '@/components/timetable-full';
import { getLineIndex, getStation, type StationDetail } from '@/lib/data';
import { fmtKm, fmtMinute, serviceGroupOf, STOP_CLASS_LABEL, stopClassesOf } from '@/lib/format';
import { compareDayType } from '@/lib/patterns';
import { clip, pageMeta } from '@/lib/site';
import { groupSources } from '@/lib/sources';
import { firstParam, paths } from '@/lib/urls';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const s = await getStation(id);
  const lines = s.lines.map((l) => l.line_name_ko).join('·');
  const desc = clip(
    `${s.name_ko}역${s.name_en ? ` (${s.name_en})` : ''}${s.region ? ` — ${s.region.name_ko}` : ''}. ${lines ? `${lines}. ` : ''}노선별 역번호·이웃 역, 정차 운행 계통, 시간표, 관련 계획과 출처.`,
  );
  return pageMeta(`${s.name_ko}역`, desc, paths.station(s.id));
}

type Tt = StationDetail['timetables'][number];

const labels = (d: { labels: Record<string, { ko: string }> }) =>
  Object.fromEntries(Object.entries(d.labels).map(([k, v]) => [k, v.ko]));

function Bars({ by, color }: { by: number[]; color: string }) {
  const max = Math.max(1, ...by);
  return (
    <>
      <div className="bars" style={{ ['--c' as string]: color }} aria-hidden="true">
        {by.map((n, h) => (
          <span key={h} style={{ height: `${(n / max) * 100}%`, opacity: n ? 0.85 : 0.15 }} title={`${h}시 ${n}회`} />
        ))}
      </div>
      <div className="axis" aria-hidden="true">
        <span>0시</span>
        <span>6</span>
        <span>12</span>
        <span>18</span>
        <span>23시</span>
      </div>
    </>
  );
}

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function StationPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // 기존 요일 탭 링크(`?day=saturday#tt-saturday`)는 그 요일을 펼친다
  const daySel = firstParam(sp.day);
  const [s, lineIndex] = await Promise.all([getStation(id), getLineIndex()]);
  const path = paths.station(s.id);
  const src = groupSources(s.sources, s.id);
  const classes = stopClassesOf(
    s.services.map((x) => x.kind),
    s.line_classes,
  );
  const fromServices = s.services.length > 0;
  const trains = s.services.filter((x) => serviceGroupOf(x.kind) === 'train');
  const metros = s.services.filter((x) => serviceGroupOf(x.kind) === 'metro');
  const dayTypes = [...new Set(s.timetables.map((t) => t.day_type))].sort(compareDayType);
  const lineColor = (lid: string | null) => (lid ? (lineIndex.get(lid)?.color ?? null) : null);
  const asOf = [...new Set(s.timetables.map((t) => t.data_as_of).filter(Boolean))];

  return (
    <>
      <DetailBand
        colors={s.lines.map((l) => l.line_color)}
        crumbs={[
          { href: paths.stations(), label: '역' },
          ...(s.region ? [{ href: paths.stationRegion(s.region.slug), label: s.region.name_ko }] : []),
          { label: s.name_ko },
        ]}
        title={`${s.name_ko}역`}
        sub={
          [s.name_en, s.name_hanja, s.name_full && s.name_full !== s.name_ko ? s.name_full : null, s.address]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        badges={
          <>
            <StatusBadge status={s.status} />
            {s.kind !== 'station' ? <span className="badge outline">{codeLabel('stationKind', s.kind)}</span> : null}
            {classes.map((c) => (
              <span
                key={c}
                className="badge outline"
                title={fromServices ? '정차 운행 계통 기준' : '정차 정보가 없어 노선 분류 기준'}
              >
                {STOP_CLASS_LABEL[c]}
                {fromServices ? '' : ' (노선 기준)'}
              </span>
            ))}
            {s.grade ? <span className="badge outline">역 등급 {s.grade}</span> : null}
            {s.target_open ? (
              <span className="badge outline">
                개통 목표 <FuzzyDateText value={s.target_open} withDday />
              </span>
            ) : null}
            <ReviewBadge status={s.review_status} />
          </>
        }
        extra={
          s.lines.length ? (
            <>
              {s.lines.map((l) => (
                <LineChip key={l.line_id} line={{ id: l.line_id, name_ko: l.line_name_ko, color: l.line_color }} />
              ))}
            </>
          ) : undefined
        }
      />
      <Toc
        items={[
          ...(s.depot ? [{ id: 'depot', label: '차량기지' }] : []),
          { id: 'lines', label: '노선별', count: s.lines.length },
          { id: 'services', label: '정차 열차', count: s.services.length },
          { id: 'timetable', label: '시간표' },
          { id: 'plans', label: '관련 계획', count: s.plans.length + s.transfer_centers.length },
          { id: 'history', label: '연혁', count: s.events.length },
          ...(s.attachments.length ? [{ id: 'evidence', label: '근거 자료', count: s.attachments.length }] : []),
          { id: 'sources', label: '출처', count: src.length },
        ]}
      />
      <div className="container two-col">
        <div>
          {s.depot ? (
            <Section id="depot" title="차량기지">
              <dl className="kv" data-testid="depot-section">
                <dt>기능</dt>
                <dd>
                  {s.depot.functions.length
                    ? s.depot.functions.map((f) => codeLabel('depotFunction', f)).join(' · ')
                    : '미확인'}
                </dd>
                <dt>운영기관</dt>
                <dd>{s.depot.operator?.name_ko ?? '미확인'}</dd>
                <dt>담당 노선</dt>
                <dd>
                  {s.depot.served_lines.length ? (
                    <span className="chips">
                      {s.depot.served_lines.map((l) => (
                        <LineChip key={l.id} line={l} />
                      ))}
                    </span>
                  ) : (
                    '미확인'
                  )}
                </dd>
                <dt>붙은 선로</dt>
                <dd>
                  {s.depot.connecting_lines.length
                    ? s.depot.connecting_lines.map((l, i) => (
                        <span key={l.id}>
                          {i ? ', ' : ''}
                          <a href={paths.line(l.id)}>{l.name_ko}</a>
                        </span>
                      ))
                    : '미확인'}
                </dd>
                {s.depot.opened ? (
                  <>
                    <dt>개통</dt>
                    <dd>
                      <FuzzyDateText value={s.depot.opened} />
                    </dd>
                  </>
                ) : null}
              </dl>
            </Section>
          ) : null}
          <Section id="lines" title="노선별" sub="노선마다 역 이름·역번호·이웃 역·운영기관이 다릅니다">
            {s.lines.length === 0 ? (
              <p className="note">연결된 노선이 없습니다(미확인).</p>
            ) : (
              <div className="lines-grid">
                {s.lines.map((l) => (
                  <article
                    key={`${l.line_id}-${l.seq}`}
                    className={`lcard${l.line_color ? '' : ' nocolor'}`}
                    style={{ ['--c' as string]: l.line_color ?? undefined }}
                  >
                    <div className="top">
                      <LineChip line={{ id: l.line_id, name_ko: l.line_name_ko, color: l.line_color }} short />
                      <b>
                        <a href={paths.line(l.line_id)} style={{ color: 'inherit', textDecoration: 'none' }}>
                          {l.line_name_ko}
                        </a>
                      </b>
                      <span className="code" title="역번호">
                        {l.station_code ?? '—'}
                      </span>
                    </div>
                    <div className="nb">
                      <span className="prev">
                        {l.prev.length ? (
                          l.prev.map((p, i) => (
                            <span key={p.id}>
                              {i ? ' · ' : ''}
                              <a href={paths.station(p.id)}>‹ {p.name_ko}</a>
                            </span>
                          ))
                        ) : (
                          <span className="none">시점</span>
                        )}
                      </span>
                      <span className="here">{l.name_ko}</span>
                      <span>
                        {l.next.length ? (
                          l.next.map((p, i) => (
                            <span key={p.id}>
                              {i ? ' · ' : ''}
                              <a href={paths.station(p.id)}>{p.name_ko} ›</a>
                            </span>
                          ))
                        ) : (
                          <span className="none">종점</span>
                        )}
                      </span>
                    </div>
                    <dl className="kv">
                      {l.name_ko !== s.name_ko || (l.name_en && l.name_en !== s.name_en) ? (
                        <>
                          <dt>이 노선 역명</dt>
                          <dd>
                            {l.name_ko}
                            {l.name_en ? ` (${l.name_en})` : ''}
                          </dd>
                        </>
                      ) : null}
                      <dt>운영기관</dt>
                      <dd>{l.operator?.name_ko ?? '미확인'}</dd>
                      <dt>상태</dt>
                      <dd>
                        <StatusBadge status={l.status} />
                      </dd>
                      <dt>개통</dt>
                      <dd>
                        <FuzzyDateText value={l.opened} />
                        {l.closed ? (
                          <>
                            {' · 폐지 '}
                            <FuzzyDateText value={l.closed} />
                          </>
                        ) : null}
                      </dd>
                      {l.km != null ? (
                        <>
                          <dt>거리</dt>
                          <dd className="num">{fmtKm(l.km)} km</dd>
                        </>
                      ) : null}
                      {l.branch ? (
                        <>
                          <dt>지선</dt>
                          <dd>{l.branch}</dd>
                        </>
                      ) : null}
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </Section>

          <Section id="services" title="정차하는 운행 계통">
            {s.services.length === 0 ? (
              <p className="note">정차 정보가 없습니다(미확인).</p>
            ) : (
              <div className="surface">
                {[
                  { label: '열차', list: trains },
                  { label: '전철', list: metros },
                ]
                  .filter((g) => g.list.length)
                  .map((g) => (
                    <div className="svc" key={g.label} style={{ gridTemplateColumns: '3rem 1fr' }}>
                      <b>{g.label}</b>
                      <span className="chips" style={{ gap: '4px 12px' }}>
                        {g.list.map((x) => (
                          <span key={x.id}>
                            <a href={paths.service(x.id)}>{x.name_ko}</a>
                            <span className="muted" style={{ fontSize: 'var(--kr-text-xs)' }}>
                              {' '}
                              {isCode('serviceKind', x.kind) ? codeLabel('serviceKind', x.kind) : x.kind}
                              {x.assumed ? ' · 노선 기준 추정' : ''}
                            </span>
                          </span>
                        ))}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </Section>

          <Section id="timetable" title="시간표 요약" sub={asOf.length ? `자료 기준 ${asOf.join(', ')}` : undefined}>
            {s.timetables.length === 0 ? (
              <p className="note">수집된 시간표가 없습니다.</p>
            ) : (
              <div className="surface">
                {dayTypes.map((d, i) => (
                  <details
                    key={d}
                    id={`tt-${d}`}
                    className="tt-dayblock"
                    open={daySel && (dayTypes as string[]).includes(daySel) ? d === daySel : i === 0}
                  >
                    <summary
                      className="branch-head"
                      style={{ padding: 'var(--kr-space-2) var(--kr-space-4)', margin: 0, cursor: 'pointer' }}
                    >
                      {codeLabel('dayType', d)}{' '}
                      <span className="badge outline">
                        {s.timetables.filter((t: Tt) => t.day_type === d).length}개 방면
                      </span>
                    </summary>
                    {s.timetables
                      .filter((t: Tt) => t.day_type === d)
                      .map((t: Tt) => {
                        const l = t.line_id ? lineIndex.get(t.line_id) : undefined;
                        return (
                          <div className="tt" key={t.set_id}>
                            <div>
                              {l ? <LineChip line={l} /> : null}{' '}
                              <b>{t.direction_label ?? codeLabel('direction', t.direction)}</b>
                              {t.day_note ? <span className="name-sub">{t.day_note}</span> : null}
                            </div>
                            <div className="num" style={{ fontSize: 'var(--kr-text-sm)' }}>
                              첫차 {fmtMinute(t.first_minute)} · 막차 {fmtMinute(t.last_minute)} · <b>{t.count}회</b>
                            </div>
                            <Bars by={t.by_hour} color={lineColor(t.line_id) ?? 'var(--kr-accent)'} />
                          </div>
                        );
                      })}
                  </details>
                ))}
                <TimetableFull
                  url={paths.timetableJson(s.id)}
                  dayLabels={labels(codes.dayType)}
                  directionLabels={labels(codes.direction)}
                  lineNames={Object.fromEntries(s.lines.map((l) => [l.line_id, l.line_name_ko]))}
                />
              </div>
            )}
          </Section>

          <Section id="plans" title="관련 계획">
            {s.plans.length === 0 && s.transfer_centers.length === 0 ? (
              <p className="note">이 역과 연결된 계획 사업이 없습니다.</p>
            ) : null}
            {s.plans.length ? (
              <div className="table-wrap">
                <table className="data cardify">
                  <thead>
                    <tr>
                      <th scope="col">계획</th>
                      <th scope="col">이 역에서</th>
                      <th scope="col">단계</th>
                      <th scope="col" className="r">
                        개통 예정
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.plans.map((p) => (
                      <tr key={p.plan_id}>
                        <td>
                          <a href={paths.plan(p.plan_id)}>{p.name_ko}</a>
                        </td>
                        <td data-label="이 역에서">
                          {isCode('planStationRole', p.role) ? codeLabel('planStationRole', p.role) : p.role}
                        </td>
                        <td data-label="단계">
                          <StageBadge stage={p.stage} />
                        </td>
                        <td data-label="개통 예정" className="r">
                          <TargetText target={p.target_open} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {s.transfer_centers.length ? (
              <div className="surface" style={{ marginTop: 'var(--kr-space-3)' }}>
                {s.transfer_centers.map((t) => (
                  <div className="svc" key={t.id}>
                    <span className="badge outline">환승센터</span>
                    <a href={paths.transferCenter(t.id)}>{t.name_ko}</a>
                    <span className="muted" style={{ fontSize: 'var(--kr-text-xs)' }}>
                      {isCode('transferCenterStatus', t.status)
                        ? codeLabel('transferCenterStatus', t.status)
                        : t.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </Section>

          <Section id="history" title="연혁" sub={s.events.length ? `${s.events.length}건` : undefined}>
            <EventList events={s.events} />
            {s.history_text ? (
              <details className="more" style={{ marginTop: 'var(--kr-space-3)' }}>
                <summary>기관 연혁(원문)</summary>
                <div className="body prose-text">{s.history_text}</div>
              </details>
            ) : null}
          </Section>

          {s.intro_text || s.names.length || s.meta.provenance_note ? (
            <section className="section" id="details">
              <details className="more">
                <summary>상세(별칭·소개·출처 메모)</summary>
                <div className="body">
                  {s.names.length ? (
                    <p style={{ fontSize: 'var(--kr-text-sm)' }}>
                      다른 이름: {s.names.map((n) => `${n.name}(${codeLabel('entityNameKind', n.kind)})`).join(', ')}
                    </p>
                  ) : null}
                  {s.intro_text ? <p className="prose-text">{s.intro_text}</p> : null}
                  {s.meta.provenance_note ? (
                    <p className="prose-text muted" style={{ fontSize: 'var(--kr-text-xs)' }}>
                      출처 메모: {s.meta.provenance_note}
                    </p>
                  ) : null}
                </div>
              </details>
            </section>
          ) : null}

          <AttachmentsSection items={s.attachments} />
          <SourcesSection groups={src} title={`${s.name_ko}역`} path={path} />
        </div>
        <aside className="aside" aria-label="역 정보">
          <div className="panel">
            <h3>위치</h3>
            {s.coord ? (
              <dl className="kv">
                <dt>좌표</dt>
                <dd className="num" style={s.approximate ? { color: 'var(--kr-fg-subtle)' } : undefined}>
                  {s.coord.lat.toFixed(5)}, {s.coord.lng.toFixed(5)}
                </dd>
                {s.approximate ? (
                  <>
                    <dt>정밀도</dt>
                    <dd>
                      <span className="badge outline">근사 좌표</span>
                      {s.coord_basis && isCode('coordBasis', s.coord_basis) ? (
                        <span className="name-sub">{codeLabel('coordBasis', s.coord_basis)} 기준</span>
                      ) : null}
                    </dd>
                  </>
                ) : null}
                {s.coord_source && isCode('coordSource', s.coord_source) ? (
                  <>
                    <dt>좌표 출처</dt>
                    <dd>{codeLabel('coordSource', s.coord_source)}</dd>
                  </>
                ) : null}
              </dl>
            ) : (
              <p className="muted" style={{ fontSize: 'var(--kr-text-sm)' }}>
                좌표 미확인
              </p>
            )}
            <a
              className="btn"
              href={paths.map(`station=${encodeURIComponent(s.id)}`)}
              style={{ width: '100%', justifyContent: 'center', marginTop: 'var(--kr-space-3)' }}
            >
              지도에서 보기
            </a>
          </div>
          {s.region ? (
            <div className="panel">
              <h3>지역</h3>
              <a href={paths.stationRegion(s.region.slug)}>{s.region.name_ko}의 역</a>
            </div>
          ) : null}
          <PagePanel meta={s.meta} id={s.id} />
        </aside>
      </div>
    </>
  );
}
