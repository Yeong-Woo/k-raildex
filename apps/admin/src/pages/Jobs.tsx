/**
 * 작업(docs/05-admin-app.md 2절 "작업"): pg-boss 작업 + 수집기·에이전트 실행 기록(ingest.run) 목록, 상태 필터,
 * 끝나지 않은 작업이 있으면 3초마다 새로 고침, 상세 서랍(데이터·결과·오류·시간), 허용된 작업 실행 양식.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, cn, Empty, FieldShell, Input, Select, Textarea } from '@k-raildex/ui';
import { api, errorText } from '../lib/api';
import {
  duration,
  fmtTime,
  JOBS_REFRESH_MS,
  PENDING_STATES,
  STATE_LABEL,
  STATE_TONE,
  useJobs,
  type OpsJob,
  type RunnableJobs,
} from '../ops/api';
import { OpsStatusBanner } from '../ops/OpsStatusBanner';

const STATE_FILTERS: { value: string; label: string }[] = [
  { value: '', label: '모든 상태' },
  { value: 'pending', label: '진행 중(대기·실행)' },
  { value: 'failed', label: '실패' },
  { value: 'completed', label: '완료' },
  { value: 'cancelled', label: '취소' },
];

export function Jobs() {
  const [state, setState] = useState('');
  const [kind, setKind] = useState('');
  const [name, setName] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const jobs = useJobs({ state: state || undefined, kind: kind || undefined, name: name || undefined });
  const live = jobs.data?.items.some((j) => PENDING_STATES.includes(j.state)) ?? false;
  const names = [...new Set(jobs.data?.items.map((j) => j.name) ?? [])].sort();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-bold">작업</h1>
      <OpsStatusBanner />
      <RunJobForm />
      <Card>
        <CardHeader
          title={`작업·실행 기록 ${jobs.data?.total ?? 0}건`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {live ? (
                <span className="text-xs text-fg-muted" data-testid="jobs-live">
                  자동 새로 고침 {JOBS_REFRESH_MS / 1000}초
                </span>
              ) : null}
              <Select aria-label="상태" value={state} onChange={(e) => setState(e.target.value)} className="w-40">
                {STATE_FILTERS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <Select aria-label="종류" value={kind} onChange={(e) => setKind(e.target.value)} className="w-32">
                <option value="">작업+실행</option>
                <option value="job">작업(pg-boss)</option>
                <option value="run">실행 기록</option>
              </Select>
              <Select aria-label="이름" value={name} onChange={(e) => setName(e.target.value)} className="w-44">
                <option value="">모든 이름</option>
                {[...new Set([...names, ...(name ? [name] : [])])].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="secondary" onClick={() => void jobs.refetch()}>
                새로 고침
              </Button>
            </div>
          }
        />
        {jobs.isLoading ? (
          <Empty>불러오는 중…</Empty>
        ) : jobs.error ? (
          <Empty>{errorText(jobs.error)}</Empty>
        ) : !jobs.data?.items.length ? (
          <Empty>
            {jobs.data && !jobs.data.pgboss
              ? '작업 큐(pg-boss)가 아직 만들어지지 않았고 실행 기록도 없습니다'
              : '해당하는 작업이 없습니다'}
          </Empty>
        ) : (
          <table className="w-full text-sm" data-testid="jobs-table">
            <thead className="text-left text-xs text-fg-muted">
              <tr>
                <th className="px-4 py-2">상태</th>
                <th className="px-4 py-2">이름</th>
                <th className="px-4 py-2">종류</th>
                <th className="px-4 py-2">만든 시각</th>
                <th className="px-4 py-2">걸린 시간</th>
                <th className="px-4 py-2">오류</th>
              </tr>
            </thead>
            <tbody>
              {jobs.data.items.map((j) => (
                <tr
                  key={j.id}
                  className={cn('cursor-pointer border-t border-border hover:bg-muted', openId === j.id && 'bg-muted')}
                  onClick={() => setOpenId(j.id)}
                >
                  <td className="px-4 py-1.5">
                    <StateBadge state={j.state} />
                  </td>
                  <td className="px-4 py-1.5">
                    <button type="button" className="text-left hover:underline">
                      <code>{j.name}</code>
                    </button>
                  </td>
                  <td className="px-4 py-1.5 text-xs text-fg-muted">
                    {j.kind === 'run' ? `실행 기록${j.trigger ? ` · ${j.trigger}` : ''}` : '작업'}
                  </td>
                  <td className="px-4 py-1.5 text-xs text-fg-muted">{fmtTime(j.created_at)}</td>
                  <td className="px-4 py-1.5 text-xs">{duration(j)}</td>
                  <td className="max-w-80 truncate px-4 py-1.5 text-xs text-danger">{j.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {openId ? <JobDrawer id={openId} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

function StateBadge({ state }: { state: OpsJob['state'] }) {
  return (
    <Badge tone={STATE_TONE[state]} data-state={state}>
      {STATE_LABEL[state] ?? state}
    </Badge>
  );
}

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-xs text-fg-muted">없음</span>;
  return (
    <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function JobDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['job', id],
    queryFn: () => api<OpsJob>(`/v1/admin/jobs/${encodeURIComponent(id)}`),
    refetchInterval: (s) => (s.state.data && PENDING_STATES.includes(s.state.data.state) ? JOBS_REFRESH_MS : false),
  });
  const j = q.data;
  return (
    <aside
      data-testid="job-drawer"
      aria-label="작업 상세"
      className="fixed top-0 right-0 z-40 flex h-full w-[min(92vw,560px)] flex-col border-l border-border bg-bg-elevated shadow-xl"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{j ? j.name : '작업'}</h2>
        {j ? <StateBadge state={j.state} /> : null}
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="닫기">
          닫기
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-4 text-sm">
        {q.isLoading ? (
          <Empty>불러오는 중…</Empty>
        ) : q.error ? (
          <Empty>{errorText(q.error)}</Empty>
        ) : j ? (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-fg-muted">id</dt>
              <dd>
                <code>{j.id}</code>
              </dd>
              <dt className="text-fg-muted">만든 시각</dt>
              <dd>{fmtTime(j.created_at)}</dd>
              <dt className="text-fg-muted">시작</dt>
              <dd>{fmtTime(j.started_at)}</dd>
              <dt className="text-fg-muted">끝</dt>
              <dd>{fmtTime(j.completed_at)}</dd>
              <dt className="text-fg-muted">걸린 시간</dt>
              <dd>{duration(j)}</dd>
              {j.kind === 'job' ? (
                <>
                  <dt className="text-fg-muted">재시도</dt>
                  <dd>{j.retry_count ?? 0}</dd>
                </>
              ) : (
                <>
                  <dt className="text-fg-muted">계기</dt>
                  <dd>{j.trigger ?? '—'}</dd>
                  {j.model ? (
                    <>
                      <dt className="text-fg-muted">모델·토큰</dt>
                      <dd>
                        {j.model} · {j.input_tokens ?? 0}/{j.output_tokens ?? 0}
                      </dd>
                    </>
                  ) : null}
                  {j.cost_usd != null ? (
                    <>
                      <dt className="text-fg-muted">비용</dt>
                      <dd>${j.cost_usd.toFixed(4)}</dd>
                    </>
                  ) : null}
                  {j.changeset_ids?.length ? (
                    <>
                      <dt className="text-fg-muted">변경 묶음</dt>
                      <dd>{j.changeset_ids.join(', ')}</dd>
                    </>
                  ) : null}
                </>
              )}
            </dl>
            {j.error ? (
              <section>
                <h3 className="mb-1 text-xs font-semibold text-danger">오류</h3>
                <pre className="rounded bg-danger/10 p-2 text-xs whitespace-pre-wrap" data-testid="job-error">
                  {j.error}
                </pre>
              </section>
            ) : null}
            <section>
              <h3 className="mb-1 text-xs font-semibold">{j.kind === 'run' ? '매개변수' : '데이터'}</h3>
              <Json value={j.data} />
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold">{j.kind === 'run' ? '통계' : '결과(output)'}</h3>
              <Json value={j.output} />
            </section>
            {j.log ? (
              <section>
                <h3 className="mb-1 text-xs font-semibold">로그</h3>
                <pre className="max-h-80 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{j.log}</pre>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function RunJobForm() {
  const qc = useQueryClient();
  const defs = useQuery({
    queryKey: ['runnable-jobs'],
    queryFn: () => api<RunnableJobs>('/v1/admin/jobs/importer-tasks'),
    staleTime: Infinity,
  });
  const [name, setName] = useState('validate-all');
  const [task, setTask] = useState('');
  const [options, setOptions] = useState('{}');
  const [documentId, setDocumentId] = useState('');
  const [force, setForce] = useState(false);
  const [days, setDays] = useState('');
  const send = useMutation({
    mutationFn: async () => {
      let data: Record<string, unknown> = {};
      if (name === 'importer.run') {
        let opts: unknown;
        try {
          opts = JSON.parse(options || '{}');
        } catch {
          throw new Error('옵션은 JSON 객체여야 합니다');
        }
        data = { task: task || defs.data?.items[0]?.task, options: opts };
      } else if (name === 'doc.text-extract') data = { document_id: documentId.trim() };
      else if (name === 'doc.page-images') data = { document_id: documentId.trim(), force };
      else if (name === 'cleanup-api-calls' && days) data = { days: Number(days) };
      return api<{ id: string | null; deduplicated: boolean }>('/v1/admin/jobs', {
        method: 'POST',
        json: { name, data },
      });
    },
    onSuccess: async (r) => {
      if (r.deduplicated) toast.info('같은 작업이 이미 대기 중이라 합쳤습니다');
      else toast.success('작업을 보냈습니다');
      await qc.invalidateQueries({ queryKey: ['jobs'] });
      await qc.invalidateQueries({ queryKey: ['ops-status'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const current = defs.data?.jobs.find((j) => j.name === name);
  return (
    <Card>
      <CardHeader title="작업 실행" />
      <form
        className="flex flex-wrap items-end gap-3 p-4"
        data-testid="run-job"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <FieldShell label="작업" htmlFor="run-job-name" className="w-56">
          <Select id="run-job-name" value={name} onChange={(e) => setName(e.target.value)}>
            {(defs.data?.jobs ?? []).map((j) => (
              <option key={j.name} value={j.name}>
                {j.label} ({j.name})
              </option>
            ))}
          </Select>
        </FieldShell>
        {name === 'importer.run' ? (
          <>
            <FieldShell label="과제" htmlFor="run-job-task" className="w-60">
              <Select id="run-job-task" value={task} onChange={(e) => setTask(e.target.value)}>
                {(defs.data?.items ?? []).map((t) => (
                  <option key={t.task} value={t.task} title={t.description}>
                    {t.label} ({t.task})
                  </option>
                ))}
              </Select>
            </FieldShell>
            <FieldShell
              label="옵션(JSON)"
              htmlFor="run-job-options"
              help='예: {"dryRun": true, "limit": 10}'
              className="min-w-64 flex-1"
            >
              <Textarea
                id="run-job-options"
                className="min-h-9 font-mono text-xs"
                rows={1}
                value={options}
                onChange={(e) => setOptions(e.target.value)}
              />
            </FieldShell>
          </>
        ) : null}
        {name === 'doc.text-extract' || name === 'doc.page-images' ? (
          <FieldShell label="문서 id(uuid)" htmlFor="run-job-doc" className="w-80">
            <Input id="run-job-doc" value={documentId} onChange={(e) => setDocumentId(e.target.value)} />
          </FieldShell>
        ) : null}
        {name === 'doc.page-images' ? (
          <label className="flex h-9 items-center gap-1.5 text-sm">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> 다시 만들기
          </label>
        ) : null}
        {name === 'cleanup-api-calls' ? (
          <FieldShell label="보관 일수(기본 7)" htmlFor="run-job-days" className="w-36">
            <Input
              id="run-job-days"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </FieldShell>
        ) : null}
        <Button type="submit" disabled={send.isPending || !defs.data}>
          실행
        </Button>
        {current ? <p className="basis-full text-xs text-fg-muted">{current.description}</p> : null}
      </form>
    </Card>
  );
}
