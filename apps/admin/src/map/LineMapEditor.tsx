/**
 * 노선 편집(지도, FR-ADM-050·070): 노선 목록(ReviewPicker: 검수 필요 빨강·정상 초록 태그와 필터)에서 노선을 고르면 그 노선을 강조하고 노선별 역(line_station)을 순서 번호로 보여 준다.
 * 왼쪽 목록에서 순서(위로/아래로)·삭제·km 를 고치고, "지도에서 역 추가"를 켜면 역 점 클릭으로 역을 넣는다
 * (이웃 역 사이 경로가 가장 적게 늘어나는 자리, 좌표가 없으면 끝). 저장은 노선 상세 [역 순서] 탭과 같은
 * PUT /v1/admin/lines/:id/stations(도메인 적용기, 행 version 확인) — editors/useLineStations.
 * 선은 현재 지도 물리화 뷰(mv_map_line, OSM)라 파생 갱신 뒤에 바뀐다. 역 점은 mv_map_station.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Marker, type MapLayerMouseEvent } from 'maplibre-gl';
import { codeLabel, isCode } from '@k-raildex/contracts';
import { STAGE_FALLBACK_COLOR, type LayerSpec } from '@k-raildex/map';
import { Badge, Button, Card, cn, Empty, Input, Label } from '@k-raildex/ui';
import { AlertTriangle, ArrowDown, ArrowUp, MapPin, RotateCcw, Trash2 } from 'lucide-react';
import { api, apiOptional, errorText, type EntityResponse } from '../lib/api';
import { kmRegressions, type LsRow } from '../lib/line-stations';
import { useLabel } from '../form/widgets/RefInput';
import { newLineStationRow, useLineStations } from '../editors/useLineStations';
import { bestInsertIndex, type Coord } from './geo';
import { boundsOf, EMPTY_FC, useGeoJsonLayer, useMapLibre, type FeatureCollection } from './useMap';
import { useFeaturePopup } from './FeaturePopup';
import { ReviewIssues, ReviewPicker, ReviewTag, useReviewList } from './ReviewPicker';

const DEFAULT_COLOR = '#2563EB';

const BG_LAYERS: LayerSpec[] = [
  {
    id: 'lm-line',
    type: 'line',
    source: 'lm-lines',
    filter: ['!=', ['get', 'is_construction'], true],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['coalesce', ['get', 'color'], STAGE_FALLBACK_COLOR], 'line-width': 2, 'line-opacity': 0.3 },
  },
  {
    id: 'lm-line-construction',
    type: 'line',
    source: 'lm-lines',
    filter: ['==', ['get', 'is_construction'], true],
    paint: {
      'line-color': ['coalesce', ['get', 'color'], STAGE_FALLBACK_COLOR],
      'line-width': 2,
      'line-dasharray': [2, 1.2],
      'line-opacity': 0.3,
    },
  },
];
const SEL_LAYERS: LayerSpec[] = [
  {
    id: 'lm-sel-line',
    type: 'line',
    source: 'lm-sel',
    filter: ['!=', ['get', 'is_construction'], true],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['coalesce', ['get', 'color'], DEFAULT_COLOR], 'line-width': 6 },
  },
  {
    id: 'lm-sel-line-construction',
    type: 'line',
    source: 'lm-sel',
    filter: ['==', ['get', 'is_construction'], true],
    paint: { 'line-color': ['coalesce', ['get', 'color'], DEFAULT_COLOR], 'line-width': 6, 'line-dasharray': [2, 1.2] },
  },
];
/** 노선별 역 순서대로 이은 선(지선별) — 순서 확인용 */
const PATH_LAYERS: LayerSpec[] = [
  {
    id: 'lm-path',
    type: 'line',
    source: 'lm-path',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [1, 1.5], 'line-opacity': 0.9 },
  },
];
const STATION_LAYERS: LayerSpec[] = [
  {
    id: 'lm-station',
    type: 'circle',
    source: 'lm-stations',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 2.5, 13, 5],
      'circle-color': '#475569',
      'circle-stroke-color': '#FFFFFF',
      'circle-stroke-width': 1,
    },
  },
];
const POPUP_LAYERS = ['lm-station', 'lm-sel-line', 'lm-sel-line-construction', 'lm-line', 'lm-line-construction'];

interface LineData {
  name_ko: string;
  status: string;
  color?: string | null;
}

export function LineMapEditor({
  lineId,
  onLineChange,
}: {
  lineId: string | null;
  onLineChange: (id: string | null) => void;
}) {
  const { container, map } = useMapLibre();
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ tone: 'good' | 'warn'; text: string } | null>(null);
  const markers = useRef<Marker[]>([]);

  const stations = useQuery({
    queryKey: ['map', 'current-stations'],
    queryFn: () => apiOptional<FeatureCollection>('/v1/admin/map/current-stations'),
  });
  const lines = useQuery({
    queryKey: ['map', 'current-lines'],
    queryFn: () => apiOptional<FeatureCollection>('/v1/admin/map/current-lines'),
  });
  const entity = useQuery({
    queryKey: ['entity', 'line', lineId],
    enabled: !!lineId,
    queryFn: () => api<EntityResponse<LineData>>(`/v1/admin/line/${encodeURIComponent(lineId!)}`),
  });
  const review = useReviewList('line');
  const lineReview = lineId ? review.data?.items.find((it) => it.id === lineId) : undefined;
  const ls = useLineStations(lineId);
  const { rows, setRows } = ls;

  // 노선이 바뀌면 추가 모드·안내를 끈다
  useEffect(() => {
    setAdding(false);
    setMessage(null);
  }, [lineId]);

  /** 역 id → 지도 좌표·이름(mv_map_station) */
  const stationInfo = useMemo(() => {
    const m = new Map<string, { coord: Coord; name: string | null }>();
    for (const f of stations.data?.features ?? []) {
      const id = f.properties?.station_id;
      const c = (f.geometry as { coordinates?: number[] } | null)?.coordinates;
      if (typeof id === 'string' && c && c.length >= 2)
        m.set(id, { coord: [c[0]!, c[1]!], name: (f.properties?.name_ko as string | null) ?? null });
    }
    return m;
  }, [stations.data]);
  /** 지도 역 점(여객역) → 없으면 역 자체 좌표(화물역·신호장·조차장은 지도 역 점에 없다) */
  const coordOf = (r: LsRow): Coord | null =>
    stationInfo.get(r.station_id)?.coord ?? (r.station_geom ? [r.station_geom.lng, r.station_geom.lat] : null);

  const selFc = useMemo<FeatureCollection>(
    () =>
      lineId && lines.data
        ? { type: 'FeatureCollection', features: lines.data.features.filter((f) => f.properties?.line_id === lineId) }
        : EMPTY_FC,
    [lines.data, lineId],
  );
  const color =
    entity.data?.data.color ?? (selFc.features[0]?.properties?.color as string | null | undefined) ?? DEFAULT_COLOR;

  const pathFc = useMemo<FeatureCollection>(() => {
    const groups = new Map<string, Coord[]>();
    for (const r of rows) {
      const c = coordOf(r);
      if (!c) continue;
      const k = r.branch ?? '';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(c);
    }
    return {
      type: 'FeatureCollection',
      features: [...groups.values()]
        .filter((g) => g.length >= 2)
        .map((g) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: g }, properties: { color } })),
    };
  }, [rows, stationInfo, color]);

  useGeoJsonLayer(map, 'lm-lines', lines.data, BG_LAYERS);
  useGeoJsonLayer(map, 'lm-sel', selFc, SEL_LAYERS);
  useGeoJsonLayer(map, 'lm-path', pathFc, PATH_LAYERS);
  useGeoJsonLayer(map, 'lm-stations', stations.data, STATION_LAYERS);

  // 추가 모드가 아닐 때만 역·노선 정보 팝업
  useFeaturePopup(map, POPUP_LAYERS, !adding);

  // 노선을 고르면(데이터가 다 오면 한 번) 그 노선 범위로
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!map || !lineId || fitted.current === lineId || !ls.query.data || !stations.data) return;
    const pts = ls.original.map(coordOf).filter((c): c is Coord => !!c);
    const b = boundsOf({
      type: 'FeatureCollection',
      features: [
        ...selFc.features,
        ...(pts.length
          ? [{ type: 'Feature' as const, geometry: { type: 'MultiPoint', coordinates: pts }, properties: {} }]
          : []),
      ],
    });
    fitted.current = lineId;
    if (b) map.fitBounds(b, { padding: 80, maxZoom: 13, duration: 0 });
  }, [map, lineId, ls.query.data, stations.data, selFc]);

  // 순서 번호 표식(클릭은 지도로 통과)
  const markerKey = JSON.stringify(rows.map((r) => [r.station_id, coordOf(r)])) + color;
  useEffect(() => {
    for (const m of markers.current) m.remove();
    markers.current = [];
    if (!map) return;
    rows.forEach((r, i) => {
      const c = coordOf(r);
      if (!c) return;
      const el = document.createElement('div');
      el.className =
        'pointer-events-none flex size-5 items-center justify-center rounded-full border-2 bg-white text-[10px] font-bold text-black shadow';
      el.style.borderColor = color;
      el.textContent = String(i + 1);
      el.dataset.testid = 'lm-marker';
      el.title = r.station_name_ko ?? r.station_id;
      markers.current.push(new Marker({ element: el }).setLngLat(c).addTo(map));
    });
  }, [map, markerKey]);
  useEffect(
    () => () => {
      for (const m of markers.current) m.remove();
    },
    [],
  );

  // 지도에서 역 추가: 역 점 클릭 → 넣을 자리 계산
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const infoRef = useRef(stationInfo);
  infoRef.current = stationInfo;
  useEffect(() => {
    if (!map || !adding) return;
    map.getCanvas().style.cursor = 'crosshair';
    const onClick = (e: MapLayerMouseEvent) => {
      const p = e.features?.[0]?.properties as { station_id?: string; name_ko?: string } | undefined;
      const id = p?.station_id;
      if (!id) return;
      const name = p.name_ko ?? id;
      const cur = rowsRef.current;
      const at = cur.findIndex((r) => r.station_id === id);
      if (at >= 0) {
        setMessage({ tone: 'warn', text: `${name}(${id}): 이미 이 노선의 ${at + 1}번째 역입니다` });
        return;
      }
      const info = infoRef.current;
      const idx = bestInsertIndex(
        cur.map((r) => info.get(r.station_id)?.coord ?? null),
        info.get(id)?.coord ?? null,
      );
      const status = cur[idx - 1]?.status ?? cur[idx]?.status ?? 'operating';
      const row = { ...newLineStationRow(id, status), station_name_ko: p.name_ko ?? null };
      setRows([...cur.slice(0, idx), row, ...cur.slice(idx)]);
      setMessage({ tone: 'good', text: `${name}(${id}) → ${idx + 1}번째에 넣었습니다` });
    };
    map.on('click', 'lm-station', onClick);
    return () => {
      map.off('click', 'lm-station', onClick);
      map.getCanvas().style.cursor = '';
    };
  }, [map, adding]);

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setRows(next);
  };
  const regress = kmRegressions(rows);
  const line = entity.data?.data;

  return (
    <div className="absolute inset-0 flex">
      <aside className="flex w-96 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-bg-elevated p-3 text-sm">
        <div className={cn('flex min-h-0 flex-col', lineId ? 'h-64 shrink-0' : 'flex-1')}>
          <Label>노선</Label>
          <ReviewPicker
            type="line"
            selectedId={lineId}
            className="min-h-0 flex-1"
            onSelect={(it) => onLineChange(it.id)}
          />
        </div>
        {lineId && line ? (
          <Card className="p-3" data-testid="lm-line-summary">
            <div className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-4 rounded" style={{ background: color }} />
              <strong>{line.name_ko}</strong>
              <Badge>{isCode('status', line.status) ? codeLabel('status', line.status) : line.status}</Badge>
              {lineReview ? <ReviewTag issues={lineReview.issues} className="ml-auto" /> : null}
            </div>
            <div className="mt-0.5 text-[11px] text-fg-muted">{lineId}</div>
            {lineReview ? <ReviewIssues issues={lineReview.issues} /> : null}
            <div className="mt-2 flex flex-col gap-0.5 text-xs">
              <Link to="/data/$type/$id" params={{ type: 'line', id: lineId }} search={{}}>
                노선 상세 편집 →
              </Link>
              <Link to="/map" search={{ tool: 'osm', line: lineId } as never}>
                선형(OSM 배정) 점검 →
              </Link>
            </div>
          </Card>
        ) : null}
        {entity.error ? <p className="text-xs text-danger">{errorText(entity.error)}</p> : null}

        {lineId ? (
          ls.query.isLoading ? (
            <Empty>불러오는 중…</Empty>
          ) : ls.query.error ? (
            <Empty>{errorText(ls.query.error)}</Empty>
          ) : (
            <Card className="flex flex-col" data-testid="lm-stations">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <strong className="text-xs" data-testid="lm-stations-title">
                  역 순서 · {rows.length}개 역
                </strong>
                {ls.dirty ? (
                  <Badge tone="warn" data-testid="lm-dirty">
                    저장 안 됨
                  </Badge>
                ) : null}
                <div className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" size="sm" disabled={!ls.dirty} onClick={ls.reset}>
                    <RotateCcw className="size-3.5" /> 되돌리기
                  </Button>
                  <Button size="sm" disabled={!ls.dirty || ls.save.isPending} onClick={() => ls.save.mutate()}>
                    {ls.save.isPending ? '저장 중…' : '역 순서 저장'}
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1 border-b border-border px-3 py-2">
                <Button
                  size="sm"
                  variant={adding ? 'default' : 'outline'}
                  aria-pressed={adding}
                  onClick={() => {
                    setAdding((v) => !v);
                    setMessage(null);
                  }}
                >
                  <MapPin className="size-3.5" /> {adding ? '지도에서 역 추가 중 — 끄기' : '지도에서 역 추가'}
                </Button>
                {adding ? (
                  <p className="text-[11px] text-fg-muted">
                    역 점을 클릭하면 이웃 역 사이 경로가 가장 적게 늘어나는 자리에 넣습니다(좌표 없으면 끝). 정보 팝업은
                    꺼집니다.
                  </p>
                ) : null}
                {message ? (
                  <p
                    className={cn('text-xs', message.tone === 'warn' ? 'text-warn' : 'text-good')}
                    data-testid="lm-add-message"
                    role="status"
                  >
                    {message.text}
                  </p>
                ) : null}
              </div>
              {regress.size ? (
                <p className="flex items-center gap-1 border-b border-border bg-warn/10 px-3 py-1.5 text-xs text-warn">
                  <AlertTriangle className="size-3.5" /> km 역행 {regress.size}곳 — 순서나 km 를 확인하세요(V-S04)
                </p>
              ) : null}
              {ls.serverErrors.length ? (
                <ul className="border-b border-border bg-danger/10 px-3 py-1.5 text-xs text-danger" role="alert">
                  {ls.serverErrors.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              ) : null}
              {rows.length === 0 ? (
                <Empty>노선별 역이 없습니다. [지도에서 역 추가]로 넣으세요.</Empty>
              ) : (
                <ol className="flex flex-col">
                  {rows.map((r, i) => (
                    <li
                      key={r._key}
                      data-testid="lm-row"
                      className={cn('border-t border-border px-2 py-1 first:border-t-0', !r.id && 'bg-good/5')}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold"
                          style={{ borderColor: color }}
                        >
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <Link
                              to="/data/$type/$id"
                              params={{ type: 'station', id: r.station_id }}
                              search={{}}
                              className="truncate font-medium"
                              title={r.station_id}
                              data-testid="lm-station-name"
                            >
                              {r.station_name_ko ?? <StationName id={r.station_id} />}
                            </Link>
                            {!r.id ? <Badge tone="good">새 행</Badge> : null}
                            {r.branch ? <Badge>지선 {r.branch}</Badge> : null}
                            {r.station_kind && r.station_kind !== 'station' && isCode('stationKind', r.station_kind) ? (
                              <Badge>{codeLabel('stationKind', r.station_kind)}</Badge>
                            ) : null}
                            {!coordOf(r) ? (
                              <span
                                className="text-[10px] text-warn"
                                title="역에 좌표가 없습니다 — 지도 편집에서 좌표를 찍을 수 있습니다"
                              >
                                좌표 없음
                              </span>
                            ) : null}
                            {regress.has(i) ? (
                              <span title="km 역행" className="text-warn">
                                <AlertTriangle className="size-3" />
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[10px] text-fg-muted">
                            {r.station_id} · {isCode('status', r.status) ? codeLabel('status', r.status) : r.status}
                          </div>
                        </div>
                        <Input
                          className={cn('h-7 w-16 px-1 text-xs', regress.has(i) && 'border-warn')}
                          aria-label="km"
                          type="number"
                          step="any"
                          placeholder="km"
                          value={r.km ?? ''}
                          onChange={(e) =>
                            setRows(
                              rows.map((x) =>
                                x._key === r._key
                                  ? { ...x, km: e.target.value === '' ? null : Number(e.target.value) }
                                  : x,
                              ),
                            )
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="위로"
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                        >
                          <ArrowUp className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="아래로"
                          disabled={i === rows.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          <ArrowDown className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="행 삭제"
                          onClick={() => setRows(rows.filter((x) => x._key !== r._key))}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                      {ls.rowErrors[i] ? <div className="pl-6 text-[11px] text-danger">{ls.rowErrors[i]}</div> : null}
                    </li>
                  ))}
                </ol>
              )}
              <p className="border-t border-border px-3 py-1.5 text-[11px] text-fg-muted">
                지선·역번호·노선별 상태·개통일 등 나머지 칸은{' '}
                <Link to="/data/$type/$id" params={{ type: 'line', id: lineId }} search={{ tab: 'stations' } as never}>
                  노선 상세 [역 순서] 탭
                </Link>
                에서 고칩니다.
              </p>
            </Card>
          )
        ) : null}

        <section className="mt-auto text-[11px] text-fg-muted">
          <ul className="flex flex-col gap-0.5">
            <li className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-4" style={{ background: color }} /> 고른 노선(현재 지도 선형, 파생
              갱신 뒤 반영)
            </li>
            <li className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-4 border-t-2 border-dotted" style={{ borderColor: color }} /> 역
              순서대로 이은 선(편집 중 초안)
            </li>
            <li className="flex items-center gap-1">
              <span className="inline-block size-2 rounded-full bg-[#475569]" /> 역(번호 = 노선별 역 순서)
            </li>
          </ul>
          <p className="mt-1">선형 © OpenStreetMap contributors, ODbL — 참고용</p>
        </section>
      </aside>
      <div className="relative min-w-0 flex-1">
        <div className="absolute inset-0">
          <div ref={container} className="h-full w-full" data-testid="line-map" />
        </div>
        {stations.data === null ? (
          <div className="absolute top-3 left-3 rounded-md border border-border bg-bg-elevated/95 px-3 py-2 text-xs shadow">
            현재 지도 API 가 아직 없습니다.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StationName({ id }: { id: string }) {
  const l = useLabel('station', id);
  return <>{l.data?.label ?? id}</>;
}
