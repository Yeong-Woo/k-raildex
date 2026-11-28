/**
 * 역·시설·노선 편집(2026-11-28 통합): 지도에서 역 그룹·시설·노선 어느 것이든 누를 수 있다.
 * 누르면 바로 화면을 바꾸지 않고(2026-11-28 사용자 지시) 이름과 단추가 있는 작은 팝업을 띄운다 —
 * [… 편집](그 대상으로 전환)과 화면이 주는 동작(노선 편집의 [이 노선에 추가] 등). 단추를 눌러야 바뀐다.
 * 겹치면 역 그룹 > 시설 > 노선 순. 화면 자신의 종류(own)는 화면의 기존 클릭 처리에 맡긴다.
 */
import { useEffect, useRef } from 'react';
import { Popup, type MapMouseEvent, type Map as MlMap } from 'maplibre-gl';

export type PickKind = 'station' | 'facility' | 'line';
export type PickLayers = Partial<Record<PickKind, string[]>>;
export interface PickHit {
  kind: PickKind;
  id: string;
  name: string | null;
}
export interface PickAction {
  label: string;
  run: () => void;
  testId?: string;
}
/** 역·시설·노선 편집 공용 지도(EditWorkspace)의 레이어 id — 목록이 클릭·고르기에 쓴다 */
export const BASE: PickLayers = {
  station: ['current-station'],
  facility: ['depots-depot'],
  line: ['current-line', 'current-line-construction', 'current-line-closed'],
};
/** 목록의 강조 레이어는 이 아래에 넣는다(시설 선로·역 그룹 점·시설 점이 늘 위) */
export const OVERLAY_BEFORE = 'facility-tracks-track';
const ORDER: PickKind[] = ['station', 'facility', 'line'];
const PROP: Record<PickKind, string> = { station: 'station_id', facility: 'facility_id', line: 'line_id' };
export const PICK_KIND_LABEL: Record<PickKind, string> = { station: '역 그룹', facility: '시설', line: '노선' };

/** 클릭 지점의 맨 위 대상(순서: 역 그룹 > 시설 > 노선) */
export function pickAt(map: MlMap, e: MapMouseEvent, layers: PickLayers): PickHit | null {
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
      if (typeof id === 'string' && id) {
        const name = f.properties?.name_ko;
        return { kind, id, name: typeof name === 'string' ? name : null };
      }
    }
  }
  return null;
}

/**
 * @param onPick [… 편집] 단추 → 그 대상으로 전환
 * @param extra 화면이 더하는 단추(없으면 편집 단추만). null 이면 그 클릭은 무시(팝업 없음)
 */
export function useMapPick(
  map: MlMap | null,
  layers: PickLayers,
  own: PickKind | null,
  onPick: (kind: PickKind, id: string) => void,
  enabled = true,
  extra?: (hit: PickHit) => PickAction[] | null,
) {
  const cb = useRef(onPick);
  cb.current = onPick;
  const extraRef = useRef(extra);
  extraRef.current = extra;
  const key = JSON.stringify(layers);
  useEffect(() => {
    if (!map || !enabled) return;
    const all = Object.values(layers).flat();
    const popup = new Popup({ closeButton: true, closeOnClick: false, offset: 8, maxWidth: '260px' });
    const onClick = (e: MapMouseEvent) => {
      const hit = pickAt(map, e, layers);
      const more = hit && hit.kind !== own ? extraRef.current?.(hit) : null;
      if (!hit || hit.kind === own || more === null) {
        popup.remove();
        return;
      }
      const actions: PickAction[] = [
        ...(more ?? []),
        {
          label: `${PICK_KIND_LABEL[hit.kind]} 편집`,
          run: () => cb.current(hit.kind, hit.id),
          testId: 'pick-edit',
        },
      ];
      popup
        .setLngLat(e.lngLat)
        .setDOMContent(popupContent(hit, actions, () => popup.remove()))
        .addTo(map);
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
      popup.remove();
    };
    // layers 는 key 로 비교
  }, [map, key, own, enabled]);
}

function popupContent(hit: PickHit, actions: PickAction[], close: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'text-sm';
  root.dataset.testid = 'pick-popup';
  const head = document.createElement('div');
  head.className = 'mb-1.5 pr-4';
  const kind = document.createElement('span');
  kind.className = 'mr-1 text-xs text-fg-muted';
  kind.textContent = PICK_KIND_LABEL[hit.kind];
  const name = document.createElement('b');
  name.textContent = hit.name ?? hit.id;
  head.append(kind, name);
  const row = document.createElement('div');
  row.className = 'flex flex-wrap gap-1';
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rounded border border-border px-2 py-0.5 text-xs hover:bg-muted';
    b.textContent = a.label;
    if (a.testId) b.dataset.testid = a.testId;
    b.onclick = () => {
      close();
      a.run();
    };
    row.append(b);
  }
  root.append(head, row);
  return root;
}
