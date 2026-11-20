/** 변경 묶음 상세(FR-ADM-081~084): op 별 전/후, 미리 보기, 승인·반려 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { codeLabel } from '@k-raildex/contracts';
import { Badge, Button, Card, CardHeader, Empty, Textarea } from '@k-raildex/ui';
import { api } from '../lib/api';
import { pretty } from '../lib/diff';
import { statusTone, type ChangesetRow } from './Changesets';

interface Op {
  seq: number;
  op: string;
  entity_type: string;
  entity_id: string;
  payload: unknown;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}
interface Detail extends ChangesetRow {
  rationale: string | null;
  error: string | null;
  review_comment: string | null;
  ops: Op[];
}

export function ChangesetDetail() {
  const { id } = useParams({ from: '/changesets/$id' });
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['changeset', id],
    queryFn: () => api<Detail>(`/v1/admin/changesets/${encodeURIComponent(id)}`),
  });
  const [comment, setComment] = useState('');
  const [preview, setPreview] = useState<unknown>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['changeset', id] });
  const act = useMutation({
    mutationFn: (action: 'approve' | 'reject' | 'preview') =>
      api<unknown>(`/v1/admin/changesets/${encodeURIComponent(id)}/${action}`, { method: 'POST', json: { comment } }),
    onSuccess: async (r, action) => {
      if (action === 'preview') setPreview(r);
      else {
        toast.success(action === 'approve' ? '승인(반영)했습니다' : '반려했습니다');
        await refresh();
      }
    },
    onError: async (e) => {
      toast.error(e instanceof Error ? e.message : String(e));
      await refresh();
    },
  });
  if (q.isLoading) return <Empty>불러오는 중…</Empty>;
  const c = q.data;
  if (!c) return <Empty>없음</Empty>;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold">{c.title}</h1>
        <Badge tone={statusTone(c.status)}>{codeLabel('changesetStatus', c.status as 'draft')}</Badge>
        <span className="text-xs text-fg-muted">
          {c.id} · {codeLabel('changesetOrigin', c.origin as 'admin_edit')}
        </span>
      </div>
      {c.rationale ? <p className="text-sm">{c.rationale}</p> : null}
      {c.error ? <pre className="overflow-auto rounded bg-danger/10 p-3 text-xs text-danger">{c.error}</pre> : null}
      {c.status === 'draft' ? (
        <Card className="flex flex-col gap-2 p-3">
          <Textarea
            placeholder="검수 메모(반려 시 필수 — 에이전트 피드백)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => act.mutate('preview')}>
              미리 보기
            </Button>
            <Button onClick={() => act.mutate('approve')}>승인(반영)</Button>
            <Button variant="danger" disabled={!comment.trim()} onClick={() => act.mutate('reject')}>
              반려
            </Button>
          </div>
          {preview ? (
            <pre className="max-h-80 overflow-auto rounded bg-muted p-2 text-xs">{pretty(preview)}</pre>
          ) : null}
        </Card>
      ) : null}
      {c.ops.map((op) => (
        <Card key={op.seq}>
          <CardHeader
            title={
              <span>
                #{op.seq} <Badge>{op.op}</Badge> {op.entity_type} <code className="text-xs">{op.entity_id}</code>
              </span>
            }
          />
          <div className="grid grid-cols-1 gap-2 p-3 text-xs md:grid-cols-2">
            {op.before || op.after ? (
              <>
                <pre className="max-h-72 overflow-auto rounded bg-danger/10 p-2">{pretty(op.before)}</pre>
                <pre className="max-h-72 overflow-auto rounded bg-good/10 p-2">{pretty(op.after)}</pre>
              </>
            ) : (
              <pre className="max-h-72 overflow-auto rounded bg-muted p-2 md:col-span-2">{pretty(op.payload)}</pre>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
