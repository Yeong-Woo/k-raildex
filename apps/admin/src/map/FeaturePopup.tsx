/**
 * 지도 공용 정보 팝업: 역 점·노선(계획) 선을 클릭하면 이름·상태·노선·개통 정보와 편집 링크를 보여 준다.
 * 지도 응답의 속성으로 바로 그리고, 자세한 값은 개체 API 로 채운다(React 트리를 팝업 DOM 에 붙임).
 * 고른 노선·계획 선·역은 지도에서 강조하고, 클릭 지점에 노선이 여러 개 겹치면(예: 동탄역 GTX-A·수서평택고속선) 먼저 고르게 한다.
 */
import { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClientProvider, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Popup, type Map as MlMap, type MapLayerMouseEvent } from 'maplibre-gl';
import { codeLabel, formatFuzzy, isCode, type FuzzyDate } from '@k-raildex/contracts';
import { STAGE_FALLBACK_COLOR } from '@k-raildex/map';
import { api } from '../lib/api';
import { router } from '../router';
import { keyOf, pickTargets, targetOf, type PopupTarget } from './targets';

export { pickTargets, targetOf, type PopupTarget };

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

type Pick = (t: PopupTarget) => void;

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

function StationBody({ id, props, onPick }: { id: string; props: Record<string, unknown>; onPick: Pick }) {
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
      <Row k="노선">
        {lineIds.length
          ? lineIds.map((l, i) => (
              <span key={l}>
                {i ? ', ' : ''}
                <button
                  type="button"
                  className="text-primary underline decoration-dotted hover:decoration-solid"
                  title="이 노선을 지도에서 강조"
                  onClick={() => onPick({ kind: 'line', id: l, props: { name_ko: names.data?.get(l) ?? l } })}
                >
                  {names.data?.get(l) ?? l}
                </button>
              </span>
            ))
          : null}
      </Row>
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

const KIND_LABEL: Record<PopupTarget['kind'], string> = { station: '역 그룹', line: '노선', plan: '계획' };
/** 지도와 같은 색: 노선색 → 없으면 지도 기본색 */
const swatchOf = (t: PopupTarget) =>
  typeof t.props.color === 'string' && t.props.color ? t.props.color : STAGE_FALLBACK_COLOR;

/** 겹친 대상 고르기 */
function Chooser({
  items,
  onPick,
  onHover,
}: {
  items: PopupTarget[];
  onPick: Pick;
  onHover: (t: PopupTarget | null) => void;
}) {
  return (
    <>
      <div className="text-sm font-semibold">이 지점의 노선 {items.length}개</div>
      <div className="text-[11px] text-fg-muted">하나를 고르세요</div>
      <ul className="mt-1 flex flex-col" onMouseLeave={() => onHover(null)}>
        {items.map((t) => (
          <li key={keyOf(t)}>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-muted focus-visible:bg-muted"
              onMouseEnter={() => onHover(t)}
              onFocus={() => onHover(t)}
              onClick={() => onPick(t)}
            >
              <span
                className="inline-block h-2.5 w-4 shrink-0 rounded-sm border border-border"
                style={{ background: swatchOf(t) }}
              />
              <span className="min-w-0 flex-1 truncate">{String(t.props.name_ko ?? t.id)}</span>
              <span className="shrink-0 text-[11px] text-fg-muted">{KIND_LABEL[t.kind]}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function PopupBody({
  candidates,
  onSelect,
}: {
  candidates: PopupTarget[];
  onSelect: (t: PopupTarget | null, preview?: boolean) => void;
}) {
  const [cur, setCur] = useState<PopupTarget | null>(candidates.length === 1 ? candidates[0]! : null);
  const [fromList, setFromList] = useState(false);
  useEffect(() => {
    onSelect(cur);
    // onSelect 는 팝업마다 고정
  }, [cur]);
  const pick: Pick = (t) => {
    setFromList(true);
    setCur(t);
  };
  return (
    <div className="flex min-w-48 flex-col gap-0.5 text-xs text-fg">
      {cur && fromList ? (
        <button
          type="button"
          className="mb-0.5 self-start text-[11px] text-fg-muted hover:text-fg"
          onClick={() => {
            setFromList(false);
            setCur(candidates.length === 1 ? candidates[0]! : null);
          }}
        >
          ← {candidates.length > 1 ? '목록으로' : '처음으로'}
        </button>
      ) : null}
      {!cur ? (
        <Chooser items={candidates} onPick={pick} onHover={(t) => onSelect(t ?? null, true)} />
      ) : cur.kind === 'station' ? (
        <StationBody key={keyOf(cur)} id={cur.id} props={cur.props} onPick={pick} />
      ) : cur.kind === 'line' ? (
        <LineBody key={keyOf(cur)} id={cur.id} props={cur.props} />
      ) : (
        <PlanBody key={keyOf(cur)} id={cur.id} props={cur.props} />
      )}
    </div>
  );
}

/** CSS 토큰(oklch 등) → MapLibre 가 읽는 rgb 문자열 */
function tokenColor(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!v) return fallback;
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d');
    if (!ctx) return fallback;
    ctx.fillStyle = fallback;
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return fallback;
  }
}

const HL_PREFIX = 'kr-hl-';
const PROP_OF: Record<PopupTarget['kind'], string> = { station: 'station_id', line: 'line_id', plan: 'plan_id' };

/** 고른 대상 강조: 선은 테두리(halo)+본래 색 다시 그리기, 역은 고리. 선 강조는 역 레이어 아래에 둔다 */
function highlight(map: MlMap, layers: string[], t: PopupTarget | null, preview = false) {
  const style = map.getStyle();
  for (const l of style?.layers ?? []) if (l.id.startsWith(HL_PREFIX)) map.removeLayer(l.id);
  if (!t) return;
  const focus = tokenColor('--kr-focus', '#E8912D');
  const match = ['==', ['get', PROP_OF[t.kind]], t.id];
  const present = layers.map((id) => map.getLayer(id)).filter((l): l is NonNullable<typeof l> => !!l);
  const firstCircle = present.find((l) => l.type === 'circle')?.id;
  for (const l of present) {
    const base = {
      source: l.source,
      ...(l.sourceLayer ? { 'source-layer': l.sourceLayer } : {}),
    };
    const orig = map.getFilter(l.id);
    const filter = (orig ? ['all', orig, match] : match) as never;
    if (l.type === 'line' && t.kind !== 'station') {
      map.addLayer(
        {
          id: `${HL_PREFIX}${l.id}-halo`,
          type: 'line',
          ...base,
          filter,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': focus, 'line-width': preview ? 8 : 10, 'line-opacity': preview ? 0.45 : 0.7 },
        } as never,
        firstCircle,
      );
      const dash = map.getPaintProperty(l.id, 'line-dasharray');
      map.addLayer(
        {
          id: `${HL_PREFIX}${l.id}-line`,
          type: 'line',
          ...base,
          filter,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': map.getPaintProperty(l.id, 'line-color') ?? '#555',
            'line-width': 4.5,
            ...(dash ? { 'line-dasharray': dash } : {}),
          },
        } as never,
        firstCircle,
      );
    } else if (l.type === 'circle' && t.kind === 'station') {
      map.addLayer({
        id: `${HL_PREFIX}${l.id}-ring`,
        type: 'circle',
        ...base,
        filter,
        paint: {
          'circle-radius': 9,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': focus,
          'circle-stroke-width': 3,
        },
      } as never);
    }
  }
}

let open: { popup: Popup; root: Root } | null = null;

/** 팝업 하나만 연다(이전 것은 닫음). candidates 가 여러 개면 고르기 목록부터 */
export function showFeaturePopup(
  map: MlMap,
  qc: QueryClient,
  lngLat: [number, number],
  candidates: PopupTarget[],
  layers: string[] = [],
) {
  if (!candidates.length) return;
  open?.popup.remove();
  const el = document.createElement('div');
  const root = createRoot(el);
  let selected: PopupTarget | null = null;
  const onSelect = (t: PopupTarget | null, preview = false) => {
    if (!preview) selected = t;
    // 미리 보기를 벗어나면 고른 것(없으면 없음)으로 되돌린다
    highlight(map, layers, preview ? (t ?? selected) : t, preview && !!t);
  };
  root.render(
    <QueryClientProvider client={qc}>
      <PopupBody candidates={candidates} onSelect={onSelect} />
    </QueryClientProvider>,
  );
  const popup = new Popup({ closeButton: true, maxWidth: '300px', className: 'kr-popup' })
    .setLngLat(lngLat)
    .setDOMContent(el)
    .addTo(map);
  const entry = { popup, root };
  popup.on('close', () => {
    if (map.getStyle()) highlight(map, layers, null);
    // 렌더 중 해제 경고를 피하려고 다음 틱에 정리
    setTimeout(() => root.unmount(), 0);
    if (open === entry) open = null;
  });
  open = entry;
}

/**
 * 레이어 클릭 → 정보 팝업 + 강조. enabled=false 면 등록하지 않는다(그리기 모드 등 클릭이 다른 뜻일 때).
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
      const pad = 5;
      const feats = map.queryRenderedFeatures(
        [
          [e.point.x - pad, e.point.y - pad],
          [e.point.x + pad, e.point.y + pad],
        ],
        { layers: present },
      );
      const picked = pickTargets(feats, present);
      if (picked.length) showFeaturePopup(map, qc, [e.lngLat.lng, e.lngLat.lat], picked, present);
      else open?.popup.remove();
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
