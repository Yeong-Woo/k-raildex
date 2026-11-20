/**
 * 지도 편집(FR-ADM-070~072): 현재 노선·역 레이어, 역 찾기·클릭 → 표식 끌기 → 좌표 저장(coord_source manual),
 * 좌표 없는 역 패널 → 지도에서 찍어 입력. OSM 선형은 osm 스키마에서 그리기만 한다(저장 안 함).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Marker, type MapLayerMouseEvent } from 'maplibre-gl';
import { codeLabel, isCode } from '@k-raildex/contracts';
import { currentLineLayers, currentStationLayers, STATUS_COLORS } from '@k-raildex/map';
import { Badge, Button, Card, cn } from '@k-raildex/ui';
import { Crosshair, ExternalLink, MapPin, X } from 'lucide-react';
import { api, apiOptional, errorText, qs, type EntityResponse } from '../lib/api';
import { RefInput } from '../form/widgets/RefInput';
import { useGeoJsonLayer, useMapLibre, VWORLD_KEY, type FeatureCollection } from './useMap';

interface StationData {
  id: string;
  name_ko: string;
  geom: { lat: number; lng: number } | null;
  coord_source: string | null;
  coord_basis: string | null;
}
type LngLat = { lng: number; lat: number };

const round = (v: number) => Math.round(v * 1e6) / 1e6;

export function EditMap() {
  const search = useSearch({ from: '/map' });
  const navigate = useNavigate({ from: '/map' });
  const qc = useQueryClient();
  const { container, map } = useMapLibre();
  const stationId = search.station ?? null;
  const [pending, setPending] = useState<LngLat | null>(null);
  const [placing, setPlacing] = useState(false);
  const marker = useRef<Marker | null>(null);

  const stations = useQuery({
    queryKey: ['map', 'current-stations'],
    queryFn: () => apiOptional<FeatureCollection>('/v1/admin/map/current-stations'),
  });
  const lines = useQuery({
    queryKey: ['map', 'current-lines'],
    queryFn: () => apiOptional<FeatureCollection>('/v1/admin/map/current-lines'),
  });
  const missing = useQuery({
    queryKey: ['quality', 'V-S02', 'map'],
    queryFn: () =>
      apiOptional<{
        items: { entity_type: string; entity_id: string; label: string | null; detail: string | null }[];
        total: number;
      }>(`/v1/admin/quality/V-S02${qs({ limit: 200 })}`),
  });
  const station = useQuery({
    queryKey: ['entity', 'station', stationId],
    enabled: !!stationId,
    queryFn: () => api<EntityResponse<StationData>>(`/v1/admin/station/${encodeURIComponent(stationId!)}`),
  });

  useGeoJsonLayer(map, 'current-lines', lines.data, currentLineLayers('current-lines'));
  useGeoJsonLayer(map, 'current-stations', stations.data, currentStationLayers('current-stations'));

  const select = (id: string | null) => {
    setPending(null);
    setPlacing(false);
    void navigate({ search: (s) => ({ ...s, tab: 'edit', station: id ?? undefined }) });
  };

  // 역 점 클릭 → 선택, 커서
  useEffect(() => {
    if (!map) return;
    const onClick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.station_id;
      if (typeof id === 'string') select(id);
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
    // select 는 navigate 래퍼(안정적)
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
        json: { geom: { lat: pending!.lat, lng: pending!.lng }, coord_source: 'manual', coord_basis: null },
      }),
    onSuccess: async () => {
      toast.success('좌표를 저장했습니다(수기 확인)');
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
        <div>
          <label className="mb-1 block text-xs font-semibold text-fg-muted">역 찾기</label>
          <RefInput target="station" value={null} onChange={(id) => id && select(id)} />
        </div>
        {stationId ? (
          <Card className="p-3 text-sm" data-testid="map-selected-station">
            <div className="flex items-center gap-2">
              <MapPin className="size-4 text-danger" />
              <strong>{data?.name_ko ?? stationId}</strong>
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
            {station.isLoading ? <p className="mt-2 text-fg-muted">불러오는 중…</p> : null}
            {data ? (
              <dl className="mt-2 grid grid-cols-[4.5rem_1fr] gap-y-0.5 text-xs">
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
                    </dd>
                  </>
                ) : null}
              </dl>
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
              <Button size="sm" variant={placing ? 'secondary' : 'outline'} onClick={() => setPlacing((p) => !p)}>
                <Crosshair className="size-4" /> {placing ? '지도를 클릭하세요' : '지도에서 찍기'}
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-fg-muted">
              표식을 끌거나 [지도에서 찍기] 뒤 지도를 클릭하면 새 좌표가 됩니다. 저장하면 좌표 출처 = 수기 확인.
            </p>
          </Card>
        ) : (
          <p className="text-xs text-fg-muted">지도에서 역 점을 클릭하거나 위에서 찾으세요.</p>
        )}
        <section className="flex min-h-0 flex-col">
          <h2 className="mb-1 flex items-center gap-2 text-xs font-semibold text-fg-muted">
            좌표 없는 역·시·도 미상(V-S02)
            {missing.data ? <Badge tone={missing.data.total ? 'warn' : 'good'}>{missing.data.total}</Badge> : null}
          </h2>
          {missing.data === null ? (
            <p className="text-xs text-fg-muted">품질 API 가 아직 없습니다.</p>
          ) : missing.isLoading ? (
            <p className="text-xs text-fg-muted">불러오는 중…</p>
          ) : !missing.data?.items.length ? (
            <p className="text-xs text-fg-muted">없음</p>
          ) : (
            <ul className="flex flex-col text-sm" data-testid="missing-coords">
              {missing.data.items
                .filter((it) => it.entity_type === 'station')
                .map((it) => (
                  <li key={it.entity_id}>
                    <button
                      type="button"
                      className={cn(
                        'flex w-full flex-col rounded px-2 py-1 text-left hover:bg-muted',
                        it.entity_id === stationId && 'bg-muted',
                      )}
                      onClick={() => {
                        select(it.entity_id);
                        setPlacing(true);
                      }}
                    >
                      <span>{it.label ?? it.entity_id}</span>
                      <span className="text-[11px] text-fg-muted">{it.detail ?? it.entity_id}</span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </section>
        <section className="mt-auto text-[11px] text-fg-muted">
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
          <p className="mt-1">배경: {VWORLD_KEY ? 'VWorld' : 'OpenStreetMap(VITE_VWORLD_API_KEY 없음)'}</p>
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
      </div>
    </div>
  );
}
