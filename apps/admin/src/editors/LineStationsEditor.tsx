/** 노선 역 순서 편집기(FR-ADM-050): 드래그 순서·행 추가/삭제·구간 일괄 상태·km 역행 경고. 저장 = 전체 교체(PUT) */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { codeLabel, codes } from '@k-raildex/contracts';
import { Badge, Button, Card, CardHeader, cn, Empty, Input, Select } from '@k-raildex/ui';
import { AlertTriangle, ArrowDown, ArrowUp, ExternalLink, GripVertical, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { api, errorText, qs } from '../lib/api';
import { FuzzyCell } from '../form/widgets/FuzzyCell';
import { kmRegressions, rangeKeys, setStatusFor, type LsRow } from '../lib/line-stations';
import { RefInput, useLabel } from '../form/widgets/RefInput';
import { newLineStationRow, useLineStations } from './useLineStations';

export function LineStationsEditor({ lineId }: { lineId: string }) {
  const { query: q, original, rows, setRows, dirty, save, rowErrors, serverErrors } = useLineStations(lineId);
  const operators = useQuery({
    queryKey: ['list', 'operator', 'all'],
    staleTime: 60_000,
    queryFn: () => api<{ items: { id: string; name_ko: string | null }[] }>(`/v1/admin/operator${qs({ limit: 200 })}`),
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [bulkStatus, setBulkStatus] = useState('under_construction');
  const [hideBranches, setHideBranches] = useState(false);

  const regress = kmRegressions(rows);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const update = (key: string, patch: Partial<LsRow>) =>
    setRows((rs) => rs.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  const move = (i: number, j: number) => {
    if (j < 0 || j >= rows.length) return;
    setRows((rs) => arrayMove(rs, i, j));
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = rows.findIndex((r) => r._key === e.active.id);
    const to = rows.findIndex((r) => r._key === e.over!.id);
    if (from >= 0 && to >= 0) setRows((rs) => arrayMove(rs, from, to));
  };
  const toggle = (key: string, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && anchor) for (const k of rangeKeys(rows, anchor, key)) next.add(k);
      else if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setAnchor(key);
  };
  const addStation = (stationId: string | null) => {
    if (!stationId) return;
    setRows((rs) => [...rs, newLineStationRow(stationId, rs.at(-1)?.status ?? 'operating')]);
  };

  if (q.isLoading) return <Empty>불러오는 중…</Empty>;
  if (q.error) return <Empty>{errorText(q.error)}</Empty>;

  const visible = rows.filter((r) => !hideBranches || r.branch == null);
  const branches = new Set(rows.map((r) => r.branch).filter(Boolean));

  return (
    <Card>
      <CardHeader
        title={`역 순서 · ${rows.length}개 역${dirty ? ' · 저장 안 됨' : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => setRows(original)}>
              <RotateCcw className="size-4" /> 되돌리기
            </Button>
            <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? '저장 중…' : '역 순서 저장'}
            </Button>
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-sm">
        <span className="text-fg-muted">선택 {selected.size}개</span>
        <Select
          className="h-8 w-36"
          aria-label="일괄 상태"
          value={bulkStatus}
          onChange={(e) => setBulkStatus(e.target.value)}
        >
          {codes.status.values.map((s) => (
            <option key={s} value={s}>
              {codeLabel('status', s)}
            </option>
          ))}
        </Select>
        <Button
          variant="secondary"
          size="sm"
          disabled={selected.size === 0}
          onClick={() => setRows((rs) => setStatusFor(rs, selected, bulkStatus))}
        >
          선택 범위 상태 바꾸기
        </Button>
        <Button variant="ghost" size="sm" disabled={selected.size === 0} onClick={() => setSelected(new Set())}>
          선택 해제
        </Button>
        {branches.size ? (
          <label className="ml-auto flex items-center gap-1 text-xs text-fg-muted">
            <input type="checkbox" checked={hideBranches} onChange={(e) => setHideBranches(e.target.checked)} />
            지선 접기({branches.size})
          </label>
        ) : null}
        <span className={cn('text-xs text-fg-muted', branches.size ? '' : 'ml-auto')}>
          Shift+클릭으로 범위 선택 · 손잡이를 끌어 순서 변경
        </span>
      </div>
      {regress.size ? (
        <p className="flex items-center gap-1 border-b border-border bg-warn/10 px-4 py-1.5 text-xs text-warn">
          <AlertTriangle className="size-3.5" /> km 역행 {regress.size}곳 — 순서나 km 를 확인하세요(V-S04)
        </p>
      ) : null}
      {serverErrors.length ? (
        <ul className="border-b border-border bg-danger/10 px-4 py-1.5 text-xs text-danger" role="alert">
          {serverErrors.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      ) : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm" data-testid="line-stations-table">
            <thead className="text-left text-xs text-fg-muted">
              <tr>
                <th className="w-8 px-1 py-2" />
                <th className="w-8 px-1 py-2">
                  <input
                    type="checkbox"
                    aria-label="모두 선택"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r._key)) : new Set())}
                  />
                </th>
                <th className="w-8 px-1 py-2">#</th>
                <th className="px-2 py-2">역</th>
                <th className="w-20 px-1 py-2">지선</th>
                <th className="w-20 px-1 py-2">km</th>
                <th className="w-20 px-1 py-2">역번호</th>
                <th className="w-10 px-1 py-2" title="순서 확정">
                  확정
                </th>
                <th className="w-32 px-1 py-2">노선별 상태</th>
                <th className="w-28 px-1 py-2">개통</th>
                <th className="w-28 px-1 py-2">폐지</th>
                <th className="w-28 px-1 py-2">노선별 이름</th>
                <th className="w-36 px-1 py-2">운영기관</th>
                <th className="w-24 px-1 py-2" />
              </tr>
            </thead>
            <SortableContext items={visible.map((r) => r._key)} strategy={verticalListSortingStrategy}>
              <tbody>
                {visible.map((r) => {
                  const i = rows.indexOf(r);
                  return (
                    <SortableRow
                      key={r._key}
                      row={r}
                      index={i}
                      last={i === rows.length - 1}
                      selected={selected.has(r._key)}
                      regress={regress.has(i)}
                      error={rowErrors[i]}
                      operators={operators.data?.items ?? []}
                      onToggle={(shift) => toggle(r._key, shift)}
                      onChange={(p) => update(r._key, p)}
                      onMove={(d) => move(i, i + d)}
                      onRemove={() => setRows((rs) => rs.filter((x) => x._key !== r._key))}
                    />
                  );
                })}
              </tbody>
            </SortableContext>
          </table>
        </div>
      </DndContext>
      {rows.length === 0 ? <Empty>노선별 역이 없습니다. 아래에서 역을 추가하세요.</Empty> : null}
      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <Plus className="size-4 text-fg-muted" />
        <span className="shrink-0 text-sm text-fg-muted">역 추가(끝에)</span>
        <div className="w-80" data-testid="add-line-station">
          <RefInput target="station" value={null} onChange={addStation} />
        </div>
      </div>
    </Card>
  );
}

function StationName({ id }: { id: string }) {
  const l = useLabel('station', id);
  return <>{l.data?.label ?? id}</>;
}

function SortableRow({
  row,
  index,
  last,
  selected,
  regress,
  error,
  operators,
  onToggle,
  onChange,
  onMove,
  onRemove,
}: {
  row: LsRow;
  index: number;
  last: boolean;
  selected: boolean;
  regress: boolean;
  error: string | undefined;
  operators: { id: string; name_ko: string | null }[];
  onToggle: (shift: boolean) => void;
  onChange: (p: Partial<LsRow>) => void;
  onMove: (d: number) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: row._key,
  });
  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
  };
  const s = (v: string) => (v === '' ? null : v);
  return (
    <>
      <tr
        ref={setNodeRef}
        style={style}
        data-testid="ls-row"
        className={cn(
          'border-t border-border align-middle',
          selected && 'bg-primary/5',
          isDragging && 'relative z-10 bg-bg-elevated shadow-lg',
          !row.id && 'bg-good/5',
        )}
      >
        <td className="px-1">
          <button
            ref={setActivatorNodeRef}
            type="button"
            className="cursor-grab rounded p-1 text-fg-muted hover:bg-muted active:cursor-grabbing"
            aria-label={`${index + 1}번 행 끌기`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        </td>
        <td className="px-1">
          <input
            type="checkbox"
            aria-label={`${index + 1}번 행 선택`}
            checked={selected}
            onChange={() => undefined}
            onClick={(e) => onToggle(e.shiftKey)}
          />
        </td>
        <td className="px-1 text-xs text-fg-muted">{index + 1}</td>
        <td className="px-2 py-1">
          <div className="flex items-center gap-1.5">
            <span className="font-medium" data-testid="ls-station-name">
              {row.station_name_ko ?? <StationName id={row.station_id} />}
            </span>
            <Link
              to="/data/$type/$id"
              params={{ type: 'station', id: row.station_id }}
              search={{}}
              className="text-fg-muted"
              title={row.station_id}
            >
              <ExternalLink className="size-3" />
            </Link>
            {!row.id ? <Badge tone="good">새 행</Badge> : null}
            {regress ? (
              <span title="km 역행" className="text-warn">
                <AlertTriangle className="size-3.5" />
              </span>
            ) : null}
          </div>
          {row.station_name_ko ? <div className="text-[11px] text-fg-muted">{row.station_id}</div> : null}
        </td>
        <td className="px-1">
          <Input
            className="h-8 px-1.5 text-xs"
            aria-label="지선"
            value={row.branch ?? ''}
            onChange={(e) => onChange({ branch: s(e.target.value) })}
          />
        </td>
        <td className="px-1">
          <Input
            className={cn('h-8 px-1.5 text-xs', regress && 'border-warn')}
            aria-label="km"
            type="number"
            step="any"
            value={row.km ?? ''}
            onChange={(e) => onChange({ km: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </td>
        <td className="px-1">
          <Input
            className="h-8 px-1.5 text-xs"
            aria-label="역번호"
            value={row.station_code ?? ''}
            onChange={(e) => onChange({ station_code: s(e.target.value) })}
          />
        </td>
        <td className="px-1 text-center">
          <input
            type="checkbox"
            aria-label="순서 확정"
            checked={row.order_confirmed}
            onChange={(e) => onChange({ order_confirmed: e.target.checked })}
          />
        </td>
        <td className="px-1">
          <Select
            className="h-8 px-1.5 text-xs"
            aria-label="노선별 상태"
            value={row.status}
            onChange={(e) => onChange({ status: e.target.value })}
          >
            {codes.status.values.map((v) => (
              <option key={v} value={v}>
                {codeLabel('status', v)}
              </option>
            ))}
          </Select>
        </td>
        <td className="px-1">
          <FuzzyCell label="개통" value={row.opened} onChange={(v) => onChange({ opened: v })} />
        </td>
        <td className="px-1">
          <FuzzyCell label="폐지" value={row.closed} onChange={(v) => onChange({ closed: v })} />
        </td>
        <td className="px-1">
          <Input
            className="h-8 px-1.5 text-xs"
            aria-label="노선별 이름"
            placeholder="역 이름과 같음"
            value={row.name_ko ?? ''}
            onChange={(e) => onChange({ name_ko: s(e.target.value) })}
          />
        </td>
        <td className="px-1">
          <Select
            className="h-8 px-1.5 text-xs"
            aria-label="운영기관"
            value={row.operator_id ?? ''}
            onChange={(e) => onChange({ operator_id: s(e.target.value) })}
          >
            <option value="">노선 운영기관</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name_ko ?? o.id}
              </option>
            ))}
            {row.operator_id && !operators.some((o) => o.id === row.operator_id) ? (
              <option value={row.operator_id}>{row.operator_id}</option>
            ) : null}
          </Select>
        </td>
        <td className="px-1">
          <div className="flex justify-end">
            <Button variant="ghost" size="icon" aria-label="위로" disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="아래로" disabled={last} onClick={() => onMove(1)}>
              <ArrowDown className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="행 삭제" onClick={onRemove}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </td>
      </tr>
      {error ? (
        <tr>
          <td colSpan={14} className="px-4 pb-1 text-xs text-danger">
            {index + 1}번 행: {error}
          </td>
        </tr>
      ) : null}
    </>
  );
}
