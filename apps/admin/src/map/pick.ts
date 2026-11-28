/**
 * 역·시설·노선 편집(2026-11-28 통합): 지도에서 역 그룹·시설·노선 어느 것을 눌러도 그 개체를 고른다.
 * 겹치면 역 그룹 > 시설 > 노선 순. 화면 자신의 종류(own)는 화면의 기존 클릭 처리(좌표 찍기·다른 역 고르기 등)에 맡긴다.
 */
import { useEffect, useRef } from 'react';
import type { MapMouseEvent, Map as MlMap } from 'maplibre-gl';

export type PickKind = 'station' | 'facility' | 'line';
export type PickLayers = Partial<Record<PickKind, string[]>>;
const ORDER: PickKind[] = ['station', 'facility', 'line'];
const PROP: Record<PickKind, string> = { station: 'station_id', facility: 'facility_id', line: 'line_id' };

/** 클릭 지점의 맨 위 대상(순서: 역 그룹 > 시설 > 노선) */
export function pickAt(map: MlMap, e: MapMouseEvent, layers: PickLayers): { kind: PickKind; id: string } | null {
  const pad = 5;
  const box: [[number, number], [number, number]] = [
    [e.point.x - pad, e.point.y - pad],
    [e.point.x + pad, e.point.y + pad],
  ];
  for (const kind of ORDER) {
    const present = (layers[kind] ?? []).filter((l) => map.getLayer(l));
    if (!present.length) continue;
    for (const f of map.queryRenderedFeatures(box, { layers: present })) {
      const id = f.properties?.[PROP[kind]];
      if (typeof id === 'string' && id) return { kind, id };
    }
  }
  return null;
}

export function useMapPick(
  map: MlMap | null,
  layers: PickLayers,
  own: PickKind | null,
  onPick: (kind: PickKind, id: string) => void,
  enabled = true,
) {
  const cb = useRef(onPick);
  cb.current = onPick;
  const key = JSON.stringify(layers);
  useEffect(() => {
    if (!map || !enabled) return;
    const all = Object.values(layers).flat();
    const onClick = (e: MapMouseEvent) => {
      const hit = pickAt(map, e, layers);
      if (hit && hit.kind !== own) cb.current(hit.kind, hit.id);
    };
    const enter = () => (map.getCanvas().style.cursor = 'pointer');
    const leave = () => (map.getCanvas().style.cursor = '');
    map.on('click', onClick);
    for (const l of all) {
      map.on('mouseenter', l, enter);
      map.on('mouseleave', l, leave);
    }
    return () => {
      map.off('click', onClick);
      for (const l of all) {
        map.off('mouseenter', l, enter);
        map.off('mouseleave', l, leave);
      }
    };
    // layers 는 key 로 비교
  }, [map, key, own, enabled]);
}
