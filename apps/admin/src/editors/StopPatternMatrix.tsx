/** 정차 패턴 매트릭스(FR-ADM-052): 운행 계통 노선들의 노선역(행) × 패턴(열), ● 정차 / — 통과 */
import { useQueries } from '@tanstack/react-query';
import { codeLabel, codes, type StopPattern } from '@k-raildex/contracts';
import { Button, cn, Input, Select } from '@k-raildex/ui';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useLabel } from '../form/widgets/RefInput';

interface LsItem {
  id: string;
  station_id: string;
  station_name_ko: string | null;
  name_ko: string | null;
  station_code: string | null;
  status: string;
}

interface Candidate {
  id: string;
  label: string;
  code: string | null;
  lineId: string | null;
  status: string | null;
}

/** 패턴 stops 를 후보 순서대로 다시 정렬(후보에 없는 정차역은 원래 자리 순서를 지켜 뒤에) */
export function orderStops(stops: string[], candidates: string[]): string[] {
  const set = new Set(stops);
  const inCand = candidates.filter((c) => set.has(c));
  const extra = stops.filter((s) => !candidates.includes(s));
  return [...inCand, ...extra];
}

export function StopPatternMatrix({
  value,
  onChange,
  lines,
}: {
  value: StopPattern[];
  onChange: (v: StopPattern[]) => void;
  lines: string[];
}) {
  const results = useQueries({
    queries: lines.map((lineId) => ({
      queryKey: ['line-stations', lineId],
      queryFn: () => api<{ items: LsItem[] }>(`/v1/admin/lines/${encodeURIComponent(lineId)}/stations`),
    })),
  });
  const candidates: Candidate[] = [];
  results.forEach((r, i) => {
    for (const it of r.data?.items ?? [])
      candidates.push({
        id: it.id,
        label: it.name_ko ?? it.station_name_ko ?? it.station_id,
        code: it.station_code,
        lineId: lines[i]!,
        status: it.status,
      });
  });
  const candIds = candidates.map((c) => c.id);
  // 패턴에 있지만 후보(계통 노선의 노선역)에 없는 정차역 — V-H05 위반 후보
  for (const p of value)
    for (const s of p.stops)
      if (!candIds.includes(s) && !candidates.some((c) => c.id === s))
        candidates.push({ id: s, label: s, code: null, lineId: null, status: null });

  const loading = results.some((r) => r.isLoading);
  const setPattern = (i: number, patch: Partial<StopPattern>) =>
    onChange(value.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const toggle = (i: number, lsId: string) => {
    const p = value[i]!;
    const stops = p.stops.includes(lsId) ? p.stops.filter((s) => s !== lsId) : [...p.stops, lsId];
    setPattern(i, { stops: orderStops(stops, candIds) });
  };
  const addPattern = () => {
    let n = value.length + 1;
    while (value.some((p) => p.code === `p${n}`)) n++;
    onChange([
      ...value,
      { code: `p${n}`, name_ko: `패턴 ${n}`, name_en: null, type: 'local', note: null, stops: [...candIds] },
    ]);
  };

  if (lines.length === 0)
    return (
      <p className="text-sm text-fg-muted">
        먼저 [노선 순서]에 소속 노선을 넣으세요. 후보 역은 그 노선들의 노선역입니다.
      </p>
    );

  let prevLine: string | null | undefined;
  return (
    <div className="flex flex-col gap-2" data-testid="stop-pattern-matrix">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="text-sm">
          <thead className="bg-muted/50 text-xs">
            <tr>
              <th className="sticky left-0 min-w-44 bg-muted px-2 py-1.5 text-left font-medium text-fg-muted">
                노선역 ({candidates.length})
              </th>
              {value.map((p, i) => (
                <th key={i} className="min-w-36 border-l border-border px-1.5 py-1.5 align-top font-normal">
                  <div className="flex flex-col gap-1">
                    <div className="flex gap-1">
                      <Input
                        className="h-7 px-1.5 text-xs"
                        aria-label="패턴 코드"
                        value={p.code}
                        onChange={(e) => setPattern(i, { code: e.target.value })}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        aria-label="패턴 삭제"
                        onClick={() => onChange(value.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                    <Input
                      className="h-7 px-1.5 text-xs"
                      aria-label="패턴 이름"
                      value={p.name_ko}
                      onChange={(e) => setPattern(i, { name_ko: e.target.value })}
                    />
                    <Select
                      className="h-7 px-1.5 text-xs"
                      aria-label="패턴 유형"
                      value={p.type}
                      onChange={(e) => setPattern(i, { type: e.target.value as StopPattern['type'] })}
                    >
                      {codes.stopPatternType.values.map((t) => (
                        <option key={t} value={t}>
                          {codeLabel('stopPatternType', t)}
                        </option>
                      ))}
                    </Select>
                    <span className={cn('text-[11px]', p.stops.length < 2 ? 'text-danger' : 'text-fg-muted')}>
                      정차 {p.stops.length}역{p.stops.length < 2 ? ' — 2역 이상 필요(V-H05)' : ''}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => {
              const header = c.lineId !== prevLine;
              prevLine = c.lineId;
              return (
                <CandidateRows key={c.id} c={c} header={header} cols={value.length}>
                  {value.map((p, i) => {
                    const on = p.stops.includes(c.id);
                    return (
                      <td key={i} className="border-l border-border text-center">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          aria-label={`${p.name_ko}: ${c.label}`}
                          onClick={() => toggle(i, c.id)}
                          className={cn(
                            'h-7 w-full text-base leading-none hover:bg-muted',
                            on ? 'font-bold text-primary' : 'text-fg-muted',
                          )}
                        >
                          {on ? '●' : '—'}
                        </button>
                      </td>
                    );
                  })}
                </CandidateRows>
              );
            })}
          </tbody>
        </table>
        {loading ? <p className="p-2 text-xs text-fg-muted">노선역 불러오는 중…</p> : null}
      </div>
      <Button variant="secondary" size="sm" className="self-start" onClick={addPattern}>
        <Plus className="size-4" /> 패턴 추가
      </Button>
    </div>
  );
}

function CandidateRows({
  c,
  header,
  cols,
  children,
}: {
  c: Candidate;
  header: boolean;
  cols: number;
  children: React.ReactNode;
}) {
  return (
    <>
      {header ? (
        <tr className="border-t border-border bg-muted/30">
          <td colSpan={cols + 1} className="sticky left-0 px-2 py-1 text-xs font-semibold">
            {c.lineId ? <LineName id={c.lineId} /> : '계통 노선 밖 정차역(V-H05 확인)'}
          </td>
        </tr>
      ) : null}
      <tr className="border-t border-border">
        <td className="sticky left-0 bg-bg-elevated px-2 py-0.5">
          <span className={cn(c.status && c.status !== 'operating' && 'text-fg-muted')}>{c.label}</span>
          {c.code ? <span className="ml-1 text-xs text-fg-muted">{c.code}</span> : null}
          {c.status && c.status !== 'operating' ? (
            <span className="ml-1 text-[11px] text-warn">{codeLabel('status', c.status as 'planned')}</span>
          ) : null}
        </td>
        {children}
      </tr>
    </>
  );
}

function LineName({ id }: { id: string }) {
  const l = useLabel('line', id);
  return <>{l.data?.label ?? id}</>;
}
