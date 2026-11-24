/**
 * 배경 지도 고르기(사용자 요청 2026-11-24): OSM 교통 지도·OSM 표준·VWorld 일반·VWorld 위성.
 * - 기본 = OSM 교통 지도(Thunderforest Transport, 키 필요). 키가 없으면 OSM 표준.
 * - 키가 필요한 배경은 키가 있을 때만 목록에 나온다. 고른 값은 브라우저 localStorage(`kr-basemap`)에 기억한다.
 * - 키(VWorld·Thunderforest)는 브라우저 타일 주소에 들어가는 공개 키다(도메인 묶음). 저장소에 커밋하지 않는다.
 * 지도 라이브러리(MapLibre)에 의존하지 않도록 지도 객체는 필요한 메서드만 구조적으로 받는다.
 */

export type BasemapId = 'osm-transport' | 'osm-standard' | 'vworld-base' | 'vworld-satellite';

export interface BasemapKeys {
  vworldKey?: string | null | undefined;
  /** Thunderforest API 키(OSM "교통 지도" 타일) */
  thunderforestKey?: string | null | undefined;
}

interface BasemapDef {
  id: BasemapId;
  label: string;
  needs: 'vworld' | 'thunderforest' | null;
  satellite?: boolean;
}

export const BASEMAPS: readonly BasemapDef[] = [
  { id: 'osm-transport', label: 'OSM 교통 지도', needs: 'thunderforest' },
  { id: 'osm-standard', label: 'OSM 표준', needs: null },
  { id: 'vworld-base', label: 'VWorld 일반', needs: 'vworld' },
  { id: 'vworld-satellite', label: 'VWorld 위성', needs: 'vworld', satellite: true },
];

const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자';

const clean = (k: string | null | undefined) => k?.trim() || null;

/** 키가 있어 쓸 수 있는 배경(위성 제외 옵션) */
export function availableBasemaps(keys: BasemapKeys, opts: { satellite?: boolean } = {}): BasemapDef[] {
  return BASEMAPS.filter((b) => {
    if (b.satellite && opts.satellite === false) return false;
    if (b.needs === 'vworld') return !!clean(keys.vworldKey);
    if (b.needs === 'thunderforest') return !!clean(keys.thunderforestKey);
    return true;
  });
}

/** 기본 배경: OSM 교통 지도, 키가 없으면 OSM 표준 */
export function defaultBasemap(keys: BasemapKeys): BasemapId {
  return clean(keys.thunderforestKey) ? 'osm-transport' : 'osm-standard';
}

/** 쓸 수 없는 id(키 없음·알 수 없는 값)는 기본 배경으로 */
export function resolveBasemap(id: string | null | undefined, keys: BasemapKeys): BasemapId {
  const ok = availableBasemaps(keys).some((b) => b.id === id);
  return ok ? (id as BasemapId) : defaultBasemap(keys);
}

/** 래스터 타일 소스 */
export function basemapSource(id: BasemapId, keys: BasemapKeys): Record<string, unknown> {
  const vw = clean(keys.vworldKey);
  const tf = clean(keys.thunderforestKey);
  switch (resolveBasemap(id, keys)) {
    case 'osm-transport':
      return {
        type: 'raster',
        tiles: [`https://tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=${encodeURIComponent(tf ?? '')}`],
        tileSize: 256,
        maxzoom: 22,
        attribution: `지도 © <a href="https://www.thunderforest.com/">Thunderforest</a>, 자료 ${OSM_ATTR}`,
      };
    case 'vworld-base':
    case 'vworld-satellite':
      return {
        type: 'raster',
        tiles: [
          id === 'vworld-satellite'
            ? `https://api.vworld.kr/req/wmts/1.0.0/${vw}/Satellite/{z}/{y}/{x}.jpeg`
            : `https://api.vworld.kr/req/wmts/1.0.0/${vw}/Base/{z}/{y}/{x}.png`,
        ],
        tileSize: 256,
        minzoom: 6,
        maxzoom: 19,
        attribution: '© VWorld(국토교통부)',
      };
    default:
      return {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: OSM_ATTR,
      };
  }
}

const STORAGE_KEY = 'kr-basemap';

/** 기억한 배경(없거나 저장소를 못 쓰면 null) */
export function loadBasemapChoice(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveBasemapChoice(id: BasemapId): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, id);
  } catch {
    /* 사생활 보호 창 등 — 기억하지 않을 뿐 */
  }
}

/** swapBasemap 이 쓰는 지도 메서드(MapLibre Map 과 호환) */
export interface BasemapHost {
  getLayer(id: string): unknown;
  removeLayer(id: string): unknown;
  getSource(id: string): unknown;
  removeSource(id: string): unknown;
  addSource(id: string, source: never): unknown;
  addLayer(layer: never, before?: string): unknown;
  getStyle(): { layers: { id: string }[] };
}

/** 배경 소스·층만 바꾼다(그 위 노선·역 층은 그대로). paint = 배경 층 paint(흐리게 등) */
export function swapBasemap(
  map: BasemapHost,
  id: BasemapId,
  keys: BasemapKeys,
  paint: Record<string, unknown> = {},
): void {
  const before = map.getStyle().layers.find((l) => l.id !== 'basemap')?.id;
  if (map.getLayer('basemap')) map.removeLayer('basemap');
  if (map.getSource('basemap')) map.removeSource('basemap');
  map.addSource('basemap', basemapSource(id, keys) as never);
  map.addLayer({ id: 'basemap', type: 'raster', source: 'basemap', paint } as never, before);
}

/**
 * 배경 고르기 컨트롤(MapLibre IControl 모양: onAdd·onRemove). 쓸 수 있는 배경이 하나뿐이면 아무것도 그리지 않는다.
 * onChange 는 사용자가 고른 직후(이미 바꾼 뒤) 부른다.
 */
export function createBasemapControl(opts: {
  keys: BasemapKeys;
  current: BasemapId;
  paint?: Record<string, unknown>;
  satellite?: boolean;
  onChange?: (id: BasemapId) => void;
}): { onAdd(map: BasemapHost): HTMLElement; onRemove(): void } {
  let root: HTMLElement | null = null;
  return {
    onAdd(map) {
      root = document.createElement('div');
      root.className = 'maplibregl-ctrl maplibregl-ctrl-group kr-basemap-ctrl';
      const items = availableBasemaps(opts.keys, { satellite: opts.satellite });
      if (items.length < 2) {
        root.hidden = true;
        return root;
      }
      const select = document.createElement('select');
      select.setAttribute('aria-label', '배경 지도');
      select.title = '배경 지도';
      select.style.cssText =
        'font:inherit;font-size:12px;min-height:29px;padding:0 6px;border:0;background:transparent;color:#111418;cursor:pointer';
      for (const b of items) {
        const o = document.createElement('option');
        o.value = b.id;
        o.textContent = b.label;
        if (b.id === opts.current) o.selected = true;
        select.append(o);
      }
      select.addEventListener('change', () => {
        const id = resolveBasemap(select.value, opts.keys);
        swapBasemap(map, id, opts.keys, opts.paint);
        saveBasemapChoice(id);
        opts.onChange?.(id);
      });
      root.append(select);
      return root;
    },
    onRemove() {
      root?.remove();
      root = null;
    },
  };
}
