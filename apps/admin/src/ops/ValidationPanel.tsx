/** 설정 › 검증: 전체 검증(validate-all) 실행 — 동기 또는 작업 — 과 마지막 결과(위반 개체로 바로 가기) */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { entityUiMeta, isCode, type EntityType } from '@k-raildex/contracts';
import { Badge, Button, Card, CardHeader, Empty } from '@k-raildex/ui';
import { api, apiOptional, errorText } from '../lib/api';
import { toSlug } from '../lib/entity-types';
import { fmtTime, type ValidationResult } from './api';

export function ValidationPanel() {
  const qc = useQueryClient();
  const last = useQuery({
    queryKey: ['validation-last'],
    queryFn: () => apiOptional<ValidationResult>('/v1/admin/validate-all/last'),
  });
  const runSync = useMutation({
    mutationFn: () => api<ValidationResult>('/v1/admin/validate-all?sync=true', { method: 'POST' }),
    onSuccess: (r) => {
      qc.setQueryData(['validation-last'], r);
      toast.success(`전체 검증 완료 — Hard 위반 ${r.hard_count}건`);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const runJob = useMutation({
    mutationFn: () => api<{ job_id: string | null }>('/v1/admin/validate-all', { method: 'POST' }),
    onSuccess: async () => {
      toast.success('전체 검증 작업을 보냈습니다 — 작업 화면에서 진행을 볼 수 있습니다');
      await qc.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const r = last.data;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="전체 검증"
          actions={
            <div className="flex gap-2">
              <Button size="sm" onClick={() => runSync.mutate()} disabled={runSync.isPending}>
                {runSync.isPending ? '검증 중…' : '지금 검증(동기)'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => runJob.mutate()} disabled={runJob.isPending}>
                작업으로 보내기
              </Button>
            </div>
          }
        />
        <p className="px-4 py-3 text-xs text-fg-muted">
          모든 활성 개체에 Hard 규칙(적용기와 같은 SQL)을 돌리고 Soft 규칙(품질) 건수를 셉니다. 결과는 app_setting
          validation.last 에 남습니다. 큰 DB 는 작업으로 보내세요.
        </p>
      </Card>
      {last.isLoading ? (
        <Empty>불러오는 중…</Empty>
      ) : last.error ? (
        <Empty>{errorText(last.error)}</Empty>
      ) : !r ? (
        <Card>
          <Empty>아직 전체 검증 결과가 없습니다</Empty>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]" data-testid="validation-result">
          <Card className="self-start">
            <CardHeader
              title={
                <span>
                  Hard 위반 <Badge tone={r.hard_count ? 'danger' : 'good'}>{r.hard_count}</Badge>
                </span>
              }
              actions={
                <span className="text-xs text-fg-muted">
                  {fmtTime(r.at)} · 개체 {r.entity_count.toLocaleString()} · {r.ms}ms
                </span>
              }
            />
            {!r.hard.length ? (
              <Empty>위반 없음</Empty>
            ) : (
              <table className="w-full text-sm" data-testid="validation-hard">
                <thead className="text-left text-xs text-fg-muted">
                  <tr>
                    <th className="px-4 py-2">규칙</th>
                    <th className="px-4 py-2">개체</th>
                    <th className="px-4 py-2">내용</th>
                  </tr>
                </thead>
                <tbody>
                  {r.hard.map((v, i) => {
                    const t =
                      v.entity_type && isCode('entityType', v.entity_type) ? (v.entity_type as EntityType) : null;
                    return (
                      <tr key={`${v.rule}-${v.entity_id ?? ''}-${i}`} className="border-t border-border">
                        <td className="px-4 py-1.5">
                          <code className="text-xs">{v.rule}</code>
                        </td>
                        <td className="px-4 py-1.5">
                          {t && v.entity_id ? (
                            <Link
                              to="/data/$type/$id"
                              params={{ type: toSlug(t), id: v.entity_id }}
                              search={{}}
                              className="hover:underline"
                            >
                              <span className="text-xs text-fg-muted">{entityUiMeta[t].label}</span> {v.label}
                            </Link>
                          ) : (
                            (v.entity_id ?? '—')
                          )}
                        </td>
                        <td className="px-4 py-1.5 text-xs">{v.message}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {r.hard_truncated ? (
              <p className="px-4 py-2 text-xs text-fg-muted">앞 {r.hard.length}건만 보관했습니다</p>
            ) : null}
          </Card>
          <Card className="self-start">
            <CardHeader title={`Soft 규칙 ${r.soft_total.toLocaleString()}건`} />
            <ul className="divide-y divide-border text-sm" data-testid="validation-soft">
              {r.soft_counts.map((s) => (
                <li key={s.id}>
                  <Link
                    to="/quality"
                    search={{ rule: s.id, offset: undefined }}
                    className="flex items-center gap-2 px-4 py-1.5 hover:bg-muted"
                  >
                    <span className="min-w-0 flex-1">
                      <code className="block text-[11px] text-fg-muted">{s.id}</code>
                      {s.title}
                    </span>
                    <Badge tone={s.count ? 'warn' : 'good'}>{s.count.toLocaleString()}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
