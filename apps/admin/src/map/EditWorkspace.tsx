/**
 * 역·시설·노선 편집(2026-11-28 통합): 지도 하나를 세 편집 목록이 함께 쓴다.
 * 대상(역 그룹·시설·노선)은 왼쪽 목록의 필터일 뿐이다(사용자 지시) — 지도 레이어(노선 선·시설 선로·역 그룹 점·시설 점)는
 * 여기서 한 번만 그려 어느 대상이든 똑같다. 목록은 고른 것의 표시(표식·고른 노선 강조·순서 번호)만 더한다.
 */
import { useRef, useState, type ReactNode } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { useQuery } from '@tanstack/react-query';
import { currentLineLayers, currentStationLayers, depotLayers, facilityTrackLayers } from '@k-raildex/map';
import { apiOptional } from '../lib/api';
import { useGeoJsonLayer, useMapLibre, type FeatureCollection } from './useMap';
import { EditMap } from './EditMap';
import { FacilityEditMap } from './FacilityEditMap';
import { LineMapEditor } from './LineMapEditor';
import type { PickKind } from './pick';

const fetchFc = (path: string) => () => apiOptional<FeatureCollection>(path);

/** 편집 목록이 받는 공용 지도 */
export interface MapPanelProps {
  map: MlMap | null;
  /** 지도 위 안내 띄움(portal 대상) */
  overlay: HTMLElement | null;
  /** 대상을 바꿔 들어왔으면 true — 이미 고른 것으로 지도를 옮기지 않는다 */
  keepView: boolean;
  /** 다른 종류 개체 팝업의 [… 편집] → 그 목록으로 */
  onPick: (kind: PickKind, id: string) => void;
}

const LINE_LAYERS = currentLineLayers('current-lines');
const TRACK_LAYERS = facilityTrackLayers('facility-tracks');
const STATION_LAYERS = currentStationLayers('current-stations');
const DEPOT_LAYERS = depotLayers('depots');

const MAP_TESTID: Record<PickKind, string> = { station: 'edit-map', facility: 'facility-map', line: 'line-map' };

export function EditWorkspace({
  target,
  facilityId,
  lineId,
  onPick,
  onFacility,
  onLine,
}: {
  target: PickKind;
  facilityId: string | null;
  lineId: string | null;
  onPick: (kind: PickKind, id: string | null) => void;
  onFacility: (id: string | null) => void;
  onLine: (id: string | null) => void;
}) {
  const { container, map } = useMapLibre();
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  // 처음 연 대상만 고른 것으로 지도를 옮긴다(주소로 들어온 경우). 대상을 바꾼 뒤에는 지도를 그대로 둔다
  const first = useRef(target);
  const switched = useRef(false);
  if (target !== first.current) switched.current = true;
  const common: MapPanelProps = { map, overlay, keepView: switched.current, onPick };

  let panel: ReactNode;
  if (target === 'facility') panel = <FacilityEditMap {...common} facilityId={facilityId} onSelect={onFacility} />;
  else if (target === 'line') panel = <LineMapEditor {...common} lineId={lineId} onLineChange={onLine} />;
  else panel = <EditMap {...common} />;

  return (
    <div className="absolute inset-0 flex">
      {/* 공용 레이어가 목록보다 먼저 들어가야(효과 순서) 목록 강조를 그 아래에 끼울 수 있다 */}
      <BaseLayers map={map} />
      {panel}
      <div className="relative min-w-0 flex-1">
        <div className="absolute inset-0">
          <div ref={container} className="h-full w-full" data-testid={MAP_TESTID[target]} />
        </div>
        <div ref={setOverlay} className="contents" />
      </div>
    </div>
  );
}

/** 어느 대상이든 같은 지도 레이어 */
function BaseLayers({ map }: { map: MlMap | null }) {
  const lines = useQuery({ queryKey: ['map', 'current-lines'], queryFn: fetchFc('/v1/admin/map/current-lines') });
  const tracks = useQuery({ queryKey: ['map', 'facility-tracks'], queryFn: fetchFc('/v1/admin/map/facility-tracks') });
  const stations = useQuery({
    queryKey: ['map', 'current-stations'],
    queryFn: fetchFc('/v1/admin/map/current-stations'),
  });
  const depots = useQuery({ queryKey: ['map', 'depots'], queryFn: fetchFc('/v1/admin/map/depots') });
  // 순서: 노선 선 → 시설 선로 → 역 그룹 점 → 시설 점(목록 강조는 시설 선로 아래)
  useGeoJsonLayer(map, 'current-lines', lines.data, LINE_LAYERS);
  useGeoJsonLayer(map, 'facility-tracks', tracks.data, TRACK_LAYERS);
  useGeoJsonLayer(map, 'current-stations', stations.data, STATION_LAYERS);
  useGeoJsonLayer(map, 'depots', depots.data, DEPOT_LAYERS);
  return null;
}
