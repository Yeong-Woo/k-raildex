/** MapLibre 지도 생성·정리 훅 + GeoJSON 소스 갱신 도우미 */
import { useEffect, useRef, useState } from 'react';
import {
  AttributionControl,
  Map as MlMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type LayerSpecification,
  type StyleSpecification,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  basemapStyle,
  createBasemapControl,
  KOREA_CENTER,
  loadBasemapChoice,
  resolveBasemap,
  type BasemapKeys,
  type LayerSpec,
} from '@k-raildex/map';

// 번들러가 워커 파일을 옮기므로 위치를 직접 알려 준다
setWorkerUrl(workerUrl);

export const VWORLD_KEY = (import.meta.env.VITE_VWORLD_API_KEY as string | undefined) || null;
export const GOOGLE_MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || null;
/** OSM "교통 지도"(Thunderforest Transport) 타일 키 — 없으면 그 배경은 목록에 없다 */
export const THUNDERFOREST_KEY = (import.meta.env.VITE_THUNDERFOREST_API_KEY as string | undefined) || null;
export const BASEMAP_KEYS: BasemapKeys = { vworldKey: VWORLD_KEY, thunderforestKey: THUNDERFOREST_KEY };
const BASEMAP_PAINT = { 'raster-saturation': -0.4 };

export type FeatureCollection = {
  type: 'FeatureCollection';
  features: { type: 'Feature'; geometry: unknown; properties: Record<string, unknown> | null }[];
  attribution?: string;
};
export const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** 지도 하나를 만들고 load 뒤 인스턴스를 돌려준다 */
export function useMapLibre(opts: { satellite?: boolean } = {}) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  useEffect(() => {
    if (!container.current) return;
    // 배경: 기억한 값 → 기본(OSM 교통 지도, 키 없으면 OSM 표준). 위성 비교는 VWorld 위성(사용자 요청 2026-11-24)
    const basemap = opts.satellite ? 'vworld-satellite' : resolveBasemap(loadBasemapChoice(), BASEMAP_KEYS);
    const m = new MlMap({
      container: container.current,
      style: basemapStyle({ ...BASEMAP_KEYS, basemap }) as unknown as StyleSpecification,
      center: KOREA_CENTER,
      zoom: 7,
      attributionControl: false,
    });
    m.addControl(new AttributionControl({ compact: false }), 'bottom-right');
    m.addControl(
      createBasemapControl({
        keys: BASEMAP_KEYS,
        current: resolveBasemap(basemap, BASEMAP_KEYS),
        paint: BASEMAP_PAINT,
      }),
      'top-right',
    );
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
    m.on('load', () => {
      setMap(m);
      // E2E·점검 스크립트용(지도 하나만 떠 있다)
      (window as unknown as { __kraildexMap?: MlMap }).__kraildexMap = m;
    });
    return () => {
      setMap(null);
      m.remove();
    };
  }, [opts.satellite]);
  return { container, map };
}

/** GeoJSON 소스를 만들거나 데이터만 바꾼다. 레이어는 처음 한 번만 더한다 */
export function useGeoJsonLayer(
  map: MlMap | null,
  sourceId: string,
  data: FeatureCollection | null | undefined,
  layers: LayerSpec[],
) {
  useEffect(() => {
    if (!map) return;
    const fc = (data ?? EMPTY_FC) as never;
    const src = map.getSource(sourceId) as GeoJSONSource | undefined;
    if (src) src.setData(fc);
    else {
      map.addSource(sourceId, { type: 'geojson', data: fc });
      for (const l of layers) if (!map.getLayer(l.id)) map.addLayer(l as unknown as LayerSpecification);
    }
    // layers 는 상수로 넘긴다(의존성에서 뺌)
  }, [map, sourceId, data]);
  // 지도를 여러 화면이 함께 쓰므로(역·시설·노선 편집) 이 훅을 쓴 화면이 사라지면 소스·레이어도 뺀다
  useEffect(() => {
    if (!map) return;
    return () => {
      try {
        for (const l of layers) if (map.getLayer(l.id)) map.removeLayer(l.id);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        // 지도가 먼저 정리됐다
      }
    };
  }, [map, sourceId]);
}

/** 좌표 배열 전체 경계 */
export function boundsOf(fc: FeatureCollection): [[number, number], [number, number]] | null {
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
  for (const f of fc.features) walk((f.geometry as { coordinates?: unknown } | null)?.coordinates);
  return Number.isFinite(minX)
    ? [
        [minX, minY],
        [maxX, maxY],
      ]
    : null;
}
