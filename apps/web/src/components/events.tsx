/** 연혁(v_event_all 기반). 자동 파생(개통·운행 개시 등)은 "파생" 표시. 많으면 앞 6건만 펼치고 나머지는 접힘 */
import { codeLabel, compareFuzzy, type PublicEvent } from '@k-raildex/contracts';
import { FuzzyDateText } from './badges';

function Item({ e }: { e: PublicEvent }) {
  return (
    <li>
      <span className="num">
        <FuzzyDateText value={e.date} />
      </span>
      <span>
        <span className="badge outline" style={{ marginRight: 6 }}>
          {codeLabel('eventType', e.type)}
        </span>
        {e.title}
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
}

export function EventList({ events, open = 6 }: { events: PublicEvent[]; open?: number }) {
  if (events.length === 0) return <p className="note">기록된 연혁이 없습니다.</p>;
  const sorted = [...events].sort((a, b) => compareFuzzy(a.date, b.date));
  const head = sorted.slice(0, open);
  const rest = sorted.slice(open);
  return (
    <div className="surface" style={{ padding: 'var(--kr-space-2) var(--kr-space-4)' }}>
      <ul className="hist">
        {head.map((e) => (
          <Item key={e.id} e={e} />
        ))}
      </ul>
      {rest.length ? (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 'var(--kr-text-sm)', padding: 'var(--kr-space-2) 0' }}>
            나머지 {rest.length}건 보기
          </summary>
          <ul className="hist">
            {rest.map((e) => (
              <Item key={e.id} e={e} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
