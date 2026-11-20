import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { entityUiMeta, type EntityType } from '@k-raildex/contracts';
import { Dialog, Input } from '@k-raildex/ui';
import { api, qs } from '../lib/api';
import type { LookupItem } from '../form/widgets/RefInput';

const SEARCH_TYPES: EntityType[] = ['station', 'line', 'service', 'plan', 'plan_program', 'source', 'operator'];

/** 전역 검색(⌘K): 주요 개체를 이름·별칭·id·역번호로 */
export function GlobalSearch({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (type: EntityType, id: string) => void;
}) {
  const [q, setQ] = useState('');
  const { data } = useQuery({
    queryKey: ['global-search', q],
    enabled: q.trim().length > 0,
    queryFn: async () => {
      const res = await Promise.all(
        SEARCH_TYPES.map(async (t) => ({
          type: t,
          items: (
            await api<{ items: LookupItem[] }>(`/v1/admin/lookup${qs({ type: t.replace(/_/g, '-'), q, limit: 5 })}`)
          ).items,
        })),
      );
      return res.filter((r) => r.items.length > 0);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="검색">
      <Input autoFocus placeholder="이름·별칭·id·역번호" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 flex flex-col gap-3">
        {data?.map((g) => (
          <div key={g.type}>
            <div className="mb-1 text-xs font-semibold text-fg-muted">{entityUiMeta[g.type].label}</div>
            {g.items.map((it) => (
              <button
                key={it.id}
                onClick={() => onPick(g.type, it.id)}
                className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted"
              >
                <span>{it.label}</span>
                <span className="text-xs text-fg-muted">{it.sublabel ?? it.id}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
