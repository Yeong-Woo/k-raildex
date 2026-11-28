/**
 * 역 병합(FR-ADM-062, Q73 A): 원본 역(주로 공사 중 분리 정거장)을 대상 역으로 합친다.
 * 미리 보기(GET /stations/:id/merge-preview) → 근거 출처·사유 → 적용(POST /stations/:id/merge). 되돌릴 수 없다.
 * [분리 유지]: 아직 같은 역인지 미확정이면 내부 메모에 "분리 유지(<병합할 역 id>): 이유" 를 붙여 검수 목록(X-station-split)에서 뺀다.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { codeLabel, isCode } from '@k-raildex/contracts';
import { Badge, Button, Dialog, Input } from '@k-raildex/ui';
import { GitMerge, PauseCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText, qs, type EntityResponse } from '../lib/api';
import { RefInput } from '../form/widgets/RefInput';

interface PreviewStation {
  id: string;
  name_ko: string;
  merge_into_id: string | null;
  has_geom: boolean;
  lines: { line_id: string; line_name: string; status: string }[];
}
interface MergePreview {
  from: PreviewStation;
  into: PreviewStation;
  line_stations: {
    id: string;
    line_id: string;
    line_name: string;
    status: string;
    action: 'move' | 'combine';
    twin_id: string | null;
    twin_status: string | null;
  }[];
  references: { table: string; count: number }[];
  distance_m: number | null;
  adds_former_name: boolean;
  matches_merge_into: boolean;
}

const statusText = (s: string | null) => (s && isCode('status', s) ? codeLabel('status', s) : (s ?? ''));

/** 병합 후 다시 불러올 것들(검수 목록·지도·개체) */
async function refresh(qc: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ['quality'] }),
    qc.invalidateQueries({ queryKey: ['entity'] }),
    qc.invalidateQueries({ queryKey: ['map'] }),
  ]);
}

function StationBox({ title, s }: { title: string; s: PreviewStation }) {
  return (
    <div className="min-w-0 rounded border border-border p-2 text-xs">
      <div className="text-[11px] text-fg-muted">{title}</div>
      <div className="font-semibold">
        {s.name_ko} <code className="font-normal text-fg-muted">{s.id}</code>
      </div>
      <ul className="mt-1 space-y-0.5">
        {s.lines.length ? (
          s.lines.map((l) => (
            <li key={l.line_id}>
              {l.line_name} <span className="text-fg-muted">· {statusText(l.status)}</span>
            </li>
          ))
        ) : (
          <li className="text-fg-muted">노선 없음</li>
        )}
      </ul>
    </div>
  );
}

export function MergeStationDialog({
  fromId,
  defaultIntoId,
  open,
  onOpenChange,
  onDone,
}: {
  fromId: string;
  defaultIntoId?: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: (intoId: string) => void;
}) {
  const qc = useQueryClient();
  const [intoId, setIntoId] = useState<string | null>(defaultIntoId ?? null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const preview = useQuery({
    queryKey: ['merge-preview', fromId, intoId],
    enabled: open && !!intoId && intoId !== fromId,
    queryFn: () =>
      api<MergePreview>(`/v1/admin/stations/${encodeURIComponent(fromId)}/merge-preview${qs({ into_id: intoId })}`),
  });
  const merge = useMutation({
    mutationFn: () =>
      api(`/v1/admin/stations/${encodeURIComponent(fromId)}/merge${qs({ rationale: reason || undefined })}`, {
        method: 'POST',
        json: { into_id: intoId, reason: reason || undefined, source_id: sourceId ?? undefined },
      }),
    onSuccess: async () => {
      toast.success(`${fromId} 를 ${intoId} 로 병합했습니다`);
      onOpenChange(false);
      await refresh(qc);
      onDone?.(intoId!);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const p = preview.data;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="역 병합"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            data-testid="merge-apply"
            disabled={!p || merge.isPending || !reason.trim()}
            title={!reason.trim() ? '병합 사유를 적으세요' : undefined}
            onClick={() => merge.mutate()}
          >
            <GitMerge className="size-4" /> {merge.isPending ? '병합 중…' : '병합'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm" data-testid="merge-dialog">
        <div>
          <label className="mb-1 block text-xs text-fg-muted">합칠 대상 역(남는 역)</label>
          <RefInput target="station" value={intoId} onChange={setIntoId} />
        </div>
        {!intoId ? (
          <p className="text-xs text-fg-muted">대상 역을 고르면 미리 보기가 나옵니다.</p>
        ) : intoId === fromId ? (
          <p className="text-xs text-danger">같은 역으로는 병합할 수 없습니다.</p>
        ) : preview.isLoading ? (
          <p className="text-xs text-fg-muted">미리 보기 불러오는 중…</p>
        ) : preview.error ? (
          <p className="text-xs text-danger">{errorText(preview.error)}</p>
        ) : p ? (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <StationBox title="원본(사라짐 → 휴지통, 옛 주소는 대상으로)" s={p.from} />
              <StationBox title="대상(남음)" s={p.into} />
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {p.matches_merge_into ? (
                <Badge tone="good">원본의 "병합할 역"과 같음</Badge>
              ) : (
                <Badge tone="warn">원본의 "병합할 역"({p.from.merge_into_id ?? '없음'})과 다름</Badge>
              )}
              {p.distance_m == null ? (
                <Badge tone="warn">좌표 없음 — 거리 비교 못 함</Badge>
              ) : (
                <Badge tone={p.distance_m > 500 ? 'danger' : 'good'}>좌표 거리 {p.distance_m.toLocaleString()}m</Badge>
              )}
              {p.adds_former_name ? <Badge>원본 이름 "{p.from.name_ko}" → 대상의 옛 이름</Badge> : null}
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold">정거장 {p.line_stations.length}개</div>
              <ul className="space-y-0.5 text-xs" data-testid="merge-line-stations">
                {p.line_stations.map((l) => (
                  <li key={l.id}>
                    {l.line_name} <span className="text-fg-muted">· {statusText(l.status)}</span> —{' '}
                    {l.action === 'move' ? (
                      <span>대상 역 아래로 옮김</span>
                    ) : (
                      <span className="text-warn">
                        대상에 같은 노선({statusText(l.twin_status)})이 있어 그쪽으로 합침(이 행 삭제)
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            {p.references.length ? (
              <div className="text-xs">
                <span className="font-semibold">대상으로 바뀌는 참조</span>:{' '}
                {p.references.map((r) => `${r.table} ${r.count}`).join(' · ')}
              </div>
            ) : null}
            <div>
              <label className="mb-1 block text-xs text-fg-muted">
                같은 역임을 확인한 근거 출처(권장 — 정거장에 붙음)
              </label>
              <RefInput target="source" value={sourceId} onChange={setSourceId} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-fg-muted" htmlFor="merge-reason">
                병합 사유(필수)
              </label>
              <Input
                id="merge-reason"
                value={reason}
                placeholder="예: 기본계획에 기존 역 환승역으로 명시"
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <p className="text-xs text-danger">병합은 되돌릴 수 없습니다.</p>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

/** [병합] 단추 + 대화상자 */
export function MergeStationButton({
  fromId,
  intoId,
  size = 'sm',
  onDone,
}: {
  fromId: string;
  intoId?: string | null;
  size?: 'sm' | 'md';
  onDone?: (intoId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size={size === 'sm' ? 'sm' : undefined}
        variant="outline"
        className={size === 'sm' ? 'h-7 text-xs' : undefined}
        data-testid="merge-open"
        onClick={() => setOpen(true)}
      >
        <GitMerge className="size-3.5" /> 병합…
      </Button>
      {open ? (
        <MergeStationDialog fromId={fromId} defaultIntoId={intoId} open={open} onOpenChange={setOpen} onDone={onDone} />
      ) : null}
    </>
  );
}

/** [분리 유지] — 미확정이라 분리해 둔다(내부 메모에 표시) */
export function KeepSplitButton({ stationId, intoId }: { stationId: string; intoId: string }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async (why: string) => {
      const path = `/v1/admin/station/${encodeURIComponent(stationId)}`;
      const cur = await api<EntityResponse<{ editor_note?: string | null }>>(path);
      const line = `분리 유지(${intoId}): ${why}`;
      const note = cur.data.editor_note ? `${cur.data.editor_note}\n${line}` : line;
      return api(path, { method: 'PATCH', ifMatch: cur.version, json: { editor_note: note } });
    },
    onSuccess: async () => {
      toast.success('분리 유지로 표시했습니다(내부 메모)');
      await refresh(qc);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 text-xs"
      disabled={m.isPending}
      data-testid="keep-split"
      title="같은 역인지 아직 확인되지 않아 분리해 둡니다"
      onClick={() => {
        const why = window.prompt('분리 유지 이유(예: 환승 통로 미정 — 기본계획 확인 필요)');
        if (why?.trim()) m.mutate(why.trim());
      }}
    >
      <PauseCircle className="size-3.5" /> 분리 유지
    </Button>
  );
}
