/** 휴지통(FR-ADM-064) */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { entityUiMeta, type EntityType } from '@k-raildex/contracts';
import { Button, Card, Empty } from '@k-raildex/ui';
import { api } from '../lib/api';
import { toSlug } from '../lib/entity-types';

interface TrashItem {
  id: string;
  type: EntityType;
  name_ko: string | null;
  deleted_at: string;
  delete_reason?: string | null;
}

export function Trash() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['trash'], queryFn: () => api<{ items: TrashItem[] }>('/v1/admin/trash') });
  const act = useMutation({
    mutationFn: ({ it, purge }: { it: TrashItem; purge: boolean }) =>
      purge
        ? api(`/v1/admin/${toSlug(it.type)}/${encodeURIComponent(it.id)}?purge=true`, { method: 'DELETE' })
        : api(`/v1/admin/${toSlug(it.type)}/${encodeURIComponent(it.id)}/restore`, { method: 'POST' }),
    onSuccess: async (_r, v) => {
      toast.success(v.purge ? '영구 삭제했습니다' : '복구했습니다');
      await qc.invalidateQueries({ queryKey: ['trash'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-lg font-bold">휴지통</h1>
      <Card>
        {!q.data?.items.length ? (
          <Empty>{q.isLoading ? '불러오는 중…' : '비어 있음'}</Empty>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {q.data.items.map((it) => (
                <tr key={it.id} className="border-t border-border">
                  <td className="px-3 py-1.5">{entityUiMeta[it.type]?.label ?? it.type}</td>
                  <td className="px-3 py-1.5">
                    <Link
                      to="/data/$type/$id"
                      params={{ type: toSlug(it.type), id: it.id }}
                      search={{}}
                      className="hover:underline"
                    >
                      {it.name_ko ?? it.id}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-xs text-fg-muted">{it.deleted_at.slice(0, 16).replace('T', ' ')}</td>
                  <td className="px-3 py-1.5 text-xs">{it.delete_reason ?? ''}</td>
                  <td className="flex justify-end gap-1 px-3 py-1.5">
                    <Button size="sm" variant="secondary" onClick={() => act.mutate({ it, purge: false })}>
                      복구
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        if (
                          window.confirm(`${it.id} 를 영구 삭제합니다. id 는 다시 쓸 수 없습니다.`) &&
                          window.confirm('정말 영구 삭제할까요?')
                        )
                          act.mutate({ it, purge: true });
                      }}
                    >
                      영구 삭제
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
