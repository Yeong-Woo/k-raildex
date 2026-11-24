/**
 * 연표(P2 `/timeline/`·`/timeline/<연대>s/`, 기존 Q87 B): 연대 목차 → 연도별(최신 연도 먼저) 세로 목록. 항목 id = 사건 id(기존 `#evt-…` 앵커).
 * 유형 필터는 링크(`?type=`). 대상 개체는 id 접두사로 상세 경로를 찾는다.
 */
import { codeLabel, compareFuzzy, type PublicEvent } from '@k-raildex/contracts';
import { FuzzyDateText } from './badges';
import { FilterRow, LinkTabs } from './tabs';
import { idPath, paths } from '@/lib/urls';

export function DecadeNav({
  decades,
  current,
  undated = 0,
}: {
  decades: { decade: number; count: number }[];
  /** 연대(숫자) 또는 'unknown'(연도 미상) */
  current: number | 'unknown';
  /** 날짜 미상 기록 수 — 0 이면 칸을 숨긴다 */
  undated?: number;
}) {
  return (
    <nav aria-label="연대">
      <ul className="tabs small">
        {[...decades]
          .sort((a, b) => b.decade - a.decade)
          .map((d, i) => (
            <li key={d.decade}>
              <a
                href={i === 0 ? paths.timeline() : paths.timelineDecade(d.decade)}
                aria-current={d.decade === current ? 'true' : undefined}
              >
                {d.decade}년대<span className="count">{d.count.toLocaleString('ko-KR')}</span>
              </a>
            </li>
          ))}
        {undated > 0 ? (
          <li>
            <a href={paths.timelineUnknown()} aria-current={current === 'unknown' ? 'true' : undefined}>
              연도 미상<span className="count">{undated.toLocaleString('ko-KR')}</span>
            </a>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

export function TimelineBody({
  events,
  type,
  typeHref,
}: {
  events: PublicEvent[];
  type: string;
  typeHref: (t: string) => string;
}) {
  const types = [...new Set(events.map((e) => e.type))];
  const shown = type === 'all' ? events : events.filter((e) => e.type === type);
  const years = new Map<string, PublicEvent[]>();
  for (const e of [...shown].sort((a, b) => compareFuzzy(a.date, b.date))) {
    const y = e.date?.value?.slice(0, 4) ?? '연도 미상';
    years.set(y, [...(years.get(y) ?? []), e]);
  }
  const ys = [...years.keys()].sort((a, b) => b.localeCompare(a));
  return (
    <>
      <div className="filters">
        <FilterRow label="유형">
          <LinkTabs
            small
            label="유형"
            current={type}
            items={['all', ...types].map((t) => ({
              value: t,
              label: t === 'all' ? '전체' : codeLabel('eventType', t as PublicEvent['type']),
              count: t === 'all' ? events.length : events.filter((e) => e.type === t).length,
              href: typeHref(t),
            }))}
          />
        </FilterRow>
      </div>
      <nav className="chips" aria-label="연도">
        {ys.map((y) => (
          <a key={y} className="chip" href={`#y-${y}`} style={{ paddingLeft: '0.6em' }}>
            {y}
          </a>
        ))}
      </nav>
      {ys.length === 0 ? <p className="empty surface">해당하는 기록이 없습니다.</p> : null}
      {ys.map((y) => (
        <section key={y} id={`y-${y}`} className="section" aria-labelledby={`y-${y}-h`}>
          <div className="section-head">
            <h2 id={`y-${y}-h`}>{y}</h2>
            <span className="muted num">{years.get(y)!.length}건</span>
          </div>
          <ul className="hist surface" style={{ padding: 'var(--kr-space-2) var(--kr-space-4)' }}>
            {years.get(y)!.map((e) => {
              const href = e.targets.map(idPath).find(Boolean);
              return (
                <li key={e.id} id={e.id}>
                  <span className="num">
                    <FuzzyDateText value={e.date} />
                  </span>
                  <span>
                    <span className="badge outline" style={{ marginRight: 6 }}>
                      {codeLabel('eventType', e.type)}
                    </span>
                    {href ? <a href={href}>{e.title}</a> : e.title}
                    {e.derived ? (
                      <span
                        className="muted"
                        style={{ fontSize: 'var(--kr-text-xs)' }}
                        title="개통일 등 다른 값에서 자동으로 만든 항목"
                      >
                        {' '}
                        (파생)
                      </span>
                    ) : null}
                    {e.note ? <span className="name-sub">{e.note}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
