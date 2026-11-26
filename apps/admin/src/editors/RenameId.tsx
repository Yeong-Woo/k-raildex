/**
 * ID 변경(FR-ADM-063): 새 id → 참조 전부 갱신(FK ON UPDATE CASCADE) + id_redirect(옛 주소는 새 id 로 넘어감).
 * 형식은 화면에서 먼저 보고(isEntityId), 중복·예약(삭제된 id·옛 id) 여부는 dry_run 으로 서버가 판정한다.
 * 옛 id 는 영구 예약되어 다시 쓸 수 없다(C-7).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ID_PREFIX, isEntityId, type EntityType } from '@k-raildex/contracts';
import { Button, Dialog, Input } from '@k-raildex/ui';
import { PencilLine } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText, qs } from '../lib/api';

export function RenameIdButton({
  type,
  id,
  referenceCount,
  onDone,
}: {
  type: EntityType;
  id: string;
  referenceCount?: number;
  onDone: (newId: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newId, setNewId] = useState(id);
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const prefix = ID_PREFIX[type];
  const formatOk = isEntityId(type, newId);
  const same = newId === id;

  const call = (dry: boolean) =>
    api(`/v1/admin/entities/${encodeURIComponent(id)}/rename${qs({ dry_run: dry || undefined })}`, {
      method: 'POST',
      json: { new_id: newId, reason: reason || undefined },
    });
  const check = useMutation({
    mutationFn: () => call(true),
    onSuccess: () => {
      setChecked(newId);
      setCheckError(null);
    },
    onError: (e) => {
      setChecked(null);
      setCheckError(errorText(e));
    },
  });
  const apply = useMutation({
    mutationFn: () => call(false),
    onSuccess: async () => {
      toast.success(`ID 를 ${newId} 로 바꿨습니다`);
      setOpen(false);
      await qc.invalidateQueries();
      onDone(newId);
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <>
      <Button variant="outline" data-testid="rename-open" onClick={() => setOpen(true)}>
        <PencilLine className="size-3.5" /> ID 변경…
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="ID 변경"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button
              variant="outline"
              disabled={!formatOk || same || check.isPending}
              onClick={() => check.mutate()}
              data-testid="rename-check"
            >
              {check.isPending ? '확인 중…' : '사용 가능 확인'}
            </Button>
            <Button
              data-testid="rename-apply"
              disabled={checked !== newId || !reason.trim() || apply.isPending}
              title={checked !== newId ? '먼저 사용 가능 확인' : !reason.trim() ? '변경 사유를 적으세요' : undefined}
              onClick={() => apply.mutate()}
            >
              {apply.isPending ? '바꾸는 중…' : 'ID 변경'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm" data-testid="rename-dialog">
          <p className="text-xs text-fg-muted">
            지금 id <code>{id}</code>. 참조{referenceCount ? ` ${referenceCount}곳` : ''}(노선별 역·계획·시간표 등)이
            모두 새 id 로 바뀌고, 옛 id 주소는 새 id 로 넘어갑니다. 옛 id 는 다시 쓸 수 없습니다.
          </p>
          <div>
            <label className="mb-1 block text-xs text-fg-muted" htmlFor="rename-new-id">
              새 id(접두사 <code>{prefix}</code> + 영문 소문자·숫자·하이픈)
            </label>
            <Input
              id="rename-new-id"
              value={newId}
              onChange={(e) => {
                setNewId(e.target.value.trim());
                setChecked(null);
                setCheckError(null);
              }}
            />
            {!formatOk ? (
              <p className="mt-1 text-xs text-danger">id 형식이 아닙니다</p>
            ) : checkError ? (
              <p className="mt-1 text-xs text-danger" data-testid="rename-error">
                {checkError}
              </p>
            ) : checked === newId ? (
              <p className="mt-1 text-xs text-good" data-testid="rename-ok">
                사용할 수 있습니다
              </p>
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-xs text-fg-muted" htmlFor="rename-reason">
              변경 사유(필수)
            </label>
            <Input id="rename-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
      </Dialog>
    </>
  );
}
