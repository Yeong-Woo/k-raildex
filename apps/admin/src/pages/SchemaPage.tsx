/**
 * 데이터 스키마(2026-11-28 사용자 지시): ERD(표·열·관계)와 실제 데이터 관계 예시.
 * - 관계도: 핵심 흐름(계획 → 노선 → 정거장 → 역 그룹 → 시설 → 지도 선형 → OSM relation) 표 관계도와, 고른 표 중심의 이웃 관계도
 * - 관계 예시: DB 에서 고른 여러 경우의 개체를 출발점으로 실제 행 사이 관계를 그린다(GET /v1/admin/schema/trace)
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, Empty, Input, Select, Tabs, TabsContent, TabsList, TabsTrigger } from '@k-raildex/ui';
import { api, qs } from '../lib/api';
import { toSlug } from '../lib/entity-types';

interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  pk: boolean;
}
interface SchemaTable {
  schema: string;
  name: string;
  kind: 'table' | 'view';
  entity_type: string | null;
  label_ko: string | null;
  rows: number | null;
  columns: SchemaColumn[];
}
interface SchemaRelation {
  from_table: string;
  from_columns: string[];
  to_table: string;
  to_columns: string[];
  kind: 'fk' | 'logical';
  note?: string;
}
interface TraceNode {
  key: string;
  layer: string;
  entity_type: string | null;
  id: string;
  label: string;
  sub: string | null;
  table: string;
}
interface TraceEdge {
  from: string;
  to: string;
  label: string;
  via: string;
}
interface Trace {
  root: string;
  nodes: TraceNode[];
  edges: TraceEdge[];
  truncated: string[];
}
interface SchemaCase {
  key: string;
  label: string;
  desc: string;
  type: string;
  id: string | null;
  name: string | null;
}

export interface SchemaSearch {
  tab?: 'erd' | 'trace';
  table?: string;
  type?: string;
  id?: string;
}

/** 핵심 흐름 관계도(사용자 요청: 계획·노선·정거장·역 그룹·시설·지도 선형·OSM relation) */
const CORE_LAYERS: string[][] = [
  ['plan', 'plan_geometry'],
  ['plan_line', 'plan_station'],
  ['line', 'line_operator'],
  ['line_station', 'facility_line'],
  ['station', 'facility'],
  ['line_osm_map'],
  ['osm.relation', 'osm.relation_member', 'osm.way'],
];

export function SchemaPage() {
  const search = useSearch({ from: '/schema' });
  const navigate = useNavigate({ from: '/schema' });
  const schema = useQuery({
    queryKey: ['schema'],
    queryFn: () => api<{ tables: SchemaTable[]; relations: SchemaRelation[] }>('/v1/admin/schema'),
    staleTime: 10 * 60_000,
  });
  const labels = useMemo(
    () => new Map((schema.data?.tables ?? []).filter((t) => t.label_ko).map((t) => [t.name, t.label_ko!])),
    [schema.data],
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-bold">데이터 스키마</h1>
        {schema.data ? (
          <span className="text-sm text-fg-muted">
            표·뷰 {schema.data.tables.length}개 · 관계 {schema.data.relations.length}개
          </span>
        ) : null}
      </div>
      <Tabs
        value={search.tab ?? 'erd'}
        onValueChange={(v) => void navigate({ search: { ...search, tab: v as 'erd' | 'trace' } })}
      >
        <TabsList>
          <TabsTrigger value="erd">관계도(ERD)</TabsTrigger>
          <TabsTrigger value="trace">데이터 관계 예시</TabsTrigger>
        </TabsList>
        <TabsContent value="erd" className="pt-3">
          {schema.data ? (
            <ErdTab
              tables={schema.data.tables}
              relations={schema.data.relations}
              selected={search.table}
              onSelect={(t) => void navigate({ search: { ...search, table: t } })}
            />
          ) : (
            <Empty>{schema.isError ? '불러오지 못함' : '불러오는 중…'}</Empty>
          )}
        </TabsContent>
        <TabsContent value="trace" className="pt-3">
          <TraceTab
            labels={labels}
            type={search.type}
            id={search.id}
            onPick={(type, id) => void navigate({ search: { ...search, tab: 'trace', type, id } })}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ERD
// ---------------------------------------------------------------------------

function ErdTab({
  tables,
  relations,
  selected,
  onSelect,
}: {
  tables: SchemaTable[];
  relations: SchemaRelation[];
  selected: string | undefined;
  onSelect: (t: string | undefined) => void;
}) {
  const [filter, setFilter] = useState('');
  const byName = useMemo(() => new Map(tables.map((t) => [t.name, t])), [tables]);
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const hit = tables.filter(
      (t) => !f || t.name.includes(f) || (t.label_ko ?? '').includes(f) || t.columns.some((c) => c.name.includes(f)),
    );
    return [
      { label: '개체 표', items: hit.filter((t) => t.kind === 'table' && t.entity_type) },
      {
        label: '하위·보조 표',
        items: hit.filter((t) => t.kind === 'table' && !t.entity_type && t.schema === 'public'),
      },
      { label: '뷰(파생 값)', items: hit.filter((t) => t.kind === 'view' && t.schema === 'public') },
      { label: 'osm 스키마(ODbL)', items: hit.filter((t) => t.schema === 'osm') },
    ];
  }, [tables, filter]);
  const sel = selected ? byName.get(selected) : undefined;

  const focusLayers = useMemo(() => {
    if (!sel) return null;
    const out = [
      ...new Set(relations.filter((r) => r.from_table === sel.name && r.to_table !== '*').map((r) => r.to_table)),
    ];
    const inc = [
      ...new Set(
        relations.filter((r) => r.to_table === sel.name && r.from_table !== sel.name).map((r) => r.from_table),
      ),
    ];
    return [inc.filter((t) => !out.includes(t)), [sel.name], out];
  }, [sel, relations]);

  return (
    <div className="grid gap-3 lg:grid-cols-[16rem_1fr]">
      <Card className="flex max-h-[80vh] flex-col gap-2 overflow-auto p-2">
        <Input placeholder="표·열 이름" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button
          className={`rounded px-2 py-1 text-left text-sm hover:bg-muted ${!sel ? 'bg-muted font-semibold' : ''}`}
          onClick={() => onSelect(undefined)}
        >
          핵심 흐름(계획 → OSM)
        </button>
        {groups.map((g) =>
          g.items.length ? (
            <div key={g.label}>
              <div className="px-2 pt-2 text-xs font-semibold text-fg-muted">
                {g.label} ({g.items.length})
              </div>
              {g.items.map((t) => (
                <button
                  key={t.name}
                  className={`flex w-full items-center justify-between rounded px-2 py-0.5 text-left font-mono text-xs hover:bg-muted ${sel?.name === t.name ? 'bg-muted font-semibold' : ''}`}
                  onClick={() => onSelect(t.name)}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{t.name}</span>
                    {t.label_ko ? (
                      <span className="block truncate font-sans text-[11px] text-fg-muted">{t.label_ko}</span>
                    ) : null}
                  </span>
                  {t.rows != null ? <span className="text-fg-muted">{t.rows.toLocaleString()}</span> : null}
                </button>
              ))}
            </div>
          ) : null,
        )}
      </Card>
      <div className="flex min-w-0 flex-col gap-3">
        <Card className="overflow-auto p-2">
          <div className="px-1 pb-2 text-sm text-fg-muted">
            {sel
              ? `왼쪽: ${sel.name} 를 가리키는 표 · 가운데: ${sel.name} · 오른쪽: ${sel.name} 가 가리키는 표. 점선은 외래 키 없는 논리 관계. 카드를 누르면 그 표로 옮긴다.`
              : '핵심 흐름: 계획(plan) → 계획 노선·역 → 노선 → 정거장·시설 노선 → 역 그룹·시설 → OSM 대응(line_osm_map) → osm relation·way. 카드를 누르면 그 표 중심으로 본다.'}
          </div>
          <ErdCanvas
            layers={(focusLayers ?? CORE_LAYERS).map((l) => l.filter((n) => byName.has(n)))}
            byName={byName}
            relations={relations}
            focus={sel?.name}
            onSelect={onSelect}
          />
        </Card>
        {sel ? <TableDetail table={sel} byName={byName} relations={relations} onSelect={onSelect} /> : null}
      </div>
    </div>
  );
}

const CARD_W = 230;
const GAP_X = 70;
const ROW_H = 17;
const HEAD_H = 40;
const GAP_Y = 18;
const MAX_ROWS = 14;

function ErdCanvas({
  layers,
  byName,
  relations,
  focus,
  onSelect,
}: {
  layers: string[][];
  byName: Map<string, SchemaTable>;
  relations: SchemaRelation[];
  focus: string | undefined;
  onSelect: (t: string) => void;
}) {
  const shown = new Set(layers.flat());
  const rels = relations.filter((r) => shown.has(r.from_table) && shown.has(r.to_table) && r.from_table !== r.to_table);
  // 카드마다 보일 열: PK + 관계 열 (+ 가운데 표는 모든 열, 최대 MAX_ROWS)
  const colsOf = (t: SchemaTable) => {
    const rel = new Set<string>();
    for (const r of rels) {
      if (r.from_table === t.name) r.from_columns.forEach((c) => rel.add(c));
      if (r.to_table === t.name) r.to_columns.forEach((c) => rel.add(c));
    }
    const pick = t.columns.filter((c) => c.pk || rel.has(c.name) || t.name === focus);
    const extra = t.columns.filter(
      (c) => !pick.includes(c) && ['name_ko', 'kind', 'status', 'role', 'line_role'].includes(c.name),
    );
    const all = [...pick, ...extra];
    return { cols: all.slice(0, MAX_ROWS), hidden: Math.max(0, t.columns.length - Math.min(all.length, MAX_ROWS)) };
  };
  const pos = new Map<string, { x: number; y: number; h: number; cols: string[] }>();
  let height = 0;
  layers.forEach((layer, i) => {
    let y = 8;
    for (const name of layer) {
      const t = byName.get(name);
      if (!t) continue;
      const { cols, hidden } = colsOf(t);
      const h = HEAD_H + (cols.length + (hidden ? 1 : 0)) * ROW_H + 6;
      pos.set(name, { x: 8 + i * (CARD_W + GAP_X), y, h, cols: cols.map((c) => c.name) });
      y += h + GAP_Y;
    }
    height = Math.max(height, y);
  });
  const width = 16 + layers.length * (CARD_W + GAP_X) - GAP_X;
  const rowY = (name: string, col: string) => {
    const p = pos.get(name)!;
    const i = p.cols.indexOf(col);
    return p.y + HEAD_H + (i < 0 ? 0 : i) * ROW_H + ROW_H / 2 - 2;
  };
  return (
    <svg width={width} height={height} className="text-fg" role="img" aria-label="관계도">
      {rels.map((r, i) => {
        const a = pos.get(r.from_table)!;
        const b = pos.get(r.to_table)!;
        const y1 = rowY(r.from_table, r.from_columns[0]!);
        const y2 = rowY(r.to_table, r.to_columns[0]!);
        const ltr = a.x <= b.x;
        const sameCol = a.x === b.x;
        const x1 = ltr ? a.x + CARD_W : a.x;
        const x2 = sameCol ? b.x + CARD_W : ltr ? b.x : b.x + CARD_W;
        const c1 = sameCol ? x1 + 40 : ltr ? x1 + GAP_X / 2 : x1 - GAP_X / 2;
        const c2 = sameCol ? x2 + 40 : ltr ? x2 - GAP_X / 2 : x2 + GAP_X / 2;
        return (
          <path
            key={i}
            d={`M${x1},${y1} C${c1},${y1} ${c2},${y2} ${x2},${y2}`}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.45}
            strokeDasharray={r.kind === 'logical' ? '4 3' : undefined}
            markerEnd="url(#erd-arrow)"
          >
            <title>{`${r.from_table}.${r.from_columns.join(',')} → ${r.to_table}.${r.to_columns.join(',')}${r.note ? ` (${r.note})` : ''}`}</title>
          </path>
        );
      })}
      <defs>
        <marker id="erd-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="currentColor" fillOpacity={0.6} />
        </marker>
      </defs>
      {[...pos.entries()].map(([name, p]) => {
        const t = byName.get(name)!;
        const { hidden } = colsOf(t);
        return (
          <g
            key={name}
            transform={`translate(${p.x},${p.y})`}
            className="cursor-pointer"
            onClick={() => onSelect(name)}
          >
            <rect
              width={CARD_W}
              height={p.h}
              rx={6}
              className={
                name === focus
                  ? 'fill-[var(--color-muted)] stroke-[var(--color-primary)]'
                  : 'fill-[var(--color-bg)] stroke-[var(--color-border)]'
              }
              strokeWidth={name === focus ? 2 : 1}
            />
            <text x={8} y={17} className="fill-current font-mono text-[12px] font-semibold">
              {name}
              {t.kind === 'view' ? ' (뷰)' : ''}
            </text>
            <text x={8} y={32} className="fill-current text-[11px] opacity-70">
              {t.label_ko ?? ''}
            </text>
            {t.rows != null ? (
              <text x={CARD_W - 8} y={32} textAnchor="end" className="fill-current text-[10px] opacity-60">
                {t.rows.toLocaleString()}행
              </text>
            ) : null}
            {p.cols.map((c, i) => {
              const col = t.columns.find((x) => x.name === c)!;
              return (
                <g key={c} transform={`translate(0,${HEAD_H + i * ROW_H})`}>
                  <text x={8} y={12} className="fill-current font-mono text-[11px]">
                    {col.pk ? '🔑 ' : ''}
                    {c}
                  </text>
                  <text
                    x={CARD_W - 8}
                    y={12}
                    textAnchor="end"
                    className="fill-current font-mono text-[10px] opacity-55"
                  >
                    {col.type.length > 18 ? `${col.type.slice(0, 17)}…` : col.type}
                    {col.nullable ? '' : ' *'}
                  </text>
                </g>
              );
            })}
            {hidden ? (
              <text x={8} y={HEAD_H + p.cols.length * ROW_H + 12} className="fill-current text-[10px] opacity-55">
                … 열 {hidden}개 더
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function TableDetail({
  table,
  byName,
  relations,
  onSelect,
}: {
  table: SchemaTable;
  byName: Map<string, SchemaTable>;
  relations: SchemaRelation[];
  onSelect: (t: string) => void;
}) {
  const labelOf = (t: string) => byName.get(t)?.label_ko ?? null;
  const out = relations.filter((r) => r.from_table === table.name);
  const inc = relations.filter((r) => r.to_table === table.name || (r.to_table === '*' && table.entity_type));
  const relLink = (t: string) =>
    t === '*' ? (
      <span>모든 개체 표</span>
    ) : (
      <button className="font-mono text-primary hover:underline" onClick={() => onSelect(t)}>
        {t}
        {labelOf(t) ? <span className="ml-1 font-sans text-fg-muted">({labelOf(t)})</span> : null}
      </button>
    );
  return (
    <Card className="flex flex-col gap-3 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-semibold">{table.name}</code>
        {table.label_ko ? <span className="font-semibold">{table.label_ko}</span> : null}
        <Badge>{table.kind === 'view' ? '뷰' : '표'}</Badge>
        {table.entity_type ? (
          <Link
            to="/data/$type"
            params={{ type: toSlug(table.entity_type as never) }}
            search={{}}
            className="text-primary hover:underline"
          >
            개체 목록 열기
          </Link>
        ) : null}
        {table.rows != null ? <span className="text-fg-muted">약 {table.rows.toLocaleString()}행</span> : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-semibold text-fg-muted">가리키는 관계({out.length})</div>
          {out.map((r, i) => (
            <div key={i} className="font-mono text-xs">
              {r.from_columns.join(',')} → {relLink(r.to_table)}.{r.to_columns.join(',')}
              {r.kind === 'logical' ? (
                <span className="ml-1 text-fg-muted">(논리{r.note ? `: ${r.note}` : ''})</span>
              ) : null}
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold text-fg-muted">가리켜지는 관계({inc.length})</div>
          {inc.map((r, i) => (
            <div key={i} className="font-mono text-xs">
              {relLink(r.from_table)}.{r.from_columns.join(',')} → {r.to_columns.join(',')}
              {r.kind === 'logical' ? (
                <span className="ml-1 text-fg-muted">(논리{r.note ? `: ${r.note}` : ''})</span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <table className="w-full text-xs">
        <thead className="text-left text-fg-muted">
          <tr>
            <th className="py-1 pr-2">열</th>
            <th className="py-1 pr-2">형식</th>
            <th className="py-1">필수</th>
          </tr>
        </thead>
        <tbody>
          {table.columns.map((c) => (
            <tr key={c.name} className="border-t border-border">
              <td className="py-0.5 pr-2 font-mono">
                {c.pk ? '🔑 ' : ''}
                {c.name}
              </td>
              <td className="py-0.5 pr-2 font-mono text-fg-muted">{c.type}</td>
              <td className="py-0.5">{c.nullable ? '' : '필수'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 데이터 관계 예시
// ---------------------------------------------------------------------------

const LAYERS: { key: string; label: string }[] = [
  { key: 'plan', label: '계획' },
  { key: 'line', label: '노선' },
  { key: 'line_station', label: '정거장' },
  { key: 'station', label: '역 그룹' },
  { key: 'facility', label: '시설' },
  { key: 'map', label: '지도 선형' },
  { key: 'osm_relation', label: 'OSM relation' },
];
const ROOT_TYPES = [
  { value: 'plan', label: '계획' },
  { value: 'line', label: '노선' },
  { value: 'line_station', label: '정거장' },
  { value: 'station', label: '역 그룹' },
  { value: 'facility', label: '시설' },
];

function TraceTab({
  labels,
  type,
  id,
  onPick,
}: {
  labels: Map<string, string>;
  type: string | undefined;
  id: string | undefined;
  onPick: (type: string, id: string) => void;
}) {
  const cases = useQuery({
    queryKey: ['schema-cases'],
    queryFn: () => api<{ items: SchemaCase[] }>('/v1/admin/schema/cases'),
    staleTime: 5 * 60_000,
  });
  const [t, setT] = useState(type ?? 'plan');
  const [i, setI] = useState(id ?? '');
  const trace = useQuery({
    queryKey: ['schema-trace', type, id],
    enabled: !!type && !!id,
    queryFn: () => api<Trace>(`/v1/admin/schema/trace${qs({ type, id })}`),
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {cases.data?.items.map((c) =>
          c.id ? (
            <button
              key={c.key}
              title={c.desc}
              onClick={() => {
                setT(c.type);
                setI(c.id!);
                onPick(c.type, c.id!);
              }}
              className={`rounded border px-2 py-1 text-left text-xs hover:bg-muted ${type === c.type && id === c.id ? 'border-primary bg-muted' : 'border-border'}`}
            >
              <div className="font-semibold">{c.label}</div>
              <div className="text-fg-muted">{c.name ?? c.id}</div>
            </button>
          ) : null,
        )}
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (i.trim()) onPick(t, i.trim());
        }}
      >
        <Select className="w-32" value={t} onChange={(e) => setT(e.target.value)}>
          {ROOT_TYPES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
        <Input
          className="max-w-xs"
          placeholder="id (예: line-gyeongbu)"
          value={i}
          onChange={(e) => setI(e.target.value)}
        />
        <Button type="submit" variant="secondary">
          관계 보기
        </Button>
      </form>
      {!type || !id ? (
        <Empty>위의 경우를 고르거나 id 를 넣으세요</Empty>
      ) : trace.isLoading ? (
        <Empty>불러오는 중…</Empty>
      ) : trace.isError || !trace.data ? (
        <Empty>찾지 못함</Empty>
      ) : (
        <TraceView trace={trace.data} onPick={onPick} labels={labels} />
      )}
    </div>
  );
}

const NODE_W = 200;
const NODE_H = 44;
const NODE_GAP_Y = 10;
const COL_GAP = 60;

function TraceView({
  trace,
  onPick,
  labels,
}: {
  trace: Trace;
  onPick: (type: string, id: string) => void;
  labels: Map<string, string>;
}) {
  /** 저장 위치 문자열(표.열 · 표 → 표)에 표 한국어 이름을 붙인다 */
  const viaKo = (via: string) =>
    [...new Set(via.match(/[a-z_]+(?:\.[a-z_]+)?/g) ?? [])]
      .map((tok) => labels.get(tok) ?? labels.get(tok.split('.')[0]!) ?? null)
      .filter(Boolean)
      .join(' · ');
  const navigate = useNavigate();
  const layers = LAYERS.filter((l) => trace.nodes.some((n) => n.layer === l.key));
  const pos = new Map<string, { x: number; y: number }>();
  let height = 0;
  layers.forEach((l, ci) => {
    const nodes = trace.nodes.filter((n) => n.layer === l.key);
    nodes.forEach((n, ri) => pos.set(n.key, { x: 8 + ci * (NODE_W + COL_GAP), y: 28 + ri * (NODE_H + NODE_GAP_Y) }));
    height = Math.max(height, 28 + nodes.length * (NODE_H + NODE_GAP_Y));
  });
  const width = 16 + layers.length * (NODE_W + COL_GAP) - COL_GAP;
  const [hover, setHover] = useState<string | null>(null);
  const near = (k: string) =>
    !hover ||
    k === hover ||
    trace.edges.some((e) => (e.from === hover && e.to === k) || (e.to === hover && e.from === k));
  return (
    <div className="flex flex-col gap-3">
      {trace.truncated.length ? <div className="text-xs text-fg-muted">줄임: {trace.truncated.join(' · ')}</div> : null}
      <Card className="overflow-auto p-2">
        <svg width={width} height={height} className="text-fg" role="img" aria-label="데이터 관계">
          <defs>
            <marker id="tr-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="currentColor" fillOpacity={0.6} />
            </marker>
          </defs>
          {layers.map((l, ci) => (
            <text
              key={l.key}
              x={8 + ci * (NODE_W + COL_GAP)}
              y={16}
              className="fill-current text-[12px] font-semibold opacity-70"
            >
              {l.label}
            </text>
          ))}
          {trace.edges.map((e, k) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            const ltr = a.x <= b.x;
            const same = a.x === b.x;
            const x1 = ltr ? a.x + NODE_W : a.x;
            const x2 = same ? b.x + NODE_W : ltr ? b.x : b.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const y2 = b.y + NODE_H / 2;
            const c1 = same ? x1 + 30 : ltr ? x1 + COL_GAP / 2 : x1 - COL_GAP / 2;
            const c2 = same ? x2 + 30 : ltr ? x2 - COL_GAP / 2 : x2 + COL_GAP / 2;
            const on = !hover || e.from === hover || e.to === hover;
            return (
              <path
                key={k}
                d={`M${x1},${y1} C${c1},${y1} ${c2},${y2} ${x2},${y2}`}
                fill="none"
                stroke="currentColor"
                strokeOpacity={on ? 0.55 : 0.08}
                markerEnd="url(#tr-arrow)"
              >
                <title>{`${e.label} — ${e.via}${viaKo(e.via) ? ` (${viaKo(e.via)})` : ''}`}</title>
              </path>
            );
          })}
          {trace.nodes.map((n) => {
            const p = pos.get(n.key);
            if (!p) return null;
            const isRoot = n.key === trace.root;
            return (
              <g
                key={n.key}
                transform={`translate(${p.x},${p.y})`}
                opacity={near(n.key) ? 1 : 0.25}
                className={n.entity_type ? 'cursor-pointer' : undefined}
                onMouseEnter={() => setHover(n.key)}
                onMouseLeave={() => setHover(null)}
                onClick={(ev) => {
                  if (!n.entity_type) return;
                  if (ev.shiftKey || ev.metaKey || ev.ctrlKey)
                    void navigate({
                      to: '/data/$type/$id',
                      params: { type: toSlug(n.entity_type as never), id: n.id },
                      search: {},
                    });
                  else onPick(n.entity_type, n.id);
                }}
              >
                <title>{`${n.id}\n저장: ${n.table}${viaKo(n.table) ? ` (${viaKo(n.table)})` : ''}${n.entity_type ? '\n클릭: 여기서 다시 추적 · Shift+클릭: 편집 화면' : ''}`}</title>
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={6}
                  className={
                    isRoot
                      ? 'fill-[var(--color-muted)] stroke-[var(--color-primary)]'
                      : 'fill-[var(--color-bg)] stroke-[var(--color-border)]'
                  }
                  strokeWidth={isRoot ? 2 : 1}
                />
                <text x={8} y={17} className="fill-current text-[12px] font-semibold">
                  {n.label.length > 24 ? `${n.label.slice(0, 23)}…` : n.label}
                </text>
                <text x={8} y={34} className="fill-current text-[10px] opacity-60">
                  {(n.sub ?? n.id).length > 34 ? `${(n.sub ?? n.id).slice(0, 33)}…` : (n.sub ?? n.id)}
                </text>
              </g>
            );
          })}
        </svg>
      </Card>
      <Card className="overflow-auto p-2">
        <table className="w-full text-xs">
          <thead className="text-left text-fg-muted">
            <tr>
              <th className="px-2 py-1">출발</th>
              <th className="px-2 py-1">관계</th>
              <th className="px-2 py-1">도착</th>
              <th className="px-2 py-1">저장 위치</th>
            </tr>
          </thead>
          <tbody>
            {trace.edges.map((e, k) => {
              const a = trace.nodes.find((n) => n.key === e.from);
              const b = trace.nodes.find((n) => n.key === e.to);
              return (
                <tr key={k} className="border-t border-border">
                  <td className="px-2 py-0.5">{a?.label ?? e.from}</td>
                  <td className="px-2 py-0.5">{e.label}</td>
                  <td className="px-2 py-0.5">{b?.label ?? e.to}</td>
                  <td className="px-2 py-0.5 text-fg-muted">
                    <span className="font-mono">{e.via}</span>
                    {viaKo(e.via) ? <span className="ml-1">({viaKo(e.via)})</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
