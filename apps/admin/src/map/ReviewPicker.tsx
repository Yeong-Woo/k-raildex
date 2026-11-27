/**
 * 지도 편집·노선 편집의 고르기 목록(FR-ADM-070): 역·노선 전체를 보여 주고, 품질 규칙에 걸린 개체는 빨간 태그(검수 필요),
 * 걸린 규칙이 없으면 초록 태그(정상). 검색·태그 필터. 역 이름 옆에 지나는 노선 이름을 함께 쓴다.
 * 계획 선형 편집(type plan)도 같은 목록: 현재 단계·표시 선형 품질·이어진 노선, 선형 없음/개략만 필터.
 * 규칙 고르기(select)로 특정 품질 규칙에 걸린 것만 볼 수 있다.
 * 데이터: GET /v1/admin/quality/entities/:type (규칙 SQL 을 합친 것이라 품질 화면과 같은 결과)
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { codeLabel, isCode } from '@k-raildex/contracts';
import { GEOMETRY_QUALITY_LABELS } from '@k-raildex/map';
import { cn, Input, Select } from '@k-raildex/ui';
import { Search } from 'lucide-react';
import { api } from '../lib/api';

export interface ReviewIssue {
  rule: string;
  title: string;
  detail: string | null;
}
export interface ReviewListItem {
  id: string;
  name_ko: string;
  lines: string[];
  status: string | null;
  kind: string | null;
  has_geom: boolean | null;
  station_count: number | null;
  color: string | null;
  issues: ReviewIssue[];
}
type Filter = 'all' | 'issue' | 'ok' | 'nogeom' | 'schematic';
export type ReviewType = 'station' | 'line' | 'plan' | 'facility';

const TEXT: Record<ReviewType, { placeholder: string; label: string }> = {
  station: { placeholder: '역 그룹 이름·노선 이름·id', label: '역 그룹 검색' },
  line: { placeholder: '노선 이름·id', label: '노선 검색' },
  plan: { placeholder: '계획 이름·노선 이름·id', label: '계획 검색' },
  facility: { placeholder: '시설 이름·담당 노선·id', label: '시설 검색' },
};

export function useReviewList(type: ReviewType) {
  return useQuery({
    queryKey: ['quality', 'entities', type],
    queryFn: () => api<{ items: ReviewListItem[] }>(`/v1/admin/quality/entities/${type}`),
    staleTime: 30_000,
  });
}

/** 빨강 = 검수 필요(걸린 규칙 수), 초록 = 정상 */
export function ReviewTag({ issues, className }: { issues: ReviewIssue[]; className?: string }) {
  const bad = issues.length > 0;
  return (
    <span
      data-testid="review-tag"
      data-state={bad ? 'issue' : 'ok'}
      title={bad ? issues.map((i) => `${i.rule} ${i.title}${i.detail ? ` — ${i.detail}` : ''}`).join('\n') : undefined}
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 py-px text-[10px] font-semibold whitespace-nowrap',
        bad ? 'bg-danger-soft text-danger' : 'bg-good-soft text-good',
        className,
      )}
    >
      {bad ? `검수 ${issues.length}` : '정상'}
    </span>
  );
}

/** 선택한 개체에 걸린 규칙 목록(품질 화면 링크) */
export function ReviewIssues({ issues }: { issues: ReviewIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="mt-2 flex flex-col gap-0.5 rounded border border-danger/30 bg-danger-soft/40 px-2 py-1 text-[11px]">
      {issues.map((i, k) => (
        <li key={k} className="min-w-0">
          <Link to="/quality" search={{ rule: i.rule } as never} className="font-semibold text-danger underline">
            {i.rule}
          </Link>{' '}
          {i.title}
          {i.detail ? <span className="text-fg-muted"> — {i.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

export function ReviewPicker({
  type,
  selectedId,
  onSelect,
  className,
}: {
  type: ReviewType;
  selectedId: string | null;
  onSelect: (item: ReviewListItem) => void;
  className?: string;
}) {
  const list = useReviewList(type);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [rule, setRule] = useState('');
  const items = list.data?.items ?? [];
  const ul = useRef<HTMLUListElement | null>(null);

  const counts = useMemo(() => {
    let issue = 0;
    let nogeom = 0;
    let schematic = 0;
    for (const it of items) {
      if (it.issues.length) issue++;
      if (it.has_geom === false) nogeom++;
      if (type === 'plan' && it.kind === 'schematic') schematic++;
    }
    return { all: items.length, issue, ok: items.length - issue, nogeom, schematic };
  }, [items, type]);

  // 목록에 걸린 규칙(건수 많은 순)
  const rules = useMemo(() => {
    const m = new Map<string, { title: string; n: number }>();
    for (const it of items)
      for (const r of new Map(it.issues.map((x) => [x.rule, x])).values()) {
        const cur = m.get(r.rule) ?? { title: r.title, n: 0 };
        cur.n++;
        m.set(r.rule, cur);
      }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
  }, [items]);
  useEffect(() => {
    if (rule && !rules.some(([id]) => id === rule)) setRule('');
  }, [rule, rules]);

  const shown = useMemo(() => {
    const t = norm(q);
    return items.filter((it) => {
      if (filter === 'issue' && !it.issues.length) return false;
      if (filter === 'ok' && it.issues.length) return false;
      if (filter === 'nogeom' && it.has_geom !== false) return false;
      if (filter === 'schematic' && it.kind !== 'schematic') return false;
      if (rule && !it.issues.some((x) => x.rule === rule)) return false;
      if (!t) return true;
      return norm(it.name_ko).includes(t) || it.id.includes(t) || it.lines.some((l) => norm(l).includes(t));
    });
  }, [items, q, filter, rule]);

  // 고른 행이 목록 안에 보이게(목록만 스크롤 — 페이지는 움직이지 않는다)
  useEffect(() => {
    const box = ul.current;
    const el = selectedId ? box?.querySelector<HTMLElement>(`[data-id="${CSS.escape(selectedId)}"]`) : null;
    if (!box || !el) return;
    const top = el.offsetTop;
    if (top < box.scrollTop || top + el.offsetHeight > box.scrollTop + box.clientHeight)
      box.scrollTop = top - box.clientHeight / 2 + el.offsetHeight / 2;
  }, [selectedId, shown.length]);

  const chips: { key: Filter; label: string; tone: string }[] = [
    { key: 'all', label: '전체', tone: '' },
    { key: 'issue', label: '검수 필요', tone: 'text-danger' },
    { key: 'ok', label: '정상', tone: 'text-good' },
    ...(type === 'station' || type === 'facility'
      ? [{ key: 'nogeom' as const, label: '좌표 없음', tone: 'text-warn' }]
      : []),
    ...(type === 'plan'
      ? [
          { key: 'nogeom' as const, label: '선형 없음', tone: 'text-warn' },
          { key: 'schematic' as const, label: '개략만', tone: 'text-warn' },
        ]
      : []),
  ];

  return (
    <section className={cn('flex min-h-0 flex-col gap-1.5', className)} data-testid={`review-picker-${type}`}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-fg-muted" />
        <Input
          className="h-8 pl-7 text-sm"
          placeholder={TEXT[type].placeholder}
          aria-label={TEXT[type].label}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="태그 필터">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={filter === c.key}
            onClick={() => setFilter(c.key)}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap',
              filter === c.key ? 'border-primary bg-primary/10 font-semibold' : 'border-border hover:bg-muted',
              c.tone,
            )}
          >
            {c.label} {counts[c.key]}
          </button>
        ))}
      </div>
      {rules.length ? (
        <Select
          className="h-8 text-xs"
          aria-label="품질 규칙 필터"
          data-testid="review-rule-filter"
          value={rule}
          onChange={(e) => setRule(e.target.value)}
        >
          <option value="">규칙: 전체</option>
          {rules.map(([id, r]) => (
            <option key={id} value={id}>
              {id} {r.title} ({r.n})
            </option>
          ))}
        </Select>
      ) : null}
      {list.isLoading ? (
        <p className="text-xs text-fg-muted">불러오는 중…</p>
      ) : list.error ? (
        <p className="text-xs text-danger">목록을 불러오지 못했습니다.</p>
      ) : !shown.length ? (
        <p className="text-xs text-fg-muted">없음</p>
      ) : (
        <ul
          ref={ul}
          className="relative min-h-0 flex-1 overflow-y-auto rounded border border-border text-sm"
          data-testid={`review-list-${type}`}
        >
          {shown.map((it) => (
            <li key={it.id} data-id={it.id} className="border-t border-border first:border-t-0">
              <button
                type="button"
                data-testid="review-row"
                className={cn(
                  'flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left hover:bg-muted',
                  it.id === selectedId && 'bg-muted',
                )}
                onClick={() => onSelect(it)}
              >
                {type !== 'station' ? (
                  <span
                    className="inline-block h-1.5 w-3 shrink-0 rounded"
                    style={{ background: it.color ?? 'var(--color-border)' }}
                  />
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-1">
                    <span className="truncate font-medium">{it.name_ko}</span>
                    {type !== 'line' && it.lines.length ? (
                      <span className="min-w-0 truncate text-[11px] text-fg-muted" title={it.lines.join(' · ')}>
                        {it.lines.join(' · ')}
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-[10px] text-fg-muted">
                    {it.id}
                    {type === 'facility'
                      ? [
                          it.kind && isCode('facilityKind', it.kind) ? codeLabel('facilityKind', it.kind) : null,
                          it.status && isCode('status', it.status) ? codeLabel('status', it.status) : null,
                          it.has_geom === false ? '좌표 없음' : null,
                        ]
                          .filter(Boolean)
                          .map((s) => ` · ${s}`)
                          .join('')
                      : type === 'plan'
                        ? [
                            it.status && isCode('planStage', it.status) ? codeLabel('planStage', it.status) : null,
                            it.kind ? `선형 ${GEOMETRY_QUALITY_LABELS[it.kind] ?? it.kind}` : '선형 없음',
                          ]
                            .filter(Boolean)
                            .map((s) => ` · ${s}`)
                            .join('')
                        : type === 'station'
                          ? [
                              it.kind && it.kind !== 'station' && isCode('stationKind', it.kind)
                                ? codeLabel('stationKind', it.kind)
                                : null,
                              it.status && isCode('status', it.status) ? codeLabel('status', it.status) : null,
                              it.has_geom === false ? '좌표 없음' : null,
                            ]
                              .filter(Boolean)
                              .map((s) => ` · ${s}`)
                              .join('')
                          : [
                              it.status && isCode('status', it.status) ? codeLabel('status', it.status) : null,
                              `역 ${it.station_count ?? 0}개`,
                              it.lines[0] ? `${it.lines[0]} 지선` : null,
                            ]
                              .filter(Boolean)
                              .map((s) => ` · ${s}`)
                              .join('')}
                  </span>
                </span>
                <ReviewTag issues={it.issues} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
