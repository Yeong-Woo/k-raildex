/** 표 행 안의 짧은 출처 표기(번호 체계·용어·노선도처럼 행마다 출처가 다른 목록) — 발행처 + 링크, 확인일 */
import type { PublicSourceRef } from '@k-raildex/contracts';
import { fmtDate } from '@/lib/format';

export function SourceMini({ sources, checkedAt }: { sources: PublicSourceRef[]; checkedAt?: string }) {
  const uniq = [...new Map(sources.map((s) => [s.source_id, s])).values()];
  if (uniq.length === 0) return <span className="muted">출처 미확인</span>;
  return (
    <span className="src-mini">
      {uniq.map((s, i) => (
        <span key={s.source_id}>
          {i ? ' · ' : ''}
          {s.url ? (
            <a href={s.url} rel="noopener noreferrer" target="_blank" title={s.title}>
              {s.publisher}
            </a>
          ) : (
            <span title={s.title}>{s.publisher}</span>
          )}
        </span>
      ))}
      {checkedAt ? <span className="muted"> · 확인 {fmtDate(checkedAt)}</span> : null}
    </span>
  );
}
