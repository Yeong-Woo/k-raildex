/**
 * 개체 지도 강조(2026-11-28 사용자 요청): 역 그룹·노선역·노선·운행 계통·시설 상세의 "지도" 탭.
 * 현재 지도(노선 선형·역 그룹 점·시설 선로)를 옅게 깔고, 개체 자신(primary)은 굵게·강조색 테두리로,
 * 둘레(context — 지나는 노선, 노선의 역 그룹·지선·시설 등)는 노선색으로 그린다. 강조 목록: GET /v1/admin/map/focus/:type/:id.
 * 그리기만 한다(OSM 선형·좌표를 저장하지 않음, C-5).
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef } from 'react';
import { Popup, type MapLayerMouseEvent, type Map as MlMap } from 'maplibre-gl';
import type { EntityType } from '@k-raildex/contracts';
import { CONSTRUCTION_LINE, isConstructionExpression, NO_COLOR_LINE, type LayerSpec } from '@k-raildex/map';
import { Badge, Card, Empty } from '@k-raildex/ui';
import { api, apiOptional } from '../lib/api';
import { toSlug } from '../lib/entity-types';
import { boundsOf, useGeoJsonLayer, useMapLibre, type FeatureCollection } from './useMap';

interface FocusSet {
  line_ids: string[];
  station_ids: string[];
  facility_ids: string[];
}
interface MapFocus {
  type: string;
  id: string;
  name_ko: string | null;
  primary: FocusSet;
  context: FocusSet;
  names: Record<string, string>;
  features: FeatureCollection['features'];
}

const HILITE = '#F59E0B';
const BASE = '#9AA3AE';
const TRACK = '#7C3AED';
/** 공식 노선색 → 없으면 검정에 가까운 색, 공사 중은 진한 회색(점선은 아래 공사 중 층) */
const lineColor = [
  'case',
  isConstructionExpression(),
  CONSTRUCTION_LINE.color,
  ['coalesce', ['get', 'color'], NO_COLOR_LINE],
];
const notCons = ['!', isConstructionExpression()];
const isCons = isConstructionExpression();
/** 강조 필터 + 공사 중 여부(line-dasharray 는 데이터 식을 못 쓰므로 층을 나눈다) */
const withCons = (cons: boolean, f: unknown[]) => ['all', cons ? isCons : notCons, f];
const inList = (prop: string, ids: string[]) => ['in', ['get', prop], ['literal', ids]];

// 레이어(아래 → 위). 강조 필터는 데이터가 오면 setFilter 로 바꾼다
const LINE_LAYERS: LayerSpec[] = [
  {
    id: 'fx-line-base',
    type: 'line',
    source: 'fx-lines',
    filter: notCons,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': BASE, 'line-width': 1.5, 'line-opacity': 0.45 },
  },
  {
    id: 'fx-line-base-cons',
    type: 'line',
    source: 'fx-lines',
    filter: isCons,
    paint: {
      'line-color': BASE,
      'line-width': 1.5,
      'line-opacity': 0.45,
      'line-dasharray': [...CONSTRUCTION_LINE.dasharray],
    },
  },
  {
    id: 'fx-line-context',
    type: 'line',
    source: 'fx-lines',
    filter: inList('line_id', []),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': lineColor, 'line-width': 3.5, 'line-opacity': 0.9 },
  },
  {
    id: 'fx-line-context-cons',
    type: 'line',
    source: 'fx-lines',
    filter: inList('line_id', []),
    paint: {
      'line-color': lineColor,
      'line-width': 3.5,
      'line-opacity': 0.9,
      'line-dasharray': [...CONSTRUCTION_LINE.dasharray],
    },
  },
  {
    id: 'fx-line-halo',
    type: 'line',
    source: 'fx-lines',
    filter: inList('line_id', []),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': HILITE, 'line-width': 13, 'line-opacity': 0.45, 'line-blur': 1 },
  },
  {
    id: 'fx-line-primary',
    type: 'line',
    source: 'fx-lines',
    filter: inList('line_id', []),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': lineColor, 'line-width': 6 },
  },
  {
    id: 'fx-line-primary-cons',
    type: 'line',
    source: 'fx-lines',
    filter: inList('line_id', []),
    paint: { 'line-color': lineColor, 'line-width': 6, 'line-dasharray': [...CONSTRUCTION_LINE.dasharray] },
  },
];
const TRACK_LAYERS: LayerSpec[] = [
  {
    id: 'fx-track-base',
    type: 'line',
    source: 'fx-tracks',
    minzoom: 10,
    paint: { 'line-color': TRACK, 'line-width': 1, 'line-opacity': 0.3 },
  },
  {
    id: 'fx-track-focus',
    type: 'line',
    source: 'fx-tracks',
    filter: inList('facility_id', []),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': TRACK, 'line-width': 3, 'line-opacity': 0.9 },
  },
];
const STATION_LAYERS: LayerSpec[] = [
  {
    id: 'fx-station-base',
    type: 'circle',
    source: 'fx-stations',
    minzoom: 9,
    paint: { 'circle-radius': 2.5, 'circle-color': BASE, 'circle-opacity': 0.7 },
  },
  {
    id: 'fx-station-context',
    type: 'circle',
    source: 'fx-stations',
    filter: inList('station_id', []),
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 3, 13, 6],
      'circle-color': '#FFFFFF',
      'circle-stroke-color': '#1F2937',
      'circle-stroke-width': 1.5,
    },
  },
  {
    id: 'fx-station-primary',
    type: 'circle',
    source: 'fx-stations',
    filter: inList('station_id', []),
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 6, 13, 10],
      'circle-color': '#FFFFFF',
      'circle-stroke-color': HILITE,
      'circle-stroke-width': 4,
    },
  },
];
const FACILITY_LAYERS: LayerSpec[] = [
  {
    id: 'fx-facility',
    type: 'circle',
    source: 'fx-facilities',
    paint: {
      'circle-radius': ['case', ['get', 'primary'], 10, 6],
      'circle-color': '#FFFFFF',
      'circle-stroke-color': ['case', ['get', 'primary'], HILITE, TRACK],
      'circle-stroke-width': ['case', ['get', 'primary'], 4, 3],
    },
  },
];
const HOVER_LAYERS = [
  'fx-station-primary',
  'fx-station-context',
  'fx-facility',
  'fx-line-primary',
  'fx-line-primary-cons',
  'fx-line-context',
  'fx-line-context-cons',
];

export function EntityFocusMap({ type, id }: { type: EntityType; id: string }) {
  const navigate = useNavigate();
  const { container, map } = useMapLibre();
  const focus = useQuery({
    queryKey: ['map', 'focus', type, id],
    queryFn: () => api<MapFocus>(`/v1/admin/map/focus/${encodeURIComponent(type)}/${encodeURIComponent(id)}`),
  });
  // 다른 지도 화면과 같은 캐시 키
  const lines = useQuery({
    queryKey: ['map', 'current-lines'],
    queryFn: () => apiOptional<FeatureCollection>('/v1/admin/map/current-lines'),
  });
  const stations = useQuery({
    queryKey: ['map', 'current-stations'],
    queryFn: () => apiOptional<FeatureCollection>('/v1/admin/map/current-stations'),
  });
  const tracks = useQuery({
    queryKey: ['map', 'facility-tracks'],
    queryFn: () => apiOptional<FeatureCollection>('/v1/admin/map/facility-tracks'),
  });
  const facPoints = useMemo<FeatureCollection | null>(
    () => (focus.data ? { type: 'FeatureCollection', features: focus.data.features } : null),
    [focus.data],
  );
  useGeoJsonLayer(map, 'fx-lines', lines.data, LINE_LAYERS);
  useGeoJsonLayer(map, 'fx-tracks', tracks.data, TRACK_LAYERS);
  useGeoJsonLayer(map, 'fx-stations', stations.data, STATION_LAYERS);
  useGeoJsonLayer(map, 'fx-facilities', facPoints, FACILITY_LAYERS);

  const f = focus.data;
  // 강조 필터
  useEffect(() => {
    if (!map || !f) return;
    const set = (layer: string, filter: unknown[]) => {
      if (map.getLayer(layer)) map.setFilter(layer, filter as never);
    };
    set('fx-line-context', withCons(false, inList('line_id', f.context.line_ids)));
    set('fx-line-context-cons', withCons(true, inList('line_id', f.context.line_ids)));
    set('fx-line-halo', inList('line_id', f.primary.line_ids));
    set('fx-line-primary', withCons(false, inList('line_id', f.primary.line_ids)));
    set('fx-line-primary-cons', withCons(true, inList('line_id', f.primary.line_ids)));
    set('fx-station-context', inList('station_id', f.context.station_ids));
    set('fx-station-primary', inList('station_id', f.primary.station_ids));
    set('fx-track-focus', inList('facility_id', [...f.primary.facility_ids, ...f.context.facility_ids]));
  }, [map, f, lines.data, stations.data, tracks.data]);

  // 강조한 것이 지도에 있는지(선형·좌표 없음 알림)와 맞출 범위
  const shown = useMemo(() => {
    if (!f) return null;
    const lf = lines.data?.features ?? [];
    const sf = stations.data?.features ?? [];
    const tf = tracks.data?.features ?? [];
    const has = new Set<string>();
    for (const x of lf) has.add(String(x.properties?.line_id));
    for (const x of sf) has.add(String(x.properties?.station_id));
    for (const x of [...tf, ...f.features]) has.add(String(x.properties?.facility_id));
    const pick = (s: FocusSet) => [
      ...lf.filter((x) => s.line_ids.includes(String(x.properties?.line_id))),
      ...sf.filter((x) => s.station_ids.includes(String(x.properties?.station_id))),
      ...tf.filter((x) => s.facility_ids.includes(String(x.properties?.facility_id))),
      ...f.features.filter((x) => s.facility_ids.includes(String(x.properties?.facility_id))),
    ];
    const prim = pick(f.primary);
    return { has, primary: prim, fit: prim.length ? prim : pick(f.context) };
  }, [f, lines.data, stations.data, tracks.data]);

  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!map || !shown || !lines.data || !stations.data) return;
    const key = `${type}:${id}`;
    if (fitted.current === key) return;
    fitted.current = key;
    fitTo(map, { type: 'FeatureCollection', features: shown.fit });
  }, [map, shown, type, id]);

  // 마우스 올리면 이름, 누르면 그 개체 상세로
  useEffect(() => {
    if (!map) return;
    const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    const target = (e: MapLayerMouseEvent) => {
      const p = e.features?.[0]?.properties ?? {};
      if (typeof p.station_id === 'string') return { t: 'station' as const, id: p.station_id, name: p.name_ko };
      if (typeof p.facility_id === 'string') return { t: 'facility' as const, id: p.facility_id, name: p.name_ko };
      if (typeof p.line_id === 'string') return { t: 'line' as const, id: p.line_id, name: p.name_ko };
      return null;
    };
    const move = (e: MapLayerMouseEvent) => {
      const t = target(e);
      if (!t) return;
      map.getCanvas().style.cursor = 'pointer';
      popup
        .setLngLat(e.lngLat)
        .setText(String(t.name ?? t.id))
        .addTo(map);
    };
    const leave = () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    };
    const click = (e: MapLayerMouseEvent) => {
      const t = target(e);
      if (t) void navigate({ to: '/data/$type/$id', params: { type: toSlug(t.t), id: t.id }, search: { tab: 'map' } });
    };
    for (const l of HOVER_LAYERS) {
      map.on('mousemove', l, move);
      map.on('mouseleave', l, leave);
      map.on('click', l, click);
    }
    return () => {
      for (const l of HOVER_LAYERS) {
        map.off('mousemove', l, move);
        map.off('mouseleave', l, leave);
        map.off('click', l, click);
      }
      popup.remove();
    };
  }, [map, navigate]);

  // 목록에서 누르면 그 개체로
  const flyToId = (kind: 'line' | 'station' | 'facility', oid: string) => {
    if (!map) return;
    const prop = kind === 'line' ? 'line_id' : kind === 'station' ? 'station_id' : 'facility_id';
    const src =
      kind === 'line'
        ? (lines.data?.features ?? [])
        : kind === 'station'
          ? (stations.data?.features ?? [])
          : [...(f?.features ?? []), ...(tracks.data?.features ?? [])];
    fitTo(map, { type: 'FeatureCollection', features: src.filter((x) => x.properties?.[prop] === oid) });
  };

  const sections: { title: string; set: FocusSet | undefined; primary: boolean }[] = [
    { title: '강조', set: f?.primary, primary: true },
    { title: '둘레', set: f?.context, primary: false },
  ];

  return (
    <Card>
      <div className="grid grid-cols-1 md:h-[600px] md:grid-cols-[1fr_280px]">
        <div className="relative h-[420px] md:h-full">
          {/* maplibregl-map 이 position: relative 를 덮으므로 크기를 직접 준다 */}
          <div ref={container} className="h-full w-full" data-testid="entity-focus-map" />
          {lines.data === null ? (
            <p className="absolute left-2 top-2 rounded bg-bg-elevated/90 px-2 py-1 text-xs text-fg-muted">
              지도 API 가 없어 배경 지도만 표시합니다.
            </p>
          ) : null}
        </div>
        <aside
          data-testid="entity-focus-list"
          className="max-h-[420px] overflow-auto border-t border-border p-3 text-sm md:max-h-none md:border-l md:border-t-0"
        >
          {focus.isError ? <Empty>강조 목록을 불러오지 못했습니다</Empty> : null}
          {sections.map(({ title, set, primary }) =>
            set ? (
              <FocusList
                key={title}
                title={title}
                primary={primary}
                set={set}
                names={f!.names}
                has={shown?.has ?? null}
                onFly={flyToId}
              />
            ) : null,
          )}
          <p className="mt-3 text-xs text-fg-muted">
            주황 테두리 = 이 개체, 노선색·흰 점 = 둘레. 지도에서 누르면 그 개체 상세의 지도 탭으로 갑니다. 노선
            선형·시설 선로는 OSM(ODbL) 표시만.
          </p>
        </aside>
      </div>
    </Card>
  );
}

function FocusList({
  title,
  primary,
  set,
  names,
  has,
  onFly,
}: {
  title: string;
  primary: boolean;
  set: FocusSet;
  names: Record<string, string>;
  has: Set<string> | null;
  onFly: (kind: 'line' | 'station' | 'facility', id: string) => void;
}) {
  const groups = [
    ['line', '노선', set.line_ids],
    ['station', '역 그룹', set.station_ids],
    ['facility', '시설', set.facility_ids],
  ] as const;
  if (groups.every(([, , ids]) => ids.length === 0)) return null;
  return (
    <section className="mb-3">
      <h3 className="mb-1 text-xs font-semibold text-fg-muted">
        {title}
        {primary ? <span className="ml-1 inline-block h-2 w-2 rounded-full" style={{ background: HILITE }} /> : null}
      </h3>
      {groups.map(([kind, label, ids]) =>
        ids.length ? (
          <div key={kind} className="mb-2">
            <div className="text-xs text-fg-muted">
              {label} {ids.length}
            </div>
            <ul>
              {ids.slice(0, 200).map((oid) => {
                const missing = has != null && !has.has(oid);
                return (
                  <li key={oid} className="flex items-center gap-1 py-0.5">
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left hover:underline disabled:text-fg-muted disabled:no-underline"
                      disabled={missing}
                      title={missing ? '지도에 선형·좌표 없음' : '지도에서 보기'}
                      onClick={() => onFly(kind, oid)}
                    >
                      {names[oid] ?? oid}
                    </button>
                    {missing ? <Badge>지도 없음</Badge> : null}
                    <Link
                      to="/data/$type/$id"
                      params={{ type: toSlug(kind), id: oid }}
                      search={{ tab: 'map' }}
                      className="text-xs text-primary hover:underline"
                    >
                      열기
                    </Link>
                  </li>
                );
              })}
              {ids.length > 200 ? <li className="text-xs text-fg-muted">… 외 {ids.length - 200}</li> : null}
            </ul>
          </div>
        ) : null,
      )}
    </section>
  );
}

function fitTo(map: MlMap, fc: FeatureCollection) {
  const b = boundsOf(fc);
  if (!b) return;
  const point = b[0][0] === b[1][0] && b[0][1] === b[1][1];
  if (point) map.flyTo({ center: b[0], zoom: Math.max(map.getZoom(), 13) });
  else map.fitBounds(b, { padding: 48, maxZoom: 14, duration: 600 });
}
