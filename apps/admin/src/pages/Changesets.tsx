/** 변경 묶음 목록(FR-ADM-080·086) */
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { codes } from '@k-raildex/contracts';
import { codeLabel } from '@k-raildex/contracts';
import { Badge, Card, Empty, TabsList, TabsTrigger, Tabs } from '@k-raildex/ui';
import { api, qs } from '../lib/api';

export interface ChangesetRow {
  id: string;
  title: string;
  origin: string;
  status: string;
  submitted_at: string;
  applied_at: string | null;
  author?: string;
  op_count?: number;
}

export const statusTone = (s: string) =>
  s === 'applied' ? 'good' : s === 'draft' ? 'warn' : s === 'failed' || s === 'rejected' ? 'danger' : 'neutral';

export function Changesets() {
  const search = useSearch({ from: '/changesets' });
  const navigate = useNavigate({ from: '/changesets' });
  const status = search.status ?? 'draft';
  const q = useQuery({
    queryKey: ['changesets', status],
    queryFn: () =>
      api<{ items: ChangesetRow[]; total: number }>(
        `/v1/admin/changesets${qs({ status: status === 'all' ? undefined : status, limit: 100 })}`,
      ),
  });
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-lg font-bold">변경 묶음</h1>
      <Tabs value={status} onValueChange={(s) => void navigate({ search: { status: s } })}>
        <TabsList>
          {['draft', 'applied', 'failed', 'rejected', 'all'].map((s) => (
            <TabsTrigger key={s} value={s}>
              {s === 'all' ? '전체' : codeLabel('changesetStatus', s as (typeof codes.changesetStatus.values)[number])}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Card>
        {!q.data?.items.length ? (
          <Empty>{q.isLoading ? '불러오는 중…' : '없음'}</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-fg-muted">
              <tr>
                <th className="px-3 py-2">제목</th>
                <th className="px-3 py-2">기원</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">제출</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-muted/50">
                  <td className="px-3 py-1.5">
                    <Link to="/changesets/$id" params={{ id: c.id }} className="font-medium hover:underline">
                      {c.title}
                    </Link>
                    <div className="text-xs text-fg-muted">{c.id}</div>
                  </td>
                  <td className="px-3 py-1.5">{codeLabel('changesetOrigin', c.origin as 'admin_edit')}</td>
                  <td className="px-3 py-1.5">
                    <Badge tone={statusTone(c.status)}>{codeLabel('changesetStatus', c.status as 'draft')}</Badge>
                  </td>
                  <td className="px-3 py-1.5 text-xs text-fg-muted">{c.submitted_at.slice(0, 16).replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
