/** 운행 계통 상세(P1): 지나는 노선, 정차 패턴 비교표, 운행 시간·배차(기점·종점 역 시간표 요약), 열차번호대, 연혁, 출처 */
import type { Metadata } from 'next';
import { codeLabel, isCode } from '@k-raildex/contracts';
import { FuzzyDateText, LineChip, ReviewBadge, StatusBadge } from '@/components/badges';
import { AttachmentsSection, DetailBand, Fact, PagePanel, Section, SourcesSection, Toc } from '@/components/detail';
import { EventList } from '@/components/events';
import { findStation, getLineIndex, getService } from '@/lib/data';
import { fmtMinute, fmtNum, serviceGroupOf } from '@/lib/format';
import { compareDayType, serviceHoursAt, stopMatrix, type ServiceHours } from '@/lib/patterns';
import { clip, pageMeta } from '@/lib/site';
import { groupSources } from '@/lib/sources';
import { paths, withQuery } from '@/lib/urls';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const s = await getService(id);
  const desc = clip(
    `${s.name_ko} — ${codeLabel('serviceKind', s.kind)}${s.train_class ? ` · ${s.train_class.name_ko}` : ''}. 지나는 노선 ${s.lines.map((l) => l.name_ko).join('·')}. 정차 패턴 비교표·운행 시간·열차번호대와 출처.`,
  );
  return pageMeta(s.name_ko, desc, paths.service(s.id));
}

export default async function ServicePage({ params }: { params: Params }) {
  const { id } = await params;
  const [s, lineIndex] = await Promise.all([getService(id), getLineIndex()]);
  const path = paths.service(s.id);
  const src = groupSources(s.sources, s.id);
  const group = serviceGroupOf(s.kind);
  const rows = stopMatrix(s.stop_patterns);
  const multiLine = new Set(rows.map((r) => r.line_id)).size > 1;
  const longest = [...s.stop_patterns].sort((a, b) => b.stops.length - a.stops.length)[0];
  const ends = longest && longest.stops.length ? [longest.stops[0]!, longest.stops[longest.stops.length - 1]!] : [];
  const endStations = await Promise.all(
    [...new Map(ends.map((e) => [e.station_id, e])).values()].map(async (e) => ({
      e,
      st: await findStation(e.station_id),
    })),
  );
  const hours: ServiceHours[] = endStations
    .flatMap(({ st }) => (st ? serviceHoursAt(st.id, st.name_ko, s.id, st.timetables) : []))
    .filter(
      (h, i, all) =>
        i ===
        all.findIndex((x) => x.station_id === h.station_id && x.day_type === h.day_type && x.direction === h.direction),
    )
    .sort((a, b) => compareDayType(a.day_type, b.day_type) || a.station_name.localeCompare(b.station_name, 'ko'));

  return (
    <>
      <DetailBand
        colors={[s.color]}
        crumbs={[
          { href: paths.services(), label: '운행 계통' },
          {
            href: withQuery(paths.services(), {}, { group }, { group: 'train' }),
            label: group === 'train' ? '열차' : '전철',
          },
          {
            href: withQuery(paths.services(), {}, { group, kind: s.kind }, { group: 'train' }),
            label: codeLabel('serviceKind', s.kind),
          },
          { label: s.name_ko },
        ]}
        title={s.name_ko}
        sub={
          [s.name_en, s.name_full && s.name_full !== s.name_ko ? s.name_full : null, s.name_hanja]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        badges={
          <>
            <StatusBadge status={s.status} />
            <span className="badge outline">{codeLabel('serviceKind', s.kind)}</span>
            {s.train_class ? <span className="badge outline">열차 등급 {s.train_class.name_ko}</span> : null}
            {s.areas.map((a) => (
              <span key={a} className="badge outline">
                {codeLabel('area', a)}
              </span>
            ))}
            <ReviewBadge status={s.review_status} />
          </>
        }
        extra={
          <>
            {s.lines.map((l) => (
              <LineChip key={l.id} line={l} />
            ))}
          </>
        }
        facts={
          <>
            <Fact label="종류">{codeLabel('serviceKind', s.kind)}</Fact>
            <Fact label="열차 등급">
              {s.train_class ? s.train_class.name_ko : <span className="muted">미확인</span>}
            </Fact>
            <Fact label="지나는 노선">
              {fmtNum(s.lines.length)}
              <small>개</small>
            </Fact>
            <Fact label="정차 패턴" note={longest ? `가장 긴 패턴 ${longest.stops.length}역` : undefined}>
              {fmtNum(s.stop_patterns.length)}
              <small>개</small>
            </Fact>
            <Fact label="운행 개시">
              <FuzzyDateText value={s.opened} />
            </Fact>
          </>
        }
      />
      <Toc
        items={[
          { id: 'patterns', label: '정차 패턴', count: rows.length },
          { id: 'hours', label: '운행 시간' },
          { id: 'numbers', label: '열차번호대', count: s.train_number_ranges.length },
          { id: 'history', label: '연혁', count: s.events.length },
          ...(s.attachments.length ? [{ id: 'evidence', label: '근거 자료', count: s.attachments.length }] : []),
          { id: 'sources', label: '출처', count: src.length },
        ]}
      />
      <div className="container two-col">
        <div>
          <Section id="patterns" title="정차 패턴 비교" sub="● 정차 · — 통과">
            {s.stops_assumed ? (
              <p className="note">정차 패턴 자료가 없어 지나는 노선의 모든 역으로 봤습니다(추정).</p>
            ) : null}
            {rows.length === 0 ? (
              <p className="empty surface">정차역 정보가 없습니다(미확인).</p>
            ) : (
              <div className="table-wrap" style={{ maxHeight: '75vh' }}>
                <table className="data matrix">
                  <thead>
                    <tr>
                      <th scope="col">역</th>
                      {multiLine ? <th scope="col">노선</th> : null}
                      {s.stop_patterns.map((p) => (
                        <th key={p.code} scope="col" className="pat" title={p.note ?? undefined}>
                          {p.name_ko}
                          <span className="name-sub">{codeLabel('stopPatternType', p.type)}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const l = lineIndex.get(r.line_id);
                      return (
                        <tr key={r.station_id}>
                          <th
                            scope="row"
                            style={{
                              position: 'static',
                              background: 'transparent',
                              fontWeight: 600,
                              color: 'var(--kr-fg)',
                              fontSize: 'var(--kr-text-sm)',
                            }}
                          >
                            {r.station_code ? (
                              <span className="muted num" style={{ fontSize: 'var(--kr-text-xs)', marginRight: 6 }}>
                                {r.station_code}
                              </span>
                            ) : null}
                            <a href={paths.station(r.station_id)}>{r.name_ko}</a>
                          </th>
                          {multiLine ? (
                            <td style={{ fontSize: 'var(--kr-text-xs)' }}>{l ? <LineChip line={l} /> : r.line_id}</td>
                          ) : null}
                          {s.stop_patterns.map((p) => (
                            <td key={p.code} className={`mark ${r.stops[p.code] ? 'stop' : 'pass'}`}>
                              {r.stops[p.code] ? <span aria-label="정차">●</span> : <span aria-label="통과">—</span>}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section id="hours" title="운행 시간·배차" sub="기점·종점 역 시간표 기준">
            {hours.length === 0 ? (
              <p className="note">이 운행 계통의 시간표 요약이 아직 없습니다.</p>
            ) : (
              <div className="table-wrap">
                <table className="data cardify">
                  <thead>
                    <tr>
                      <th scope="col">요일</th>
                      <th scope="col">역</th>
                      <th scope="col">방면</th>
                      <th scope="col" className="r">
                        첫차
                      </th>
                      <th scope="col" className="r">
                        막차
                      </th>
                      <th scope="col" className="r">
                        편수
                      </th>
                      <th scope="col" className="r">
                        평균 배차
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {hours.map((h) => (
                      <tr key={`${h.station_id}-${h.day_type}-${h.direction}`}>
                        <td>
                          {isCode('dayType', h.day_type) ? codeLabel('dayType', h.day_type) : h.day_type}
                          {h.day_note ? <span className="name-sub">{h.day_note}</span> : null}
                        </td>
                        <td data-label="역">
                          <a href={`${paths.station(h.station_id)}#timetable`}>{h.station_name}</a>
                        </td>
                        <td data-label="방면">
                          {h.direction_label ??
                            (isCode('direction', h.direction) ? codeLabel('direction', h.direction) : h.direction)}
                        </td>
                        <td data-label="첫차" className="r num">
                          {fmtMinute(h.first_minute)}
                        </td>
                        <td data-label="막차" className="r num">
                          {fmtMinute(h.last_minute)}
                        </td>
                        <td data-label="편수" className="r num">
                          {fmtNum(h.count)}
                        </td>
                        <td data-label="평균 배차" className="r num">
                          {h.headway != null ? `약 ${h.headway}분` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted" style={{ fontSize: 'var(--kr-text-xs)' }}>
              평균 배차 = (막차 − 첫차) ÷ (편수 − 1)로 계산한 추정값입니다. 시간대별 편수는 역 페이지의 시간표에서
              봅니다.
            </p>
          </Section>

          <Section id="numbers" title="열차번호대" sub="열차번호는 차량번호·편성번호와 다릅니다">
            {s.train_number_ranges.length === 0 ? (
              <p className="note">이 운행 계통에 연결된 열차번호대가 없습니다.</p>
            ) : (
              <div className="table-wrap">
                <table className="data cardify">
                  <thead>
                    <tr>
                      <th scope="col">번호대</th>
                      <th scope="col">구분</th>
                      <th scope="col">운행 구간</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.train_number_ranges.map((t) => (
                      <tr key={t.id}>
                        <td className="num nowrap">
                          {t.code_prefix ?? ''}
                          {t.range_from}–{t.code_prefix ?? ''}
                          {t.range_to}
                        </td>
                        <td data-label="구분">
                          {isCode('tnrGroup', t.group) ? codeLabel('tnrGroup', t.group) : t.group}
                        </td>
                        <td data-label="운행 구간" style={{ fontSize: 'var(--kr-text-sm)' }}>
                          {t.route_text ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section id="history" title="연혁" sub={s.events.length ? `${s.events.length}건` : undefined}>
            <EventList events={s.events} />
          </Section>

          <section className="section" id="details">
            <details className="more">
              <summary>상세(설명·별칭·출처 메모)</summary>
              <div className="body">
                {s.successor ? (
                  <p style={{ fontSize: 'var(--kr-text-sm)' }}>
                    후속 운행 계통: <a href={paths.service(s.successor.id)}>{s.successor.name_ko}</a>
                  </p>
                ) : null}
                {s.names.length ? (
                  <p style={{ fontSize: 'var(--kr-text-sm)' }}>
                    다른 이름: {s.names.map((n) => `${n.name}(${codeLabel('entityNameKind', n.kind)})`).join(', ')}
                  </p>
                ) : null}
                {s.description ? <p className="prose-text">{s.description}</p> : null}
                {s.meta.provenance_note ? (
                  <p className="prose-text muted" style={{ fontSize: 'var(--kr-text-xs)' }}>
                    출처 메모: {s.meta.provenance_note}
                  </p>
                ) : null}
                <p className="muted" style={{ fontSize: 'var(--kr-text-xs)' }}>
                  식별자 <code>{s.id}</code>
                </p>
              </div>
            </details>
          </section>

          <AttachmentsSection items={s.attachments} />
          <SourcesSection groups={src} title={s.name_ko} path={path} />
        </div>
        <aside className="aside" aria-label="운행 계통 정보">
          <div className="panel">
            <h3>지나는 노선</h3>
            <div className="chips">
              {s.lines.map((l) => (
                <span key={l.id} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  <LineChip line={l} />
                  {l.status !== 'operating' ? <StatusBadge status={l.status} /> : null}
                </span>
              ))}
            </div>
          </div>
          <PagePanel meta={s.meta} id={s.id} />
        </aside>
      </div>
    </>
  );
}
