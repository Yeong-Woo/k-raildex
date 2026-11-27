'use client';
/**
 * 역 전체 시간표(클라이언트, NFR-WEB-002: 시간표만 클라이언트 컴포넌트). 누르면 web 의 Route Handler
 * (/api/timetable/<역>/ → 공개 API 중계, FR-WEB-002)에서 받아 시·분 표로 그린다. 요일 설명은 해석 부분만(Q111 A).
 */
import { useState } from 'react';

interface Entry {
  minute: number;
  dest_name: string | null;
  train_no: string | null;
  note: string | null;
}
interface TtSet {
  set_id: string;
  line_id: string | null;
  day_type: string;
  direction: string;
  direction_label: string | null;
  day_note: string | null;
  data_as_of: string | null;
  entries: Entry[];
}

export function TimetableFull({
  url,
  dayLabels,
  directionLabels,
  lineNames,
  lineFilter,
}: {
  url: string;
  /** 노선 탭(Q148): 이 노선 세트만(null = 노선 미정 세트만, undefined = 모두) */
  lineFilter?: string | null;
  dayLabels: Record<string, string>;
  directionLabels: Record<string, string>;
  lineNames: Record<string, string>;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  const [sets, setSets] = useState<TtSet[]>([]);
  const [day, setDay] = useState<string>('weekday');

  async function load() {
    setState('loading');
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { sets: TtSet[] };
      const mine = lineFilter === undefined ? data.sets : data.sets.filter((s) => s.line_id === lineFilter);
      setSets(mine);
      if (mine.length && !mine.some((s) => s.day_type === 'weekday')) setDay(mine[0]!.day_type);
      setState('done');
    } catch {
      setState('error');
    }
  }

  if (state !== 'done')
    return (
      <div className="tt-full">
        <button type="button" className="btn" onClick={load} disabled={state === 'loading'}>
          {state === 'loading' ? '불러오는 중…' : '전체 시각 보기'}
        </button>
        {state === 'error' ? (
          <span className="muted"> 시간표를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.</span>
        ) : null}
        <noscript>
          <span className="muted">
            {' '}
            전체 시각은 자바스크립트가 필요합니다. 위 요약(첫차·막차·시간대별 편수)은 그대로 볼 수 있습니다.
          </span>
        </noscript>
      </div>
    );

  const days = [...new Set(sets.map((s) => s.day_type))];
  const shown = sets.filter((s) => s.day_type === day);
  return (
    <div className="tt-full">
      <div className="seg" role="group" aria-label="요일">
        {days.map((d) => (
          <button key={d} type="button" aria-pressed={d === day} onClick={() => setDay(d)}>
            {dayLabels[d] ?? d}
          </button>
        ))}
      </div>
      {shown.map((s) => {
        const byHour = new Map<number, Entry[]>();
        for (const e of s.entries) {
          const h = Math.floor(e.minute / 60);
          byHour.set(h, [...(byHour.get(h) ?? []), e]);
        }
        return (
          <div className="tt-day" key={s.set_id}>
            <h3>
              {s.line_id ? `${lineNames[s.line_id] ?? s.line_id} · ` : ''}
              {s.direction_label ?? directionLabels[s.direction] ?? s.direction}
              <span className="muted" style={{ fontSize: 'var(--kr-text-xs)', fontWeight: 400 }}>
                {' '}
                {s.entries.length}회{s.day_note ? ` · ${s.day_note}` : ''}
                {s.data_as_of ? ` · 자료 기준 ${s.data_as_of}` : ''}
              </span>
            </h3>
            <div className="tt-grid">
              {[...byHour.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([h, list]) => (
                  <div key={h} style={{ display: 'contents' }}>
                    <span className="h">{String(h).padStart(2, '0')}</span>
                    <span className="m">
                      {list.map((e, i) => (
                        <span
                          key={i}
                          title={[e.dest_name && `${e.dest_name}행`, e.train_no && `열차 ${e.train_no}`, e.note]
                            .filter(Boolean)
                            .join(' · ')}
                        >
                          {String(e.minute % 60).padStart(2, '0')}
                          {e.dest_name ? <small>{e.dest_name}</small> : null}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
