/**
 * 노선 정거장 순서에서 새 역 그룹 만들어 넣기(2026-11-27 사용자 지시 — 폐선 노선처럼 기존 역 그룹이 없는 역을 바로 추가).
 * 역 그룹을 바로 만들고(POST /v1/admin/station, 출처 = 노선 출처) 정거장 행을 넣는다 — 정거장은 [정거장 순서 저장] 때 저장된다.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { codeLabel, codes, isEntityId, type Code } from '@k-raildex/contracts';
import { Button, Dialog, Input, Select } from '@k-raildex/ui';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText, type EntityResponse } from '../lib/api';

interface SourceLink {
  source_id: string;
  locator?: string | null;
  note?: string | null;
}

export function NewStationForLine({
  lineId,
  defaultStatus,
  where,
  onCreated,
}: {
  lineId: string;
  defaultStatus: string;
  /** 넣을 자리 설명(예: "선택한 ○○ 뒤", "끝에") */
  where: string;
  onCreated: (stationId: string, status: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState('stn-');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Code<'stationKind'>>('station');
  const [status, setStatus] = useState(defaultStatus);
  const line = useQuery({
    queryKey: ['entity', 'line', lineId],
    enabled: open,
    queryFn: () =>
      api<EntityResponse<{ sources: SourceLink[]; status: string }>>(`/v1/admin/line/${encodeURIComponent(lineId)}`),
  });
  const sources = [
    ...new Map(
      (line.data?.data.sources ?? []).map((s) => [
        s.source_id,
        { source_id: s.source_id, locator: s.locator ?? null, note: s.note ?? null },
      ]),
    ).values(),
  ];
  const idOk = isEntityId('station', id);
  const create = useMutation({
    mutationFn: () =>
      api('/v1/admin/station', {
        method: 'POST',
        json: { id, name_ko: name.trim(), kind, checked_at: new Date().toISOString().slice(0, 10), sources },
      }),
    onSuccess: () => {
      toast.success(`역 그룹 ${name} 를 만들었습니다 — 정거장 순서를 저장하면 노선에 들어갑니다`);
      onCreated(id, status);
      setOpen(false);
      setId('stn-');
      setName('');
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const field = (label: string, el: ReactNode, htmlFor: string) => (
    <div>
      <label className="mb-1 block text-xs text-fg-muted" htmlFor={htmlFor}>
        {label}
      </label>
      {el}
    </div>
  );
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        data-testid="new-station-open"
        onClick={() => {
          setStatus(defaultStatus);
          setOpen(true);
        }}
      >
        <Plus className="size-3.5" /> 새 역 그룹 만들어 넣기
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="새 역 그룹 만들어 넣기"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button
              data-testid="new-station-create"
              disabled={!idOk || !name.trim() || !sources.length || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? '만드는 중…' : '만들어 넣기'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2" data-testid="new-station-dialog">
          {field('이름', <Input id="ns-name" value={name} onChange={(e) => setName(e.target.value)} />, 'ns-name')}
          {field(
            '역 그룹 id',
            <>
              <Input id="ns-id" value={id} onChange={(e) => setId(e.target.value.trim())} />
              {!idOk ? <p className="mt-1 text-xs text-danger">stn- 로 시작하는 영문 소문자·숫자·하이픈</p> : null}
            </>,
            'ns-id',
          )}
          {field(
            '역 종류',
            <Select id="ns-kind" value={kind} onChange={(e) => setKind(e.target.value as Code<'stationKind'>)}>
              {codes.stationKind.values.map((v) => (
                <option key={v} value={v}>
                  {codeLabel('stationKind', v)}
                </option>
              ))}
            </Select>,
            'ns-kind',
          )}
          {field(
            '이 노선에서의 상태(정거장)',
            <Select id="ns-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {codes.status.values.map((v) => (
                <option key={v} value={v}>
                  {codeLabel('status', v)}
                </option>
              ))}
            </Select>,
            'ns-status',
          )}
          <p className="text-xs text-fg-muted sm:col-span-2">
            넣을 자리: <strong>{where}</strong>. 출처는 노선의 출처를 붙입니다
            {sources.length ? `(${sources.map((s) => s.source_id).join(', ')})` : ''}. 좌표·개통·폐지일은 만든 뒤 역
            편집·정거장 행에서 넣습니다.
          </p>
          {line.data && !sources.length ? (
            <p className="text-xs text-danger sm:col-span-2">노선에 출처가 없어 만들 수 없습니다.</p>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
