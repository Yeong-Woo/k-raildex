/**
 * 외부 API 탐색기(FR-ADM-100~106): 카탈로그(제공처별) · 호출(매개변수 폼, 역 선택기로 외부 코드 채우기) · 결과(상태·결과 코드·원문·표·CSV)
 * · 다음 쪽/전체 쪽 · 스냅샷 · DB 와 비교 · 호출 기록 · 즐겨찾기 · 키 상태 · 오늘 호출 수/일일 한도.
 * 키는 서버가 붙이고 가린다 — 이 화면은 키 값을 받지도 보이지도 않는다.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Empty,
  FieldShell,
  Input,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@k-raildex/ui';
import { RefInput } from '../form/widgets/RefInput';
import { api, errorText, qs } from '../lib/api';
import { toSlug } from '../lib/entity-types';
import type { EntityType } from '@k-raildex/contracts';

// ---------------------------------------------------------------------------
// 형식
// ---------------------------------------------------------------------------

interface ParamDef {
  name: string;
  label?: string;
  description?: string;
  required?: boolean;
  default?: string;
  example?: string;
  kind?: 'text' | 'int' | 'date' | 'enum' | 'station_ref';
  ref_system?: string;
  options?: string[];
  fixed?: boolean;
}

export interface Endpoint {
  id: string;
  provider: string;
  name_ko: string;
  method: string;
  base_url: string;
  params: ParamDef[];
  key_param: string | null;
  key_env: string | null;
  response_format: 'xml' | 'json';
  rows_path: string | null;
  paging: Record<string, string> | null;
  compare: { code_field: string; name_field?: string; lat_field?: string; lng_field?: string } | null;
  daily_limit: number | null;
  external_system: string | null;
  source_id: string | null;
  doc_url: string | null;
  note: string | null;
  version: number;
  today_calls: number;
  key_configured: boolean | null;
}

type Row = Record<string, unknown>;

interface CallResult {
  call_id: number;
  endpoint_id: string;
  called_at: string;
  params: Record<string, string>;
  url: string;
  status: number | null;
  elapsed_ms: number | null;
  ok: boolean;
  result_code: string | null;
  result_message: string | null;
  content_type: string | null;
  size_bytes: number | null;
  raw: string | null;
  raw_truncated: boolean;
  rows: Row[];
  rows_path: string | null;
  rows_truncated: boolean;
  row_count: number;
  page_info: {
    page: number;
    size: number | null;
    total: number | null;
    has_next: boolean;
    next_params: Record<string, string> | null;
  } | null;
  snapshot_document_id: string | null;
  today_calls: number;
  daily_limit: number | null;
}

interface AllPages {
  call_ids: number[];
  pages: number;
  rows: Row[];
  row_count: number;
  rows_truncated: boolean;
  total: number | null;
  stopped: string;
  last: CallResult;
}

interface CallItem {
  id: number;
  endpoint_id: string;
  params: Record<string, string>;
  called_at: string;
  status: number | null;
  elapsed_ms: number | null;
  result_code: string | null;
  result_message: string | null;
  has_body: boolean;
  snapshot_document_id: string | null;
}

interface Preset {
  id: number;
  endpoint_id: string;
  name: string;
  params: Record<string, string>;
}

interface KeyStatus {
  provider: string;
  key_env: string;
  fallback_env: string | null;
  configured: boolean;
  using_env: string | null;
  last_success_at: string | null;
}

interface ComparePair {
  row_index: number;
  external: { code: string | null; name: string | null; lat: number | null; lng: number | null };
  entity_id: string | null;
  label: string | null;
  link_type: string | null;
  link_id: string | null;
  status: 'same' | 'diff' | 'missing';
  diffs: { field: string; external: unknown; db: unknown; distance_m?: number }[];
}
interface CompareResult {
  external_system: string;
  pairs: ComparePair[];
  summary: { rows: number; matched: number; same: number; diff: number; missing: number };
}

export interface ExternalSearch {
  endpoint?: string;
  tab?: 'call' | 'history' | 'edit';
}

const STOPPED: Record<string, string> = {
  done: '끝까지 받음',
  page_cap: '쪽 수 상한에서 멈춤',
  daily_limit: '일일 한도에서 멈춤',
  error: '오류 응답에서 멈춤',
  no_paging: '페이지 설정 없음(1쪽)',
};

const cell = (v: unknown) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const fmtTime = (s: string | null) => (s ? new Date(s).toLocaleString('ko-KR', { hour12: false }) : '-');

function csvOf(cols: string[], rows: Row[]): string {
  const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [cols.map(esc).join(','), ...rows.map((r) => cols.map((c) => esc(cell(r[c]))).join(','))].join('\r\n');
}

function download(name: string, text: string) {
  const blob = new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------------------
// 화면
// ---------------------------------------------------------------------------

export function External() {
  const search = useSearch({ from: '/external' });
  const navigate = useNavigate({ from: '/external' });
  const qc = useQueryClient();
  const endpoints = useQuery({
    queryKey: ['ext-endpoints'],
    queryFn: () => api<{ items: Endpoint[] }>('/v1/admin/external/endpoints'),
  });
  const providers = useQuery({
    queryKey: ['ext-providers'],
    queryFn: () =>
      api<{ items: { code: string; label: string; common_key_env: string | null }[] }>('/v1/admin/external/providers'),
    staleTime: Infinity,
  });
  const keys = useQuery({
    queryKey: ['ext-keys'],
    queryFn: () => api<{ items: KeyStatus[] }>('/v1/admin/external/keys'),
  });
  const seed = useMutation({
    mutationFn: () =>
      api<{ created: string[]; updated: string[] }>('/v1/admin/external/catalog/seed', { method: 'POST' }),
    onSuccess: async (r) => {
      toast.success(`초기 카탈로그: 새로 ${r.created.length} · 갱신 ${r.updated.length}`);
      await qc.invalidateQueries({ queryKey: ['ext-endpoints'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const providerLabel = (p: string) => providers.data?.items.find((x) => x.code === p)?.label ?? p;
  const groups = useMemo(() => {
    const m = new Map<string, Endpoint[]>();
    for (const e of endpoints.data?.items ?? []) m.set(e.provider, [...(m.get(e.provider) ?? []), e]);
    return [...m.entries()];
  }, [endpoints.data]);
  const selected = endpoints.data?.items.find((e) => e.id === search.endpoint) ?? null;
  const tab = search.tab ?? 'call';
  const creating = search.endpoint === '__new';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-bold">외부 API</h1>
        <span className="text-xs text-fg-muted">조회·대조용 — 결과가 DB 개체를 바꾸지 않습니다. 남기려면 스냅샷.</span>
        <Button className="ml-auto" size="sm" variant="secondary" onClick={() => seed.mutate()}>
          초기 카탈로그 넣기
        </Button>
        <Button size="sm" onClick={() => void navigate({ search: { endpoint: '__new', tab: 'edit' } })}>
          새 엔드포인트
        </Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <Card data-testid="external-catalog">
            <CardHeader title="카탈로그" />
            {!groups.length ? (
              <Empty>{endpoints.isLoading ? '불러오는 중…' : '등록된 엔드포인트 없음'}</Empty>
            ) : (
              <div className="flex flex-col gap-2 p-2">
                {groups.map(([provider, list]) => (
                  <div key={provider}>
                    <div className="px-1 text-xs font-semibold text-fg-muted">{providerLabel(provider)}</div>
                    {list.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => void navigate({ search: { endpoint: e.id, tab: search.tab ?? 'call' } })}
                        className={`flex w-full flex-col rounded px-2 py-1 text-left text-sm hover:bg-muted ${e.id === search.endpoint ? 'bg-muted font-medium' : ''}`}
                      >
                        <span>{e.name_ko}</span>
                        <span className="text-xs text-fg-muted">
                          {e.id} · 오늘 {e.today_calls}
                          {e.daily_limit ? `/${e.daily_limit}` : ''}
                          {e.key_configured === false ? ' · 키 없음' : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card data-testid="external-keys">
            <CardHeader
              title="키 상태"
              actions={
                <Button size="sm" variant="ghost" onClick={() => void keys.refetch()}>
                  점검
                </Button>
              }
            />
            <ul className="flex flex-col gap-1 p-2 text-xs">
              {(keys.data?.items ?? []).map((k) => (
                <li key={`${k.provider}-${k.key_env}`} className="flex flex-wrap items-center gap-1">
                  <Badge tone={k.configured ? 'good' : 'warn'}>{k.configured ? '있음' : '없음'}</Badge>
                  <code>{k.key_env}</code>
                  {k.fallback_env ? <span className="text-fg-muted">→ {k.fallback_env}</span> : null}
                  <span className="w-full pl-1 text-fg-muted">
                    {k.using_env ? `사용: ${k.using_env}` : ''} · 최근 성공 {fmtTime(k.last_success_at)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="min-w-0">
          {creating ? (
            <EndpointEditor
              endpoint={null}
              providers={providers.data?.items ?? []}
              onSaved={(id) => void navigate({ search: { endpoint: id, tab: 'call' } })}
            />
          ) : !selected ? (
            <Card>
              <Empty>왼쪽에서 엔드포인트를 고르세요</Empty>
            </Card>
          ) : (
            <Tabs
              value={tab}
              onValueChange={(t) =>
                void navigate({ search: { endpoint: selected.id, tab: t as ExternalSearch['tab'] } })
              }
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{selected.name_ko}</h2>
                <Badge>{providerLabel(selected.provider)}</Badge>
                {selected.doc_url ? (
                  <a
                    href={selected.doc_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    문서
                  </a>
                ) : null}
                <TabsList className="ml-auto">
                  <TabsTrigger value="call">호출</TabsTrigger>
                  <TabsTrigger value="history">기록</TabsTrigger>
                  <TabsTrigger value="edit">편집</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="call">
                <CallPanel key={selected.id} endpoint={selected} />
              </TabsContent>
              <TabsContent value="history">
                <HistoryPanel endpoint={selected} />
              </TabsContent>
              <TabsContent value="edit">
                <EndpointEditor
                  key={`${selected.id}-${selected.version}`}
                  endpoint={selected}
                  providers={providers.data?.items ?? []}
                  onSaved={(id) => void navigate({ search: { endpoint: id, tab: 'edit' } })}
                  onDeleted={() => void navigate({ search: {} })}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 호출
// ---------------------------------------------------------------------------

function initialParams(e: Endpoint): Record<string, string> {
  return Object.fromEntries(e.params.map((p) => [p.name, p.default ?? '']));
}

function StationCodeInput({ def, value, onChange }: { def: ParamDef; value: string; onChange: (v: string) => void }) {
  const [station, setStation] = useState<string | null>(null);
  const [choices, setChoices] = useState<{ code: string; label: string | null }[]>([]);
  useEffect(() => {
    if (!station || !def.ref_system) return;
    let live = true;
    void api<{ items: { code: string; entity_id: string; label: string | null }[] }>(
      `/v1/admin/external/ref-codes${qs({ entity_id: station, system: def.ref_system })}`,
    ).then((r) => {
      if (!live) return;
      setChoices(r.items);
      if (r.items[0]) onChange(r.items[0].code);
      else toast.warning(`이 역에 ${def.ref_system} 외부 코드가 없습니다`);
    });
    return () => {
      live = false;
    };
  }, [station, def.ref_system]);
  return (
    <div className="flex flex-col gap-1">
      <RefInput target="station" value={station} onChange={setStation} />
      <div className="flex gap-1">
        <Input
          aria-label={def.label ?? def.name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.example}
        />
        {choices.length > 1 ? (
          <Select
            aria-label="외부 코드 고르기"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-48"
          >
            {choices.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} {c.label ?? ''}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
    </div>
  );
}

function CallPanel({ endpoint: e }: { endpoint: Endpoint }) {
  const qc = useQueryClient();
  const [params, setParams] = useState<Record<string, string>>(() => initialParams(e));
  const [result, setResult] = useState<CallResult | null>(null);
  const [allRows, setAllRows] = useState<AllPages | null>(null);
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [maxPages, setMaxPages] = useState('20');
  const presets = useQuery({
    queryKey: ['ext-presets', e.id],
    queryFn: () => api<{ items: Preset[] }>(`/v1/admin/external/endpoints/${encodeURIComponent(e.id)}/presets`),
  });
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['ext-endpoints'] }),
      qc.invalidateQueries({ queryKey: ['ext-calls', e.id] }),
      qc.invalidateQueries({ queryKey: ['ext-keys'] }),
    ]);
  const body = (p: Record<string, string>) =>
    Object.fromEntries(Object.entries(p).filter(([k, v]) => v !== '' && !e.params.find((d) => d.name === k)?.fixed));

  const call = useMutation({
    mutationFn: (p: Record<string, string>) =>
      api<CallResult>(`/v1/admin/external/endpoints/${encodeURIComponent(e.id)}/call`, {
        method: 'POST',
        json: body(p),
      }),
    onSuccess: async (r) => {
      setResult(r);
      setAllRows(null);
      setCompare(null);
      setParams((cur) => ({ ...cur, ...r.params }));
      if (!r.ok) toast.error(`외부 오류: ${r.result_code ?? r.status} ${r.result_message ?? ''}`);
      await refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const callAll = useMutation({
    mutationFn: () =>
      api<AllPages>(
        `/v1/admin/external/endpoints/${encodeURIComponent(e.id)}/call-all-pages${qs({ max_pages: maxPages })}`,
        {
          method: 'POST',
          json: body(params),
        },
      ),
    onSuccess: async (r) => {
      setResult(r.last);
      setAllRows(r);
      setCompare(null);
      toast.success(`${r.pages}쪽 ${r.row_count}행 — ${STOPPED[r.stopped] ?? r.stopped}`);
      await refresh();
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const snapshot = useMutation({
    mutationFn: (id: number) =>
      api<{ id: string; existing: boolean }>(`/v1/admin/external/calls/${id}/snapshot`, { method: 'POST' }),
    onSuccess: (d) => {
      toast.success(d.existing ? '이미 저장한 스냅샷입니다' : '스냅샷 문서로 저장했습니다');
      setResult((r) => (r ? { ...r, snapshot_document_id: d.id } : r));
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const doCompare = useMutation({
    mutationFn: (id: number) => api<CompareResult>(`/v1/admin/external/calls/${id}/compare`, { method: 'POST' }),
    onSuccess: setCompare,
    onError: (err) => toast.error(errorText(err)),
  });
  const savePreset = useMutation({
    mutationFn: (name: string) =>
      api<Preset>(`/v1/admin/external/endpoints/${encodeURIComponent(e.id)}/presets`, {
        method: 'POST',
        json: { name, params: body(params) },
      }),
    onSuccess: async () => {
      toast.success('즐겨찾기에 저장했습니다');
      await qc.invalidateQueries({ queryKey: ['ext-presets', e.id] });
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const delPreset = useMutation({
    mutationFn: (id: number) => api<void>(`/v1/admin/external/presets/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ext-presets', e.id] }),
  });

  const limitNear = e.daily_limit != null && e.today_calls >= e.daily_limit * 0.8;
  const limitHit = e.daily_limit != null && e.today_calls >= e.daily_limit;
  const busy = call.isPending || callAll.isPending;

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <code className="break-all">
            {e.method} {e.base_url}
          </code>
          <span data-testid="external-today">
            오늘 {e.today_calls}
            {e.daily_limit ? ` / 한도 ${e.daily_limit}` : ''}
          </span>
          {limitHit ? <Badge tone="danger">한도 도달</Badge> : limitNear ? <Badge tone="warn">한도 근접</Badge> : null}
          {e.key_param ? (
            <Badge tone={e.key_configured ? 'good' : 'warn'}>
              키 {e.key_configured ? '설정됨' : `없음(${e.key_env ?? ''})`}
            </Badge>
          ) : null}
        </div>
        {e.note ? <p className="text-xs text-fg-muted">{e.note}</p> : null}
        {presets.data?.items.length ? (
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <span className="text-xs text-fg-muted">즐겨찾기</span>
            {presets.data.items.map((p) => (
              <span key={p.id} className="inline-flex items-center rounded border border-border">
                <button
                  type="button"
                  className="px-2 py-0.5 hover:bg-muted"
                  onClick={() => setParams({ ...initialParams(e), ...p.params })}
                >
                  {p.name}
                </button>
                <button
                  type="button"
                  aria-label={`${p.name} 삭제`}
                  className="px-1 text-fg-muted hover:text-danger"
                  onClick={() => delPreset.mutate(p.id)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2" data-testid="external-params">
          {e.params.map((p) => {
            const id = `ext-p-${p.name}`;
            const label = `${p.label ?? p.name}${p.required ? ' *' : ''}`;
            const set = (v: string) => setParams((cur) => ({ ...cur, [p.name]: v }));
            return (
              <FieldShell
                key={p.name}
                label={label}
                htmlFor={id}
                help={[p.name, p.description, p.example ? `예: ${p.example}` : ''].filter(Boolean).join(' · ')}
              >
                {p.fixed ? (
                  <Input id={id} value={p.default ?? ''} disabled />
                ) : p.kind === 'enum' ? (
                  <Select id={id} value={params[p.name] ?? ''} onChange={(ev) => set(ev.target.value)}>
                    {!p.required ? <option value="">(없음)</option> : null}
                    {(p.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </Select>
                ) : p.kind === 'station_ref' ? (
                  <StationCodeInput def={p} value={params[p.name] ?? ''} onChange={set} />
                ) : (
                  <Input
                    id={id}
                    value={params[p.name] ?? ''}
                    onChange={(ev) => set(ev.target.value)}
                    placeholder={p.example}
                  />
                )}
              </FieldShell>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy || limitHit} onClick={() => call.mutate(params)}>
            호출
          </Button>
          {e.paging ? (
            <>
              <Button variant="secondary" disabled={busy || limitHit} onClick={() => callAll.mutate()}>
                전체 쪽 받기
              </Button>
              <label className="flex items-center gap-1 text-xs text-fg-muted">
                쪽 수 상한
                <Input
                  className="h-8 w-16"
                  value={maxPages}
                  onChange={(ev) => setMaxPages(ev.target.value.replace(/\D/g, ''))}
                />
              </label>
            </>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => {
              const name = window.prompt('즐겨찾기 이름');
              if (name?.trim()) savePreset.mutate(name.trim());
            }}
          >
            즐겨찾기로 저장
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setParams(initialParams(e))}>
            초기화
          </Button>
        </div>
      </Card>
      {result ? (
        <ResultPanel
          endpoint={e}
          result={result}
          allPages={allRows}
          compare={compare}
          busy={busy}
          onNext={(p) => {
            setParams((cur) => ({ ...cur, ...p }));
            call.mutate({ ...params, ...p });
          }}
          onSnapshot={() => snapshot.mutate(result.call_id)}
          onCompare={() => doCompare.mutate(result.call_id)}
        />
      ) : null}
    </div>
  );
}

function ResultPanel({
  endpoint: e,
  result: r,
  allPages,
  compare,
  busy,
  onNext,
  onSnapshot,
  onCompare,
}: {
  endpoint: Endpoint;
  result: CallResult;
  allPages: AllPages | null;
  compare: CompareResult | null;
  busy: boolean;
  onNext: (p: Record<string, string>) => void;
  onSnapshot: () => void;
  onCompare: () => void;
}) {
  const rows = allPages ? allPages.rows : r.rows;
  const allCols = useMemo(() => {
    const s = new Set<string>();
    for (const row of rows.slice(0, 300)) for (const k of Object.keys(row)) s.add(k);
    return [...s];
  }, [rows]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [rawQuery, setRawQuery] = useState('');
  const [view, setView] = useState<'table' | 'raw'>('table');
  const cols = allCols.filter((c) => !hidden.has(c));
  const rawHits = useMemo(() => {
    if (!rawQuery || !r.raw) return 0;
    return r.raw.split(rawQuery).length - 1;
  }, [rawQuery, r.raw]);
  const rawShown = useMemo(() => {
    if (!r.raw) return '';
    if (!rawQuery) return r.raw.slice(0, 200_000);
    // 검색어가 있으면 그 줄만
    return r.raw
      .split('\n')
      .filter((l) => l.includes(rawQuery))
      .join('\n')
      .slice(0, 200_000);
  }, [rawQuery, r.raw]);

  return (
    <Card data-testid="external-result">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 text-sm">
        <Badge tone={r.ok ? 'good' : 'danger'}>{r.ok ? '성공' : '실패'}</Badge>
        <span>HTTP {r.status ?? '-'}</span>
        <span className="text-fg-muted">{r.elapsed_ms ?? '-'}ms</span>
        {r.result_code ? (
          <span data-testid="external-result-code">
            결과 코드 <code>{r.result_code}</code> {r.result_message ?? ''}
          </span>
        ) : null}
        <span className="text-fg-muted">
          {allPages
            ? `${allPages.pages}쪽 · ${allPages.row_count}행 (${STOPPED[allPages.stopped] ?? allPages.stopped})`
            : `${r.row_count}행`}
          {r.page_info?.total != null ? ` / 전체 ${r.page_info.total}` : ''}
        </span>
        <div className="ml-auto flex gap-1">
          {r.page_info?.has_next && r.page_info.next_params && !allPages ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onNext(r.page_info!.next_params!)}>
              다음 쪽
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" disabled={!r.raw} onClick={onSnapshot}>
            스냅샷 저장
          </Button>
          {e.compare && e.external_system ? (
            <Button size="sm" variant="secondary" disabled={!r.raw} onClick={onCompare}>
              DB와 비교
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <code className="text-xs break-all text-fg-muted" data-testid="external-url">
          {r.url}
        </code>
        {r.snapshot_document_id ? (
          <p className="text-xs">
            스냅샷 문서 <code>{r.snapshot_document_id}</code>
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as 'table' | 'raw')}>
            <TabsList>
              <TabsTrigger value="table">표</TabsTrigger>
              <TabsTrigger value="raw">원문</TabsTrigger>
            </TabsList>
          </Tabs>
          {view === 'table' && rows.length ? (
            <>
              <details className="relative text-xs">
                <summary className="cursor-pointer text-fg-muted">
                  열 선택({cols.length}/{allCols.length})
                </summary>
                <div className="absolute z-10 mt-1 max-h-64 w-64 overflow-auto rounded border border-border bg-bg-elevated p-2 shadow">
                  {allCols.map((c) => (
                    <label key={c} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={!hidden.has(c)}
                        onChange={(ev) => {
                          const n = new Set(hidden);
                          if (ev.target.checked) n.delete(c);
                          else n.add(c);
                          setHidden(n);
                        }}
                      />
                      {c}
                    </label>
                  ))}
                </div>
              </details>
              <Button size="sm" variant="ghost" onClick={() => download(`${e.id}-${r.call_id}.csv`, csvOf(cols, rows))}>
                CSV 내보내기
              </Button>
            </>
          ) : null}
          {view === 'raw' ? (
            <Input
              className="h-8 w-64"
              placeholder="원문 검색"
              value={rawQuery}
              onChange={(ev) => setRawQuery(ev.target.value)}
            />
          ) : null}
          {view === 'raw' && rawQuery ? <span className="text-xs text-fg-muted">{rawHits}건</span> : null}
        </div>
        {view === 'table' ? (
          !rows.length ? (
            <Empty>반복 항목을 찾지 못했습니다 — 원문을 보거나 카탈로그의 rows_path 를 지정하세요</Empty>
          ) : (
            <div className="max-h-[60vh] overflow-auto" data-testid="external-rows">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-bg-elevated text-left text-fg-muted">
                  <tr>
                    <th className="px-2 py-1">#</th>
                    {cols.map((c) => (
                      <th key={c} className="px-2 py-1">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 2000).map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1 text-fg-muted">{i + 1}</td>
                      {cols.map((c) => (
                        <td key={c} className="px-2 py-1 whitespace-nowrap">
                          {cell(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 2000 ? (
                <p className="p-2 text-xs text-fg-muted">앞 2,000행만 표시 — CSV 로 전부 받기</p>
              ) : null}
            </div>
          )
        ) : (
          <details open={!!rawQuery}>
            <summary className="cursor-pointer text-xs text-fg-muted">
              원문 {r.content_type ?? ''} {r.size_bytes != null ? `${r.size_bytes.toLocaleString()} 바이트` : ''}
              {r.raw_truncated ? ' (앞부분만)' : ''}
            </summary>
            <pre
              className="max-h-[60vh] overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap"
              data-testid="external-raw"
            >
              {rawShown}
            </pre>
          </details>
        )}
        {compare ? <CompareTable compare={compare} /> : null}
      </div>
    </Card>
  );
}

function CompareTable({ compare }: { compare: CompareResult }) {
  const [onlyDiff, setOnlyDiff] = useState(false);
  const pairs = onlyDiff ? compare.pairs.filter((p) => p.status !== 'same') : compare.pairs;
  return (
    <div className="flex flex-col gap-1" data-testid="external-compare">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-semibold">DB 와 비교({compare.external_system})</span>
        <Badge tone="good">같음 {compare.summary.same}</Badge>
        <Badge tone="warn">차이 {compare.summary.diff}</Badge>
        <Badge tone="danger">DB 에 없음 {compare.summary.missing}</Badge>
        <label className="ml-auto flex items-center gap-1 text-xs">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> 차이만
        </label>
      </div>
      <div className="max-h-[50vh] overflow-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-fg-muted">
            <tr>
              <th className="px-2 py-1">외부 코드</th>
              <th className="px-2 py-1">외부 이름</th>
              <th className="px-2 py-1">우리 개체</th>
              <th className="px-2 py-1">차이</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p, i) => (
              <tr
                key={`${p.row_index}-${p.entity_id ?? i}`}
                className={`border-t border-border ${p.status === 'diff' ? 'bg-warn/10' : p.status === 'missing' ? 'bg-danger/5' : ''}`}
              >
                <td className="px-2 py-1">{p.external.code}</td>
                <td className="px-2 py-1">{p.external.name}</td>
                <td className="px-2 py-1">
                  {p.entity_id && p.link_type && p.link_id ? (
                    <Link
                      to="/data/$type/$id"
                      params={{ type: toSlug(p.link_type as EntityType), id: p.link_id }}
                      className="hover:underline"
                    >
                      {p.label ?? p.entity_id} <span className="text-fg-muted">{p.entity_id}</span>
                    </Link>
                  ) : (
                    <span className="text-danger">DB 에 없음</span>
                  )}
                </td>
                <td className="px-2 py-1">
                  {p.diffs.map((d, j) => (
                    <div key={j}>
                      {d.field === 'name'
                        ? `이름: ${String(d.external)} ≠ ${String(d.db)}`
                        : `좌표 ${d.distance_m}m 차이`}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 기록
// ---------------------------------------------------------------------------

function HistoryPanel({ endpoint: e }: { endpoint: Endpoint }) {
  const calls = useQuery({
    queryKey: ['ext-calls', e.id],
    queryFn: () =>
      api<{ items: CallItem[]; total: number }>(`/v1/admin/external/calls${qs({ endpoint_id: e.id, limit: 100 })}`),
  });
  const [open, setOpen] = useState<CallResult | null>(null);
  const load = useMutation({
    mutationFn: (id: number) => api<CallResult>(`/v1/admin/external/calls/${id}`),
    onSuccess: setOpen,
    onError: (err) => toast.error(errorText(err)),
  });
  const qc = useQueryClient();
  const rerun = useMutation({
    mutationFn: (p: Record<string, string>) =>
      api<CallResult>(`/v1/admin/external/endpoints/${encodeURIComponent(e.id)}/call`, {
        method: 'POST',
        json: Object.fromEntries(Object.entries(p).filter(([k]) => !e.params.find((d) => d.name === k)?.fixed)),
      }),
    onSuccess: async (r) => {
      setOpen(r);
      await qc.invalidateQueries({ queryKey: ['ext-calls', e.id] });
      await qc.invalidateQueries({ queryKey: ['ext-endpoints'] });
    },
    onError: (err) => toast.error(errorText(err)),
  });
  const [compare, setCompare] = useState<CompareResult | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <Card data-testid="external-history">
        {!calls.data?.items.length ? (
          <Empty>{calls.isLoading ? '불러오는 중…' : '호출 기록 없음'}</Empty>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-left text-fg-muted">
              <tr>
                <th className="px-2 py-1">시각</th>
                <th className="px-2 py-1">매개변수</th>
                <th className="px-2 py-1">상태</th>
                <th className="px-2 py-1">결과 코드</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {calls.data.items.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-2 py-1 whitespace-nowrap">{fmtTime(c.called_at)}</td>
                  <td className="px-2 py-1 font-mono">
                    {Object.entries(c.params)
                      .map(([k, v]) => `${k}=${v}`)
                      .join('&')}
                  </td>
                  <td className="px-2 py-1">
                    {c.status ?? '-'} · {c.elapsed_ms ?? '-'}ms
                  </td>
                  <td className="px-2 py-1">
                    {c.result_code ?? ''} {c.result_message ?? ''}
                    {c.snapshot_document_id ? <Badge tone="info">스냅샷</Badge> : null}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <Button size="sm" variant="ghost" disabled={!c.has_body} onClick={() => load.mutate(c.id)}>
                      보기
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => rerun.mutate(c.params)}>
                      다시 실행
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {open ? (
        <ResultPanel
          endpoint={e}
          result={open}
          allPages={null}
          compare={compare}
          busy={rerun.isPending}
          onNext={(p) => rerun.mutate({ ...open.params, ...p })}
          onSnapshot={() =>
            void api<{ id: string; existing: boolean }>(`/v1/admin/external/calls/${open.call_id}/snapshot`, {
              method: 'POST',
            })
              .then((d) => {
                toast.success(d.existing ? '이미 저장한 스냅샷입니다' : '스냅샷 문서로 저장했습니다');
                setOpen({ ...open, snapshot_document_id: d.id });
              })
              .catch((err: unknown) => toast.error(errorText(err)))
          }
          onCompare={() =>
            void api<CompareResult>(`/v1/admin/external/calls/${open.call_id}/compare`, { method: 'POST' })
              .then(setCompare)
              .catch((err: unknown) => toast.error(errorText(err)))
          }
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 편집
// ---------------------------------------------------------------------------

const PARAMS_HELP =
  '[{"name","label","required","default","example","kind":"text|int|date|enum|station_ref","ref_system","options":[],"fixed"}] — base_url 의 {이름} 자리는 경로에 들어간다';

function EndpointEditor({
  endpoint,
  providers,
  onSaved,
  onDeleted,
}: {
  endpoint: Endpoint | null;
  providers: { code: string; label: string; common_key_env: string | null }[];
  onSaved: (id: string) => void;
  onDeleted?: () => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState(() => ({
    id: endpoint?.id ?? '',
    provider: endpoint?.provider ?? 'data_go_kr',
    name_ko: endpoint?.name_ko ?? '',
    method: endpoint?.method ?? 'GET',
    base_url: endpoint?.base_url ?? '',
    response_format: endpoint?.response_format ?? 'json',
    key_param: endpoint?.key_param ?? '',
    key_env: endpoint?.key_env ?? '',
    rows_path: endpoint?.rows_path ?? '',
    daily_limit: endpoint?.daily_limit != null ? String(endpoint.daily_limit) : '',
    external_system: endpoint?.external_system ?? '',
    source_id: endpoint?.source_id ?? null,
    doc_url: endpoint?.doc_url ?? '',
    note: endpoint?.note ?? '',
    params: JSON.stringify(endpoint?.params ?? [], null, 2),
    paging: endpoint?.paging ? JSON.stringify(endpoint.paging, null, 2) : '',
    compare: endpoint?.compare ? JSON.stringify(endpoint.compare, null, 2) : '',
  }));
  const set = (k: keyof typeof f) => (v: string | null) => setF((cur) => ({ ...cur, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const parseJson = (label: string, s: string) => {
        if (!s.trim()) return null;
        try {
          return JSON.parse(s) as unknown;
        } catch {
          throw new Error(`${label}: JSON 형식 오류`);
        }
      };
      const nul = (s: string) => (s.trim() ? s.trim() : null);
      const body = {
        provider: f.provider,
        name_ko: f.name_ko,
        method: f.method,
        base_url: f.base_url.trim(),
        response_format: f.response_format,
        key_param: nul(f.key_param),
        key_env: nul(f.key_env),
        rows_path: nul(f.rows_path),
        daily_limit: f.daily_limit.trim() ? Number(f.daily_limit) : null,
        external_system: nul(f.external_system),
        source_id: f.source_id,
        doc_url: nul(f.doc_url),
        note: nul(f.note),
        params: parseJson('매개변수', f.params) ?? [],
        paging: parseJson('페이지', f.paging),
        compare: parseJson('비교', f.compare),
      };
      return endpoint
        ? api<Endpoint>(`/v1/admin/external/endpoints/${encodeURIComponent(endpoint.id)}`, {
            method: 'PATCH',
            json: body,
            ifMatch: endpoint.version,
          })
        : api<Endpoint>('/v1/admin/external/endpoints', { method: 'POST', json: { id: f.id.trim(), ...body } });
    },
    onSuccess: async (e) => {
      toast.success('엔드포인트를 저장했습니다');
      await qc.invalidateQueries({ queryKey: ['ext-endpoints'] });
      await qc.invalidateQueries({ queryKey: ['ext-keys'] });
      onSaved(e.id);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const del = useMutation({
    mutationFn: () =>
      api<void>(`/v1/admin/external/endpoints/${encodeURIComponent(endpoint!.id)}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('엔드포인트를 지웠습니다');
      await qc.invalidateQueries({ queryKey: ['ext-endpoints'] });
      onDeleted?.();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const common = providers.find((p) => p.code === f.provider)?.common_key_env;
  return (
    <Card className="grid gap-3 p-4 md:grid-cols-2" data-testid="external-editor">
      <FieldShell label="ID" htmlFor="ep-id" help="소문자·숫자·하이픈. 만든 뒤 바꿀 수 없음">
        <Input id="ep-id" value={f.id} disabled={!!endpoint} onChange={(e) => set('id')(e.target.value)} />
      </FieldShell>
      <FieldShell label="이름" htmlFor="ep-name">
        <Input id="ep-name" value={f.name_ko} onChange={(e) => set('name_ko')(e.target.value)} />
      </FieldShell>
      <FieldShell label="제공처" htmlFor="ep-provider">
        <Select id="ep-provider" value={f.provider} onChange={(e) => set('provider')(e.target.value)}>
          {providers.map((p) => (
            <option key={p.code} value={p.code}>
              {p.label}
            </option>
          ))}
        </Select>
      </FieldShell>
      <FieldShell label="응답 형식" htmlFor="ep-format">
        <Select id="ep-format" value={f.response_format} onChange={(e) => set('response_format')(e.target.value)}>
          <option value="json">JSON</option>
          <option value="xml">XML</option>
        </Select>
      </FieldShell>
      <FieldShell
        label="기본 URL"
        htmlFor="ep-url"
        className="md:col-span-2"
        help="호출 허용 호스트는 이 URL 의 호스트뿐"
      >
        <Input id="ep-url" value={f.base_url} onChange={(e) => set('base_url')(e.target.value)} />
      </FieldShell>
      <FieldShell label="방식" htmlFor="ep-method">
        <Select id="ep-method" value={f.method} onChange={(e) => set('method')(e.target.value)}>
          <option>GET</option>
          <option>POST</option>
        </Select>
      </FieldShell>
      <FieldShell label="일일 한도" htmlFor="ep-limit">
        <Input
          id="ep-limit"
          value={f.daily_limit}
          onChange={(e) => set('daily_limit')(e.target.value.replace(/\D/g, ''))}
        />
      </FieldShell>
      <FieldShell label="키 매개변수 이름" htmlFor="ep-keyparam" help="serviceKey · key · OC 등(값은 서버가 붙임)">
        <Input id="ep-keyparam" value={f.key_param} onChange={(e) => set('key_param')(e.target.value)} />
      </FieldShell>
      <FieldShell label="키 환경 변수" htmlFor="ep-keyenv" help={common ? `없으면 공통 변수 ${common}` : undefined}>
        <Input id="ep-keyenv" value={f.key_env} onChange={(e) => set('key_env')(e.target.value)} />
      </FieldShell>
      <FieldShell label="외부 시스템(DB 비교)" htmlFor="ep-sys" help="ref_external_system 코드(예: tago_subway)">
        <Input id="ep-sys" value={f.external_system} onChange={(e) => set('external_system')(e.target.value)} />
      </FieldShell>
      <FieldShell label="반복 항목 경로(자동 감지 실패 시)" htmlFor="ep-rows">
        <Input
          id="ep-rows"
          value={f.rows_path}
          onChange={(e) => set('rows_path')(e.target.value)}
          placeholder="response.body.items.item"
        />
      </FieldShell>
      <FieldShell label="관련 출처">
        <RefInput target="source" value={f.source_id} onChange={set('source_id')} />
      </FieldShell>
      <FieldShell label="문서 링크" htmlFor="ep-doc">
        <Input id="ep-doc" value={f.doc_url} onChange={(e) => set('doc_url')(e.target.value)} />
      </FieldShell>
      <FieldShell label="매개변수 정의(JSON)" htmlFor="ep-params" className="md:col-span-2" help={PARAMS_HELP}>
        <Textarea
          id="ep-params"
          className="min-h-40 font-mono text-xs"
          value={f.params}
          onChange={(e) => set('params')(e.target.value)}
        />
      </FieldShell>
      <FieldShell
        label="페이지(JSON)"
        htmlFor="ep-paging"
        help='{"page_param","size_param","total_path"} 또는 {"start_param","end_param"}'
      >
        <Textarea
          id="ep-paging"
          className="font-mono text-xs"
          value={f.paging}
          onChange={(e) => set('paging')(e.target.value)}
        />
      </FieldShell>
      <FieldShell label="DB 비교(JSON)" htmlFor="ep-compare" help='{"code_field","name_field","lat_field","lng_field"}'>
        <Textarea
          id="ep-compare"
          className="font-mono text-xs"
          value={f.compare}
          onChange={(e) => set('compare')(e.target.value)}
        />
      </FieldShell>
      <FieldShell label="메모" htmlFor="ep-note" className="md:col-span-2">
        <Textarea id="ep-note" value={f.note} onChange={(e) => set('note')(e.target.value)} />
      </FieldShell>
      <div className="flex gap-2 md:col-span-2">
        {endpoint ? (
          <Button
            variant="danger"
            onClick={() => {
              if (window.confirm(`${endpoint.id} 를 지울까요? (호출 기록은 남습니다)`)) del.mutate();
            }}
          >
            삭제
          </Button>
        ) : null}
        <Button className="ml-auto" disabled={save.isPending} onClick={() => save.mutate()}>
          저장
        </Button>
      </div>
    </Card>
  );
}
