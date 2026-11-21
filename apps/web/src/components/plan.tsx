/**
 * 계획 상세 부품(docs/06 4-1절 "계획 상세"): 12칸 단계 진행 띠, 기대 일정 상자, 단계 이력 타임라인.
 * 색만으로 단계를 전달하지 않는다 — 칸마다 번호·이름·연도, 현재 칸 aria-current="step", 예정 칸은 빗금 + "예정" 글자.
 */
import { codeLabel, type Code, type FuzzyDate } from '@k-raildex/contracts';
import { STAGE_GROUP } from '@k-raildex/ui/tokens';
import { formatFuzzy, fuzzyDateTime } from '@/lib/format';
import type { StripCell } from '@/lib/plans';
import type { SourceGroup } from '@/lib/sources';
import { StageBadge } from './badges';

type Stage = Code<'planStage'>;

export function StageStrip({ cells, stopped }: { cells: StripCell[]; stopped?: Stage | null }) {
  return (
    <div className="track-wrap">
      <ol className="track" aria-label="사업 단계 진행(12단계)">
        {cells.map((c) => (
          <li
            key={c.stage}
            className={c.state}
            aria-current={c.state === 'current' ? 'step' : undefined}
            style={{ ['--g' as string]: `var(--kr-stage-${STAGE_GROUP[c.stage]})` }}
            title={codeLabel('planStage', c.stage)}
          >
            <span className="n">{c.n}</span>
            {c.label}
            {c.year ? <span className="y num">{c.year}</span> : null}
            {c.state === 'current' ? <span className="sr-only"> (현재 단계)</span> : null}
            {c.state === 'done' ? <span className="sr-only"> (지남)</span> : null}
          </li>
        ))}
      </ol>
      {stopped ? (
        <p className="note" style={{ marginTop: 'var(--kr-space-3)' }}>
          이 계획은 <b>{codeLabel('planStage', stopped)}</b> 상태입니다. 띠는 그 전까지 도달한 단계를 보입니다.
        </p>
      ) : null}
    </div>
  );
}

export interface ExpectedSchedule {
  value: string | null;
  precision: FuzzyDate['precision'];
  basis: Code<'milestoneBasis'> | null;
  as_of: FuzzyDate | null;
  delayed: boolean;
  stage: Stage;
  note: string | null;
  source: SourceGroup | null;
}

/** 기대 일정 상자: 큰 날짜 + 근거(공식·보도)·발표 시점·출처 + "바뀔 수 있음"(Q94 A: 공식·보도 근거만) */
export function ExpectBox({ e }: { e: ExpectedSchedule }) {
  const f = { value: e.value, precision: e.precision } as FuzzyDate;
  return (
    <div className="expect" style={{ ['--g' as string]: `var(--kr-stage-${STAGE_GROUP[e.stage]})` }}>
      <div>
        <div className="eyebrow">
          {e.stage === 'opened' ? '개통 예정' : `${codeLabel('planStage', e.stage)} 예정`}
          {e.basis ? ` · ${codeLabel('milestoneBasis', e.basis)}` : ''}
        </div>
        <time className="big" dateTime={fuzzyDateTime(f)}>
          {formatFuzzy(f)}
        </time>
        {e.delayed ? (
          <div>
            <span className="badge delayed">지연 — 목표가 지났지만 미개통</span>
          </div>
        ) : null}
      </div>
      <div style={{ fontSize: 'var(--kr-text-sm)' }}>
        {e.note ? <p style={{ margin: '0 0 var(--kr-space-2)' }}>{e.note}</p> : null}
        <p className="muted" style={{ margin: 0, fontSize: 'var(--kr-text-xs)' }}>
          근거: {e.basis ? codeLabel('milestoneBasis', e.basis) : '미확인'}
          {e.source ? (
            <>
              {' '}
              —{' '}
              <a href={`#src-${e.source.n}`}>
                {e.source.publisher} 「{e.source.title}」
              </a>
            </>
          ) : null}
          {e.as_of ? <> · 발표 시점 {formatFuzzy(e.as_of)}</> : null}
        </p>
      </div>
    </div>
  );
}

export interface TimelineItem {
  key: string;
  date: FuzzyDate | null;
  stage: Stage;
  title: string;
  future?: boolean;
  kindLabel?: string;
  source: SourceGroup | null;
}

/** 단계 이력(날짜·출처가 있는 것만 — 출처 없는 항목은 "출처 미확인") 최신순. 미래 기대 일정은 점선 원 */
export function StageTimeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) return <p className="note">기록된 단계 이력이 없습니다(미확인).</p>;
  return (
    <div className="surface" style={{ padding: 'var(--kr-space-4)' }}>
      <ol className="tl">
        {items.map((it) => (
          <li
            key={it.key}
            className={it.future ? 'future' : undefined}
            style={{ ['--g' as string]: `var(--kr-stage-${STAGE_GROUP[it.stage]})` }}
          >
            <span className="d">
              {it.date ? <time dateTime={fuzzyDateTime(it.date)}>{formatFuzzy(it.date)}</time> : '날짜 미상'}
            </span>
            <div>
              <div className="t">{it.title}</div>
              <div className="s">
                <StageBadge stage={it.stage} />
                {it.kindLabel ? <span>{it.kindLabel}</span> : null}
                {it.source ? (
                  <>
                    <span>
                      출처:{' '}
                      <a href={`#src-${it.source.n}`}>
                        {it.source.publisher}{' '}
                        {it.source.title.length > 40 ? `${it.source.title.slice(0, 39)}…` : it.source.title}
                      </a>
                    </span>
                    <span className="badge outline">{codeLabel('sourceType', it.source.type)}</span>
                  </>
                ) : (
                  <span className="muted">출처 미확인</span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** 선 모양 = 단계 범례(미래 지도와 같은 규칙, FR-WEB-023) */
export function LineStyleLegend() {
  const rows: { dash?: string; w: number; label: string; color: string }[] = [
    { w: 4, label: '공사·시운전 이상(실선)', color: 'var(--kr-stage-build)' },
    { w: 4, dash: '8 5', label: '기본계획~실시설계(굵은 점선)', color: 'var(--kr-stage-design)' },
    { w: 2, dash: '3 3', label: '그 전 단계(가는 점선)', color: 'var(--kr-stage-early)' },
  ];
  return (
    <ul className="legend-lines">
      {rows.map((r) => (
        <li key={r.label}>
          <svg width="36" height="10" aria-hidden="true">
            <line x1="0" y1="5" x2="36" y2="5" stroke={r.color} strokeWidth={r.w} strokeDasharray={r.dash} />
          </svg>
          {r.label}
        </li>
      ))}
    </ul>
  );
}
