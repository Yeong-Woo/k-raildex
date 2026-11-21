/**
 * 계획 선형 편집(FR-ADM-073): 계획을 고르면 기존 선형(plan_geometry)·표시 선형(v_plan_shape)을 그린다.
 * - schematic: 지도에서 역을 차례로 클릭해 경유역(via_station_ids)을 만든다. 직선/곡선 미리 보기(곡선이면 geom 으로 저장, 직선이면 DB 가 채움)
 * - traced·official: 지도를 클릭해 꼭짓점 추가, 꼭짓점 끌기, 되돌리기, 그리기 끝, GeoJSON 붙여넣기
 * - 길이(하버사인) vs 계획 연장(plan_ref.length_km). 저장 = PATCH plan { geometries: [...] }(If-Match, 다른 선형은 그대로)
 * 경유역 좌표는 자체 좌표(station.geom)만 쓴다 — 지도에서 OSM 선형에 스냅해 보이는 근사 좌표 역은 own_coord 로 바꾼다(C-6).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Marker, type Map as MlMap, type MapLayerMouseEvent } from 'maplibre-gl';
import { codeLabel, codes, type PlanGeometry } from '@k-raildex/contracts';
import { currentLineLayers, currentStationLayers, GEOMETRY_QUALITY_LABELS, type LayerSpec } from '@k-raildex/map';
import { Badge, Button, Card, cn, Input, Label, Select, Textarea } from '@k-raildex/ui';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Undo2, X } from 'lucide-react';
import { api, apiOptional, errorText, type EntityResponse } from '../lib/api';
import { RefInput } from '../form/widgets/RefInput';
import { curveThrough, lengthKm, parseLineGeoJson, type Coord } from './geo';
import { boundsOf, EMPTY_FC, useGeoJsonLayer, useMapLibre, type FeatureCollection } from './useMap';
import { useFeaturePopup } from './FeaturePopup';

type Kind = PlanGeometry['kind'];
const KINDS = codes.planGeometryKind.values as readonly Kind[];

interface PlanGeometryResponse extends FeatureCollection {
  plan: { id: string; name_ko: string };
  shape: { type: 'Feature'; geometry: unknown; properties: Record<string, unknown> } | null;
  refs: { program_id: string; section: string | null; length_km: number | null }[];
  attribution?: string;
}

interface Via {
  id: string;
  name: string;
  coord: Coord;
}

interface Draft {
  /** 고치는 기존 선형의 순서(null = 새 선형) */
  index: number | null;
  kind: Kind;
  via: Via[];
  lines: Coord[][];
  curved: boolean;
  source_id: string | null;
  accuracy_m: string;
  method_note: string;
  note: string;
}

const KIND_COLORS: Record<Kind, string> = { schematic: '#7C3AED', traced: '#0891B2', official: '#16A34A' };

const newDraft = (kind: Kind): Draft => ({
  index: null,
  kind,
  via: [],
  lines: [[]],
  curved: false,
  source_id: null,
  accuracy_m: '',
  method_note: '',
  note: '',
});

/** 계약 필드만(읽기 응답을 그대로 다시 보낸다) */
function contractGeometry(g: PlanGeometry): PlanGeometry {
  return {
    kind: g.kind,
    via_station_ids: g.via_station_ids ?? null,
    geom: g.geom ?? null,
    accuracy_m: g.accuracy_m ?? null,
    method_note: g.method_note ?? null,
    source_id: g.source_id,
    note: g.note ?? null,
  };
}

/** 초안이 그리는 선(경유역 = 직선/곡선) */
function draftLines(d: Draft): Coord[][] {
  if (d.kind === 'schematic') {
    const pts = d.via.map((v) => v.coord);
    return pts.length >= 2 ? [d.curved ? curveThrough(pts) : pts] : [];
  }
  return d.lines.filter((l) => l.length >= 2);
}

const fc = (features: FeatureCollection['features']): FeatureCollection => ({ type: 'FeatureCollection', features });

const GEOM_LAYERS: LayerSpec[] = [
  {
    id: 'plan-shape',
    type: 'line',
    source: 'plan-shape',
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#F59E0B', 'line-width': 9, 'line-opacity': 0.3 },
  },
];
const EXISTING_LAYERS: LayerSpec[] = [
  {
    id: 'plan-geoms',
    type: 'line',
    source: 'plan-geoms',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: {
      'line-color': ['match', ['get', 'kind'], ...Object.entries(KIND_COLORS).flat(), '#64748B'],
      'line-width': 3,
      'line-dasharray': [2, 1.5],
    },
  },
  {
    id: 'plan-geoms-multi',
    type: 'line',
    source: 'plan-geoms',
    filter: ['==', ['geometry-type'], 'MultiLineString'],
    paint: {
      'line-color': ['match', ['get', 'kind'], ...Object.entries(KIND_COLORS).flat(), '#64748B'],
      'line-width': 3,
      'line-dasharray': [2, 1.5],
    },
  },
];
const DRAFT_LAYERS: LayerSpec[] = [
  {
    id: 'draft-line',
    type: 'line',
    source: 'draft',
    filter: ['!=', ['geometry-type'], 'Point'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#DC2626', 'line-width': 4 },
  },
  {
    id: 'draft-via',
    type: 'circle',
    source: 'draft',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 7, 'circle-color': '#DC2626', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
  },
];

export function PlanGeometryEditor({
  planId,
  onPlanChange,
}: {
  planId: string | null;
  onPlanChange: (id: string | null) => void;
}) {
  const qc = useQueryClient();
  const { container, map } = useMapLibre();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [past, setPast] = useState<Draft[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [paste, setPaste] = useState('');
  const markers = useRef<Marker[]>([]);

  useEffect(() => {
    if (map) (window as unknown as { __kraildexMap?: MlMap }).__kraildexMap = map;
  }, [map]);

  const stations = useQuery({
    queryKey: ['map', 'current-stations'],
    queryFn: () => apiOptional<FeatureCollection>('/v1/admin/map/current-stations'),
  });
  const lines = useQuery({
    queryKey: ['map', 'current-lines'],
    queryFn: () => apiOptional<FeatureCollection>('/v1/admin/map/current-lines'),
  });
  const entity = useQuery({
    queryKey: ['entity', 'plan', planId],
    enabled: !!planId,
    queryFn: () =>
      api<EntityResponse<{ name_ko: string; geometries: PlanGeometry[] }>>(
        `/v1/admin/plan/${encodeURIComponent(planId!)}`,
      ),
  });
  const geo = useQuery({
    queryKey: ['map', 'plan-geometry', planId],
    enabled: !!planId,
    queryFn: () => api<PlanGeometryResponse>(`/v1/admin/map/plan-geometry/${encodeURIComponent(planId!)}`),
  });

  // 계획이 바뀌면 초안을 버린다
  useEffect(() => {
    set(null, []);
    setDrawing(false);
  }, [planId]);

  // 지도 이벤트 처리기가 최신 초안을 보도록 ref 로도 들고 있는다
  const draftRef = useRef<Draft | null>(null);
  const pastRef = useRef<Draft[]>([]);
  const set = (d: Draft | null, history: Draft[]) => {
    draftRef.current = d;
    pastRef.current = history;
    setDraft(d);
    setPast(history);
  };
  const update = (fn: (d: Draft) => Draft, record = true) => {
    const d = draftRef.current;
    if (!d) return;
    set(fn(d), record ? [...pastRef.current.slice(-49), d] : pastRef.current);
  };
  const undo = () => {
    const h = pastRef.current;
    const prev = h[h.length - 1];
    if (prev) set(prev, h.slice(0, -1));
  };

  const existing = geo.data?.features.filter((f) => f.properties?.kind !== 'station') ?? [];
  const shown = useMemo(
    () => fc(existing.filter((f) => draft?.index == null || f.properties?.index !== draft.index)),
    [geo.data, draft?.index],
  );
  const shapeFc = useMemo(() => (geo.data?.shape ? fc([geo.data.shape]) : EMPTY_FC), [geo.data]);
  const dLines = draft ? draftLines(draft) : [];
  const draftFc = useMemo(() => {
    if (!draft) return EMPTY_FC;
    const feats: FeatureCollection['features'] = [];
    if (dLines.length)
      feats.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: dLines }, properties: {} });
    if (draft.kind === 'schematic')
      for (const v of draft.via)
        feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: v.coord }, properties: { id: v.id } });
    return fc(feats);
  }, [draft]);

  useGeoJsonLayer(map, 'ctx-lines', lines.data, currentLineLayers('ctx-lines'));
  useGeoJsonLayer(map, 'plan-shape', shapeFc, GEOM_LAYERS);
  useGeoJsonLayer(map, 'plan-geoms', shown, EXISTING_LAYERS);
  useGeoJsonLayer(map, 'draft', draftFc, DRAFT_LAYERS);
  useGeoJsonLayer(map, 'stations', stations.data, currentStationLayers('stations'));

  // 편집 중이 아닐 때만 역·노선 정보 팝업(편집 중 클릭은 경유역·꼭짓점 추가)
  useFeaturePopup(map, ['current-station', 'current-line', 'current-line-construction'], !draft);

  // 계획을 고르면 선형 범위로
  useEffect(() => {
    if (!map || !geo.data) return;
    const b = boundsOf(fc([...geo.data.features, ...(geo.data.shape ? [geo.data.shape] : [])]));
    if (b) map.fitBounds(b, { padding: 80, maxZoom: 13, duration: 0 });
  }, [map, geo.data?.plan.id]);

  // schematic: 역 클릭 → 경유역 추가
  const schematic = draft?.kind === 'schematic';
  useEffect(() => {
    if (!map || !schematic) return;
    const onClick = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const p = f?.properties as { station_id?: string; name_ko?: string; own_coord?: string | Coord } | undefined;
      if (!p?.station_id) return;
      const own = typeof p.own_coord === 'string' ? (JSON.parse(p.own_coord) as Coord | null) : (p.own_coord ?? null);
      const coord = own ?? ((f!.geometry as { coordinates: Coord }).coordinates.slice(0, 2) as Coord);
      const id = p.station_id;
      update((d) =>
        d.via[d.via.length - 1]?.id === id ? d : { ...d, via: [...d.via, { id, name: p.name_ko ?? id, coord }] },
      );
    };
    const enter = () => (map.getCanvas().style.cursor = 'pointer');
    const leave = () => (map.getCanvas().style.cursor = '');
    map.on('click', 'current-station', onClick);
    map.on('mouseenter', 'current-station', enter);
    map.on('mouseleave', 'current-station', leave);
    return () => {
      map.off('click', 'current-station', onClick);
      map.off('mouseenter', 'current-station', enter);
      map.off('mouseleave', 'current-station', leave);
    };
  }, [map, schematic]);

  // traced·official 그리기: 지도 클릭 → 마지막 줄에 꼭짓점
  useEffect(() => {
    if (!map || !drawing || !draft || draft.kind === 'schematic') return;
    map.getCanvas().style.cursor = 'crosshair';
    const onClick = (e: MapLayerMouseEvent) => {
      if (e.originalEvent.target !== map.getCanvas()) return; // 꼭짓점 표식 클릭은 무시
      const c: Coord = [Math.round(e.lngLat.lng * 1e6) / 1e6, Math.round(e.lngLat.lat * 1e6) / 1e6];
      update((d) => {
        const ls = d.lines.length ? d.lines.map((l) => [...l]) : [[]];
        ls[ls.length - 1]!.push(c);
        return { ...d, lines: ls };
      });
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
      map.getCanvas().style.cursor = '';
    };
  }, [map, drawing, draft?.kind]);

  // 꼭짓점 표식(끌기)
  const vertexKey = draft && draft.kind !== 'schematic' ? JSON.stringify(draft.lines) : '';
  useEffect(() => {
    for (const m of markers.current) m.remove();
    markers.current = [];
    if (!map || !draft || draft.kind === 'schematic') return;
    draft.lines.forEach((l, li) =>
      l.forEach((c, ci) => {
        const el = document.createElement('div');
        el.className = 'size-3 rounded-full border-2 border-white bg-[#DC2626] shadow';
        el.dataset.testid = 'draft-vertex';
        const m = new Marker({ element: el, draggable: true }).setLngLat(c).addTo(map);
        m.on('dragend', () => {
          const p = m.getLngLat();
          update((d) => {
            const ls = d.lines.map((x) => [...x]);
            ls[li]![ci] = [Math.round(p.lng * 1e6) / 1e6, Math.round(p.lat * 1e6) / 1e6];
            return { ...d, lines: ls };
          });
        });
        markers.current.push(m);
      }),
    );
  }, [map, vertexKey]);
  useEffect(
    () => () => {
      for (const m of markers.current) m.remove();
    },
    [],
  );

  const startEdit = (i: number) => {
    const g = entity.data?.data.geometries[i];
    if (!g) return;
    const viaFeats = new Map(
      (geo.data?.features ?? [])
        .filter((f) => f.properties?.kind === 'station')
        .map((f) => [String(f.properties!.station_id), f]),
    );
    setDrawing(false);
    set(
      {
        index: i,
        kind: g.kind,
        via: (g.via_station_ids ?? []).map((id) => {
          const f = viaFeats.get(id);
          return {
            id,
            name: String(f?.properties?.name_ko ?? id),
            coord: ((f?.geometry as { coordinates?: Coord } | undefined)?.coordinates ?? [0, 0]) as Coord,
          };
        }),
        lines: g.kind === 'schematic' ? [[]] : ((g.geom?.coordinates as Coord[][] | undefined) ?? [[]]),
        // 저장된 schematic geom 이 경유역 직선보다 점이 많으면 곡선으로 저장한 것
        curved:
          g.kind === 'schematic' &&
          (g.geom?.coordinates?.[0]?.length ?? 0) > (g.via_station_ids?.length ?? 0) &&
          (g.via_station_ids?.length ?? 0) > 2,
        source_id: g.source_id,
        accuracy_m: g.accuracy_m == null ? '' : String(g.accuracy_m),
        method_note: g.method_note ?? '',
        note: g.note ?? '',
      },
      [],
    );
  };

  const save = useMutation({
    mutationFn: async (next: PlanGeometry[]) =>
      api(`/v1/admin/plan/${encodeURIComponent(planId!)}`, {
        method: 'PATCH',
        ifMatch: entity.data!.version,
        json: { geometries: next },
      }),
    onSuccess: async () => {
      toast.success('계획 선형을 저장했습니다');
      set(null, []);
      setDrawing(false);
      await qc.invalidateQueries({ queryKey: ['entity', 'plan', planId] });
      await qc.invalidateQueries({ queryKey: ['map'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const base = (entity.data?.data.geometries ?? []).map(contractGeometry);
  const problems: string[] = [];
  if (draft) {
    if (!draft.source_id) problems.push('출처를 고르세요');
    if (draft.kind === 'schematic' && draft.via.length < 2) problems.push('경유역을 2개 이상 클릭하세요');
    if (draft.kind !== 'schematic' && !dLines.length) problems.push('선을 그리거나 GeoJSON 을 붙여 넣으세요');
    if (draft.accuracy_m !== '' && !/^\d+$/.test(draft.accuracy_m)) problems.push('정확도는 0 이상 정수(m)');
    if (draft.kind !== 'schematic' && draft.accuracy_m === '') problems.push('도면 추출·공식 좌표는 정확도(m)가 필요');
    if (draft.kind !== 'schematic' && !draft.method_note.trim())
      problems.push('도면 추출·공식 좌표는 방법 메모가 필요');
  }
  const submit = () => {
    if (!draft || problems.length) return;
    const item: PlanGeometry = {
      kind: draft.kind,
      via_station_ids: draft.kind === 'schematic' ? draft.via.map((v) => v.id) : null,
      // schematic 직선은 DB 가 경유역으로 채운다(geom NULL), 곡선이면 보간 결과를 표시용으로 저장
      geom:
        draft.kind === 'schematic' && !draft.curved
          ? null
          : { type: 'MultiLineString', coordinates: draftLines(draft) },
      accuracy_m: draft.accuracy_m === '' ? null : Number(draft.accuracy_m),
      method_note: draft.method_note.trim() || null,
      source_id: draft.source_id!,
      note: draft.note.trim() || null,
    };
    save.mutate(draft.index == null ? [...base, item] : base.map((g, i) => (i === draft.index ? item : g)));
  };
  const remove = (i: number) => {
    if (!window.confirm(`${i + 1}번 선형을 지울까요?`)) return;
    save.mutate(base.filter((_, j) => j !== i));
  };

  const applyPaste = () => {
    try {
      const g = parseLineGeoJson(paste);
      update((d) => ({ ...d, lines: g.coordinates }));
      setPaste('');
      setDrawing(false);
      const b = boundsOf(fc([{ type: 'Feature', geometry: g, properties: {} }]));
      if (b && map) map.fitBounds(b, { padding: 80, maxZoom: 14 });
      toast.success(`선 ${g.coordinates.length}개를 불러왔습니다`);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const km = lengthKm(dLines);
  const refs = geo.data?.refs.filter((r) => r.length_km != null) ?? [];
  const shape = geo.data?.shape?.properties;

  return (
    <div className="absolute inset-0 flex">
      <aside className="flex w-96 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-bg-elevated p-3 text-sm">
        <div>
          <Label>계획</Label>
          <RefInput target="plan" value={planId} onChange={onPlanChange} />
        </div>
        {!planId ? <p className="text-xs text-fg-muted">선형을 편집할 계획을 고르세요.</p> : null}
        {geo.data ? (
          <>
            <Card className="p-3" data-testid="plan-shape">
              <div className="mb-1 text-xs font-semibold text-fg-muted">표시 선형(v_plan_shape)</div>
              {shape ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={shape.quality === 'schematic' ? 'warn' : 'good'}>
                    {GEOMETRY_QUALITY_LABELS[String(shape.quality)] ?? String(shape.quality)}
                  </Badge>
                  {shape.length_km != null ? <span>{String(shape.length_km)}km</span> : null}
                  {shape.odbl ? <span className="text-[11px] text-fg-muted">OSM(ODbL)</span> : null}
                </div>
              ) : (
                <p className="text-xs text-fg-muted">없음</p>
              )}
              <div className="mt-2 text-xs text-fg-muted">
                계획 연장(상위 계획 반영):{' '}
                {refs.length
                  ? refs.map((r) => `${r.length_km}km${r.section ? `(${r.section})` : ''}`).join(' · ')
                  : '미확인'}
              </div>
            </Card>
            <section>
              <h2 className="mb-1 text-xs font-semibold text-fg-muted">계획 선형 {base.length}개</h2>
              <ul className="flex flex-col gap-1" data-testid="plan-geometries">
                {existing.map((f) => {
                  const p = f.properties!;
                  const i = Number(p.index);
                  return (
                    <li
                      key={i}
                      className={cn(
                        'flex items-center gap-2 rounded border border-border px-2 py-1',
                        draft?.index === i && 'border-primary',
                      )}
                      data-testid="plan-geometry-row"
                    >
                      <span
                        className="inline-block size-2.5 rounded-full"
                        style={{ background: KIND_COLORS[p.kind as Kind] }}
                      />
                      <span>
                        {i + 1}. {codeLabel('planGeometryKind', String(p.kind) as Kind)}
                      </span>
                      <span className="text-xs text-fg-muted">
                        {p.length_km != null ? `${String(p.length_km)}km` : ''}
                        {Array.isArray(p.via_station_ids) ? ` · 경유역 ${p.via_station_ids.length}` : ''}
                        {p.accuracy_m != null ? ` · ±${String(p.accuracy_m)}m` : ''}
                      </span>
                      <span className="ml-auto flex gap-1">
                        <button
                          type="button"
                          className="text-fg-muted hover:text-fg"
                          aria-label={`${i + 1}번 선형 편집`}
                          onClick={() => startEdit(i)}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          className="text-fg-muted hover:text-danger"
                          aria-label={`${i + 1}번 선형 삭제`}
                          onClick={() => remove(i)}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
              {!draft ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {KINDS.map((k) => (
                    <Button
                      key={k}
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        set(newDraft(k), []);
                        setDrawing(k !== 'schematic');
                      }}
                    >
                      <Plus className="size-3.5" /> {codeLabel('planGeometryKind', k)}
                    </Button>
                  ))}
                </div>
              ) : null}
            </section>
          </>
        ) : null}

        {draft ? (
          <Card className="flex flex-col gap-2 p-3" data-testid="geometry-draft">
            <div className="flex items-center gap-2">
              <strong>{draft.index == null ? '새 선형' : `${draft.index + 1}번 선형 편집`}</strong>
              <Select
                aria-label="선형 종류"
                className="ml-auto h-8 w-36"
                value={draft.kind}
                onChange={(e) => {
                  const kind = e.target.value as Kind;
                  update((d) => ({ ...d, kind }));
                  setDrawing(kind !== 'schematic');
                }}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {codeLabel('planGeometryKind', k)}
                  </option>
                ))}
              </Select>
            </div>

            {draft.kind === 'schematic' ? (
              <>
                <p className="text-xs text-fg-muted">지도에서 역을 차례로 클릭하세요(아래에서 찾아 더해도 됩니다).</p>
                <ol className="flex flex-col gap-0.5" data-testid="via-list">
                  {draft.via.map((v, i) => (
                    <li key={`${v.id}-${i}`} className="flex items-center gap-1 text-xs">
                      <span className="w-5 text-right text-fg-muted">{i + 1}.</span>
                      <span>{v.name}</span>
                      <span className="text-fg-muted">{v.id}</span>
                      <span className="ml-auto flex gap-0.5">
                        <button
                          type="button"
                          aria-label="위로"
                          disabled={i === 0}
                          onClick={() =>
                            update((d) => {
                              const via = [...d.via];
                              [via[i - 1], via[i]] = [via[i]!, via[i - 1]!];
                              return { ...d, via };
                            })
                          }
                        >
                          <ArrowUp className="size-3" />
                        </button>
                        <button
                          type="button"
                          aria-label="아래로"
                          disabled={i === draft.via.length - 1}
                          onClick={() =>
                            update((d) => {
                              const via = [...d.via];
                              [via[i + 1], via[i]] = [via[i]!, via[i + 1]!];
                              return { ...d, via };
                            })
                          }
                        >
                          <ArrowDown className="size-3" />
                        </button>
                        <button
                          type="button"
                          aria-label="빼기"
                          onClick={() => update((d) => ({ ...d, via: d.via.filter((_, j) => j !== i) }))}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ol>
                <AddStation
                  onAdd={(v) => update((d) => ({ ...d, via: [...d.via, v] }))}
                  stations={stations.data ?? null}
                />
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={draft.curved}
                    onChange={(e) => update((d) => ({ ...d, curved: e.target.checked }))}
                  />
                  곡선으로 잇기(미리 보기·저장. 끄면 경유역 직선)
                </label>
              </>
            ) : (
              <>
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant={drawing ? 'secondary' : 'outline'}
                    onClick={() => setDrawing((x) => !x)}
                    data-testid="draw-toggle"
                  >
                    <Pencil className="size-3.5" /> {drawing ? '그리기 끝' : '이어 그리기'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!draft.lines[draft.lines.length - 1]?.length}
                    onClick={() => update((d) => ({ ...d, lines: [...d.lines, []] }))}
                  >
                    새 줄
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => update((d) => ({ ...d, lines: [[]] }))}>
                    모두 지우기
                  </Button>
                </div>
                <p className="text-xs text-fg-muted">
                  지도를 클릭하면 꼭짓점이 더해지고, 꼭짓점을 끌면 옮겨집니다. 꼭짓점{' '}
                  {draft.lines.reduce((s, l) => s + l.length, 0)}개 · 줄 {draft.lines.filter((l) => l.length).length}개
                </p>
                <Textarea
                  aria-label="GeoJSON 붙여넣기"
                  placeholder="GeoJSON(LineString·MultiLineString·Feature) 붙여넣기 — 좌표는 [경도, 위도]"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  className="min-h-16 font-mono text-xs"
                />
                <Button size="sm" variant="outline" disabled={!paste.trim()} onClick={applyPaste}>
                  붙여 넣은 선으로 바꾸기
                </Button>
              </>
            )}

            <div className="rounded bg-muted px-2 py-1 text-xs" data-testid="draft-length">
              길이 <strong>{km.toFixed(2)}km</strong>
              <span className="block text-fg-muted">
                계획 연장 {refs.length ? refs.map((r) => `${r.length_km}km`).join(' / ') : '미확인'}
                {refs[0]?.length_km ? ` (차이 ${(km - refs[0].length_km).toFixed(2)}km)` : ''}
              </span>
            </div>

            <div data-testid="geometry-source">
              <Label>출처(필수)</Label>
              <RefInput
                target="source"
                value={draft.source_id}
                onChange={(v) => update((d) => ({ ...d, source_id: v }))}
              />
            </div>
            <div className="grid grid-cols-[6rem_1fr] items-center gap-2">
              <Label htmlFor="geom-accuracy">정확도(m)</Label>
              <Input
                id="geom-accuracy"
                inputMode="numeric"
                value={draft.accuracy_m}
                onChange={(e) => update((d) => ({ ...d, accuracy_m: e.target.value.trim() }), false)}
              />
              <Label htmlFor="geom-method">방법 메모</Label>
              <Input
                id="geom-method"
                value={draft.method_note}
                placeholder="예: 기본계획 도면 1:25,000 에서 추출"
                onChange={(e) => update((d) => ({ ...d, method_note: e.target.value }), false)}
              />
              <Label htmlFor="geom-note">비고</Label>
              <Input
                id="geom-note"
                value={draft.note}
                onChange={(e) => update((d) => ({ ...d, note: e.target.value }), false)}
              />
            </div>
            {problems.length ? (
              <ul className="text-xs text-warn" data-testid="draft-problems">
                {problems.map((p) => (
                  <li key={p}>· {p}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!!problems.length || save.isPending} onClick={submit}>
                {save.isPending ? '저장 중…' : '선형 저장'}
              </Button>
              <Button size="sm" variant="outline" disabled={!past.length} onClick={undo}>
                <Undo2 className="size-3.5" /> 되돌리기
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  set(null, []);
                  setDrawing(false);
                }}
              >
                취소
              </Button>
            </div>
            <p className="text-[11px] text-fg-muted">
              저장하면 계획의 다른 선형은 그대로 두고 이 선형만 더하거나 바꿉니다. OSM 선형을 따라 그리지
              마세요(ODbL·C-6).
            </p>
          </Card>
        ) : null}

        <section className="mt-auto text-[11px] text-fg-muted">
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
            {KINDS.map((k) => (
              <li key={k} className="flex items-center gap-1">
                <span className="inline-block h-0.5 w-4" style={{ background: KIND_COLORS[k] }} />
                {codeLabel('planGeometryKind', k)}
              </li>
            ))}
            <li className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-4 bg-[#F59E0B]/40" /> 표시 선형
            </li>
            <li className="flex items-center gap-1">
              <span className="inline-block h-1 w-4 bg-[#DC2626]" /> 편집 중
            </li>
          </ul>
          {lines.data?.attribution || geo.data?.attribution ? (
            <p className="mt-1">노선 선형 {lines.data?.attribution ?? geo.data?.attribution}</p>
          ) : null}
        </section>
      </aside>
      <div className="relative min-w-0 flex-1">
        <div className="absolute inset-0">
          <div ref={container} className="h-full w-full" data-testid="geometry-map" />
        </div>
        {draft?.kind === 'schematic' ? (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-fg shadow">
            경유역을 차례로 클릭하세요 ({draft.via.length}개)
          </div>
        ) : drawing ? (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-fg shadow">
            지도를 클릭해 꼭짓점을 더하세요
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 경유역 검색 추가(지도 클릭 대신) — 좌표는 자체 좌표 */
function AddStation({ onAdd, stations }: { onAdd: (v: Via) => void; stations: FeatureCollection | null }) {
  const [key, setKey] = useState(0);
  return (
    <div data-testid="via-add">
      <RefInput
        key={key}
        target="station"
        value={null}
        onChange={(id) => {
          if (!id) return;
          const f = stations?.features.find((x) => x.properties?.station_id === id);
          setKey((k) => k + 1);
          if (!f) {
            toast.error('좌표가 있는 역만 경유역이 될 수 있습니다(V-H07)');
            return;
          }
          const p = f.properties!;
          const coord =
            (p.own_coord as Coord | null) ?? ((f.geometry as { coordinates: Coord }).coordinates.slice(0, 2) as Coord);
          onAdd({ id, name: String(p.name_ko ?? id), coord });
        }}
      />
    </div>
  );
}
