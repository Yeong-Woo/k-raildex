/** PDF 쪽 보기 + 영역 끌어 잘라 내기(FR-ADM-061) → POST /documents/:id/crop → figure_crop 파생 문서 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button, Dialog, Input } from '@k-raildex/ui';
import { api, apiOptional, errorText } from '../lib/api';
import type { DocumentRow } from './AttachmentsTab';

type Box = [number, number, number, number];

/** 끌기 두 점(0~1) → 정규화된 bbox(x0<x1, y0<y1) */
export function normBox(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  const c = (v: number) => Math.min(1, Math.max(0, v));
  return [c(Math.min(a.x, b.x)), c(Math.min(a.y, b.y)), c(Math.max(a.x, b.x)), c(Math.max(a.y, b.y))];
}

export function CropDialog({
  documentId,
  initialPage,
  onClose,
  onCropped,
}: {
  documentId: string;
  initialPage: number;
  onClose: () => void;
  onCropped: (doc: DocumentRow, page: number, title: string | null) => void;
}) {
  const qc = useQueryClient();
  const [page, setPage] = useState(initialPage);
  const [title, setTitle] = useState('');
  const [box, setBox] = useState<Box | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const img = useRef<HTMLDivElement>(null);
  const pages = useQuery({
    queryKey: ['document-pages', documentId],
    queryFn: () => apiOptional<{ items: DocumentRow[] }>(`/v1/admin/documents/${documentId}/pages`),
  });
  const render = useMutation({
    mutationFn: () => api(`/v1/admin/documents/${documentId}/pages`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success('쪽 이미지를 만들었습니다');
      await qc.invalidateQueries({ queryKey: ['document-pages', documentId] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const crop = useMutation({
    mutationFn: async () => {
      const r = await api<{ data?: DocumentRow } & Partial<DocumentRow>>(`/v1/admin/documents/${documentId}/crop`, {
        method: 'POST',
        json: { page, bbox: box, ...(title ? { title } : {}) },
      });
      return (r.data ?? r) as DocumentRow;
    },
    onSuccess: (d) => onCropped(d, page, title || null),
    onError: (e) => toast.error(errorText(e)),
  });

  const pageCount = pages.data?.items.length ?? 0;
  const point = (e: React.PointerEvent) => {
    const r = img.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="쪽에서 그림 잘라 내기"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
          <Button disabled={!box || crop.isPending} onClick={() => crop.mutate()}>
            {crop.isPending ? '잘라 내는 중…' : '잘라 내어 첨부'}
          </Button>
        </>
      }
    >
      {pages.data === null ? (
        <p className="text-sm text-fg-muted">문서 쪽 API 가 아직 없습니다.</p>
      ) : pageCount === 0 && !pages.isLoading ? (
        <div className="flex flex-col items-start gap-2 text-sm">
          <p className="text-fg-muted">쪽 이미지가 없습니다. 먼저 쪽 이미지를 만드세요(PDF).</p>
          <Button size="sm" disabled={render.isPending} onClick={() => render.mutate()}>
            {render.isPending ? '만드는 중…' : '쪽 이미지 만들기'}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => (setPage(page - 1), setBox(null))}
            >
              이전 쪽
            </Button>
            <span>
              {page} / {pageCount || '?'}쪽
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={pageCount > 0 && page >= pageCount}
              onClick={() => (setPage(page + 1), setBox(null))}
            >
              다음 쪽
            </Button>
            <Input
              className="ml-auto h-8 w-48"
              placeholder="그림 제목(선택)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div
            ref={img}
            className="relative cursor-crosshair touch-none select-none border border-border"
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              start.current = point(e);
              setBox(null);
            }}
            onPointerMove={(e) => {
              if (start.current) setBox(normBox(start.current, point(e)));
            }}
            onPointerUp={() => {
              start.current = null;
              setBox((b) => (b && b[2] - b[0] > 0.01 && b[3] - b[1] > 0.01 ? b : null));
            }}
          >
            <img
              src={`/v1/admin/documents/${documentId}/pages/${page}/image`}
              alt={`${page}쪽`}
              draggable={false}
              className="block w-full"
            />
            {box ? (
              <div
                className="pointer-events-none absolute border-2 border-primary bg-primary/15"
                style={{
                  left: `${box[0] * 100}%`,
                  top: `${box[1] * 100}%`,
                  width: `${(box[2] - box[0]) * 100}%`,
                  height: `${(box[3] - box[1]) * 100}%`,
                }}
              />
            ) : null}
          </div>
          <p className="text-xs text-fg-muted">
            {box ? `영역 ${box.map((v) => v.toFixed(3)).join(', ')}` : '이미지 위에서 끌어 영역을 고르세요'}
          </p>
        </div>
      )}
    </Dialog>
  );
}
