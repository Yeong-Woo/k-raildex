/**
 * 운영 실패 배너(docs/05-admin-app.md 8절, Q64 C — 알림 대신 대시보드). 24시간 안의 작업·수집기 실패,
 * 오래된 백업을 상단에 보여 준다. 아무 문제가 없으면 아무것도 그리지 않는다. 대시보드·셸 어디에나 둘 수 있다.
 */
import { Link } from '@tanstack/react-router';
import { cn } from '@k-raildex/ui';
import { fmtTime, useOpsStatus } from './api';

/** 마지막 백업이 이보다 오래되면 경고(일일 백업, NFR-OPS-040) */
export const BACKUP_STALE_HOURS = 36;

export function OpsStatusBanner({ className }: { className?: string }) {
  const q = useOpsStatus();
  const s = q.data;
  if (!s) return null;
  const failed = s.failed_jobs_24h + s.failed_runs_24h;
  const backupAge = s.last_backup_at ? (Date.now() - Date.parse(s.last_backup_at)) / 3_600_000 : null;
  const staleBackup = backupAge !== null && backupAge > BACKUP_STALE_HOURS;
  if (!failed && !staleBackup) return null;
  return (
    <div
      role="alert"
      data-testid="ops-banner"
      className={cn(
        'flex flex-col gap-1 rounded-lg border px-4 py-2.5 text-sm',
        failed ? 'border-danger/40 bg-danger/10' : 'border-warn/40 bg-warn/10',
        className,
      )}
    >
      {failed ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <strong className="text-danger">최근 24시간 실패 {failed}건</strong>
          <span className="text-xs text-fg-muted">
            작업 {s.failed_jobs_24h} · 수집기·에이전트 실행 {s.failed_runs_24h}
          </span>
          <Link to="/jobs" className="ml-auto text-xs text-primary hover:underline">
            작업 화면에서 보기
          </Link>
        </div>
      ) : null}
      {s.recent_failures.length ? (
        <ul className="flex flex-col gap-0.5 text-xs">
          {s.recent_failures.map((f) => (
            <li key={f.id} className="truncate">
              <code>{f.name}</code> <span className="text-fg-muted">{fmtTime(f.at)}</span> {f.error ?? ''}
            </li>
          ))}
        </ul>
      ) : null}
      {staleBackup ? (
        <div className="text-warn">
          마지막 백업이 {Math.floor(backupAge!)}시간 전({fmtTime(s.last_backup_at)})입니다
        </div>
      ) : null}
    </div>
  );
}
