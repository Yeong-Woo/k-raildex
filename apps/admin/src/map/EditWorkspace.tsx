/**
 * 역·시설·노선 편집(2026-11-28 통합): 지도 하나를 세 편집 목록이 함께 쓴다.
 * 대상(역 그룹·시설·노선)을 바꾸면 왼쪽 목록과 그 대상의 레이어만 바뀌고 지도(위치·배율·배경)는 그대로다(사용자 지시).
 */
import { useRef, useState, type ReactNode } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { useMapLibre } from './useMap';
import { EditMap } from './EditMap';
import { FacilityEditMap } from './FacilityEditMap';
import { LineMapEditor } from './LineMapEditor';
import type { PickKind } from './pick';

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
