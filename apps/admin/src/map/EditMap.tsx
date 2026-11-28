/**
 * 지도 편집(FR-ADM-070~072): 현재 노선·역 레이어, 역 찾기·클릭 → 표식 끌기 → 좌표 저장(coord_source manual),
 * 역 고르기 목록(ReviewPicker: 노선명 병기, 검수 필요 빨강·정상 초록 태그와 필터, 좌표 없음 필터) → 지도에서 찍어 입력,
 * 또는 다른 역을 골라 그 좌표를 가져온다
 * (coord_source derived · coord_basis existing_station · coord_same_as_id = 그 역). OSM 선형은 그리기만 한다(저장 안 함).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Marker, type MapLayerMouseEvent } from 'maplibre-gl';
import { codeLabel, isCode } from '@k-raildex/contracts';
import { currentLineLayers, currentStationLayers, depotLayers, STATUS_COLORS } from '@k-raildex/map';
import { Button, Card } from '@k-raildex/ui';
import { Copy, Crosshair, ExternalLink, MapPin, X } from 'lucide-react';
import { api, apiOptional, errorText, type EntityResponse } from '../lib/api';
import { RefInput } from '../form/widgets/RefInput';
import { useGeoJsonLayer, useMapLibre, type FeatureCollection } from './useMap';
import { useFeaturePopup } from './FeaturePopup';
import { useMapPick, type PickKind } from './pick';
import { ReviewIssues, ReviewPicker, ReviewTag, useReviewList } from './ReviewPicker';
import { KeepSplitButton, MergeStationButton } from '../editors/MergeStation';

interface StationData {
  id: string;
  name_ko: string;
  geom: { lat: number; lng: number } | null;
  coord_source: string | null;
  coord_basis: string | null;
  merge_into_id?: string | null;
}
type LngLat = { lng: number; lat: number };
/** from = 좌표를 가져온 역(있으면 "기존 역 좌표"로 저장) */
type Pending = LngLat & { from?: { id: string; name: string } };

const round = (v: number) => Math.round(v * 1e6) / 1e6;

export function EditMap({ onPick }: { onPick: (kind: PickKind, id: string) => void }) {
  const search = useSearch({ from: '/map' });
  const navigate = useNavigate({ from: '/map' });
  const qc = useQueryClient();
  const { container, map } = useMapLibre();
  const stationId = search.station ?? null;
  const [pending, setPending] = useState<Pending | null>(null);
  const [placing, setPlacing] = useState(false);
  // 다른 역 고르기 모드: 지도에서 역 점을 클릭하면 그 역 좌표를 새 좌표로
  const [picking, setPicking] = useState(false);
  const pickingRef = useRef(false);
  pickingRef.current = picking;
  const stationIdRef = useRef(stationId);
  stationIdRef.current = stationId;
  const marker = useRef<Marker | null>(null);

  const stations = useQuery({
    queryKey: ['map', 'current-stations'],
    queryFn: () => apiOptional<FeatureCollection>('/v1/admin/map/current-stations'),
  });
  const lines = useQuery({
    queryKey: ['map', 'current-lines'],
    queryFn: () => apiOptional<FeatureCollection>('/v1/admin/map/current-lines'),
  });
  const review = useReviewList('station');
  const selectedItem = stationId ? review.data?.items.find((it) => it.id === stationId) : undefined;
  const station = useQuery({
    queryKey: ['entity', 'station', stationId],
    enabled: !!stationId,
    queryFn: () => api<EntityResponse<StationData>>(`/v1/admin/station/${encodeURIComponent(stationId!)}`),
  });

  useGeoJsonLayer(map, 'current-lines', lines.data, currentLineLayers('current-lines'));
  useGeoJsonLayer(map, 'current-stations', stations.data, currentStationLayers('current-stations'));
  // 차량기지(시설 facility, 0035) — 좌표가 있는 것만. 누르면 시설 편집
  const depots = useQuery({
    queryKey: ['map', 'depots'],
    queryFn: () => apiOptional<FeatureCollection>('/v1/admin/map/depots'),
  });
  useGeoJsonLayer(map, 'depots', depots.data, depotLayers('depots'));
  // 역 클릭 → 정보 팝업 + 옆 패널 선택(좌표 찍기 중에는 끔). 노선·시설 클릭 → 그 편집으로(useMapPick)
  useFeaturePopup(map, ['current-station'], !placing && !picking);
  useMapPick(
    map,
    { station: ['current-station'], facility: ['depots-depot'], line: ['current-line', 'current-line-construction'] },
    'station',
    onPick,
    !placing && !picking,
  );

  const select = (id: string | null) => {
    setPending(null);
    setPlacing(false);
    setPicking(false);
    void navigate({ search: (s) => ({ ...s, tab: 'edit', station: id ?? undefined }) });
  };

  // 역 점 클릭 → 선택, 커서
  useEffect(() => {
    if (!map) return;
    const onClick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.station_id;
      if (typeof id !== 'string') return;
      if (pickingRef.current) void takeFrom(id);
      else select(id);
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
    // select·takeFrom 은 ref·navigate 로만 상태를 바꾼다
  }, [map]);

  // 좌표 찍기 모드: 지도 클릭 = 새 좌표
  useEffect(() => {
    if (!map || !placing) return;
    map.getCanvas().style.cursor = 'crosshair';
    const onClick = (e: MapLayerMouseEvent) => {
      setPending({ lng: round(e.lngLat.lng), lat: round(e.lngLat.lat) });
      setPlacing(false);
    };
    map.once('click', onClick);
    return () => {
      map.off('click', onClick);
      map.getCanvas().style.cursor = '';
    };
  }, [map, placing]);

  // 다른 역 좌표 가져오기(그 역에 좌표가 있어야 한다 — V-H08)
  const takeFrom = async (fromId: string) => {
    setPicking(false);
    if (fromId === stationIdRef.current) return void toast.error('같은 역입니다');
    try {
      const r = await qc.fetchQuery({
        queryKey: ['entity', 'station', fromId],
        queryFn: () => api<EntityResponse<StationData>>(`/v1/admin/station/${encodeURIComponent(fromId)}`),
      });
      if (!r.data.geom) return void toast.error(`${r.data.name_ko}: 좌표가 없는 역입니다`);
      setPending({ lng: r.data.geom.lng, lat: r.data.geom.lat, from: { id: fromId, name: r.data.name_ko } });
    } catch (e) {
      toast.error(errorText(e));
    }
  };
  // 선택한 역 표식(끌 수 있음)
  const data = station.data?.data;
  const shown: LngLat | null = pending ?? (data?.geom ? { lng: data.geom.lng, lat: data.geom.lat } : null);
  useEffect(() => {
    if (!map) return;
    if (!shown || !data) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      marker.current = new Marker({ draggable: true, color: '#DC2626' }).setLngLat(shown).addTo(map);
      marker.current.on('dragend', () => {
        const p = marker.current!.getLngLat();
        setPending({ lng: round(p.lng), lat: round(p.lat) });
      });
    } else marker.current.setLngLat(shown);
  }, [map, shown?.lng, shown?.lat, data]);

  useEffect(
    () => () => {
      marker.current?.remove();
    },
    [],
  );

  // 역을 고르면 그리로 이동
  useEffect(() => {
    if (map && data?.geom) map.flyTo({ center: [data.geom.lng, data.geom.lat], zoom: Math.max(map.getZoom(), 14) });
  }, [map, data?.id]);

  const save = useMutation({
    mutationFn: () =>
      api(`/v1/admin/station/${encodeURIComponent(stationId!)}`, {
        method: 'PATCH',
        ifMatch: station.data!.version,
        json: {
          geom: { lat: pending!.lat, lng: pending!.lng },
          ...(pending!.from
            ? { coord_source: 'derived', coord_basis: 'existing_station', coord_same_as_id: pending!.from.id }
            : { coord_source: 'manual', coord_basis: null, coord_same_as_id: null }),
        },
      }),
    onSuccess: async () => {
      toast.success(
        pending?.from ? `좌표를 저장했습니다(${pending.from.name} 역 좌표)` : '좌표를 저장했습니다(수기 확인)',
      );
      setPending(null);
      await qc.invalidateQueries({ queryKey: ['entity', 'station', stationId] });
      await qc.invalidateQueries({ queryKey: ['map'] });
      await qc.invalidateQueries({ queryKey: ['quality'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const apiMissing = stations.data === null || lines.data === null;

  return (
    <div className="absolute inset-0 flex">
      <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-bg-elevated p-3">
        {stationId ? (
          <Card className="p-3 text-sm" data-testid="map-selected-station">
            <div className="flex items-center gap-2">
              <MapPin className="size-4 text-danger" />
              <strong className="min-w-0 truncate">{data?.name_ko ?? stationId}</strong>
              {selectedItem ? <ReviewTag issues={selectedItem.issues} /> : null}
              <Link
                to="/data/$type/$id"
                params={{ type: 'station', id: stationId }}
                search={{}}
                className="text-fg-muted"
                title="역 상세"
              >
                <ExternalLink className="size-3.5" />
              </Link>
              <button
                className="ml-auto text-fg-muted hover:text-fg"
                aria-label="선택 해제"
                onClick={() => select(null)}
              >
                <X className="size-4" />
              </button>
            </div>
            {selectedItem?.lines.length ? (
              <p className="mt-0.5 text-[11px] text-fg-muted">{selectedItem.lines.join(' · ')}</p>
            ) : null}
            {station.isLoading ? <p className="mt-2 text-fg-muted">불러오는 중…</p> : null}
            {data ? (
              <dl className="mt-2 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-y-0.5 text-xs">
                <dt className="text-fg-muted">좌표</dt>
                <dd>{data.geom ? `${data.geom.lat}, ${data.geom.lng}` : '없음'}</dd>
                <dt className="text-fg-muted">좌표 출처</dt>
                <dd>
                  {data.coord_source && isCode('coordSource', data.coord_source)
                    ? codeLabel('coordSource', data.coord_source)
                    : '-'}
                  {data.coord_basis && isCode('coordBasis', data.coord_basis)
                    ? ` · ${codeLabel('coordBasis', data.coord_basis)}(근사)`
                    : ''}
                </dd>
                {pending ? (
                  <>
                    <dt className="font-semibold text-primary">새 좌표</dt>
                    <dd className="font-semibold text-primary" data-testid="pending-coord">
                      {pending.lat}, {pending.lng}
                      {pending.from ? (
                        <span className="block font-normal">← {pending.from.name} 역 좌표(기존 역 좌표)</span>
                      ) : null}
                    </dd>
                  </>
                ) : null}
              </dl>
            ) : null}
            {selectedItem ? <ReviewIssues issues={selectedItem.issues} /> : null}
            {data?.merge_into_id ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" data-testid="map-split-actions">
                <span className="text-fg-muted">분리 정거장 → {data.merge_into_id}</span>
                <MergeStationButton fromId={data.id} intoId={data.merge_into_id} onDone={(into) => select(into)} />
                <KeepSplitButton stationId={data.id} intoId={data.merge_into_id} />
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" disabled={!pending || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? '저장 중…' : '좌표 저장'}
              </Button>
              {pending ? (
                <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                  취소
                </Button>
              ) : null}
              <Button
                size="sm"
                variant={placing ? 'secondary' : 'outline'}
                onClick={() => {
                  setPicking(false);
                  setPlacing((p) => !p);
                }}
              >
                <Crosshair className="size-4" /> {placing ? '지도를 클릭하세요' : '지도에서 찍기'}
              </Button>
              <Button
                size="sm"
                variant={picking ? 'secondary' : 'outline'}
                onClick={() => {
                  setPlacing(false);
                  setPicking((p) => !p);
                }}
              >
                <Copy className="size-4" /> {picking ? '역 점을 클릭하세요' : '다른 역 좌표 쓰기'}
              </Button>
            </div>
            {picking ? (
              <div className="mt-2" data-testid="coord-from-station">
                <label className="mb-1 block text-xs font-semibold text-fg-muted">좌표를 가져올 역</label>
                <RefInput target="station" value={null} onChange={(id) => id && void takeFrom(id)} />
              </div>
            ) : null}
            <details className="mt-2 text-[11px] text-fg-muted">
              <summary className="cursor-pointer select-none">도움말</summary>
              표식을 끌거나 [지도에서 찍기] 뒤 지도를 클릭하면 새 좌표가 됩니다(저장하면 좌표 출처 = 수기 확인). [다른
              역 좌표 쓰기] 뒤 지도의 역 점을 클릭하거나 위 칸에서 찾으면 그 역 좌표를 덮어씁니다(좌표 출처 = 추정 ·
              기존 역 좌표, 좌표를 빌려 올 역 = 그 역). 덮어쓴 뒤 표식을 끌면 수기 확인으로 바뀝니다.
            </details>
          </Card>
        ) : (
          <p className="text-xs text-fg-muted">아래 목록에서 고르거나 지도에서 역 점을 클릭하세요.</p>
        )}
        {/* 목록은 남는 높이 안에서만 스크롤(범례와 겹치지 않게). 좌표 없는 역을 고르면 바로 찍기 모드 */}
        <ReviewPicker
          type="station"
          selectedId={stationId}
          className="min-h-72 flex-1"
          onSelect={(it) => {
            select(it.id);
            if (it.has_geom === false) setPlacing(true);
          }}
        />
        <section className="shrink-0 border-t border-border pt-2 text-[11px] text-fg-muted">
          <div className="mb-1 font-semibold">범례</div>
          <ul className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            {Object.entries(STATUS_COLORS).map(([k, c]) => (
              <li key={k} className="flex items-center gap-1">
                <span className="inline-block size-2.5 rounded-full border border-white" style={{ background: c }} />
                {isCode('status', k) ? codeLabel('status', k) : k}
              </li>
            ))}
            <li className="col-span-2 flex items-center gap-1">
              <span className="inline-block size-2.5 rounded-full border-2 border-[#F59E0B]" /> 근사 좌표(대표점)
            </li>
          </ul>
          <p className="mt-1">배경 지도는 지도 오른쪽 위에서 고릅니다(OSM 교통 지도·OSM 표준·VWorld).</p>
          {lines.data?.attribution ? <p>{lines.data.attribution}</p> : null}
        </section>
      </aside>
      <div className="relative min-w-0 flex-1">
        <div className="absolute inset-0">
          <div ref={container} className="h-full w-full" data-testid="edit-map" />
        </div>
        {apiMissing ? (
          <div className="absolute top-3 left-3 rounded-md border border-border bg-bg-elevated/95 px-3 py-2 text-xs shadow">
            지도 API(/v1/admin/map/current-*)가 아직 없어 배경 지도만 표시합니다.
          </div>
        ) : null}
        {placing ? (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-fg shadow">
            {data?.name_ko ?? stationId} — 지도를 클릭해 좌표를 찍으세요
          </div>
        ) : null}
        {picking ? (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-fg shadow">
            {data?.name_ko ?? stationId} — 좌표를 가져올 역 점을 클릭하세요
          </div>
        ) : null}
      </div>
    </div>
  );
}
