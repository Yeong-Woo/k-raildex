/** 개체 상세 = 편집(FR-ADM-020~028) */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { entityContracts, entityUiMeta, type EntityType } from '@k-raildex/contracts';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  Empty,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@k-raildex/ui';
import { api, ApiError, qs } from '../lib/api';
import { changedFields, pretty } from '../lib/diff';
import { fromSlug, toSlug } from '../lib/entity-types';
import { emptyRecord, FormEngine } from '../form/FormEngine';
import { LineStationsEditor } from '../editors/LineStationsEditor';
import { LineStopTable, StopNeighbors } from '../editors/LineStops';
import { StationLineStations } from '../editors/StationLineStations';
import { ManagedStations } from '../editors/ManagedStations';
import { AttachmentsTab } from '../editors/AttachmentsTab';
import { MergeStationButton } from '../editors/MergeStation';
import { RenameIdButton } from '../editors/RenameId';

// 지도 강조 탭(MapLibre 는 무거우므로 탭을 열 때만 불러온다)
const FOCUS_MAP_TYPES: readonly EntityType[] = ['station', 'line_station', 'line', 'service', 'facility'];
const EntityFocusMap = lazy(() => import('../map/EntityFocusMap').then((m) => ({ default: m.EntityFocusMap })));

type Obj = Record<string, unknown>;
interface EntityResponse {
  data: Obj;
  version: number;
  derived: Obj;
  referenced_by: {
    total: number;
    items: {
      table: string;
      column: string;
      owner_id: string | null;
      owner_type: EntityType | null;
      owner_label: string | null;
      owner_deleted: boolean;
      count: number;
    }[];
  };
}
interface WriteResponse {
  id: string;
  version: number | null;
  changeset_id: string | null;
  data: Obj | null;
}

const META_KEYS = ['version', 'created_at', 'updated_at', 'deleted_at', 'last_changeset_id', 'reviewed_at'];

function stripMeta(o: Obj): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(o)) if (!META_KEYS.includes(k)) out[k] = v;
  return out;
}

/** zod 오류·서버 422 → 필드 경로별 메시지 */
function errorMap(issues: { path: string; message: string }[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const i of issues) if (!(i.path in m)) m[i.path || '_'] = i.message;
  return m;
}

export function EntityDetail() {
  const { type: slug, id } = useParams({ from: '/data/$type/$id' });
  const { tab } = useSearch({ from: '/data/$type/$id' });
  const type = fromSlug(slug);
  if (!type) return <Empty>알 수 없는 개체 종류: {slug}</Empty>;
  return <Detail key={`${type}/${id}`} type={type} id={id} tab={tab ?? 'info'} />;
}

function Detail({ type, id, tab }: { type: EntityType; id: string; tab: string }) {
  const isNew = id === 'new';
  const meta = entityUiMeta[type];
  const qc = useQueryClient();
  const navigate = useNavigate();
  const path = `/v1/admin/${toSlug(type)}`;

  const q = useQuery({
    queryKey: ['entity', type, id],
    enabled: !isNew,
    queryFn: () => api<EntityResponse>(`${path}/${encodeURIComponent(id)}${qs({ include_deleted: true })}`),
  });
  const original = useMemo(
    () => (isNew ? emptyRecord(type) : q.data ? stripMeta(q.data.data) : null),
    [isNew, type, q.data],
  );
  const [draft, setDraft] = useState<Obj | null>(original);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rationale, setRationale] = useState('');
  useEffect(() => setDraft(original), [original]);

  const changed = draft && original ? changedFields(original, draft) : [];
  const dirty = changed.length > 0;
  const deleted = !!q.data?.data.deleted_at;

  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [dirty]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('데이터 없음');
      if (isNew) {
        return api<WriteResponse>(`${path}${qs({ rationale })}`, { method: 'POST', json: draft });
      }
      const patch: Obj = {};
      for (const k of changed) patch[k] = draft[k];
      return api<WriteResponse>(`${path}/${encodeURIComponent(id)}${qs({ rationale })}`, {
        method: 'PATCH',
        json: patch,
        ifMatch: q.data!.version,
      });
    },
    onSuccess: async (r) => {
      toast.success(`저장했습니다 (${r.changeset_id ?? '변경 없음'})`);
      setConfirmOpen(false);
      setRationale('');
      setErrors({});
      await qc.invalidateQueries({ queryKey: ['entity', type] });
      await qc.invalidateQueries({ queryKey: ['list', type] });
      if (isNew) void navigate({ to: '/data/$type/$id', params: { type: toSlug(type), id: r.id } });
    },
    onError: (e) => {
      setConfirmOpen(false);
      if (e instanceof ApiError) {
        if (e.status === 409 && e.body.current_version !== undefined) {
          toast.error('다른 곳에서 먼저 수정했습니다. 새로 불러온 뒤 다시 저장하세요.');
        } else {
          toast.error(e.body.message);
        }
        setErrors(
          errorMap(
            (e.body.details ?? []).map((d) => ({
              path: d.path ?? '',
              message: `${d.rule ? `[${d.rule}] ` : ''}${d.message}`,
            })),
          ),
        );
      } else toast.error(String(e));
    },
  });

  const remove = useMutation({
    mutationFn: (reason: string) =>
      api(`${path}/${encodeURIComponent(id)}${qs({ reason })}`, { method: 'DELETE', ifMatch: q.data!.version }),
    onSuccess: async () => {
      toast.success('휴지통으로 옮겼습니다');
      await qc.invalidateQueries({ queryKey: ['entity', type, id] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.body.references) {
        toast.error(
          `참조하는 행이 있어 삭제할 수 없습니다: ${e.body.references.map((r) => `${r.table}(${r.owner_id ?? '-'})`).join(', ')}`,
        );
      } else toast.error(e instanceof Error ? e.message : String(e));
    },
  });
  const restore = useMutation({
    mutationFn: () => api(`${path}/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success('복구했습니다');
      await qc.invalidateQueries({ queryKey: ['entity', type, id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const onSave = () => {
    if (!draft) return;
    const r = entityContracts[type].create.safeParse(draft);
    if (!r.success) {
      setErrors(errorMap(r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))));
      toast.error('입력값을 확인하세요');
      return;
    }
    setErrors({});
    setConfirmOpen(true);
  };

  if (!isNew && q.isLoading) return <Empty>불러오는 중…</Empty>;
  if (!isNew && q.error) return <Empty>{q.error instanceof Error ? q.error.message : '오류'}</Empty>;
  if (!draft || !original) return null;

  const title = String(draft[meta.titleField] ?? '') || (isNew ? `새 ${meta.label}` : id);

  return (
    <div className={`mx-auto flex flex-col gap-4 ${tab === 'stations' ? 'max-w-7xl' : 'max-w-5xl'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/data/$type"
          params={{ type: toSlug(type) }}
          search={{}}
          className="text-sm text-fg-muted hover:underline"
        >
          {meta.label}
        </Link>
        <span className="text-fg-muted">/</span>
        <h1 className="text-lg font-bold">{title}</h1>
        {!isNew ? <code className="text-xs text-fg-muted">{id}</code> : null}
        {deleted ? <Badge tone="danger">휴지통</Badge> : null}
        {typeof q.data?.data.review_status === 'string' ? (
          <Badge
            tone={
              q.data.data.review_status === 'verified'
                ? 'good'
                : q.data.data.review_status === 'flagged'
                  ? 'danger'
                  : 'warn'
            }
          >
            {q.data.data.review_status === 'verified'
              ? '검수 완료'
              : q.data.data.review_status === 'flagged'
                ? '이의 있음'
                : '검수 전'}
          </Badge>
        ) : null}
        <div className="ml-auto flex flex-wrap justify-end gap-2">
          {!isNew && !deleted ? (
            <RenameIdButton
              type={type}
              id={id}
              referenceCount={q.data?.referenced_by.total}
              onDone={(nid) =>
                void navigate({ to: '/data/$type/$id', params: { type: toSlug(type), id: nid }, search: {} })
              }
            />
          ) : null}
          {type === 'station' && !isNew && !deleted ? (
            <MergeStationButton
              size="md"
              fromId={id}
              intoId={(q.data?.data.merge_into_id as string | null | undefined) ?? null}
              onDone={(into) =>
                void navigate({ to: '/data/$type/$id', params: { type: 'station', id: into }, search: {} })
              }
            />
          ) : null}
          {!isNew && !deleted ? (
            <Button
              variant="outline"
              onClick={() => {
                const reason = window.prompt('삭제 사유(휴지통으로 옮김)');
                if (reason !== null) remove.mutate(reason);
              }}
            >
              삭제
            </Button>
          ) : null}
          {deleted ? <Button onClick={() => restore.mutate()}>복구</Button> : null}
          {!deleted ? (
            <Button onClick={onSave} disabled={!dirty || save.isPending}>
              {isNew ? '만들기' : `저장${dirty ? ` (${changed.length})` : ''}`}
            </Button>
          ) : null}
        </div>
      </div>
      {!isNew && q.data ? (
        <p className="text-xs text-fg-muted">
          version {q.data.version} · 수정 {String(q.data.data.updated_at ?? '')} · 마지막 변경 묶음{' '}
          {q.data.data.last_changeset_id ? (
            <Link to="/changesets/$id" params={{ id: String(q.data.data.last_changeset_id) }} className="underline">
              {String(q.data.data.last_changeset_id)}
            </Link>
          ) : (
            '-'
          )}
        </p>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(t) =>
          void navigate({ to: '/data/$type/$id', params: { type: toSlug(type), id }, search: { tab: t } })
        }
      >
        <TabsList>
          <TabsTrigger value="info">정보</TabsTrigger>
          {!isNew && type === 'line' ? <TabsTrigger value="stations">정거장 순서</TabsTrigger> : null}
          {!isNew && type === 'station' ? <TabsTrigger value="neighbors">앞뒤 정거장</TabsTrigger> : null}
          {!isNew && type === 'station' ? <TabsTrigger value="line-stations">노선별</TabsTrigger> : null}
          {!isNew && type === 'line_station' ? <TabsTrigger value="managed">관리역</TabsTrigger> : null}
          {!isNew && FOCUS_MAP_TYPES.includes(type) ? <TabsTrigger value="map">지도</TabsTrigger> : null}
          {!isNew ? <TabsTrigger value="attachments">첨부</TabsTrigger> : null}
          {!isNew ? <TabsTrigger value="derived">파생 값</TabsTrigger> : null}
          {!isNew ? <TabsTrigger value="history">이력</TabsTrigger> : null}
          {!isNew ? (
            <TabsTrigger value="refs">
              참조됨 {q.data?.referenced_by.total ? `(${q.data.referenced_by.total})` : ''}
            </TabsTrigger>
          ) : null}
          {!isNew ? <TabsTrigger value="raw">원본 보기</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="info" className="pt-4">
          {errors._ ? <p className="mb-2 text-sm text-danger">{errors._}</p> : null}
          <FormEngine type={type} value={draft} onChange={setDraft} errors={errors} mode={isNew ? 'create' : 'edit'} />
        </TabsContent>
        {!isNew && q.data ? (
          <>
            {type === 'line' ? (
              <TabsContent value="stations" className="pt-4">
                <LineStopsTab lineId={id} />
              </TabsContent>
            ) : null}
            {type === 'station' ? (
              <TabsContent value="neighbors" className="pt-4">
                <StopNeighbors stationId={id} />
              </TabsContent>
            ) : null}
            {type === 'station' ? (
              <TabsContent value="line-stations" className="pt-4">
                <StationLineStations stationId={id} derived={q.data.derived} />
              </TabsContent>
            ) : null}
            {type === 'line_station' ? (
              <TabsContent value="managed" className="pt-4">
                <ManagedStations
                  ls={q.data.data as { id: string }}
                  operatorId={(q.data.derived.operator_id as string | null | undefined) ?? null}
                />
              </TabsContent>
            ) : null}
            {FOCUS_MAP_TYPES.includes(type) ? (
              <TabsContent value="map" className="pt-4">
                <Suspense fallback={<Empty>지도 불러오는 중…</Empty>}>
                  <EntityFocusMap type={type} id={id} />
                </Suspense>
              </TabsContent>
            ) : null}
            <TabsContent value="attachments" className="pt-4">
              <AttachmentsTab entityId={id} />
            </TabsContent>
            <TabsContent value="derived" className="pt-4">
              <Card>
                <CardHeader title="계산된 값(저장하지 않음 — DB 뷰)" />
                <pre className="overflow-auto p-4 text-xs">{pretty(q.data.derived)}</pre>
              </Card>
            </TabsContent>
            <TabsContent value="history" className="pt-4">
              <History path={`${path}/${encodeURIComponent(id)}/history`} />
            </TabsContent>
            <TabsContent value="refs" className="pt-4">
              <Card>
                <CardHeader title="이 개체를 가리키는 행" />
                {q.data.referenced_by.items.length === 0 ? (
                  <Empty>참조 없음 — 삭제할 수 있습니다</Empty>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-fg-muted">
                      <tr>
                        <th className="px-4 py-2">테이블.열</th>
                        <th className="px-4 py-2">소유 개체</th>
                        <th className="px-4 py-2">행 수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.referenced_by.items.map((r, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-4 py-1.5">
                            {r.table}.{r.column}
                          </td>
                          <td className="px-4 py-1.5">
                            {r.owner_id && r.owner_type ? (
                              <Link
                                to="/data/$type/$id"
                                params={{ type: toSlug(r.owner_type), id: r.owner_id }}
                                search={{}}
                                className="underline"
                              >
                                {r.owner_label ?? r.owner_id}
                              </Link>
                            ) : (
                              (r.owner_id ?? '-')
                            )}
                            {r.owner_deleted ? (
                              <Badge tone="danger" className="ml-1">
                                휴지통
                              </Badge>
                            ) : null}
                          </td>
                          <td className="px-4 py-1.5">{r.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </TabsContent>
            <TabsContent value="raw" className="pt-4">
              <Card>
                <CardHeader title="원본 보기(읽기 전용)" />
                <pre className="overflow-auto p-4 text-xs">{pretty(q.data.data)}</pre>
              </Card>
            </TabsContent>
          </>
        ) : null}
      </Tabs>

      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={isNew ? '만들기 확인' : `바뀐 필드 ${changed.length}개`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              취소
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? '저장 중…' : '저장'}
            </Button>
          </>
        }
      >
        {!isNew ? (
          <div className="flex flex-col gap-3">
            {changed.map((k) => (
              <div key={k}>
                <div className="text-xs font-semibold">{entityUiMeta[type].fields[k]?.label ?? k}</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <pre className="overflow-auto rounded bg-danger/10 p-2">{pretty(original[k])}</pre>
                  <pre className="overflow-auto rounded bg-good/10 p-2">{pretty(draft[k])}</pre>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <label className="mt-3 block text-xs text-fg-muted">변경 이유(선택)</label>
        <Input value={rationale} onChange={(e) => setRationale(e.target.value)} />
      </Dialog>
    </div>
  );
}

interface HistoryItem {
  changeset_id: string;
  seq: number;
  op: string;
  title?: string;
  applied_at?: string;
  before: Obj | null;
  after: Obj | null;
}

function History({ path }: { path: string }) {
  const q = useQuery({ queryKey: ['history', path], queryFn: () => api<{ items: HistoryItem[] }>(path) });
  if (q.isLoading) return <Empty>불러오는 중…</Empty>;
  const items = q.data?.items ?? [];
  if (items.length === 0) return <Empty>이력 없음</Empty>;
  return (
    <div className="flex flex-col gap-2">
      {items.map((h) => {
        const keys =
          h.before && h.after
            ? Object.keys(h.after).filter(
                (k) => JSON.stringify(h.before?.[k]) !== JSON.stringify(h.after?.[k]) && !META_KEYS.includes(k),
              )
            : [];
        return (
          <Card key={`${h.changeset_id}-${h.seq}`} className="p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{h.op}</Badge>
              <Link to="/changesets/$id" params={{ id: h.changeset_id }} className="underline">
                {h.changeset_id}
              </Link>
              <span className="text-fg-muted">{h.title}</span>
              <span className="ml-auto text-xs text-fg-muted">{h.applied_at}</span>
            </div>
            {keys.length ? <p className="mt-1 text-xs text-fg-muted">바뀐 필드: {keys.join(', ')}</p> : null}
          </Card>
        );
      })}
    </div>
  );
}

/** 노선 [정거장 순서] 탭: 보기(위키백과 역 목록형 표) ↔ 편집(정거장 편집 표) */
function LineStopsTab({ lineId }: { lineId: string }) {
  const [edit, setEdit] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 text-sm" role="group" aria-label="정거장 순서 보기">
        {(
          [
            [false, '보기'],
            [true, '편집'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={edit === v}
            data-testid={v ? 'stops-mode-edit' : 'stops-mode-view'}
            className={
              edit === v
                ? 'rounded-full border border-primary bg-primary/10 px-3 py-0.5 font-semibold'
                : 'rounded-full border border-border px-3 py-0.5 hover:bg-muted'
            }
            onClick={() => setEdit(v)}
          >
            {label}
          </button>
        ))}
      </div>
      {edit ? <LineStationsEditor lineId={lineId} /> : <LineStopTable lineId={lineId} />}
    </div>
  );
}
