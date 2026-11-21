/** 상위 계획(국토종합계획·국가철도망·도시철도망 …) 요지 카드 — 기간·고시 이력·주요 수치·요지(legacy /plans/programs/ 승계) */
import { codeLabel } from '@k-raildex/contracts';
import type { Program } from '@/lib/data';
import { formatFuzzy } from '@/lib/format';
import { paths, withQuery } from '@/lib/urls';

export function ProgramFacts({ p, srcN }: { p: Program; srcN?: (sourceId: string | null) => number | null }) {
  const ref = (sid: string | null) => {
    const n = srcN?.(sid);
    return n ? (
      <sup className="ref">
        <a href={`#src-${n}`}>{n}</a>
      </sup>
    ) : null;
  };
  return (
    <>
      <dl className="kv">
        <dt>종류</dt>
        <dd>{codeLabel('planProgramKind', p.kind)}</dd>
        <dt>상태</dt>
        <dd>{codeLabel('planProgramStatus', p.status)}</dd>
        {p.period_from ? (
          <>
            <dt>계획 기간</dt>
            <dd className="num">
              {p.period_from}~{p.period_to ?? ''}
            </dd>
          </>
        ) : null}
        {p.issuer ? (
          <>
            <dt>수립</dt>
            <dd>{p.issuer}</dd>
          </>
        ) : null}
        {p.legal_basis ? (
          <>
            <dt>법적 근거</dt>
            <dd>{p.legal_basis}</dd>
          </>
        ) : null}
        <dt>실린 사업</dt>
        <dd>
          {p.plan_count > 0 ? (
            <a href={withQuery(paths.plans(), {}, { program: p.id })}>{p.plan_count}건 보기</a>
          ) : (
            <span className="muted">수록 사업 자료 없음</span>
          )}
        </dd>
      </dl>
      {p.summary ? <p className="prose-text">{p.summary}</p> : null}
      {p.points.length ? (
        <ul className="prose-text" style={{ paddingLeft: '1.2em' }}>
          {p.points.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : null}
      {p.figures.length ? (
        <dl className="kv">
          {p.figures.map((f) => (
            <div key={f.label} style={{ display: 'contents' }}>
              <dt>{f.label}</dt>
              <dd>
                {f.value}
                {ref(f.source_id)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {p.notices.length ? (
        <ul className="hist" aria-label="고시 이력">
          {p.notices.map((n, i) => (
            <li key={i}>
              <span className="num">{n.date ? formatFuzzy(n.date) : '날짜 미상'}</span>
              <span>
                <span className="badge outline" style={{ marginRight: 6 }}>
                  {codeLabel('noticeKind', n.kind)}
                </span>
                {n.title ?? '(제목 미확인)'}
                {n.number ? ` (${n.number})` : ''}
                {ref(n.source_id)}
                {n.note ? <span className="name-sub">{n.note}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {p.document_note ? (
        <p className="muted" style={{ fontSize: 'var(--kr-text-xs)' }}>
          원문: {p.document_note}
        </p>
      ) : null}
    </>
  );
}
