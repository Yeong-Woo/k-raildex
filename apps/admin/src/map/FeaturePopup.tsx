/**
 * 지도 공용 정보 팝업: 역 점·노선(계획) 선을 클릭하면 이름·상태·노선·개통 정보와 편집 링크를 보여 준다.
 * 지도 응답의 속성으로 바로 그리고, 자세한 값은 개체 API 로 채운다(React 트리를 팝업 DOM 에 붙임).
 */
import { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClientProvider, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Popup, type Map as MlMap, type MapLayerMouseEvent } from 'maplibre-gl';
import { codeLabel, formatFuzzy, isCode, type FuzzyDate } from '@k-raildex/contracts';
import { api } from '../lib/api';
import { router } from '../router';

export type PopupTarget =
  | { kind: 'station'; id: string; props: Record<string, unknown> }
  | { kind: 'line'; id: string; props: Record<string, unknown> }
  | { kind: 'plan'; id: string; props: Record<string, unknown> };

/** 지도 피처 속성 → 팝업 대상. 역은 station_id, 계획 선은 plan_id, 노선 선은 line_id */
export function targetOf(props: Record<string, unknown> | null | undefined): PopupTarget | null {
  if (!props) return null;
  const s = (k: string) => (typeof props[k] === 'string' && props[k] ? (props[k] as string) : null);
  if (s('station_id')) return { kind: 'station', id: s('station_id')!, props };
  if (s('plan_id')) return { kind: 'plan', id: s('plan_id')!, props };
  if (s('line_id')) return { kind: 'line', id: s('line_id')!, props };
  return null;
}

const label = (domain: 'status' | 'railClass' | 'lineCategory' | 'planStage' | 'coordSource', v: unknown) =>
  typeof v === 'string' && isCode(domain, v) ? codeLabel(domain, v) : typeof v === 'string' ? v : null;

/** MapLibre 는 배열 속성을 JSON 문자열로 넘길 때가 있다 */
const arr = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.startsWith('[')) {
    try {
      return (JSON.parse(v) as unknown[]).map(String);
    } catch {
      return [];
    }
  }
  return [];
};

function useLineNames() {
  return useQuery({
    queryKey: ['popup', 'line-names'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const r = await api<{ items: { id: string; name_ko: string | null }[] }>('/v1/admin/line?limit=500');
      return new Map(r.items.map((i) => [i.id, i.name_ko ?? i.id]));
    },
  });
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  if (children == null || children === '' || children === false) return null;
  return (
    <div className="flex gap-2">
      <span className="w-14 shrink-0 text-fg-muted">{k}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

function EditLink({ type, id, text }: { type: string; id: string; text: string }) {
  return (
    <a
      href={`/data/${type}/${encodeURIComponent(id)}`}
      className="mt-1 inline-block font-medium text-primary underline"
      onClick={(e) => {
        e.preventDefault();
        void router.navigate({ to: '/data/$type/$id', params: { type, id }, search: {} as never });
      }}
    >
      {text} →
    </a>
  );
}

function StationBody({ id, props }: { id: string; props: Record<string, unknown> }) {
  const names = useLineNames();
  const st = useQuery({
    queryKey: ['popup', 'station', id],
    staleTime: 60_000,
    queryFn: () =>
      api<{
        data: { name_en: string | null; address: string | null; coord_source: string | null; grade: string | null };
        derived: { status?: string; opened?: FuzzyDate | null; closed?: FuzzyDate | null; line_count?: number };
      }>(`/v1/admin/station/${encodeURIComponent(id)}`),
  });
  const lineIds = arr(props.line_ids);
  const status = st.data?.derived.status ?? props.status;
  const coord =
    props.snapped === true || props.snapped === 'true'
      ? '선로 위로 옮긴 근사 위치'
      : props.approximate === true || props.approximate === 'true'
        ? '근사 위치'
        : label('coordSource', st.data?.data.coord_source);
  return (
    <>
      <div className="text-sm font-semibold">
        {String(props.name_ko ?? id)}
        {st.data?.data.name_en ? <span className="ml-1 font-normal text-fg-muted">{st.data.data.name_en}</span> : null}
      </div>
      <Row k="상태">{label('status', status)}</Row>
      <Row k="노선">{lineIds.length ? lineIds.map((l) => names.data?.get(l) ?? l).join(', ') : null}</Row>
      <Row k="개통">{st.data?.derived.opened ? formatFuzzy(st.data.derived.opened) : null}</Row>
      <Row k="폐지">{st.data?.derived.closed ? formatFuzzy(st.data.derived.closed) : null}</Row>
      <Row k="주소">{st.data?.data.address}</Row>
      <Row k="좌표">{coord}</Row>
      <div className="text-[11px] text-fg-muted">{id}</div>
      <EditLink type="station" id={id} text="역 편집" />
    </>
  );
}

function LineBody({ id, props }: { id: string; props: Record<string, unknown> }) {
  const ln = useQuery({
    queryKey: ['popup', 'line', id],
    staleTime: 60_000,
    queryFn: () =>
      api<{
        data: {
          name_en: string | null;
          category: string | null;
          rail_class: string | null;
          status: string | null;
          length_km: number | null;
          opened: FuzzyDate | null;
          color: string | null;
        };
      }>(`/v1/admin/line/${encodeURIComponent(id)}`),
  });
  const d = ln.data?.data;
  const construction = props.is_construction === true || props.is_construction === 'true';
  return (
    <>
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        {d?.color ? <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: d.color }} /> : null}
        {String(props.name_ko ?? id)}
      </div>
      <Row k="상태">
        {label('status', d?.status ?? props.status)}
        {construction ? ' (공사 중 구간)' : ''}
      </Row>
      <Row k="분류">
        {[label('lineCategory', d?.category), label('railClass', d?.rail_class)].filter(Boolean).join(' · ')}
      </Row>
      <Row k="연장">{d?.length_km != null ? `${d.length_km}km` : null}</Row>
      <Row k="개통">{d?.opened ? formatFuzzy(d.opened) : null}</Row>
      <div className="text-[11px] text-fg-muted">{id}</div>
      <EditLink type="line" id={id} text="노선 편집" />
    </>
  );
}

function PlanBody({ id, props }: { id: string; props: Record<string, unknown> }) {
  const target =
    props.target_value != null && props.target_value !== 'null'
      ? formatFuzzy({ value: String(props.target_value), precision: String(props.target_precision) } as FuzzyDate)
      : '미정';
  return (
    <>
      <div className="text-sm font-semibold">{String(props.name_ko ?? id)}</div>
      <Row k="단계">{label('planStage', props.stage)}</Row>
      <Row k="개통 목표">
        {target}
        {props.delayed === true || props.delayed === 'true' ? ' · 지연' : ''}
      </Row>
      <div className="text-[11px] text-fg-muted">{id}</div>
      <EditLink type="plan" id={id} text="계획 편집" />
    </>
  );
}

function PopupBody({ target }: { target: PopupTarget }) {
  return (
    <div className="flex min-w-48 flex-col gap-0.5 text-xs text-fg">
      {target.kind === 'station' ? (
        <StationBody id={target.id} props={target.props} />
      ) : target.kind === 'line' ? (
        <LineBody id={target.id} props={target.props} />
      ) : (
        <PlanBody id={target.id} props={target.props} />
      )}
    </div>
  );
}

let open: { popup: Popup; root: Root } | null = null;

/** 팝업 하나만 연다(이전 것은 닫음) */
export function showFeaturePopup(map: MlMap, qc: QueryClient, lngLat: [number, number], target: PopupTarget) {
  open?.popup.remove();
  const el = document.createElement('div');
  const root = createRoot(el);
  root.render(
    <QueryClientProvider client={qc}>
      <PopupBody target={target} />
    </QueryClientProvider>,
  );
  const popup = new Popup({ closeButton: true, maxWidth: '300px', className: 'kr-popup' })
    .setLngLat(lngLat)
    .setDOMContent(el)
    .addTo(map);
  const entry = { popup, root };
  popup.on('close', () => {
    // 렌더 중 해제 경고를 피하려고 다음 틱에 정리
    setTimeout(() => root.unmount(), 0);
    if (open === entry) open = null;
  });
  open = entry;
}

/**
 * 레이어 클릭 → 정보 팝업. layers 는 앞쪽이 우선(역 레이어를 먼저 두면 역과 선이 겹칠 때 역이 뜬다).
 * enabled=false 면 등록하지 않는다(그리기 모드 등 클릭이 다른 뜻일 때).
 */
export function useFeaturePopup(map: MlMap | null, layers: string[], enabled = true) {
  const qc = useQueryClient();
  const key = layers.join(',');
  useEffect(() => {
    if (!map || !enabled) return;
    const onClick = (e: MapLayerMouseEvent) => {
      const present = layers.filter((l) => map.getLayer(l));
      if (!present.length) return;
      // 클릭 지점 주변 몇 픽셀까지 — 가는 선도 잡히게
      const pad = 4;
      const feats = map.queryRenderedFeatures(
        [
          [e.point.x - pad, e.point.y - pad],
          [e.point.x + pad, e.point.y + pad],
        ],
        { layers: present },
      );
      let picked: PopupTarget | null = null;
      for (const l of present) {
        const f = feats.find((x) => x.layer.id === l);
        picked = targetOf(f?.properties);
        if (picked) break;
      }
      if (picked) showFeaturePopup(map, qc, [e.lngLat.lng, e.lngLat.lat], picked);
    };
    const enter = () => (map.getCanvas().style.cursor = 'pointer');
    const leave = () => (map.getCanvas().style.cursor = '');
    map.on('click', onClick);
    for (const l of layers) {
      map.on('mouseenter', l, enter);
      map.on('mouseleave', l, leave);
    }
    return () => {
      map.off('click', onClick);
      for (const l of layers) {
        map.off('mouseenter', l, enter);
        map.off('mouseleave', l, leave);
      }
      open?.popup.remove();
    };
    // layers 는 key 로 비교
  }, [map, qc, key, enabled]);
}
