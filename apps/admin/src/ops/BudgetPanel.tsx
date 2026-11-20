/** 설정 › 에이전트 예산(FR-AGT-006): 월 예산(USD, 기본 30) 편집 + 이번 달 사용액 막대 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, cn, Empty, FieldShell, Input } from '@k-raildex/ui';
import { api, errorText } from '../lib/api';
import { fmtTime, type AgentBudget } from './api';

export function BudgetPanel() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['agent-budget'],
    queryFn: () => api<AgentBudget>('/v1/admin/settings/agent-budget'),
  });
  const [value, setValue] = useState('');
  useEffect(() => {
    if (q.data) setValue(String(q.data.monthly_usd));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () =>
      api<AgentBudget>('/v1/admin/settings/agent-budget', { method: 'PUT', json: { monthly_usd: Number(value) } }),
    onSuccess: (r) => {
      qc.setQueryData(['agent-budget'], r);
      toast.success('예산을 저장했습니다');
    },
    onError: (e) => toast.error(errorText(e)),
  });
  if (q.isLoading) return <Empty>불러오는 중…</Empty>;
  if (q.error || !q.data) return <Empty>{errorText(q.error)}</Empty>;
  const b = q.data;
  const pct = b.monthly_usd > 0 ? Math.min(100, (b.spent_usd / b.monthly_usd) * 100) : b.spent_usd > 0 ? 100 : 0;
  const valid = value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
  return (
    <Card>
      <CardHeader
        title="에이전트(LLM) 월 예산"
        actions={
          b.is_default ? <Badge>기본값</Badge> : <span className="text-xs text-fg-muted">{fmtTime(b.updated_at)}</span>
        }
      />
      <div className="flex flex-col gap-4 p-4">
        <div data-testid="budget-spend">
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span>
              {b.month} 사용 <strong>${b.spent_usd.toFixed(2)}</strong> / ${b.monthly_usd.toFixed(2)}
            </span>
            <span className="text-xs text-fg-muted">
              실행 {b.runs}회 · 남은 ${b.remaining_usd.toFixed(2)}
            </span>
          </div>
          <div
            className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="이번 달 사용률"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={cn('h-full rounded-full', b.exceeded ? 'bg-danger' : pct > 80 ? 'bg-warn' : 'bg-primary')}
              style={{ width: `${pct}%` }}
            />
          </div>
          {b.exceeded ? (
            <p className="mt-1 text-xs text-danger">예산을 다 썼습니다 — 이번 달 에이전트 실행은 거부됩니다</p>
          ) : null}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <FieldShell
            label="월 예산(USD)"
            htmlFor="budget-usd"
            help="ingest.run 의 agent:* 실행 cost_usd 합으로 계산(Asia/Seoul 달 기준)"
            className="w-72"
          >
            <Input
              id="budget-usd"
              type="number"
              min={0}
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={!valid}
            />
          </FieldShell>
          <Button type="submit" disabled={!valid || save.isPending} className="mb-5">
            저장
          </Button>
        </form>
      </div>
    </Card>
  );
}
