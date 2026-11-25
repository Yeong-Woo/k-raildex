'use client';
/**
 * MapLibre 지도 캔버스(미래 지도 전용 — next/dynamic 으로 이 페이지에서만 받는다, NFR-WEB-002).
 * - 배경: VWorld(서버가 넘긴 키, FR-WEB-028) → 타일이 하나도 안 뜨고 오류가 나면 OSM 표준 타일로 바꾼다. OSM 선형이 있으면 ODbL 표기
 * - 선: 선 모양 = 단계(API line_style), 색 = color → 단계 대표색 → 상태 대표색(수도권 전철만 공식 색, 나머지 상태색 승계)
 *   개략(schematic) 선형은 가는 점선 + 흐리게(FR-WEB-024). 색 없는 계획은 선 위에 이름 라벨(FR-WEB-023)
 * - 글자: style glyphs 없이 로컬 글꼴(자가 호스팅 Pretendard)로 그린다 — 외부 글꼴 서버 없음
 * - 강조: #line= #station= #plan= (부모가 넘긴 highlight)
 * - 운행 계통(#service=, FR-WEB-029): 계통 선형(정차 구간 실선 · 운행 예정 노선 점선)을 계통 색으로 위에 그리고 나머지 선은 흐리게
 */
import { useEffect, useRef, useState } from 'react';
import {
  AttributionControl,
  Map as MlMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type LayerSpecification,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  basemapStyle,
  BASEMAPS,
  createBasemapControl,
  FREIGHT_LINE,
  loadBasemapChoice,
  resolveBasemap,
  swapBasemap,
  type BasemapId,
  isFreightExpression,
  LINE_STYLES,
  STAGE_COLORS,
  STAGE_FALLBACK_COLOR,
  STATUS_COLORS,
} from '@k-raildex/map';
import type { MapHash } from '@/lib/map-years';

export interface FC {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    id?: string;
    geometry: { type: string; coordinates: unknown[] } | null;
    properties: Record<string, unknown>;
  }[];
  attribution?: string;
}

export interface Pick {
  kind: 'station' | 'line';
  props: Record<string, unknown>;
}

export interface MapView {
  center: [number, number];
  zoom: number;
}

const EMPTY: FC = { type: 'FeatureCollection', features: [] };
const FONT = ['Pretendard Variable', 'Pretendard', 'sans-serif'];
const ODBL_ATTR = '선형 일부 © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자(ODbL)';

function matchPairs(table: Readonly<Record<string, string>>): unknown[] {
  const out: unknown[] = [];
  for (const [k, v] of Object.entries(table)) out.push(k, v);
  return out;
}

/** color → (계획이면) 단계 대표색 → 상태 대표색 */
const LINE_COLOR = [
  'case',
  ['!=', ['coalesce', ['get', 'color'], ''], ''],
  ['get', 'color'],
  ['!=', ['coalesce', ['get', 'stage'], ''], ''],
  ['match', ['get', 'stage'], ...matchPairs(STAGE_COLORS), STAGE_FALLBACK_COLOR],
  ['match', ['coalesce', ['get', 'status'], ''], ...matchPairs(STATUS_COLORS), STAGE_FALLBACK_COLOR],
];

const isSchematic = ['==', ['get', 'quality'], 'schematic'];
const isPlan = ['!=', ['coalesce', ['get', 'plan_id'], ''], ''];

/** 선 모양: 미래(시점) = API line_style, 현재 = 상태(운영 실선 / 공사 중 굵은 점선 / 휴업 가는 점선) */
function styleOf(): unknown[] {
  return [
    'case',
    isSchematic,
    'dashed_thin',
    // 공사 중은 현재·시점 지도 모두 굵은 점선(계획 선형으로 그린 공사 중 노선 — 수서광주선 — 도 plan_id 가 있지만 점선)
    ['==', ['get', 'status'], 'under_construction'],
    'dashed_bold',
    ['==', ['get', 'status'], 'suspended'],
    'dashed_thin',
    ['get', 'line_style'],
  ];
}

function lineLayers(): LayerSpecification[] {
  const layers: LayerSpecification[] = [
    {
      id: 'hl-line',
      type: 'line',
      source: 'lines',
      filter: ['==', ['get', 'feature_id'], '__none__'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#F5B700', 'line-width': 12, 'line-opacity': 0.55, 'line-blur': 1 },
    } as unknown as LayerSpecification,
  ];
  for (const style of Object.keys(LINE_STYLES) as (keyof typeof LINE_STYLES)[]) {
    const s = LINE_STYLES[style];
    const paint: Record<string, unknown> = {
      // 여객 미취급(화물 전용) 노선은 회색 가는 선(Q115 A) — 현재·시점 지도 모두
      'line-color': ['case', isFreightExpression(), FREIGHT_LINE.color, LINE_COLOR],
      // 계획 선은 단계 굵기, 기존 노선은 조금 가늘게
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        6,
        ['case', isFreightExpression(), FREIGHT_LINE.width * 0.7, isPlan, s.width * 0.8, 1.8],
        9,
        ['case', isFreightExpression(), FREIGHT_LINE.width, isPlan, s.width * 1.05, 2.8],
        13,
        ['case', isFreightExpression(), FREIGHT_LINE.width * 1.6, isPlan, s.width * 1.6, 4.5],
      ],
      'line-opacity': LINE_OPACITY,
    };
    if (s.dasharray) paint['line-dasharray'] = s.dasharray;
    layers.push({
      id: `line-${style}`,
      type: 'line',
      source: 'lines',
      filter: ['==', styleOf(), style],
      layout: { 'line-cap': style === 'solid' ? 'round' : 'butt', 'line-join': 'round' },
      paint,
    } as unknown as LayerSpecification);
  }
  layers.push({
    id: 'plan-label',
    type: 'symbol',
    source: 'lines',
    minzoom: 7.5,
    filter: ['all', isPlan, ['==', ['coalesce', ['get', 'color'], ''], '']],
    layout: {
      'symbol-placement': 'line',
      'text-field': ['get', 'name_ko'],
      'text-font': FONT,
      'text-size': 12,
      'symbol-spacing': 400,
      'text-max-angle': 35,
    },
    paint: {
      'text-color': ['match', ['coalesce', ['get', 'stage'], ''], ...matchPairs(STAGE_COLORS), STAGE_FALLBACK_COLOR],
      'text-halo-color': '#FFFFFF',
      'text-halo-width': 2,
    },
  } as unknown as LayerSpecification);
  return layers;
}

function stationLayers(): LayerSpecification[] {
  const future = ['==', ['get', 'future'], true];
  const approx = ['==', ['get', 'approximate'], true];
  return [
    {
      id: 'hl-station',
      type: 'circle',
      source: 'stations',
      filter: ['==', ['get', 'station_id'], '__none__'],
      paint: { 'circle-radius': 13, 'circle-color': '#F5B700', 'circle-opacity': 0.5, 'circle-blur': 0.3 },
    } as unknown as LayerSpecification,
    {
      id: 'station',
      type: 'circle',
      source: 'stations',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 9, 1.9, 11, 3.2, 14, 6],
        'circle-color': ['case', future, '#FFFFFF', approx, '#9AA3AD', '#161B21'],
        'circle-stroke-color': ['case', future, STATUS_COLORS.under_construction!, approx, '#6B7480', '#FFFFFF'],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 9, 1, 12, 2],
        'circle-opacity': ['case', approx, 0.7, 1],
        'circle-stroke-opacity': ['case', approx, 0.7, 1],
      },
    } as unknown as LayerSpecification,
    {
      id: 'station-label',
      type: 'symbol',
      source: 'stations',
      minzoom: 10.5,
      layout: {
        'text-field': ['get', 'name_ko'],
        'text-font': FONT,
        'text-size': 12,
        'text-offset': [0, 0.9],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: { 'text-color': '#161B21', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.6 },
    } as unknown as LayerSpecification,
  ];
}

const SERVICE_FALLBACK_COLOR = '#F5B700';
const SERVICE_COLOR = [
  'case',
  ['!=', ['coalesce', ['get', 'color'], ''], ''],
  ['get', 'color'],
  SERVICE_FALLBACK_COLOR,
];
const isServiceRun = ['==', ['get', 'status'], 'operating'];

/** 운행 계통 강조 층(노선 위, 역 아래) */
function serviceLayers(): LayerSpecification[] {
  const width = (k: number) => ['interpolate', ['linear'], ['zoom'], 6, 2.6 * k, 9, 4 * k, 13, 7 * k];
  return [
    {
      id: 'svc-casing',
      type: 'line',
      source: 'service',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#FFFFFF', 'line-width': width(1.9), 'line-opacity': 0.9 },
    },
    {
      id: 'svc-line',
      type: 'line',
      source: 'service',
      filter: isServiceRun,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': SERVICE_COLOR,
        'line-width': width(1.15),
        // 선형이 없어 역 사이를 직선으로 이은 구간은 흐리게
        'line-opacity': ['case', ['==', ['get', 'approximate'], true], 0.55, 1],
      },
    },
    {
      id: 'svc-line-planned',
      type: 'line',
      source: 'service',
      filter: ['!', isServiceRun],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': SERVICE_COLOR, 'line-width': width(1.15), 'line-dasharray': [1.6, 1.1] },
    },
  ] as unknown as LayerSpecification[];
}

const LINE_OPACITY = ['case', isSchematic, 0.75, 0.95];
const LINE_OPACITY_DIM = ['case', isSchematic, 0.2, 0.28];

const PICK_LAYERS = ['station', 'line-solid', 'line-dashed_bold', 'line-dashed_thin'];

function boundsOf(features: FC['features']): [[number, number], [number, number]] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') {
      minX = Math.min(minX, c[0]);
      maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]);
      maxY = Math.max(maxY, c[1]);
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  for (const f of features) walk(f.geometry?.coordinates);
  return Number.isFinite(minX)
    ? [
        [minX, minY],
        [maxX, maxY],
      ]
    : null;
}

function createMap(container: HTMLElement, style: StyleSpecification, view: MapView): MlMap {
  return new MlMap({
    container,
    style,
    center: view.center,
    zoom: view.zoom,
    minZoom: 5,
    maxZoom: 17,
    maxBounds: [
      [118, 30],
      [136, 43],
    ],
    attributionControl: false,
    cooperativeGestures: false,
    dragRotate: false,
    pitchWithRotate: false,
    // 지도 조작 단추·캔버스 이름을 한국어로(FR-WEB-007, 화면 낭독기)
    locale: {
      'Map.Title': '철도 지도',
      'NavigationControl.ZoomIn': '확대',
      'NavigationControl.ZoomOut': '축소',
      'NavigationControl.ResetBearing': '북쪽으로 되돌리기',
      'AttributionControl.ToggleAttribution': '지도 출처 보기/숨기기',
      'AttributionControl.MapFeedback': '지도 의견 보내기',
      'Popup.Close': '닫기',
    },
  });
}

/** 배경은 흐리게(철도 선이 주인공) */
const BASEMAP_DIM = { 'raster-saturation': -0.75, 'raster-contrast': -0.15, 'raster-brightness-min': 0.18 };

export default function MapCanvas({
  lines,
  stations,
  service = null,
  highlight,
  follow = true,
  vworldKey,
  thunderforestKey = null,
  onBasemap,
  view,
  onPick,
  onReady,
}: {
  lines: FC | null;
  stations: FC | null;
  /** 강조할 운행 계통 선형(#service=) */
  service?: FC | null;
  highlight: MapHash;
  /** false = 강조만 하고 지도는 그대로(지도 클릭으로 고른 경우) */
  follow?: boolean;
  vworldKey: string | null;
  thunderforestKey?: string | null;
  /** 배경이 정해지거나 바뀔 때(출처 문구용) */
  onBasemap?: (id: BasemapId) => void;
  /** 바뀌면 그 보기로 이동(수도권·전국 단추) */
  view: MapView & { seq: number };
  onPick: (picks: Pick[]) => void;
  onReady?: () => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const readyRef = useRef(false);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const fittedFor = useRef<string>('');
  // WebGL2 가 없으면 MapLibre 가 생성자에서 던진다 — 페이지 전체 오류 화면 대신 지도 자리에만 안내(패널·목록은 그대로)
  const [failed, setFailed] = useState(false);

  // 지도 만들기(한 번)
  useEffect(() => {
    if (!el.current) return;
    setWorkerUrl(new URL('/api/map/worker/', window.location.origin).href);
    // 배경: 기억한 값 → 기본(OSM 교통 지도, 키 없으면 OSM 표준). 사용자 요청 2026-11-24
    const keys = { vworldKey, thunderforestKey };
    let current = resolveBasemap(loadBasemapChoice(), keys);
    onBasemap?.(current);
    const style = basemapStyle({ ...keys, basemap: current }) as unknown as StyleSpecification;
    let m: MlMap;
    try {
      m = createMap(el.current, style, view);
    } catch (e) {
      console.warn('지도를 그리지 못함(WebGL2 필요)', e);
      setFailed(true);
      return;
    }
    m.touchZoomRotate.disableRotation();
    m.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    m.addControl(
      createBasemapControl({
        keys,
        current,
        paint: BASEMAP_DIM,
        onChange: (id) => {
          current = id;
          tileOk = false;
          tileErr = 0;
          swapped = false;
          onBasemap?.(id);
        },
      }) as never,
      'top-right',
    );
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

    // 키가 필요한 배경(VWorld·Thunderforest)의 타일이 거부되면 OSM 표준으로(성공한 타일이 하나도 없을 때만)
    let tileOk = false;
    let tileErr = 0;
    let swapped = false;
    m.on('data', (e) => {
      if ((e as { sourceId?: string; tile?: unknown }).sourceId === 'basemap' && (e as { tile?: unknown }).tile)
        tileOk = true;
    });
    m.on('error', (e) => {
      const sid = (e as { sourceId?: string }).sourceId;
      const needsKey = BASEMAPS.find((b) => b.id === current)?.needs;
      if (sid !== 'basemap' || swapped || tileOk || !needsKey) return;
      tileErr += 1;
      if (tileErr < 3) return;
      swapped = true;
      current = 'osm-standard';
      swapBasemap(m as never, current, keys, BASEMAP_DIM);
      onBasemap?.(current);
    });

    m.on('load', () => {
      // 배경은 흐리게(철도 선이 주인공)
      if (m.getLayer('basemap')) {
        m.setPaintProperty('basemap', 'raster-saturation', -0.75);
        m.setPaintProperty('basemap', 'raster-contrast', -0.15);
        m.setPaintProperty('basemap', 'raster-brightness-min', 0.18);
      }
      m.addSource('lines', { type: 'geojson', data: EMPTY as never, attribution: ODBL_ATTR });
      m.addSource('stations', { type: 'geojson', data: EMPTY as never });
      m.addSource('service', { type: 'geojson', data: EMPTY as never });
      for (const l of lineLayers()) m.addLayer(l);
      for (const l of serviceLayers()) m.addLayer(l);
      for (const l of stationLayers()) m.addLayer(l);
      readyRef.current = true;
      mapRef.current = m;
      (window as unknown as { __kraildexMap?: MlMap }).__kraildexMap = m;
      onReady?.();
    });

    const onClick = (e: MapMouseEvent) => {
      const touch = (e.originalEvent as PointerEvent | undefined)?.pointerType === 'touch';
      const r = touch ? 18 : 7;
      const box: [[number, number], [number, number]] = [
        [e.point.x - r, e.point.y - r],
        [e.point.x + r, e.point.y + r],
      ];
      const feats = m.queryRenderedFeatures(box, { layers: PICK_LAYERS.filter((id) => m.getLayer(id)) });
      const seen = new Set<string>();
      const picks: Pick[] = [];
      for (const f of feats) {
        const p = f.properties as Record<string, unknown>;
        const kind = f.layer.id === 'station' ? 'station' : 'line';
        const key = kind === 'station' ? `s:${String(p.station_id)}` : `l:${String(p.feature_id)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        picks.push({ kind, props: p });
      }
      picks.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'station' ? -1 : 1));
      pickRef.current(picks.slice(0, 8));
    };
    m.on('click', onClick);
    const enter = () => (m.getCanvas().style.cursor = 'pointer');
    const leave = () => (m.getCanvas().style.cursor = '');
    for (const id of PICK_LAYERS) {
      m.on('mouseenter', id, enter);
      m.on('mouseleave', id, leave);
    }
    return () => {
      readyRef.current = false;
      mapRef.current = null;
      m.remove();
    };
    // 지도는 한 번만 만든다(보기·키 변경은 아래 효과에서)
  }, []);

  // 데이터
  useEffect(() => {
    const apply = () => {
      const m = mapRef.current;
      if (!m) return;
      (m.getSource('lines') as GeoJSONSource | undefined)?.setData((lines ?? EMPTY) as never);
      (m.getSource('stations') as GeoJSONSource | undefined)?.setData((stations ?? EMPTY) as never);
    };
    if (readyRef.current) apply();
    else {
      const t = setInterval(() => {
        if (readyRef.current) {
          clearInterval(t);
          apply();
        }
      }, 50);
      return () => clearInterval(t);
    }
  }, [lines, stations]);

  // 운행 계통 강조: 계통 선형을 위에, 나머지 선은 흐리게. 패널에서 고른 것만 그 범위로 이동
  const fittedService = useRef<string>('');
  useEffect(() => {
    const run = () => {
      const m = mapRef.current;
      if (!m) return false;
      const fc = highlight.service ? (service ?? EMPTY) : EMPTY;
      (m.getSource('service') as GeoJSONSource | undefined)?.setData(fc as never);
      const dim = !!highlight.service && fc.features.length > 0;
      for (const style of Object.keys(LINE_STYLES))
        if (m.getLayer(`line-${style}`))
          m.setPaintProperty(`line-${style}`, 'line-opacity', (dim ? LINE_OPACITY_DIM : LINE_OPACITY) as never);
      if (!highlight.service) fittedService.current = '';
      else if (dim && fittedService.current !== highlight.service) {
        fittedService.current = highlight.service;
        const b = follow ? boundsOf(fc.features) : null;
        if (b) m.fitBounds(b, { padding: { top: 60, bottom: 140, left: 60, right: 60 }, maxZoom: 12, duration: 0 });
      }
      return true;
    };
    if (run()) return;
    const t = setInterval(() => {
      if (run()) clearInterval(t);
    }, 80);
    return () => clearInterval(t);
  }, [highlight.service, service, follow]);

  // 강조 + 처음 한 번 그 범위로 이동(지도 클릭으로 고른 것은 이동하지 않음)
  useEffect(() => {
    const run = () => {
      const m = mapRef.current;
      if (!m) return false;
      const lf: unknown[] = ['any'];
      if (highlight.line) lf.push(['==', ['get', 'line_id'], highlight.line]);
      if (highlight.plan) lf.push(['==', ['get', 'plan_id'], highlight.plan]);
      m.setFilter('hl-line', (lf.length > 1 ? lf : ['==', ['get', 'feature_id'], '__none__']) as never);
      m.setFilter('hl-station', ['==', ['get', 'station_id'], highlight.station ?? '__none__'] as never);
      const key = `${highlight.line ?? ''}|${highlight.plan ?? ''}|${highlight.station ?? ''}`;
      if (key === '||' || fittedFor.current === key) return true;
      // 지도에서 직접 고른 것은 확대·이동하지 않는다(사용자 요청 2026-11-24). 링크(#line=…)·패널 목록에서 고른 것만 그 범위로
      if (!follow) {
        fittedFor.current = key;
        return true;
      }
      if (highlight.station) {
        const s = stations?.features.find((f) => f.properties.station_id === highlight.station);
        if (s?.geometry) {
          fittedFor.current = key;
          m.jumpTo({ center: s.geometry.coordinates as [number, number], zoom: Math.max(m.getZoom(), 12) });
          return true;
        }
      }
      const fs = (lines?.features ?? []).filter(
        (f) =>
          (highlight.line && f.properties.line_id === highlight.line) ||
          (highlight.plan && f.properties.plan_id === highlight.plan),
      );
      const b = boundsOf(fs);
      if (b) {
        fittedFor.current = key;
        m.fitBounds(b, { padding: { top: 60, bottom: 140, left: 60, right: 60 }, maxZoom: 12.5, duration: 0 });
      }
      return true;
    };
    if (run()) return;
    const t = setInterval(() => {
      if (run()) clearInterval(t);
    }, 80);
    return () => clearInterval(t);
  }, [highlight.line, highlight.plan, highlight.station, lines, stations, follow]);

  // 보기 이동(수도권·전국)
  useEffect(() => {
    if (view.seq === 0) return;
    mapRef.current?.easeTo({ center: view.center, zoom: view.zoom, duration: 400 });
  }, [view.seq, view.center, view.zoom]);

  // maplibregl-map 클래스가 position: relative 를 덮어쓰므로 바깥 상자가 자리를 잡는다
  return (
    <div
      className="fmap-canvas"
      role="region"
      aria-label="철도 지도(키보드: 지도에 초점을 두면 화살표로 이동, +/- 로 확대)"
    >
      <div ref={el} data-testid="future-map" style={{ width: '100%', height: '100%' }} />
      {failed ? (
        <p className="fmap-nogl" role="status">
          이 브라우저에서는 지도를 그릴 수 없습니다(WebGL2 필요). 옆 목록과 각 계획·노선 상세 페이지는 그대로 볼 수
          있습니다.
        </p>
      ) : null}
    </div>
  );
}
