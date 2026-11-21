/**
 * OSM 매핑 점검(FR-ADM-074): 노선을 고르면 배정된 OSM way(공사 중 포함)를 강조하고, 지금 보이는 범위의 way 를
 * 미배정(주황)·다른 노선 배정(회색)으로 나눠 그린다. way 를 클릭하면 id·이름·ref·relation 을 보여 주고
 * "relation id 추가"·"way 이름 추가" → PATCH line { osm_map }(If-Match). 배정 결과(osm.v_line_way)는 뷰라 바로 바뀌고,
 * 현재 지도 물리화 뷰(mv_map_line·mv_map_station)는 파생 갱신(worker) 뒤에 바뀐다.
 * OSM 데이터는 표시만 한다(ODbL 표기, 자체 테이블에 좌표를 쓰지 않음 C-6).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Map as MlMap, MapLayerMouseEvent } from 'maplibre-gl';
import type { LineOsmMap } from '@k-raildex/contracts';
import type { LayerSpec } from '@k-raildex/map';
import { Badge, Button, Card, Label } from '@k-raildex/ui';
import { ExternalLink, RefreshCw, X } from 'lucide-react';
import { api, ApiError, apiOptional, errorText, qs, type EntityResponse } from '../lib/api';
import { RefInput } from '../form/widgets/RefInput';
import { bboxParam } from './geo';
import { boundsOf, EMPTY_FC, useGeoJsonLayer, useMapLibre, type FeatureCollection } from './useMap';
import { useFeaturePopup } from './FeaturePopup';

interface RelationInfo {
  id: number;
  name: string | null;
  ref: string | null;
  route: string | null;
}
interface WaysResponse extends FeatureCollection {
  truncated: boolean;
  limit: number;
  relations: RelationInfo[];
}
interface LineGeometryResponse extends WaysResponse {
  line: { id: string; name_ko: string; status: string; length_km: number | null; color: string | null };
  osm_map: (LineOsmMap & { bbox: number[] | null }) | null;
  osm_length_km: { operating?: number; construction?: number };
}
interface WayProps {
  way_id: number;
  name: string | null;
  ref: string | null;
  railway: string | null;
  construction: string | null;
  is_construction: boolean;
  assigned_line_id: string | null;
  relation_ids: number[];
}

/** way 를 볼 최소 줌(넓은 범위는 상한 3000건에 걸린다) */
const MIN_ZOOM = 10;
const SELECTED = '#DC2626';
const UNASSIGNED = '#F97316';
const OTHER = '#94A3B8';

const VIEW_LAYERS: LayerSpec[] = [
  {
    id: 'osm-view',
    type: 'line',
    source: 'osm-view',
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': ['case', ['==', ['coalesce', ['get', 'assigned_line_id'], ''], ''], UNASSIGNED, OTHER],
      'line-width': ['case', ['==', ['coalesce', ['get', 'assigned_line_id'], ''], ''], 3, 2],
      'line-opacity': 0.9,
    },
  },
];
const LINE_LAYERS: LayerSpec[] = [
  {
    id: 'osm-line',
    type: 'line',
    source: 'osm-line',
    filter: ['all', ['==', ['get', 'kind'], 'osm_way'], ['!=', ['get', 'is_construction'], true]],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': SELECTED, 'line-width': 4 },
  },
  {
    id: 'osm-line-construction',
    type: 'line',
    source: 'osm-line',
    filter: ['all', ['==', ['get', 'kind'], 'osm_way'], ['==', ['get', 'is_construction'], true]],
    paint: { 'line-color': SELECTED, 'line-width': 4, 'line-dasharray': [2, 1.2] },
  },
  {
    id: 'osm-line-station',
    type: 'circle',
    source: 'osm-line',
    filter: ['==', ['get', 'kind'], 'station'],
    paint: { 'circle-radius': 4, 'circle-color': '#1f2937', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
  },
];
const PICK_LAYERS: LayerSpec[] = [
  {
    id: 'osm-picked',
    type: 'line',
    source: 'osm-picked',
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#2563EB', 'line-width': 8, 'line-opacity': 0.6 },
  },
];

const parseIds = (v: unknown): number[] =>
  Array.isArray(v) ? (v as number[]) : typeof v === 'string' ? (JSON.parse(v) as number[]) : [];

export function OsmMappingCheck({
  lineId,
  onLineChange,
}: {
  lineId: string | null;
  onLineChange: (id: string | null) => void;
}) {
  const qc = useQueryClient();
  const { container, map } = useMapLibre();
  const [bbox, setBbox] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    if (map) (window as unknown as { __kraildexMap?: MlMap }).__kraildexMap = map;
  }, [map]);

  // 지도 범위(줌 MIN_ZOOM 이상일 때만 way 를 받는다)
  useEffect(() => {
    if (!map) return;
    const onMove = () => setBbox(map.getZoom() >= MIN_ZOOM ? bboxParam(map.getBounds()) : null);
    onMove();
    map.on('moveend', onMove);
    return () => {
      map.off('moveend', onMove);
    };
  }, [map]);

  const view = useQuery({
    queryKey: ['map', 'osm-ways', bbox],
    enabled: !!bbox,
    placeholderData: (prev) => prev,
    queryFn: () => apiOptional<WaysResponse>(`/v1/admin/map/osm-ways${qs({ bbox })}`),
  });
  const line = useQuery({
    queryKey: ['map', 'line-geometry', lineId],
    enabled: !!lineId,
    queryFn: () => api<LineGeometryResponse>(`/v1/admin/map/line-geometry/${encodeURIComponent(lineId!)}`),
  });
  const entity = useQuery({
    queryKey: ['entity', 'line', lineId],
    enabled: !!lineId,
    queryFn: () =>
      api<EntityResponse<{ name_ko: string; osm_map: LineOsmMap | null }>>(
        `/v1/admin/line/${encodeURIComponent(lineId!)}`,
      ),
  });

  const viewFc = bbox ? (view.data ?? EMPTY_FC) : EMPTY_FC;
  useGeoJsonLayer(map, 'osm-view', viewFc, VIEW_LAYERS);
  useGeoJsonLayer(map, 'osm-line', line.data ?? EMPTY_FC, LINE_LAYERS);

  // way 찾기(지금 범위 → 노선 배정 목록)
  const relations = useMemo(() => {
    const m = new Map<number, RelationInfo>();
    for (const r of [...(view.data?.relations ?? []), ...(line.data?.relations ?? [])]) m.set(r.id, r);
    return m;
  }, [view.data, line.data]);
  const pickedFeature = useMemo(() => {
    if (picked == null) return null;
    return (
      [...(view.data?.features ?? []), ...(line.data?.features ?? [])].find(
        (f) => f.properties?.kind !== 'station' && Number(f.properties?.way_id) === picked,
      ) ?? null
    );
  }, [picked, view.data, line.data]);
  const pickedFc = useMemo(
    () => (pickedFeature ? { type: 'FeatureCollection' as const, features: [pickedFeature] } : EMPTY_FC),
    [pickedFeature],
  );
  useGeoJsonLayer(map, 'osm-picked', pickedFc, PICK_LAYERS);
  // 역 점 클릭 → 정보 팝업(OSM way 클릭은 옆 패널)
  useFeaturePopup(map, ['osm-line-station']);

  // 노선을 고르면 그 선형 범위로
  useEffect(() => {
    if (!map || !line.data) return;
    const b = boundsOf(line.data);
    if (b) map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 0 });
  }, [map, line.data?.line.id]);

  // way 클릭
  useEffect(() => {
    if (!map) return;
    const onClick = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const id = f?.properties?.way_id;
      if (id != null) setPicked(Number(id));
    };
    const enter = () => (map.getCanvas().style.cursor = 'pointer');
    const leave = () => (map.getCanvas().style.cursor = '');
    const ids = ['osm-view', 'osm-line', 'osm-line-construction'];
    for (const l of ids) {
      map.on('click', l, onClick);
      map.on('mouseenter', l, enter);
      map.on('mouseleave', l, leave);
    }
    return () => {
      for (const l of ids) {
        map.off('click', l, onClick);
        map.off('mouseenter', l, enter);
        map.off('mouseleave', l, leave);
      }
    };
  }, [map]);

  const current: LineOsmMap = entity.data?.data.osm_map ?? {
    relation_ids: [],
    way_names: [],
    bbox: null,
    priority: 0,
    include_construction: true,
    note: null,
  };
  const save = useMutation({
    mutationFn: (next: LineOsmMap) =>
      api(`/v1/admin/line/${encodeURIComponent(lineId!)}`, {
        method: 'PATCH',
        ifMatch: entity.data!.version,
        json: { osm_map: next },
      }),
    onSuccess: async () => {
      toast.success('OSM 배정을 저장했습니다 — 현재 지도는 파생 갱신 뒤 바뀝니다');
      await qc.invalidateQueries({ queryKey: ['entity', 'line', lineId] });
      await qc.invalidateQueries({ queryKey: ['map'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const refresh = useMutation({
    mutationFn: () =>
      apiOptional<{ id: string | null; deduplicated: boolean }>('/v1/admin/jobs', {
        method: 'POST',
        json: { name: 'refresh-derived', data: { reason: 'OSM 매핑 점검' } },
      }),
    onSuccess: (r) =>
      r === null
        ? toast.error('작업 API(POST /v1/admin/jobs)가 아직 없습니다 — worker 가 데이터 변경 알림으로 갱신합니다')
        : toast.success(r.deduplicated ? '이미 대기 중인 파생 갱신에 합쳤습니다' : '파생 갱신 작업을 보냈습니다'),
    onError: (e) =>
      toast.error(
        e instanceof ApiError && e.status === 422 ? '이 API 는 파생 갱신 작업을 받지 않습니다' : errorText(e),
      ),
  });

  const pp = pickedFeature?.properties as unknown as WayProps | undefined;
  const pickedRelations = pp ? parseIds(pp.relation_ids) : [];
  const editable = !!lineId && !!entity.data && !save.isPending;

  return (
    <div className="absolute inset-0 flex">
      <aside className="flex w-96 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-bg-elevated p-3 text-sm">
        <div>
          <Label>노선</Label>
          <RefInput target="line" value={lineId} onChange={onLineChange} />
        </div>
        {line.data ? (
          <Card className="p-3" data-testid="osm-line-summary">
            <div className="flex items-center gap-2">
              <strong>{line.data.line.name_ko}</strong>
              <Link
                to="/data/$type/$id"
                params={{ type: 'line', id: line.data.line.id }}
                search={{}}
                className="text-fg-muted"
                title="노선 상세"
              >
                <ExternalLink className="size-3.5" />
              </Link>
            </div>
            <dl className="mt-1 grid grid-cols-[6.5rem_1fr] gap-y-0.5 text-xs">
              <dt className="text-fg-muted">배정 way</dt>
              <dd data-testid="osm-assigned-count">
                {line.data.features.filter((f) => f.properties?.kind === 'osm_way').length}
              </dd>
              <dt className="text-fg-muted">way 길이 합</dt>
              <dd>
                {line.data.osm_length_km.operating != null
                  ? `운영 ${line.data.osm_length_km.operating}km`
                  : '운영 없음'}
                {line.data.osm_length_km.construction != null
                  ? ` · 공사 중 ${line.data.osm_length_km.construction}km`
                  : ''}
                <span className="text-fg-muted"> (복선은 선로마다)</span>
              </dd>
              <dt className="text-fg-muted">노선 연장</dt>
              <dd>{line.data.line.length_km != null ? `${line.data.line.length_km}km` : '미확인'}</dd>
            </dl>
          </Card>
        ) : null}
        {lineId && entity.data ? (
          <Card className="flex flex-col gap-1 p-3 text-xs" data-testid="osm-map-editor">
            <div className="font-semibold text-fg-muted">osm_map</div>
            <div>
              relation:{' '}
              {current.relation_ids.length ? (
                <span className="inline-flex flex-wrap gap-1" data-testid="osm-map-relations">
                  {current.relation_ids.map((id) => (
                    <Badge key={id}>
                      {id}
                      {relations.get(id)?.name ? ` ${relations.get(id)!.name}` : ''}
                      <button
                        type="button"
                        className="ml-1"
                        aria-label={`relation ${id} 빼기`}
                        disabled={!editable}
                        onClick={() =>
                          save.mutate({ ...current, relation_ids: current.relation_ids.filter((x) => x !== id) })
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </span>
              ) : (
                <span className="text-fg-muted">없음</span>
              )}
            </div>
            <div>
              way 이름:{' '}
              {current.way_names.length ? (
                <span className="inline-flex flex-wrap gap-1" data-testid="osm-map-way-names">
                  {current.way_names.map((n) => (
                    <Badge key={n}>
                      {n}
                      <button
                        type="button"
                        className="ml-1"
                        aria-label={`way 이름 ${n} 빼기`}
                        disabled={!editable}
                        onClick={() => save.mutate({ ...current, way_names: current.way_names.filter((x) => x !== n) })}
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </span>
              ) : (
                <span className="text-fg-muted">없음</span>
              )}
            </div>
            <div className="text-fg-muted">
              bbox {current.bbox ? current.bbox.join(', ') : '없음'} · 우선순위 {current.priority} · 공사 중{' '}
              {current.include_construction ? '포함' : '제외'}
            </div>
            <p className="text-[11px] text-fg-muted">
              같은 way 를 여러 노선이 원하면 우선순위 숫자가 작은 노선이 가져갑니다. bbox 는 way 가운데 꼭짓점 기준.
            </p>
          </Card>
        ) : null}

        {pp ? (
          <Card className="flex flex-col gap-1 p-3" data-testid="osm-way-panel">
            <div className="flex items-center gap-2">
              <strong>way {pp.way_id}</strong>
              <a
                href={`https://www.openstreetmap.org/way/${pp.way_id}`}
                target="_blank"
                rel="noreferrer"
                className="text-fg-muted"
                title="openstreetmap.org 에서 보기"
              >
                <ExternalLink className="size-3.5" />
              </a>
              <button
                type="button"
                className="ml-auto text-fg-muted hover:text-fg"
                aria-label="선택 해제"
                onClick={() => setPicked(null)}
              >
                <X className="size-4" />
              </button>
            </div>
            <dl className="grid grid-cols-[4.5rem_1fr] gap-y-0.5 text-xs">
              <dt className="text-fg-muted">이름</dt>
              <dd>{pp.name ?? '-'}</dd>
              <dt className="text-fg-muted">ref</dt>
              <dd>{pp.ref ?? '-'}</dd>
              <dt className="text-fg-muted">railway</dt>
              <dd>
                {pp.railway ?? '-'}
                {pp.construction ? ` (construction=${pp.construction})` : ''}
                {pp.is_construction ? <Badge tone="warn">공사 중</Badge> : null}
              </dd>
              <dt className="text-fg-muted">배정 노선</dt>
              <dd data-testid="osm-way-assigned">
                {pp.assigned_line_id ? (
                  <Link to="/data/$type/$id" params={{ type: 'line', id: pp.assigned_line_id }} search={{}}>
                    {pp.assigned_line_id}
                  </Link>
                ) : (
                  <span className="text-warn">미배정</span>
                )}
              </dd>
            </dl>
            <div className="mt-1 text-xs font-semibold text-fg-muted">relation {pickedRelations.length}</div>
            <ul className="flex flex-col gap-1 text-xs" data-testid="osm-way-relations">
              {pickedRelations.map((id) => {
                const r = relations.get(id);
                const has = current.relation_ids.includes(id);
                return (
                  <li key={id} className="flex items-center gap-2">
                    <a href={`https://www.openstreetmap.org/relation/${id}`} target="_blank" rel="noreferrer">
                      {id}
                    </a>
                    <span className="min-w-0 truncate" title={r?.name ?? undefined}>
                      {r?.name ?? '-'}
                      {r?.route ? ` · ${r.route}` : ''}
                      {r?.ref ? ` · ref ${r.ref}` : ''}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto h-6 shrink-0 px-2 text-xs whitespace-nowrap"
                      title="이 relation id 를 고른 노선의 osm_map 에 더한다"
                      disabled={!editable || has}
                      onClick={() => save.mutate({ ...current, relation_ids: [...current.relation_ids, id] })}
                    >
                      {has ? '이미 있음' : 'osm_map 에 추가'}
                    </Button>
                  </li>
                );
              })}
            </ul>
            <Button
              size="sm"
              variant="outline"
              className="mt-1"
              disabled={!editable || !pp.name || current.way_names.includes(pp.name)}
              onClick={() => pp.name && save.mutate({ ...current, way_names: [...current.way_names, pp.name] })}
            >
              way 이름 추가{pp.name ? `: ${pp.name}` : ''}
            </Button>
            {!lineId ? <p className="text-[11px] text-fg-muted">배정하려면 먼저 노선을 고르세요.</p> : null}
          </Card>
        ) : (
          <p className="text-xs text-fg-muted">지도에서 OSM way 를 클릭하면 정보와 배정 버튼이 나옵니다.</p>
        )}

        <Button size="sm" variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
          <RefreshCw className="size-3.5" /> 파생 갱신(현재 지도 다시 계산)
        </Button>

        <section className="mt-auto text-[11px] text-fg-muted">
          <ul className="flex flex-col gap-0.5">
            <li className="flex items-center gap-1">
              <span className="inline-block h-1 w-4" style={{ background: SELECTED }} /> 고른 노선에 배정(점선 = 공사
              중)
            </li>
            <li className="flex items-center gap-1">
              <span className="inline-block h-1 w-4" style={{ background: UNASSIGNED }} /> 미배정 way
            </li>
            <li className="flex items-center gap-1">
              <span className="inline-block h-1 w-4" style={{ background: OTHER }} /> 다른 노선에 배정
            </li>
          </ul>
          <p className="mt-1 font-medium" data-testid="odbl-attribution">
            OSM 선형 © OpenStreetMap contributors, ODbL 1.0 (openstreetmap.org/copyright) — 참고용, 저장하지 않음
          </p>
        </section>
      </aside>
      <div className="relative min-w-0 flex-1">
        <div className="absolute inset-0">
          <div ref={container} className="h-full w-full" data-testid="osm-map" />
        </div>
        <div className="absolute top-3 left-3 flex flex-col gap-1 rounded-md border border-border bg-bg-elevated/95 px-3 py-2 text-xs shadow">
          {!bbox ? (
            <span>확대(줌 {MIN_ZOOM} 이상)하면 지금 범위의 OSM way 를 모두 보여 줍니다.</span>
          ) : view.data === null ? (
            <span>OSM API 가 아직 없습니다.</span>
          ) : view.data ? (
            <span data-testid="osm-view-count">
              범위 안 way {view.data.features.length}
              {view.data.truncated ? `(상한 ${view.data.limit} — 더 확대하세요)` : ''} · 미배정{' '}
              {view.data.features.filter((f) => !f.properties?.assigned_line_id).length}
            </span>
          ) : (
            <span>불러오는 중…</span>
          )}
          <span className="text-[10px] text-fg-muted">© OpenStreetMap contributors, ODbL</span>
        </div>
      </div>
    </div>
  );
}
