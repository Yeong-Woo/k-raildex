/** 노선 상세(P1): 역 순서(본선·지선·순서 미확인, 구간별 상태), 운행 계통, 연혁, 관련 계획, 제원, 근거 자료, 출처 */
import type { Metadata } from 'next';
import { codeLabel, isCode } from '@k-raildex/contracts';
import {
  FuzzyDateText,
  LineChip,
  LineMark,
  ReviewBadge,
  StageBadge,
  StatusBadge,
  TargetText,
} from '@/components/badges';
import { AttachmentsSection, DetailBand, Fact, PagePanel, Section, SourcesSection, Toc } from '@/components/detail';
import { EventList } from '@/components/events';
import { getLine, getLineIndex, type LineDetail } from '@/lib/data';
import { fmtKm, fmtNum } from '@/lib/format';
import { clip, pageMeta } from '@/lib/site';
import { groupSources, sourceNumberFor } from '@/lib/sources';
import { paths, withQuery } from '@/lib/urls';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const l = await getLine(id);
  const desc = clip(
    `${l.name_ko}${l.name_en ? ` (${l.name_en})` : ''} — ${codeLabel('railClass', l.rail_class)}${l.is_wide_area ? '·광역철도 지정' : ''}, ${codeLabel('status', l.status)}. 역 ${l.stations.length}개${l.length_km ? `, 연장 ${fmtKm(l.length_km)}km` : ''}. 역 순서·운행 계통·연혁·관련 계획과 출처.`,
  );
  return pageMeta(l.name_ko, desc, paths.line(l.id));
}

type Stop = LineDetail['stations'][number];

function groupStops(stops: Stop[]) {
  const main: Stop[] = [];
  const branches = new Map<string, Stop[]>();
  const unconfirmed: Stop[] = [];
  for (const s of [...stops].sort((a, b) => a.seq - b.seq)) {
    if (!s.order_confirmed) unconfirmed.push(s);
    else if (s.branch) branches.set(s.branch, [...(branches.get(s.branch) ?? []), s]);
    else main.push(s);
  }
  return { main, branches: [...branches.entries()], unconfirmed };
}

function RouteList({
  stops,
  color,
  lineIndex,
}: {
  stops: Stop[];
  color: string | null;
  lineIndex: Awaited<ReturnType<typeof getLineIndex>>;
}) {
  return (
    <ol className="route" style={{ ['--line' as string]: color ?? 'var(--kr-border-strong)' }}>
      {stops.map((s) => {
        const xfers = s.transfer_line_ids.map((id) => lineIndex.get(id)).filter((x) => !!x);
        const unopened = s.status === 'planned' || s.status === 'under_construction';
        return (
          <li
            key={`${s.station_id}-${s.seq}`}
            className={xfers.length ? 'xfer' : undefined}
            style={unopened ? { opacity: 0.8 } : undefined}
          >
            <span className="code num">{s.station_code ?? ''}</span>
            <span className="nm">
              <a href={paths.station(s.station_id)}>{s.name_ko}</a>
              {s.name_en ? <small>{s.name_en}</small> : null}
            </span>
            <span className="xs">
              {s.status !== 'operating' ? <StatusBadge status={s.status} /> : null}
              {xfers.map((x) => (
                <LineChip key={x.id} line={x} />
              ))}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default async function LinePage({ params }: { params: Params }) {
  const { id } = await params;
  const [l, lineIndex] = await Promise.all([getLine(id), getLineIndex()]);
  const path = paths.line(l.id);
  const src = groupSources(l.sources, l.id);
  const { main, branches, unconfirmed } = groupStops(l.stations);
  const transfers = [...new Set(l.stations.flatMap((s) => s.transfer_line_ids))]
    .map((x) => lineIndex.get(x))
    .filter((x) => !!x);
  const unopenedCount = l.stations.filter((s) => s.status === 'planned' || s.status === 'under_construction').length;
  const operator = l.operators.find((o) => o.role === 'operator') ?? l.operators[0];
  const track = l.track && isCode('track', l.track) ? codeLabel('track', l.track) : l.track;

  return (
    <>
      <DetailBand
        colors={[l.color]}
        crumbs={[
          { href: paths.lines(), label: '노선' },
          { href: withQuery(paths.lines(), {}, { class: l.rail_class }), label: codeLabel('railClass', l.rail_class) },
          { label: l.name_ko },
        ]}
        mark={<LineMark name={l.name_ko} color={l.color} />}
        title={l.name_ko}
        sub={
          [l.name_en, l.name_full && l.name_full !== l.name_ko ? l.name_full : null, l.name_hanja]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        badges={
          <>
            <StatusBadge status={l.status} />
            <span className="badge outline">{codeLabel('railClass', l.rail_class)}</span>
            <span className="badge outline">{codeLabel('lineCategory', l.category)}</span>
            {l.is_wide_area ? <span className="badge outline">광역철도 지정</span> : null}
            {l.line_role ? <span className="badge outline">{codeLabel('lineRole', l.line_role)}</span> : null}
            {l.branch_of ? (
              <a className="badge outline" href={paths.line(l.branch_of.id)} data-testid="line-branch-of">
                {l.branch_of.name_ko} 지선
              </a>
            ) : null}
            {!l.passenger_service ? <span className="badge outline">여객 미취급</span> : null}
            {l.region_names.length ? (
              <span className="badge outline badge-long">{l.region_names.map((r) => r.name_ko).join(' · ')}</span>
            ) : null}
            <ReviewBadge status={l.review_status} />
          </>
        }
        facts={
          <>
            <Fact label="연장" srcN={sourceNumberFor(src, 'length_km')}>
              {l.length_km != null ? (
                <>
                  {fmtKm(l.length_km)}
                  <small>km</small>
                </>
              ) : (
                <span className="muted">미확인</span>
              )}
            </Fact>
            <Fact
              label="역"
              note={`본선 ${main.length}${branches.length ? ` · 지선 ${branches.reduce((n, [, s]) => n + s.length, 0)}` : ''}${unconfirmed.length ? ` · 순서 미확인 ${unconfirmed.length}` : ''}`}
            >
              {fmtNum(l.stations.length)}
              <small>개</small>
            </Fact>
            <Fact
              label="개통"
              srcN={sourceNumberFor(src, 'opened')}
              note={
                l.target_open ? (
                  <>
                    개통 목표 <FuzzyDateText value={l.target_open} />
                  </>
                ) : undefined
              }
            >
              <FuzzyDateText value={l.opened} withDday />
            </Fact>
            <Fact label="운영기관" note={l.operators.length > 1 ? `외 ${l.operators.length - 1}곳` : undefined}>
              {operator ? operator.name_ko : <span className="muted">미확인</span>}
            </Fact>
            <Fact label="구간">
              {l.start_station && l.end_station ? (
                <>
                  <a href={paths.station(l.start_station.id)}>{l.start_station.name_ko}</a>
                  {' – '}
                  <a href={paths.station(l.end_station.id)}>{l.end_station.name_ko}</a>
                </>
              ) : (
                <span className="muted">미확인</span>
              )}
            </Fact>
            <Fact label="공식 색" srcN={sourceNumberFor(src, 'color')}>
              {l.color ? (
                <>
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-block',
                      width: 12,
                      height: 12,
                      borderRadius: 3,
                      background: l.color,
                      marginRight: 6,
                      verticalAlign: -1,
                    }}
                  />
                  {l.color}
                </>
              ) : (
                <span className="muted">없음</span>
              )}
            </Fact>
          </>
        }
      />
      <Toc
        items={[
          { id: 'stations', label: '역 순서', count: l.stations.length },
          { id: 'services', label: '운행 계통', count: l.services.length },
          ...(l.branches.length ? [{ id: 'branches', label: '지선', count: l.branches.length }] : []),
          { id: 'history', label: '연혁', count: l.events.length },
          { id: 'plans', label: '관련 계획', count: l.plans.length },
          { id: 'specs', label: '제원' },
          ...(l.attachments.length ? [{ id: 'evidence', label: '근거 자료', count: l.attachments.length }] : []),
          { id: 'sources', label: '출처', count: src.length },
        ]}
      />
      <div className="container two-col">
        <div>
          <Section
            id="stations"
            title="역 순서"
            sub={
              main.length
                ? `${main[0]!.name_ko} → ${main[main.length - 1]!.name_ko}${main.some((s) => s.station_code) ? ` · 역번호 ${main.find((s) => s.station_code)?.station_code}~` : ''}`
                : undefined
            }
          >
            {unopenedCount > 0 && l.status === 'operating' ? (
              <p className="note">
                이 노선에는 아직 개통하지 않은 역이 {unopenedCount}개 있습니다(공사 중·계획 구간 포함).
              </p>
            ) : null}
            {l.stations.length === 0 ? (
              <p className="empty surface">역 순서가 아직 없습니다(미확인).</p>
            ) : (
              <div className="surface" style={{ padding: 'var(--kr-space-2) var(--kr-space-4)' }}>
                {main.length ? (
                  <>
                    <div className="branch-head">
                      본선 <span className="badge outline">{main.length}개 역</span>
                    </div>
                    <RouteList stops={main} color={l.color} lineIndex={lineIndex} />
                  </>
                ) : null}
                {branches.map(([name, stops]) => (
                  <div key={name}>
                    <div className="branch-head">
                      지선 {name} <span className="badge outline">{stops.length}개 역</span>
                    </div>
                    <RouteList stops={stops} color={l.color} lineIndex={lineIndex} />
                  </div>
                ))}
                {unconfirmed.length ? (
                  <div>
                    <div className="branch-head">
                      순서 미확인 <span className="badge outline">{unconfirmed.length}개 역</span>
                    </div>
                    <RouteList stops={unconfirmed} color={null} lineIndex={lineIndex} />
                  </div>
                ) : null}
                <div className="legend-row" style={{ margin: '0 calc(-1 * var(--kr-space-4))' }}>
                  <span>○ 역</span>
                  <span>◯ 굵은 원 = 환승역</span>
                  <span>왼쪽 숫자 = 노선별 역번호</span>
                  <span>미개통 역은 상태 배지</span>
                </div>
              </div>
            )}
          </Section>

          <Section id="services" title="이 노선을 지나는 운행 계통">
            {l.services.length === 0 ? (
              <p className="note">연결된 운행 계통이 없습니다.</p>
            ) : (
              <div className="surface">
                {l.services.map((s) => (
                  <div className="svc" key={s.id}>
                    <span className="badge outline">
                      {isCode('serviceKind', s.kind) ? codeLabel('serviceKind', s.kind) : s.kind}
                    </span>
                    <a href={paths.service(s.id)}>{s.name_ko}</a>
                    {s.status !== 'operating' ? <StatusBadge status={s.status} /> : <span />}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {l.branches.length ? (
            <Section id="branches" title="지선" sub={`${l.branches.length}개 · 국토교통부 고시 노선번호 기준`}>
              <div className="chips" data-testid="line-branches">
                {l.branches.map((b) => (
                  <a key={b.id} className="chip" href={paths.line(b.id)} style={{ paddingLeft: '0.6em' }}>
                    {b.name_ko}
                    {b.line_role ? <span className="muted"> · {codeLabel('lineRole', b.line_role)}</span> : null}
                    {b.status !== 'operating' ? <StatusBadge status={b.status} /> : null}
                  </a>
                ))}
              </div>
            </Section>
          ) : null}

          {l.child_lines.length ? (
            <Section id="children" title="하위 노선">
              <div className="chips">
                {l.child_lines.map((c) => (
                  <a key={c.id} className="chip" href={paths.line(c.id)} style={{ paddingLeft: '0.6em' }}>
                    {c.name_ko} <StatusBadge status={c.status} />
                  </a>
                ))}
              </div>
            </Section>
          ) : null}

          <Section id="history" title="연혁" sub={l.events.length ? `${l.events.length}건` : undefined}>
            <EventList events={l.events} />
          </Section>

          <Section id="plans" title="관련 계획">
            {l.plans.length === 0 ? (
              <p className="note">이 노선과 연결된 계획 사업이 없습니다.</p>
            ) : (
              <div className="table-wrap">
                <table className="data cardify">
                  <thead>
                    <tr>
                      <th scope="col">계획</th>
                      <th scope="col">역할</th>
                      <th scope="col">단계</th>
                      <th scope="col" className="r">
                        개통 예정
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {l.plans.map((p) => (
                      <tr key={p.plan_id}>
                        <td>
                          <a href={paths.plan(p.plan_id)}>{p.name_ko}</a>
                        </td>
                        <td data-label="역할">
                          {isCode('planLineRole', p.role) ? codeLabel('planLineRole', p.role) : p.role}
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
            )}
          </Section>

          <section className="section" id="specs">
            <details className="more">
              <summary>제원·식별자(상세)</summary>
              <div className="body">
                <dl className="kv">
                  <dt>노선번호</dt>
                  <dd>
                    {l.line_no ?? '미확인'}
                    {l.line_no ? <span className="muted"> (국토교통부 고시)</span> : null}
                  </dd>
                  <dt>선로</dt>
                  <dd>{track ?? '미확인'}</dd>
                  <dt>전철화</dt>
                  <dd>{l.electrification ?? '미확인'}</dd>
                  <dt>궤간</dt>
                  <dd>{l.gauge_mm != null ? `${fmtNum(l.gauge_mm)}mm` : '미확인'}</dd>
                  <dt>설계 속도</dt>
                  <dd>{l.design_speed_kmh != null ? `${fmtNum(l.design_speed_kmh)}km/h` : '미확인'}</dd>
                  <dt>소유</dt>
                  <dd>{l.owner ?? '미확인'}</dd>
                  <dt>운영기관</dt>
                  <dd>
                    {l.operators.length
                      ? l.operators
                          .map((o) => `${o.name_ko}${o.role && o.role !== 'operator' ? `(${o.role})` : ''}`)
                          .join(', ')
                      : '미확인'}
                  </dd>
                  {l.wide_area_note ? (
                    <>
                      <dt>광역철도 지정</dt>
                      <dd>{l.wide_area_note}</dd>
                    </>
                  ) : null}
                  {l.names.length ? (
                    <>
                      <dt>다른 이름</dt>
                      <dd>{l.names.map((n) => `${n.name}(${codeLabel('entityNameKind', n.kind)})`).join(', ')}</dd>
                    </>
                  ) : null}
                  <dt>식별자</dt>
                  <dd>
                    <code>{l.id}</code>
                  </dd>
                </dl>
                {l.description ? <p className="prose-text">{l.description}</p> : null}
                {l.meta.provenance_note ? (
                  <p className="prose-text muted" style={{ fontSize: 'var(--kr-text-xs)' }}>
                    출처 메모: {l.meta.provenance_note}
                  </p>
                ) : null}
              </div>
            </details>
          </section>

          <AttachmentsSection items={l.attachments} />
          <SourcesSection groups={src} title={l.name_ko} path={path} />
        </div>
        <aside className="aside" aria-label="노선 정보">
          <div className="panel">
            <h3>지도</h3>
            <a
              className="btn"
              href={paths.map(`line=${encodeURIComponent(l.id)}`)}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              지도에서 보기
            </a>
          </div>
          {transfers.length ? (
            <div className="panel">
              <h3>환승 노선</h3>
              <div className="chips">
                {transfers.map((t) => (
                  <LineChip key={t.id} line={t} />
                ))}
              </div>
            </div>
          ) : null}
          <PagePanel meta={l.meta} id={l.id} />
        </aside>
      </div>
    </>
  );
}
