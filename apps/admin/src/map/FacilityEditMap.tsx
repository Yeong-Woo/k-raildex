/**
 * 역·시설 편집 — [시설] (2026-11-27 사용자 지시): 시설(차량기지) 목록(검수 태그·좌표 없음 필터)에서 고르고
 * 지도에서 찍거나 표식을 끌어 대표 좌표를 저장한다(coord_source manual). 배경·현재 노선·시설 OSM 선로는 참고로만 그린다 —
 * OSM 좌표를 자체 데이터로 옮기지 않는다(C-5).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Marker, type MapLayerMouseEvent } from 'maplibre-gl';
import { codeLabel, isCode } from '@k-raildex/contracts';
import { currentLineLayers, currentStationLayers, depotLayers, facilityTrackLayers } from '@k-raildex/map';
import { Button, Card, cn } from '@k-raildex/ui';
import { Crosshair, ExternalLink, MapPin, X } from 'lucide-react';
import { api, apiOptional, errorText, type EntityResponse } from '../lib/api';
import { useGeoJsonLayer, useMapLibre, type FeatureCollection } from './useMap';
import { useMapPick, type PickKind } from './pick';
import { ReviewIssues, ReviewPicker, ReviewTag, useReviewList } from './ReviewPicker';

interface FacilityData {
  id: string;
  name_ko: string;
  kind: string;
  status: string;
  address: string | null;
  geom: { lat: number; lng: number } | null;
  coord_source: string | null;
  coord_basis: string | null;
  functions: string[];
}
type LngLat = { lng: number; lat: number };
const round = (v: number) => Math.round(v * 1e6) / 1e6;

export function FacilityEditMap({
  facilityId,
  onSelect,
  onPick,
}: {
  facilityId: string | null;
  onSelect: (id: string | null) => void;
  /** 역 그룹·노선 클릭 → 그 편집으로 */
  onPick: (kind: PickKind, id: string) => void;
}) {
  const qc = useQueryClient();
  const { container, map } = useMapLibre();
  const [pending, setPending] = useState<LngLat | null>(null);
  const [placing, setPlacing] = useState(false);
  const marker = useRef<Marker | null>(null);

  const lines = useQuery({
    queryKey: ['map', 'current-lines'],
    queryFn: () => apiOptional<FeatureCollection>('/v1/admin/map/current-lines'),
  });
  const stations = useQuery({
    queryKey: ['map', 'current-stations'],
    queryFn: () => apiOptional<FeatureCollection>('/v1/admin/map/current-stations'),
  });
  const depots = useQuery({
    queryKey: ['map', 'depots'],
    queryFn: () => apiOptional<FeatureCollection>('/v1/admin/map/depots'),
  });
  const tracks = useQuery({
    queryKey: ['map', 'facility-tracks'],
    queryFn: () => apiOptional<FeatureCollection>('/v1/admin/map/facility-tracks'),
  });
  useGeoJsonLayer(map, 'current-lines', lines.data, currentLineLayers('current-lines'));
  useGeoJsonLayer(map, 'facility-tracks', tracks.data, facilityTrackLayers('facility-tracks'));
  useGeoJsonLayer(map, 'current-stations', stations.data, currentStationLayers('current-stations'));
  useGeoJsonLayer(map, 'depots', depots.data, depotLayers('depots'));

  const review = useReviewList('facility');
  const item = facilityId ? review.data?.items.find((i) => i.id === facilityId) : undefined;
  const fac = useQuery({
    queryKey: ['entity', 'facility', facilityId],
    enabled: !!facilityId,
    queryFn: () => api<EntityResponse<FacilityData>>(`/v1/admin/facility/${encodeURIComponent(facilityId!)}`),
  });
  const data = fac.data?.data;

  const select = (id: string | null) => {
    setPending(null);
    setPlacing(false);
    onSelect(id);
  };

  useMapPick(
    map,
    { station: ['current-station'], facility: ['depots-depot'], line: ['current-line', 'current-line-construction'] },
    'facility',
    onPick,
    !placing,
  );

  // 시설 점 클릭 → 고르기
  useEffect(() => {
    if (!map) return;
    const onClick = (e: MapLayerMouseEvent) => {
      if (placing) return;
      const id = e.features?.[0]?.properties?.facility_id;
      if (typeof id === 'string') select(id);
    };
    const enter = () => (map.getCanvas().style.cursor = 'pointer');
    const leave = () => (map.getCanvas().style.cursor = '');
    map.on('click', 'depots-depot', onClick);
    map.on('mouseenter', 'depots-depot', enter);
    map.on('mouseleave', 'depots-depot', leave);
    return () => {
      map.off('click', 'depots-depot', onClick);
      map.off('mouseenter', 'depots-depot', enter);
      map.off('mouseleave', 'depots-depot', leave);
    };
  }, [map, placing]);

  // 찍기 모드: 지도 클릭 = 새 좌표
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

  // 표식(끌 수 있음)
  const shown: LngLat | null = pending ?? (data?.geom ? { lng: data.geom.lng, lat: data.geom.lat } : null);
  useEffect(() => {
    if (!map) return;
    if (!shown || !data) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      marker.current = new Marker({ draggable: true, color: '#7C3AED' }).setLngLat(shown).addTo(map);
      marker.current.on('dragend', () => {
        const p = marker.current!.getLngLat();
        setPending({ lng: round(p.lng), lat: round(p.lat) });
      });
    } else marker.current.setLngLat(shown);
  }, [map, shown?.lng, shown?.lat, data]);
  useEffect(() => () => void marker.current?.remove(), []);

  // 고르면 그리로(좌표 없으면 담당 노선 쪽은 모르므로 그대로)
  useEffect(() => {
    if (map && data?.geom) map.flyTo({ center: [data.geom.lng, data.geom.lat], zoom: Math.max(map.getZoom(), 14) });
  }, [map, data?.id]);

  const save = useMutation({
    mutationFn: () =>
      api(`/v1/admin/facility/${encodeURIComponent(facilityId!)}`, {
        method: 'PATCH',
        ifMatch: fac.data!.version,
        json: { geom: { lat: pending!.lat, lng: pending!.lng }, coord_source: 'manual', coord_basis: null },
      }),
    onSuccess: async () => {
      toast.success('시설 좌표를 저장했습니다(수기 확인)');
      setPending(null);
      await qc.invalidateQueries({ queryKey: ['entity', 'facility', facilityId] });
      await qc.invalidateQueries({ queryKey: ['map'] });
      await qc.invalidateQueries({ queryKey: ['quality'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <div className="absolute inset-0 flex">
      <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-bg-elevated p-3">
        {facilityId ? (
          <Card className="p-3 text-sm" data-testid="facility-selected">
            <div className="flex items-center gap-2">
              <MapPin className="size-4 text-[#7C3AED]" />
              <strong className="min-w-0 truncate">{data?.name_ko ?? facilityId}</strong>
              {item ? <ReviewTag issues={item.issues} /> : null}
              <Link
                to="/data/$type/$id"
                params={{ type: 'facility', id: facilityId }}
                search={{}}
                className="text-fg-muted"
                title="시설 상세"
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
            {item?.lines.length ? (
              <p className="mt-0.5 text-[11px] text-fg-muted">담당: {item.lines.join(' · ')}</p>
            ) : null}
            {data ? (
              <dl className="mt-2 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-y-0.5 text-xs">
                <dt className="text-fg-muted">기능</dt>
                <dd>
                  {data.functions.length
                    ? data.functions
                        .map((f) => (isCode('facilityFunction', f) ? codeLabel('facilityFunction', f) : f))
                        .join(' · ')
                    : '미확인'}
                </dd>
                <dt className="text-fg-muted">주소</dt>
                <dd>{data.address ?? '미확인'}</dd>
                <dt className="text-fg-muted">좌표</dt>
                <dd>{data.geom ? `${data.geom.lat}, ${data.geom.lng}` : '없음'}</dd>
                {pending ? (
                  <>
                    <dt className="font-semibold text-primary">새 좌표</dt>
                    <dd className="font-semibold text-primary" data-testid="facility-pending-coord">
                      {pending.lat}, {pending.lng}
                    </dd>
                  </>
                ) : null}
              </dl>
            ) : null}
            {item ? <ReviewIssues issues={item.issues} /> : null}
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
                variant={placing ? 'default' : 'outline'}
                data-testid="facility-place"
                onClick={() => setPlacing((v) => !v)}
              >
                <Crosshair className="size-3.5" /> {placing ? '지도를 누르세요' : '지도에서 찍기'}
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-fg-muted">
              위성·VWorld 배경과 보라색 시설 선로(OSM, 참고)를 보고 기지 가운데를 찍습니다. OSM 좌표를 옮겨 적지
              않습니다.
            </p>
          </Card>
        ) : (
          <p className="text-xs text-fg-muted">시설을 고르고 [지도에서 찍기]로 좌표를 넣습니다.</p>
        )}
        <ReviewPicker
          type="facility"
          selectedId={facilityId}
          className={cn('min-h-72 flex-1')}
          onSelect={(it) => {
            select(it.id);
            if (!it.has_geom) setPlacing(true);
          }}
        />
      </aside>
      <div className="relative min-w-0 flex-1">
        <div className="absolute inset-0">
          <div ref={container} className="h-full w-full" data-testid="facility-map" />
        </div>
      </div>
    </div>
  );
}
