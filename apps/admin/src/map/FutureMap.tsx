/**
 * 미래 지도(FR-ADM-075): 연도 슬라이더·단계 필터·목표 미정 포함 — 공개 사이트와 같은 규칙(03 문서 6-1절).
 * 선 모양 = 단계(line_style), 색 = color(NULL 이면 단계 대표색). 클릭한 계획의 데이터 누락을 바로 표시하고 편집 화면으로.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import type { MapLayerMouseEvent } from 'maplibre-gl';
import { codeLabel, formatFuzzy, isCode, type FuzzyDate } from '@k-raildex/contracts';
import {
  DISCLAIMER,
  futureLineLayers,
  futureStationLayers,
  GEOMETRY_QUALITY_LABELS,
  LINE_STYLES,
  STAGE_COLORS,
  STAGE_ORDER,
  svgDash,
  type LineStyle,
} from '@k-raildex/map';
import { Badge, Card, cn, Select } from '@k-raildex/ui';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { apiOptional, qs } from '../lib/api';
import { boundsOf, useGeoJsonLayer, useMapLibre, type FeatureCollection } from './useMap';
import { useFeaturePopup } from './FeaturePopup';

interface LineProps {
  feature_id: string;
  line_id: string | null;
  plan_id: string | null;
  name_ko: string;
  status: string | null;
  stage: string | null;
  line_style: LineStyle;
  color: string | null;
  color_basis: string | null;
  quality: string | null;
  odbl: boolean;
  delayed: boolean;
  target_value: string | null;
  target_precision: string | null;
}

const NOW = new Date().getFullYear();
const LINE_LAYER_IDS = (Object.keys(LINE_STYLES) as LineStyle[]).map((s) => `future-line-${s}`);

/** 단계 필터(FR-WEB-022·Q88). 기본 = 기본계획 이상(API 기본값과 같음) */
const STAGE_FILTERS = [
  { value: 'basic_plan', label: '기본계획 이상' },
  { value: 'feasibility', label: '예비타당성조사 이상' },
  { value: 'concept', label: '전체 단계' },
  { value: 'construction', label: '착공 이상' },
];

const stageLabel = (s: string | null) => (s && isCode('planStage', s) ? codeLabel('planStage', s) : (s ?? '미상'));
const targetText = (p: Pick<LineProps, 'target_value' | 'target_precision'>) =>
  p.target_precision
    ? formatFuzzy({ value: p.target_value, precision: p.target_precision } as FuzzyDate)
    : '미정(기대 일정 없음)';

/** 계획 데이터 누락(FR-ADM-075) */
function gaps(p: LineProps): string[] {
  const out: string[] = [];
  if (p.plan_id && !p.target_precision) out.push('기대 일정 없음');
  if (p.quality === 'schematic') out.push('선형 schematic 뿐(개략)');
  if (p.plan_id && !p.line_id && p.quality === 'station_sequence') out.push('선형 없음 — 역 순서로 연결');
  if (p.delayed) out.push('개통 목표가 지났지만 미개통(지연)');
  return out;
}

export function FutureMap() {
  const search = useSearch({ from: '/map' });
  const navigate = useNavigate({ from: '/map' });
  const router = useRouter();
  const { container, map } = useMapLibre();
  const stageMin = search.stage_min ?? 'basic_plan';
  const timeline = useQuery({
    queryKey: ['map', 'timeline', stageMin],
    queryFn: () =>
      apiOptional<{ years: { year: number; count: number }[]; undated: number }>(
        `/v1/admin/map/timeline${qs({ stage_min: stageMin })}`,
      ),
    placeholderData: (prev) => prev,
  });
  const years = useMemo(() => {
    const ys = (timeline.data?.years ?? []).map((y) => y.year).filter((y) => y >= NOW);
    const max = Math.max(NOW + 10, ...ys);
    return Array.from({ length: max - NOW + 1 }, (_, i) => NOW + i);
  }, [timeline.data]);
  const at = search.at ?? String(NOW);
  const undated = search.undated ?? false;
  const slider = at === 'future' ? years.length : Math.max(0, years.indexOf(Number(at)));
  const setSearch = (p: Partial<typeof search>) =>
    void navigate({ search: (s) => ({ ...s, tab: 'future', ...p }), replace: true });

  const params = qs({ at, stage_min: stageMin, include_undated: undated || at === 'future' });
  const lines = useQuery({
    queryKey: ['map', 'lines', params],
    queryFn: () => apiOptional<FeatureCollection>(`/v1/admin/map/lines${params}`),
    placeholderData: (prev) => prev,
  });
  const stations = useQuery({
    queryKey: ['map', 'stations', params],
    queryFn: () => apiOptional<FeatureCollection>(`/v1/admin/map/stations${params}`),
    placeholderData: (prev) => prev,
  });

  useGeoJsonLayer(map, 'future-lines', lines.data, futureLineLayers('future-lines'));
  useGeoJsonLayer(map, 'future-stations', stations.data, futureStationLayers('future-stations'));
  const [selected, setSelected] = useState<LineProps | null>(null);

  // 처음 데이터가 오면 범위에 맞춘다
  const [fitted, setFitted] = useState(false);
  useEffect(() => {
    if (!map || fitted || !lines.data?.features.length) return;
    const b = boundsOf(lines.data);
    if (b) map.fitBounds(b, { padding: 60, maxZoom: 12, duration: 0 });
    setFitted(true);
  }, [map, lines.data, fitted]);

  // 역·선 클릭 → 공용 정보 팝업, 선 클릭은 옆 패널 선택도
  useFeaturePopup(map, ['future-station', ...LINE_LAYER_IDS]);
  // 선 클릭 → 옆 패널
  useEffect(() => {
    if (!map) return;
    const onClick = (e: MapLayerMouseEvent) => {
      const p = e.features?.[0]?.properties as LineProps | undefined;
      if (!p) return;
      const props = { ...p, odbl: String(p.odbl) === 'true', delayed: String(p.delayed) === 'true' } as LineProps;
      setSelected(props);
    };
    const enter = () => (map.getCanvas().style.cursor = 'pointer');
    const leave = () => (map.getCanvas().style.cursor = '');
    for (const id of LINE_LAYER_IDS) {
      map.on('click', id, onClick);
      map.on('mouseenter', id, enter);
      map.on('mouseleave', id, leave);
    }
    return () => {
      for (const id of LINE_LAYER_IDS) {
        map.off('click', id, onClick);
        map.off('mouseenter', id, enter);
        map.off('mouseleave', id, leave);
      }
    };
  }, [map, router]);

  const features = (lines.data?.features ?? []).map((f) => f.properties as unknown as LineProps);
  const plans = new Map<string, LineProps>();
  for (const p of features) if (p.plan_id && !plans.has(p.plan_id)) plans.set(p.plan_id, p);
  const odbl = features.some((p) => String(p.odbl) === 'true');
  const apiMissing = lines.data === null;

  return (
    <div className="absolute inset-0 flex">
      <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-bg-elevated p-3 text-sm">
        <section>
          <div className="mb-1 flex items-baseline justify-between">
            <label htmlFor="future-year" className="text-xs font-semibold text-fg-muted">
              연도
            </label>
            <strong data-testid="future-at">{at === 'future' ? '목표 미정 포함(전체)' : `${at}년`}</strong>
          </div>
          <input
            id="future-year"
            type="range"
            className="w-full accent-[var(--color-primary)]"
            min={0}
            max={years.length}
            value={slider}
            onChange={(e) => {
              const i = Number(e.target.value);
              setSearch({ at: i >= years.length ? 'future' : String(years[i]) });
            }}
          />
          <div className="flex justify-between text-[11px] text-fg-muted">
            <span>{NOW}</span>
            <span>{years.at(-1)}</span>
            <span>목표 미정</span>
          </div>
          {timeline.data ? (
            <TimelineBars years={years} data={timeline.data} at={at} />
          ) : timeline.data === null ? (
            <p className="mt-1 text-[11px] text-fg-muted">연도별 건수 API 가 아직 없습니다.</p>
          ) : null}
        </section>
        <section className="flex flex-col gap-2">
          <Select
            aria-label="단계 필터"
            value={stageMin}
            onChange={(e) => setSearch({ stage_min: e.target.value === 'basic_plan' ? undefined : e.target.value })}
          >
            {STAGE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={undated || at === 'future'}
              disabled={at === 'future'}
              onChange={(e) => setSearch({ undated: e.target.checked || undefined })}
            />
            개통 목표 미정 계획도 표시
          </label>
        </section>
        {selected ? <SelectedPanel p={selected} onClose={() => setSelected(null)} /> : null}
        <section>
          <h2 className="mb-1 text-xs font-semibold text-fg-muted">
            표시 중인 계획 {plans.size}건 · 선 {features.length}개
          </h2>
          <ul className="flex flex-col" data-testid="future-plans">
            {[...plans.values()].map((p) => (
              <li key={p.plan_id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-muted"
                  onClick={() => setSelected(p)}
                >
                  <span
                    className="inline-block h-1 w-5 shrink-0 rounded"
                    style={{ background: p.color ?? STAGE_COLORS[p.stage ?? ''] ?? '#64748B' }}
                  />
                  <span className="min-w-0 flex-1 truncate">{p.name_ko}</span>
                  {String(p.delayed) === 'true' ? <Badge tone="danger">지연</Badge> : null}
                  {gaps(p).length ? (
                    <AlertTriangle className="size-3.5 shrink-0 text-warn" aria-label="데이터 누락" />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <Legend odbl={odbl} />
      </aside>
      <div className="relative min-w-0 flex-1">
        <div className="absolute inset-0">
          <div ref={container} className="h-full w-full" data-testid="future-map" />
        </div>
        {apiMissing ? (
          <div className="absolute top-3 left-3 rounded-md border border-border bg-bg-elevated/95 px-3 py-2 text-xs shadow">
            미래 지도 API(/v1/admin/map/lines)가 아직 없어 배경 지도만 표시합니다.
          </div>
        ) : null}
        <p className="absolute right-2 bottom-8 max-w-md rounded bg-bg-elevated/90 px-2 py-1 text-[11px] text-fg-muted shadow">
          {DISCLAIMER}
        </p>
      </div>
    </div>
  );
}

function TimelineBars({
  years,
  data,
  at,
}: {
  years: number[];
  data: { years: { year: number; count: number }[]; undated: number };
  at: string;
}) {
  const counts = new Map(data.years.map((y) => [y.year, y.count]));
  const max = Math.max(1, data.undated, ...data.years.map((y) => y.count));
  const cols = [...years.map((y) => ({ k: String(y), n: counts.get(y) ?? 0 })), { k: 'future', n: data.undated }];
  return (
    <div className="mt-1 flex h-8 items-end gap-px" aria-label="연도별 개통 예정 건수">
      {cols.map((c) => (
        <div
          key={c.k}
          title={`${c.k === 'future' ? '목표 미정' : `${c.k}년`}: ${c.n}건`}
          className={cn(
            'flex-1 rounded-t-sm',
            c.k === at ? 'bg-primary' : c.k === 'future' ? 'bg-fg-muted/40' : 'bg-primary/30',
          )}
          style={{ height: `${Math.max(c.n ? 12 : 3, (c.n / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function SelectedPanel({ p, onClose }: { p: LineProps; onClose: () => void }) {
  const g = gaps(p);
  return (
    <Card className="p-3" data-testid="future-selected">
      <div className="flex items-center gap-2">
        <strong className="min-w-0 flex-1 truncate">{p.name_ko}</strong>
        <button className="text-xs text-fg-muted hover:text-fg" onClick={onClose}>
          닫기
        </button>
      </div>
      <dl className="mt-1 grid grid-cols-[4.5rem_1fr] gap-y-0.5 text-xs">
        <dt className="text-fg-muted">단계</dt>
        <dd>{stageLabel(p.stage)}</dd>
        <dt className="text-fg-muted">개통 예정</dt>
        <dd>
          {targetText(p)} {String(p.delayed) === 'true' ? <Badge tone="danger">지연</Badge> : null}
        </dd>
        <dt className="text-fg-muted">선형</dt>
        <dd>{p.quality ? (GEOMETRY_QUALITY_LABELS[p.quality] ?? p.quality) : '-'}</dd>
        <dt className="text-fg-muted">색</dt>
        <dd>{p.color ? `${p.color}${p.color_basis ? ` (${p.color_basis})` : ''}` : '단계 대표색'}</dd>
      </dl>
      {g.length ? (
        <ul className="mt-2 rounded bg-warn/10 px-2 py-1 text-xs text-warn">
          {g.map((x) => (
            <li key={x}>· {x}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex gap-3 text-xs">
        {p.plan_id ? (
          <Link
            to="/data/$type/$id"
            params={{ type: 'plan', id: p.plan_id }}
            search={{}}
            className="inline-flex items-center gap-1 underline"
          >
            계획 편집 <ExternalLink className="size-3" />
          </Link>
        ) : null}
        {p.line_id ? (
          <Link
            to="/data/$type/$id"
            params={{ type: 'line', id: p.line_id }}
            search={{}}
            className="inline-flex items-center gap-1 underline"
          >
            노선 편집 <ExternalLink className="size-3" />
          </Link>
        ) : null}
      </div>
    </Card>
  );
}

function Legend({ odbl }: { odbl: boolean }) {
  return (
    <section className="mt-auto text-[11px] text-fg-muted" data-testid="future-legend">
      <div className="mb-1 font-semibold">범례</div>
      <ul className="flex flex-col gap-0.5">
        {(Object.keys(LINE_STYLES) as LineStyle[]).map((s) => (
          <li key={s} className="flex items-center gap-2">
            <svg width="32" height="8" aria-hidden>
              <line
                x1="0"
                y1="4"
                x2="32"
                y2="4"
                stroke="currentColor"
                strokeWidth={LINE_STYLES[s].width}
                strokeDasharray={svgDash(s)}
              />
            </svg>
            {LINE_STYLES[s].label}
          </li>
        ))}
        <li className="flex items-center gap-2">
          <svg width="32" height="8" aria-hidden>
            <line
              x1="0"
              y1="4"
              x2="32"
              y2="4"
              stroke="currentColor"
              strokeOpacity={0.6}
              strokeWidth={2}
              strokeDasharray="3 3"
            />
          </svg>
          {GEOMETRY_QUALITY_LABELS.schematic}
        </li>
      </ul>
      <div className="mt-1 grid grid-cols-3 gap-x-1 gap-y-0.5">
        {STAGE_ORDER.map((s) => (
          <span key={s} className="flex items-center gap-1 truncate" title="색 NULL 일 때 단계 대표색">
            <span className="inline-block size-2 shrink-0 rounded-sm" style={{ background: STAGE_COLORS[s] }} />
            {stageLabel(s)}
          </span>
        ))}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="inline-block size-2.5 rounded-full border-2 border-[#EA580C] bg-white" /> 새 역(미개통)
        <span className="ml-2 inline-block size-2.5 rounded-full bg-[#1f2937]" /> 운영 중 역
      </div>
      <p className="mt-1">색: 연장 = 기존 노선색 · 공식 노선색(출처) · 그 밖 단계 대표색</p>
      {odbl ? <p className="mt-1">선형 일부 © OpenStreetMap 기여자(ODbL)</p> : null}
    </section>
  );
}
