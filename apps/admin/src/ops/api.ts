/** 운영 API 응답 형태(apps/api ops.controller · packages/domain ops.ts)와 조회 훅 */
import { useQuery } from '@tanstack/react-query';
import { api, apiOptional, qs } from '../lib/api';

export type JobState = 'created' | 'retry' | 'active' | 'completed' | 'cancelled' | 'failed';
export const PENDING_STATES: readonly JobState[] = ['created', 'retry', 'active'];

export const STATE_LABEL: Record<JobState, string> = {
  created: '대기',
  retry: '재시도 대기',
  active: '실행 중',
  completed: '완료',
  cancelled: '취소',
  failed: '실패',
};
export const STATE_TONE: Record<JobState, 'neutral' | 'good' | 'warn' | 'danger' | 'info'> = {
  created: 'neutral',
  retry: 'warn',
  active: 'info',
  completed: 'good',
  cancelled: 'neutral',
  failed: 'danger',
};

export interface OpsJob {
  id: string;
  kind: 'job' | 'run';
  name: string;
  state: JobState;
  data: unknown;
  output: unknown;
  error: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  retry_count: number | null;
  singleton_key: string | null;
  trigger?: string | null;
  cost_usd?: number | null;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  changeset_ids?: string[];
  log?: string | null;
}

export interface OpsStatus {
  failed_jobs_24h: number;
  failed_runs_24h: number;
  last_backup_at: string | null;
  queue_depth: number;
  active: number;
  recent_failures: { id: string; kind: 'job' | 'run'; name: string; error: string | null; at: string | null }[];
}

export interface RunnableJobs {
  items: { task: string; label: string; description: string }[];
  jobs: { name: string; label: string; description: string }[];
}

export interface AgentBudget {
  monthly_usd: number;
  is_default: boolean;
  updated_at: string | null;
  month: string;
  spent_usd: number;
  runs: number;
  remaining_usd: number;
  exceeded: boolean;
}

export interface ValidationResult {
  at: string;
  ms: number;
  entity_count: number;
  rules: string[];
  hard_count: number;
  hard: { rule: string; entity_id?: string; entity_type: string | null; label: string; message: string }[];
  hard_truncated: boolean;
  soft_counts: { id: string; title: string; count: number; note?: string }[];
  soft_total: number;
}

export interface ApiToken {
  id: string;
  name: string;
  scopes: string[];
  user_kind: string;
  user_name: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

export const fmtTime = (v: string | null | undefined) => (v ? v.slice(0, 19).replace('T', ' ') : '—');

/** 걸린 시간(초) */
export function duration(j: Pick<OpsJob, 'started_at' | 'completed_at'>): string {
  if (!j.started_at) return '—';
  const end = j.completed_at ? Date.parse(j.completed_at) : Date.now();
  const s = Math.max(0, (end - Date.parse(j.started_at)) / 1000);
  return s < 60 ? `${s.toFixed(1)}초` : `${Math.floor(s / 60)}분 ${Math.round(s % 60)}초`;
}

export function useOpsStatus(refetchMs = 15_000) {
  return useQuery({
    queryKey: ['ops-status'],
    queryFn: () => apiOptional<OpsStatus>('/v1/admin/ops/status'),
    refetchInterval: refetchMs,
  });
}

/** 끝나지 않은 작업이 하나라도 있으면 3초마다 새로 고침 */
export const JOBS_REFRESH_MS = 3000;

export function useJobs(filter: { state?: string; name?: string; kind?: string }) {
  return useQuery({
    queryKey: ['jobs', filter],
    queryFn: () => api<{ items: OpsJob[]; total: number; pgboss: boolean }>(`/v1/admin/jobs${qs(filter)}`),
    refetchInterval: (q) =>
      q.state.data?.items.some((j) => PENDING_STATES.includes(j.state)) ? JOBS_REFRESH_MS : false,
  });
}
