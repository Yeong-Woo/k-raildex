/** 개체 참조 선택기(FR-ADM-032): 이름·별칭·id·역번호 자동완성 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { EntityType } from '@k-raildex/contracts';
import { Badge, Input } from '@k-raildex/ui';
import { ExternalLink, X } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { toSlug } from '../../lib/entity-types';

export interface LookupItem {
  id: string;
  label: string;
  sublabel: string | null;
  deleted: boolean;
}

function useLookup(type: EntityType, q: string, enabled: boolean) {
  return useQuery({
    queryKey: ['lookup', type, q],
    enabled,
    queryFn: () => api<{ items: LookupItem[] }>(`/v1/admin/lookup${qs({ type: toSlug(type), q, limit: 12 })}`),
  });
}

/** 선택된 id 의 표시 이름 */
export function useLabel(type: EntityType, id: string | null) {
  return useQuery({
    queryKey: ['lookup-label', type, id],
    enabled: !!id,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await api<{ items: LookupItem[] }>(`/v1/admin/lookup${qs({ type: toSlug(type), q: id, limit: 5 })}`);
      return r.items.find((i) => i.id === id) ?? null;
    },
  });
}

export function RefInput({
  target,
  value,
  onChange,
  id,
  disabled,
}: {
  target: EntityType;
  value: string | null;
  onChange: (v: string | null) => void;
  id?: string;
  disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { data } = useLookup(target, q, open && q.trim().length > 0);
  const label = useLabel(target, value);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (value) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-md border border-border px-2 text-sm">
        <span className="truncate">{label.data?.label ?? value}</span>
        <span className="truncate text-xs text-fg-muted">{value}</span>
        {label.data?.deleted ? <Badge tone="danger">휴지통</Badge> : null}
        <Link
          to="/data/$type/$id"
          params={{ type: toSlug(target), id: value }}
          target="_blank"
          className="ml-auto text-fg-muted"
          title="새 탭에서 열기"
        >
          <ExternalLink className="size-3.5" />
        </Link>
        {!disabled ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-fg-muted hover:text-fg"
            aria-label="선택 해제"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div ref={box} className="relative">
      <Input
        id={id}
        disabled={disabled}
        placeholder="검색해서 고르기"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && data && data.items.length > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-bg-elevated shadow-lg">
          {data.items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                className="flex w-full items-baseline gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onChange(it.id);
                  setQ('');
                  setOpen(false);
                }}
              >
                <span>{it.label}</span>
                <span className="truncate text-xs text-fg-muted">{it.sublabel ?? it.id}</span>
                {it.deleted ? <Badge tone="danger">휴지통</Badge> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** 여러 개 선택(순서 있음) */
export function RefsInput({
  target,
  value,
  onChange,
}: {
  target: EntityType;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {value.map((v, i) => (
        <div key={`${v}-${i}`} className="flex items-center gap-1">
          <span className="w-6 text-right text-xs text-fg-muted">{i + 1}</span>
          <div className="flex-1">
            <RefInput
              target={target}
              value={v}
              onChange={(nv) =>
                onChange(nv ? value.map((x, j) => (j === i ? nv : x)) : value.filter((_, j) => j !== i))
              }
            />
          </div>
          <button
            type="button"
            className="px-1 text-fg-muted hover:text-fg"
            disabled={i === 0}
            onClick={() => onChange(swap(value, i, i - 1))}
            aria-label="위로"
          >
            ↑
          </button>
          <button
            type="button"
            className="px-1 text-fg-muted hover:text-fg"
            disabled={i === value.length - 1}
            onClick={() => onChange(swap(value, i, i + 1))}
            aria-label="아래로"
          >
            ↓
          </button>
        </div>
      ))}
      <RefInput target={target} value={null} onChange={(nv) => nv && onChange([...value, nv])} />
    </div>
  );
}

function swap<T>(a: T[], i: number, j: number): T[] {
  const b = [...a];
  [b[i], b[j]] = [b[j]!, b[i]!];
  return b;
}
