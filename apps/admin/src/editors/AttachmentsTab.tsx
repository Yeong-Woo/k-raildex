/**
 * 첨부 편집기(FR-ADM-061): 모든 개체 공통. 원문 발췌 / 링크 / 이미지 / 문서, 문서 업로드·기존 문서 선택(쪽),
 * 출처, 공개 여부(문서가 공개 가능 라이선스일 때만, Q75 A·V-H15), 순서. PDF 쪽에서 영역 잘라 내기 → 파생 문서.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { codeLabel, codes, PUBLISHABLE_LICENSE_CLASSES, type Code } from '@k-raildex/contracts';
import { Badge, Button, Card, CardHeader, Dialog, Empty, FieldShell, Input, Select, Textarea } from '@k-raildex/ui';
import {
  ArrowDown,
  ArrowUp,
  Crop,
  ExternalLink,
  FileText,
  Image,
  Link2,
  Pencil,
  Plus,
  Quote,
  Trash2,
} from 'lucide-react';
import { api, apiOptional, errorText, qs } from '../lib/api';
import { RefInput, useLabel } from '../form/widgets/RefInput';
import { CropDialog } from './CropDialog';

type Kind = Code<'attachmentKind'>;

export interface AttachmentRow {
  id: number | string;
  version: number;
  kind: Kind;
  title: string | null;
  quote: string | null;
  url: string | null;
  document_id: string | null;
  page: number | null;
  source_id: string | null;
  is_public: boolean;
  origin: string;
  ord: number;
  created_at?: string;
  updated_at?: string;
}

export interface DocumentRow {
  id: string;
  filename: string;
  mime?: string;
  kind: string;
  license_class: string;
  publishable: boolean;
  pages?: number | null;
  page?: number | null;
  size_bytes?: number;
}

type Draft = Omit<AttachmentRow, 'id' | 'version' | 'ord' | 'origin' | 'created_at' | 'updated_at'> & {
  id?: AttachmentRow['id'];
  version?: number;
};

const KIND_ICON = { quote: Quote, link: Link2, image: Image, document: FileText } as const;

const emptyDraft = (): Draft => ({
  kind: 'quote',
  title: null,
  quote: null,
  url: null,
  document_id: null,
  page: null,
  source_id: null,
  is_public: false,
});

/** 문서 한 건(공개 가능 여부 확인용). 없으면 null */
export function useDocument(id: string | null) {
  return useQuery({
    queryKey: ['document', id],
    enabled: !!id,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await apiOptional<{ data?: DocumentRow } & Partial<DocumentRow>>(
        `/v1/admin/documents/${encodeURIComponent(id!)}`,
      );
      if (!r) return null;
      return (r.data ?? r) as DocumentRow;
    },
  });
}

export function AttachmentsTab({ entityId }: { entityId: string }) {
  const qc = useQueryClient();
  const base = `/v1/admin/entities/${encodeURIComponent(entityId)}/attachments`;
  const q = useQuery({
    queryKey: ['attachments', entityId],
    queryFn: () => apiOptional<{ items: AttachmentRow[] }>(base),
  });
  const [editing, setEditing] = useState<Draft | null>(null);
  const [cropFor, setCropFor] = useState<{ documentId: string; page: number } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['attachments', entityId] });

  const patch = useMutation({
    mutationFn: ({ a, body }: { a: AttachmentRow; body: Record<string, unknown> }) =>
      api(`/v1/admin/attachments/${a.id}`, { method: 'PATCH', json: body, ifMatch: a.version }),
    onSuccess: refresh,
    onError: (e) => {
      toast.error(errorText(e));
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (a: AttachmentRow) => api(`/v1/admin/attachments/${a.id}`, { method: 'DELETE', ifMatch: a.version }),
    onSuccess: async () => {
      toast.success('첨부를 지웠습니다');
      await refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const reorder = useMutation({
    mutationFn: async (list: AttachmentRow[]) => {
      // 순서 = 배열 위치(1부터). 바뀐 것만 PATCH
      for (const [i, a] of list.entries())
        if (a.ord !== i + 1)
          await api(`/v1/admin/attachments/${a.id}`, { method: 'PATCH', json: { ord: i + 1 }, ifMatch: a.version });
    },
    onSettled: refresh,
    onError: (e) => toast.error(errorText(e)),
  });

  if (q.isLoading) return <Empty>불러오는 중…</Empty>;
  if (q.error) return <Empty>{errorText(q.error)}</Empty>;
  if (q.data === null)
    return (
      <Card>
        <Empty>첨부 API(/v1/admin/entities/:id/attachments)가 아직 없습니다.</Empty>
      </Card>
    );
  const items = [...(q.data?.items ?? [])].sort((a, b) => a.ord - b.ord || Number(a.id) - Number(b.id));

  return (
    <Card>
      <CardHeader
        title={`첨부 ${items.length}건`}
        actions={
          <Button size="sm" onClick={() => setEditing(emptyDraft())}>
            <Plus className="size-4" /> 첨부 추가
          </Button>
        }
      />
      {items.length === 0 ? (
        <Empty>첨부가 없습니다 — 원문 발췌·링크·이미지·문서를 붙일 수 있습니다.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((a, i) => (
            <AttachmentItem
              key={a.id}
              a={a}
              first={i === 0}
              last={i === items.length - 1}
              onMove={(d) => {
                const list = [...items];
                [list[i], list[i + d]] = [list[i + d]!, list[i]!];
                reorder.mutate(list);
              }}
              onEdit={() => setEditing({ ...a })}
              onDelete={() => {
                if (window.confirm('이 첨부를 지울까요?')) remove.mutate(a);
              }}
              onTogglePublic={(v) => patch.mutate({ a, body: { is_public: v } })}
              onCrop={a.document_id ? () => setCropFor({ documentId: a.document_id!, page: a.page ?? 1 }) : undefined}
            />
          ))}
        </ul>
      )}
      {editing ? (
        <AttachmentDialog
          entityId={entityId}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      ) : null}
      {cropFor ? (
        <CropDialog
          documentId={cropFor.documentId}
          initialPage={cropFor.page}
          onClose={() => setCropFor(null)}
          onCropped={async (doc, page, title) => {
            setCropFor(null);
            try {
              await api(base, {
                method: 'POST',
                json: { kind: 'image', title, document_id: doc.id, page, is_public: false, origin: 'manual' },
              });
              toast.success('잘라 낸 그림을 이미지 첨부로 붙였습니다');
              await refresh();
            } catch (e) {
              toast.error(errorText(e));
            }
          }}
        />
      ) : null}
    </Card>
  );
}

function AttachmentItem({
  a,
  first,
  last,
  onMove,
  onEdit,
  onDelete,
  onTogglePublic,
  onCrop,
}: {
  a: AttachmentRow;
  first: boolean;
  last: boolean;
  onMove: (d: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePublic: (v: boolean) => void;
  onCrop: (() => void) | undefined;
}) {
  const Icon = KIND_ICON[a.kind] ?? FileText;
  const doc = useDocument(a.document_id);
  const source = useLabel('source', a.source_id);
  const canPublish = !a.document_id || !!doc.data?.publishable;
  const hint = !a.document_id
    ? undefined
    : doc.isLoading
      ? '문서 확인 중'
      : doc.data
        ? doc.data.publishable
          ? undefined
          : `문서 라이선스(${labelOf('licenseClass', doc.data.license_class)})가 공개 가능하지 않아 공개할 수 없습니다(Q75)`
        : '문서 정보를 불러올 수 없어 공개 여부를 바꿀 수 없습니다';
  return (
    <li className="flex gap-3 px-4 py-3 text-sm" data-testid="attachment-item">
      <Icon className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{codeLabel('attachmentKind', a.kind)}</Badge>
          <span className="font-medium">{a.title ?? <span className="text-fg-muted">(제목 없음)</span>}</span>
          {a.origin !== 'manual' ? <Badge tone="info">{labelOf('attachmentOrigin', a.origin)}</Badge> : null}
          {a.is_public ? <Badge tone="good">공개</Badge> : null}
        </div>
        {a.quote ? (
          <blockquote className="mt-1 border-l-2 border-border pl-2 whitespace-pre-wrap text-fg-muted">
            {a.quote}
          </blockquote>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-fg-muted">
          {a.url ? (
            <a
              href={a.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-0.5 underline"
            >
              {a.url.length > 60 ? `${a.url.slice(0, 60)}…` : a.url} <ExternalLink className="size-3" />
            </a>
          ) : null}
          {a.document_id ? (
            <a
              href={`/v1/admin/documents/${a.document_id}/download`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {doc.data?.filename ?? a.document_id}
            </a>
          ) : null}
          {a.page ? <span>{a.page}쪽</span> : null}
          {a.source_id ? <span>출처: {source.data?.label ?? a.source_id}</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-start gap-1">
        <label className="mr-2 flex items-center gap-1 text-xs text-fg-muted" title={hint ?? '공개 사이트에 노출'}>
          <input
            type="checkbox"
            checked={a.is_public}
            disabled={!canPublish && !a.is_public}
            onChange={(e) => onTogglePublic(e.target.checked)}
          />
          공개
        </label>
        {onCrop ? (
          <Button variant="ghost" size="icon" aria-label="쪽에서 잘라 내기" title="쪽에서 잘라 내기" onClick={onCrop}>
            <Crop className="size-3.5" />
          </Button>
        ) : null}
        <Button variant="ghost" size="icon" aria-label="위로" disabled={first} onClick={() => onMove(-1)}>
          <ArrowUp className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="아래로" disabled={last} onClick={() => onMove(1)}>
          <ArrowDown className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="편집" onClick={onEdit}>
          <Pencil className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="삭제" onClick={onDelete}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}

function labelOf(domain: 'licenseClass' | 'attachmentOrigin' | 'documentKind', v: string): string {
  return (codes[domain].labels as Record<string, { ko: string }>)[v]?.ko ?? v;
}

function AttachmentDialog({
  entityId,
  initial,
  onClose,
  onSaved,
}: {
  entityId: string;
  initial: Draft;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [err, setErr] = useState<string | null>(null);
  const isNew = initial.id === undefined;
  const doc = useDocument(d.document_id);
  const needsDoc = d.kind === 'image' || d.kind === 'document';
  const canPublish = !d.document_id || !!doc.data?.publishable;
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        kind: d.kind,
        title: d.title,
        quote: d.quote,
        url: d.url,
        document_id: d.document_id,
        page: d.page,
        source_id: d.source_id,
        is_public: d.is_public && canPublish,
      };
      return isNew
        ? api(`/v1/admin/entities/${encodeURIComponent(entityId)}/attachments`, {
            method: 'POST',
            json: { ...body, origin: 'manual' },
          })
        : api(`/v1/admin/attachments/${d.id}`, { method: 'PATCH', json: body, ifMatch: d.version });
    },
    onSuccess: async () => {
      toast.success(isNew ? '첨부를 추가했습니다' : '첨부를 고쳤습니다');
      await onSaved();
    },
    onError: (e) => setErr(errorText(e)),
  });

  const validate = (): string | null => {
    if (d.kind === 'quote' && !d.quote) return '원문 발췌는 발췌문이 필요합니다';
    if (d.kind === 'link' && !d.url) return '링크는 URL 이 필요합니다';
    if (needsDoc && !d.document_id) return '이미지·문서는 문서를 올리거나 골라야 합니다';
    return null;
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? '첨부 추가' : '첨부 편집'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() => {
              const v = validate();
              if (v) setErr(v);
              else save.mutate();
            }}
          >
            {save.isPending ? '저장 중…' : '저장'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <FieldShell label="종류" htmlFor="att-kind">
            <Select id="att-kind" value={d.kind} onChange={(e) => set({ kind: e.target.value as Kind })}>
              {codes.attachmentKind.values.map((k) => (
                <option key={k} value={k}>
                  {codeLabel('attachmentKind', k)}
                </option>
              ))}
            </Select>
          </FieldShell>
          <FieldShell label="제목" htmlFor="att-title">
            <Input id="att-title" value={d.title ?? ''} onChange={(e) => set({ title: e.target.value || null })} />
          </FieldShell>
        </div>
        {d.kind === 'quote' ? (
          <FieldShell label="발췌문" htmlFor="att-quote">
            <Textarea
              id="att-quote"
              rows={4}
              value={d.quote ?? ''}
              onChange={(e) => set({ quote: e.target.value || null })}
            />
          </FieldShell>
        ) : null}
        <FieldShell label={d.kind === 'link' ? 'URL' : 'URL(원문 위치, 선택)'} htmlFor="att-url">
          <Input id="att-url" type="url" value={d.url ?? ''} onChange={(e) => set({ url: e.target.value || null })} />
        </FieldShell>
        <FieldShell
          label={needsDoc ? '문서' : '원문 문서(선택)'}
          help="파일을 올리거나 이미 올린 문서를 고릅니다. 공개 여부는 문서 라이선스로 정해집니다."
        >
          <DocumentPicker value={d.document_id} onChange={(id) => set({ document_id: id })} />
        </FieldShell>
        <div className="grid grid-cols-2 gap-3">
          <FieldShell label="쪽" htmlFor="att-page">
            <Input
              id="att-page"
              type="number"
              min={1}
              value={d.page ?? ''}
              onChange={(e) => set({ page: e.target.value ? Number(e.target.value) : null })}
            />
          </FieldShell>
          <FieldShell label="출처">
            <RefInput target="source" value={d.source_id} onChange={(v) => set({ source_id: v })} />
          </FieldShell>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={d.is_public && canPublish}
            disabled={!canPublish}
            onChange={(e) => set({ is_public: e.target.checked })}
          />
          공개 사이트에 노출
          {!canPublish ? (
            <span className="text-xs text-fg-muted">
              — 문서가 공개 가능한 라이선스(공공저작물·공공누리·공개 라이선스)일 때만 켤 수 있습니다(Q75)
            </span>
          ) : null}
        </label>
        {err ? (
          <p className="whitespace-pre-wrap text-sm text-danger" role="alert">
            {err}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/** 문서 고르기: 업로드(POST /v1/admin/documents) 또는 검색(GET /v1/admin/documents?q=) */
function DocumentPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const doc = useDocument(value);
  const [mode, setMode] = useState<'upload' | 'search'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [license, setLicense] = useState<string>('unknown');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const search = useQuery({
    queryKey: ['documents', q],
    enabled: mode === 'search',
    queryFn: () => apiOptional<{ items: DocumentRow[] }>(`/v1/admin/documents${qs({ q, limit: 20 })}`),
  });
  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.set('kind', 'upload');
      fd.set('license_class', license);
      if (sourceId) fd.set('source_id', sourceId);
      fd.set('file', file!);
      const r = await api<{ data?: DocumentRow; document?: DocumentRow } & Partial<DocumentRow>>(
        '/v1/admin/documents',
        { method: 'POST', body: fd },
      );
      return (r.data ?? r.document ?? r) as DocumentRow;
    },
    onSuccess: (d) => {
      toast.success(`문서를 올렸습니다: ${d.filename}`);
      onChange(d.id);
    },
    onError: (e) => toast.error(errorText(e)),
  });

  if (value)
    return (
      <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm">
        <FileText className="size-4 text-fg-muted" />
        <span className="truncate">{doc.data?.filename ?? value}</span>
        {doc.data ? (
          <Badge tone={doc.data.publishable ? 'good' : 'neutral'}>
            {labelOf('licenseClass', doc.data.license_class)}
            {doc.data.publishable ? ' · 공개 가능' : ''}
          </Badge>
        ) : null}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onChange(null)}>
          바꾸기
        </Button>
      </div>
    );

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2">
      <div className="flex gap-1 text-xs">
        <Button size="sm" variant={mode === 'upload' ? 'secondary' : 'ghost'} onClick={() => setMode('upload')}>
          파일 올리기
        </Button>
        <Button size="sm" variant={mode === 'search' ? 'secondary' : 'ghost'} onClick={() => setMode('search')}>
          기존 문서 고르기
        </Button>
      </div>
      {mode === 'upload' ? (
        <div className="flex flex-col gap-2">
          <input
            type="file"
            aria-label="문서 파일"
            className="text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Select aria-label="라이선스 구분" value={license} onChange={(e) => setLicense(e.target.value)}>
              {codes.licenseClass.values.map((l) => (
                <option key={l} value={l}>
                  {codeLabel('licenseClass', l)}
                  {(PUBLISHABLE_LICENSE_CLASSES as readonly string[]).includes(l) ? ' · 공개 가능' : ''}
                </option>
              ))}
            </Select>
            <RefInput target="source" value={sourceId} onChange={setSourceId} />
          </div>
          <Button size="sm" className="self-start" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
            {upload.isPending ? '올리는 중…' : '올리기'}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <Input placeholder="파일 이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          {search.data === null ? (
            <p className="text-xs text-fg-muted">문서 API 가 아직 없습니다.</p>
          ) : (
            <ul className="max-h-40 overflow-auto text-sm">
              {(search.data?.items ?? []).map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-muted"
                    onClick={() => onChange(d.id)}
                  >
                    <span className="truncate">{d.filename}</span>
                    <span className="ml-auto shrink-0 text-xs text-fg-muted">
                      {labelOf('documentKind', d.kind)} · {labelOf('licenseClass', d.license_class)}
                    </span>
                  </button>
                </li>
              ))}
              {search.data?.items.length === 0 ? <li className="text-xs text-fg-muted">없음</li> : null}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
