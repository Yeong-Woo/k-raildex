'use client';
/**
 * 지도·미래 지도(docs/06 3절 FR-WEB-020~028, 4-1절 시안): 왼쪽 패널(좁은 화면은 아래 시트) + 지도 + 지도 아래 연도 띠 + 계획 정보 창.
 * - 현재/미래 전환, 연도(올해 ~ 가장 늦은 개통 예정 + "목표 미정"), URL `?at=2030|future&stage=`, 해시 `#line= #station= #plan= #service=`
 * - 운행 계통(FR-WEB-029): 패널에서 고르거나 노선 정보 창의 "지나는 운행 계통"에서 고르면 계통이 다니는 구간 전체를 강조
 * - ←/→ 키·‹ › 단추·연도 막대로 연도 이동(끌기 대체 수단)
 * - 데이터는 web Route Handler(/api/map/*)만 부른다(FR-WEB-002). 연도·단계별 응답을 메모리에 둔다(연도 전환 < 300ms)
 * - 지도 아래(패널) 목록: 선택 연도에 생기는·사라지는 노선·역(지도 대체 정보, FR-WEB-026)
 * MapLibre 는 map-canvas 를 next/dynamic(ssr:false)으로 이 페이지에서만 받는다.
 */
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { codeLabel, isCode, type PublicTarget } from '@k-raildex/contracts';
import {
  DISCLAIMER,
  FREIGHT_LINE,
  GEOMETRY_QUALITY_LABELS,
  STAGE_COLORS,
  STATUS_COLORS,
  type BasemapId,
} from '@k-raildex/map';
import { StageBadge } from '@/components/badges';
import { formatFuzzy } from '@/lib/format';
import {
  dataQuery,
  hashString,
  mapDiff,
  mapHref,
  parseAt,
  parseHash,
  previousAt,
  STAGE_KEY_LABEL,
  STAGE_KEYS,
  STAGE_MIN,
  stepAt,
  targetLabel,
  yearRange,
  type LineFeatureProps,
  type MapAt,
  type MapDiff,
  type MapHash,
  type StageKey,
  type StationFeatureProps,
} from '@/lib/map-years';
import type { FC, MapView, Pick } from './map-canvas';

const MapCanvas = dynamic(() => import('./map-canvas'), {
  ssr: false,
  loading: () => <div className="fmap-canvas fmap-loading">지도를 불러오는 중…</div>,
});

/** 지도 "운행 계통" 고르기용(서버가 공개 API 목록에서 줄여 넘김) */
export interface MapService {
  id: string;
  name_ko: string;
  kind: string;
  color: string | null;
  status: string;
  line_ids: string[];
}

/** 고르기 목록 묶음 순서 */
const SERVICE_KIND_ORDER = ['wide_area', 'metro', 'high_speed', 'intercity', 'tourist'];
const serviceKindLabel = (k: string) => (isCode('serviceKind', k) ? codeLabel('serviceKind', k) : k);

export interface TimelineData {
  stage_min: string;
  current_year: number;
  years: { year: number; count: number; plans: { id: string; name_ko: string; stage: string; delayed: boolean }[] }[];
  undated: number;
  undated_plans: { id: string; name_ko: string; stage: string }[];
}

interface PlanSummary {
  id: string;
  name_ko: string;
  name_full: string | null;
  stage: string | null;
  target_open: PublicTarget | null;
  target_source: { title: string; publisher: string; type: string } | null;
  opened: { value: string | null; precision: string } | null;
  station_count: number;
  shape: { quality: string; odbl: boolean } | null;
}

const VIEWS: Record<'capital' | 'national', MapView & { label: string }> = {
  capital: { center: [126.98, 37.52], zoom: 9.2, label: '수도권' },
  national: { center: [127.8, 36.3], zoom: 6.4, label: '전국' },
};

// 응답 메모(같은 조건은 다시 받지 않는다)
const memo = new Map<string, Promise<unknown>>();
function getJson<T>(url: string): Promise<T> {
  let p = memo.get(url) as Promise<T> | undefined;
  if (!p) {
    p = fetch(url, { headers: { accept: 'application/json' } }).then((r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json() as Promise<T>;
    });
    p.catch(() => memo.delete(url));
    memo.set(url, p);
  }
  return p;
}
const loadMap = (at: MapAt, stage: StageKey) => {
  const q = dataQuery(at, stage);
  return Promise.all([getJson<FC>(`/api/map/lines/${q}`), getJson<FC>(`/api/map/stations/${q}`)]);
};

const statusText = (s: unknown) =>
  typeof s === 'string' && isCode('status', s) ? codeLabel('status', s) : '상태 미확인';
const bool = (v: unknown) => v === true || v === 'true';
const narrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches;

export function FutureMap({
  initialAt,
  initialStage,
  timeline: initialTimeline,
  services = [],
  vworldKey,
  thunderforestKey,
}: {
  initialAt: string | null;
  initialStage: StageKey;
  timeline: TimelineData;
  services?: MapService[];
  vworldKey: string | null;
  /** OSM 교통 지도(Thunderforest) 타일 키 — 서버 환경 변수 THUNDERFOREST_API_KEY */
  thunderforestKey: string | null;
}) {
  const [basemap, setBasemap] = useState<BasemapId | null>(null);
  const [stage, setStage] = useState<StageKey>(initialStage);
  const [timeline, setTimeline] = useState<TimelineData>(initialTimeline);
  const years = useMemo(
    () =>
      yearRange(
        timeline.years.map((y) => y.year),
        timeline.current_year,
      ),
    [timeline],
  );
  const [at, setAt] = useState<MapAt>(() => parseAt(initialAt, years));
  const [hash, setHash] = useState<MapHash>({});
  // 강조한 대상으로 지도를 옮길지: 링크·패널 목록 = 옮김, 지도 클릭(고르기 목록 포함) = 그대로(사용자 요청 2026-11-24)
  const [follow, setFollow] = useState(true);
  const [data, setData] = useState<{ lines: FC; stations: FC } | null>(null);
  // 차량기지(현재 지도에서만, 켬/끔 — 0034)
  const [showDepots, setShowDepots] = useState(false);
  const [depots, setDepots] = useState<FC | null>(null);
  useEffect(() => {
    if (!showDepots || depots) return;
    getJson<FC>('/api/map/depots/')
      .then(setDepots)
      .catch(() => setDepots({ type: 'FeatureCollection', features: [] } as unknown as FC));
  }, [showDepots, depots]);
  const [diff, setDiff] = useState<MapDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [plan, setPlan] = useState<PlanSummary | null | 'loading'>(null);
  // 운행 계통 선형(#service=)
  const [serviceFc, setServiceFc] = useState<FC | null | 'loading'>(null);
  const [view, setView] = useState<MapView & { seq: number }>({ ...VIEWS.capital, seq: 0 });
  // 아래 시트(좁은 화면)는 접고 시작한다 — 처음 값은 CSS 가 정하게 두어(sheet-open 없음) 그린 뒤 접히며 생기는 밀림(CLS)이 없다
  const [sheet, setSheet] = useState(false);
  const lastFutureYear = useRef<number>(Math.min(years[years.length - 1]!, timeline.current_year + 4));

  // 해시(#line= #station= #plan=)
  // 해시를 읽기 전에는 URL 을 건드리지 않는다(처음 동기화가 해시를 지우지 않게)
  const [hashReady, setHashReady] = useState(false);
  useEffect(() => {
    const read = () => {
      setFollow(true);
      setHash(parseHash(window.location.hash));
      setHashReady(true);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  // URL 동기화(기록을 쌓지 않는다)
  useEffect(() => {
    if (!hashReady) return;
    const url = mapHref(at, stage, hashString(hash));
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`)
      window.history.replaceState(window.history.state, '', url);
  }, [at, stage, hash, hashReady]);

  // 단계 필터가 바뀌면 연도별 건수 다시
  useEffect(() => {
    if (STAGE_MIN[stage] === timeline.stage_min) return;
    getJson<TimelineData>(`/api/map/timeline/?stage_min=${STAGE_MIN[stage]}`)
      .then(setTimeline)
      .catch(() => undefined);
  }, [stage, timeline.stage_min]);

  // 범위가 줄면 연도를 끝으로
  useEffect(() => {
    if (at.mode === 'year' && !years.includes(at.year)) setAt(parseAt(String(at.year), years));
  }, [years, at]);

  // 지도 자료 + 앞 칸과의 차이
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loadMap(at, stage)
      .then(([lines, stations]) => {
        if (!alive) return;
        setData({ lines, stations });
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setError('지도 자료를 받지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
        setLoading(false);
      });
    const prev = previousAt(at, years);
    setDiff(null);
    if (prev) {
      Promise.all([loadMap(at, stage), loadMap(prev, stage)])
        .then(([[nl, ns], [pl, ps]]) => {
          if (!alive) return;
          const props = <T,>(fc: FC) => fc.features.map((f) => f.properties as unknown as T);
          setDiff(
            mapDiff(
              { lines: props<LineFeatureProps>(pl), stations: props<StationFeatureProps>(ps) },
              { lines: props<LineFeatureProps>(nl), stations: props<StationFeatureProps>(ns) },
            ),
          );
        })
        .catch(() => undefined);
    }
    // 다음 칸 미리 받기 — 첫 그림·차이 목록 뒤 한가할 때(큰 GeoJSON 해석이 첫 입력 응답을 막지 않게, WP 7.6 TBT)
    const next = stepAt(at, years, 1);
    const idle = (cb: () => void) =>
      typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(cb, { timeout: 4000 })
        : window.setTimeout(cb, 1500);
    const cancelIdle = (h: number) =>
      typeof window.cancelIdleCallback === 'function' ? window.cancelIdleCallback(h) : window.clearTimeout(h);
    const idleHandle = idle(() => void loadMap(next, stage).catch(() => undefined));
    return () => {
      alive = false;
      cancelIdle(idleHandle);
    };
  }, [at, stage, years]);

  // 계획 정보 창(#plan= 또는 클릭)
  useEffect(() => {
    if (!hash.plan) {
      setPlan(null);
      return;
    }
    setPlan('loading');
    let alive = true;
    getJson<PlanSummary | null>(`/api/map/plan/${encodeURIComponent(hash.plan)}/`)
      .then((p) => alive && setPlan(p))
      .catch(() => alive && setPlan(null));
    return () => {
      alive = false;
    };
  }, [hash.plan]);

  // 운행 계통 선형(#service=)
  useEffect(() => {
    if (!hash.service) {
      setServiceFc(null);
      return;
    }
    setServiceFc('loading');
    let alive = true;
    getJson<FC | null>(`/api/map/service/${encodeURIComponent(hash.service)}/`)
      .then((fc) => alive && setServiceFc(fc))
      .catch(() => alive && setServiceFc(null));
    return () => {
      alive = false;
    };
  }, [hash.service]);
  const serviceGroups = useMemo(() => {
    const by = new Map<string, MapService[]>();
    for (const s of services) by.set(s.kind, [...(by.get(s.kind) ?? []), s]);
    const kinds = [...by.keys()].sort(
      (a, b) => (SERVICE_KIND_ORDER.indexOf(a) + 1 || 99) - (SERVICE_KIND_ORDER.indexOf(b) + 1 || 99),
    );
    return kinds.map((k) => ({
      kind: k,
      items: by
        .get(k)!
        .slice()
        .sort((a, b) => a.name_ko.localeCompare(b.name_ko, 'ko')),
    }));
  }, [services]);
  const selService = hash.service ? services.find((s) => s.id === hash.service) : undefined;

  const go = useCallback(
    (next: MapAt) => {
      if (next.mode === 'year') lastFutureYear.current = next.year;
      setAt(next);
    },
    [setAt],
  );

  // ←/→ 키(입력 칸·슬라이더 밖에서)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.closest('.maplibregl-canvas')))
        return;
      e.preventDefault();
      go(stepAt(at, years, e.key === 'ArrowRight' ? 1 : -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [at, years, go]);

  /** 패널 목록에서 고름 → 그 범위로 이동 */
  const showOnMap = (h: MapHash) => {
    setFollow(true);
    setHash(h);
  };
  const onPick = useCallback((list: Pick[]) => {
    setFollow(false);
    setPicks(list);
    if (list.length === 1) {
      const p = list[0]!;
      if (p.kind === 'station' || p.kind === 'depot') setHash({ station: String(p.props.station_id) });
      else if (p.props.plan_id) setHash({ plan: String(p.props.plan_id) });
      else if (p.props.line_id) setHash({ line: String(p.props.line_id) });
    } else if (list.length === 0) {
      setHash({});
    }
    // 정보 창은 지도 위에 뜬다 — 좁은 화면이면 시트를 접어 가리지 않게
    if (list.length && narrow()) setSheet(false);
  }, []);

  const lines = data?.lines.features ?? [];
  const stations = data?.stations.features ?? [];
  const odbl = lines.some((f) => bool(f.properties.odbl));
  const slider = at.mode === 'future' ? years.length : at.mode === 'year' ? years.indexOf(at.year) : -1;
  const yearInfo = at.mode === 'year' ? timeline.years.find((y) => y.year === at.year) : undefined;
  const delayed = useMemo(
    () => lines.filter((f) => f.properties.plan_id && bool(f.properties.delayed)).map((f) => f.properties),
    [lines],
  );
  const max = Math.max(1, timeline.undated, ...timeline.years.map((y) => y.count));
  const atLabel = at.mode === 'current' ? '현재' : at.mode === 'future' ? '목표 미정까지' : `${at.year}`;
  const selLine = hash.line ? lines.find((f) => f.properties.line_id === hash.line)?.properties : undefined;
  const depotOn = showDepots && at.mode === 'current';
  const selStation = hash.station
    ? (stations.find((f) => f.properties.station_id === hash.station)?.properties ??
      (depotOn ? depots?.features.find((f) => f.properties.station_id === hash.station)?.properties : undefined))
    : undefined;
  const selPlanLine = hash.plan ? lines.find((f) => f.properties.plan_id === hash.plan)?.properties : undefined;

  return (
    <div className={`fmap${sheet ? ' sheet-open' : ''}`}>
      <aside className="fmap-panel" aria-label="지도 설정과 목록">
        <button
          type="button"
          className="sheet-handle"
          aria-expanded={sheet}
          aria-controls="fmap-panel-body"
          onClick={() => setSheet((v) => !v)}
        >
          <span aria-hidden="true" className="grip" />
          {sheet ? '패널 접기' : `패널 펼치기 · ${atLabel}`}
        </button>
        <div id="fmap-panel-body" className="fmap-panel-body">
          <section className="fp-sec">
            <h2 className="fp-h">보기</h2>
            <div className="seg wide" role="group" aria-label="현재 / 미래">
              <button type="button" aria-pressed={at.mode === 'current'} onClick={() => go({ mode: 'current' })}>
                현재
              </button>
              <button
                type="button"
                aria-pressed={at.mode !== 'current'}
                onClick={() => at.mode === 'current' && go({ mode: 'year', year: lastFutureYear.current })}
              >
                미래
              </button>
            </div>
            <div className="seg" role="group" aria-label="지도 범위" style={{ marginTop: 'var(--kr-space-2)' }}>
              {(['capital', 'national'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={false}
                  onClick={() => setView((v) => ({ ...VIEWS[k], seq: v.seq + 1 }))}
                >
                  {VIEWS[k].label}
                </button>
              ))}
            </div>
            <label
              className="fp-check"
              style={{ display: 'flex', gap: '0.4em', alignItems: 'center', marginTop: 'var(--kr-space-2)' }}
            >
              <input
                type="checkbox"
                checked={showDepots}
                disabled={at.mode !== 'current'}
                onChange={(e) => setShowDepots(e.target.checked)}
                data-testid="toggle-depots"
              />
              차량기지 보기{at.mode !== 'current' ? ' (현재 지도에서만)' : ''}
            </label>
          </section>

          {services.length ? (
            <section className="fp-sec">
              <h2 className="fp-h">
                <label htmlFor="fmap-service">운행 계통</label>
              </h2>
              <select
                id="fmap-service"
                className="fp-select"
                value={hash.service ?? ''}
                onChange={(e) => showOnMap(e.target.value ? { service: e.target.value } : {})}
              >
                <option value="">고르지 않음</option>
                {serviceGroups.map((g) => (
                  <optgroup key={g.kind} label={serviceKindLabel(g.kind)}>
                    {g.items.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name_ko}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <p className="fp-hint">
                고른 계통이 다니는 구간 전체를 강조합니다(여러 노선에 걸친 구간 포함). 노선을 누르면 그 노선을 지나는
                계통도 고를 수 있습니다.
              </p>
            </section>
          ) : null}

          <section className="fp-sec">
            <h2 className="fp-h">
              <label htmlFor="fmap-year">연도</label>
            </h2>
            <p className="fp-year" aria-live="polite" data-testid="future-at">
              {at.mode === 'current' ? (
                <>
                  <b>현재</b> 운영·공사 중 노선
                </>
              ) : at.mode === 'future' ? (
                <>
                  <b>목표 미정</b> 까지 모두
                </>
              ) : (
                <>
                  <b className="num">{at.year}</b> 년까지 개통 예정 포함
                </>
              )}
            </p>
            <input
              id="fmap-year"
              type="range"
              min={0}
              max={years.length}
              step={1}
              value={Math.max(0, slider)}
              aria-valuetext={at.mode === 'future' ? '목표 미정' : at.mode === 'year' ? `${at.year}년` : '현재'}
              onChange={(e) => {
                const i = Number(e.target.value);
                go(i >= years.length ? { mode: 'future' } : { mode: 'year', year: years[i]! });
              }}
              className={at.mode === 'current' ? 'dim' : undefined}
            />
            <div className="fp-range-labels">
              <span className="num">{years[0]}</span>
              <span className="num">{years[years.length - 1]}</span>
              <span>미정</span>
            </div>
            <p className="fp-hint">지도 아래 막대·‹ › 단추나 ← → 키로도 바꿉니다.</p>
          </section>

          <section className="fp-sec">
            <h2 className="fp-h" id="fmap-stage-h">
              포함할 단계
            </h2>
            <div role="radiogroup" aria-labelledby="fmap-stage-h" className="fp-radios">
              {STAGE_KEYS.map((k) => (
                <label key={k}>
                  <input type="radio" name="fmap-stage" value={k} checked={stage === k} onChange={() => setStage(k)} />
                  {STAGE_KEY_LABEL[k]}
                </label>
              ))}
            </div>
            <p className="fp-hint">
              기본 = 개통 예정(공식·보도 근거)이 있는 기본계획 이상 계획 + 공사 중 노선. 휴면·폐기 제외.
            </p>
          </section>

          <section className="fp-sec">
            <h2 className="fp-h">범례</h2>
            <Legend odbl={odbl} />
          </section>

          <section className="fp-sec" aria-labelledby="fmap-list-h">
            <h2 className="fp-h" id="fmap-list-h">
              {at.mode === 'current'
                ? '지금 지도'
                : at.mode === 'future'
                  ? '목표 미정 계획'
                  : `${at.year}년에 생기는 것`}
            </h2>
            {at.mode === 'current' ? (
              <p className="fp-hint">
                노선 {lines.length.toLocaleString('ko-KR')}개 선 · 역 {stations.length.toLocaleString('ko-KR')}개.
                ‘미래’를 눌러 연도별 변화를 봅니다.
              </p>
            ) : null}
            {at.mode === 'year' && yearInfo ? (
              <>
                <h3 className="fp-sub">이 해 개통 예정 계획 {yearInfo.count}</h3>
                <ul className="fp-list">
                  {yearInfo.plans.map((p) => (
                    <li key={p.id}>
                      <i style={{ background: STAGE_COLORS[p.stage] }} aria-hidden="true" />
                      <a href={`/plans/${encodeURIComponent(p.id)}/`}>{p.name_ko}</a>
                      <button type="button" className="linkish" onClick={() => showOnMap({ plan: p.id })}>
                        지도에서
                      </button>
                      {p.delayed ? <span className="badge delayed">지연</span> : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {at.mode === 'future' ? (
              <>
                <h3 className="fp-sub">개통 목표 미정 {timeline.undated}</h3>
                <ul className="fp-list">
                  {timeline.undated_plans.map((p) => (
                    <li key={p.id}>
                      <i style={{ background: STAGE_COLORS[p.stage] }} aria-hidden="true" />
                      <a href={`/plans/${encodeURIComponent(p.id)}/`}>{p.name_ko}</a>
                      <button type="button" className="linkish" onClick={() => showOnMap({ plan: p.id })}>
                        지도에서
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {diff ? (
              <DiffList diff={diff} onShow={showOnMap} />
            ) : at.mode !== 'current' ? (
              <p className="fp-hint">앞 칸과 비교하는 중…</p>
            ) : null}
            {at.mode === 'year' && at.year === timeline.current_year && delayed.length ? (
              <>
                <h3 className="fp-sub">개통 목표가 지난 미개통(지연) {delayed.length}</h3>
                <ul className="fp-list">
                  {delayed.map((p) => (
                    <li key={String(p.feature_id)}>
                      <a href={`/plans/${encodeURIComponent(String(p.plan_id))}/`}>{String(p.name_ko)}</a>
                      <span className="badge delayed">지연</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          <p className="fp-disclaimer">
            {DISCLAIMER} 지리 지도만 제공합니다. 배경 지도{' '}
            {basemap === 'vworld-base' || basemap === 'vworld-satellite'
              ? '© VWorld(국토교통부)'
              : basemap === 'osm-transport'
                ? '© Thunderforest, 자료 © OpenStreetMap 기여자'
                : '© OpenStreetMap 기여자'}
            {odbl ? ' · 철도 선형 일부 © OpenStreetMap 기여자(ODbL)' : ''}.
          </p>
        </div>
      </aside>

      <div className="fmap-main">
        <MapCanvas
          lines={data?.lines ?? null}
          stations={data?.stations ?? null}
          depots={depotOn ? depots : null}
          service={serviceFc === 'loading' ? null : serviceFc}
          highlight={hash}
          follow={follow}
          vworldKey={vworldKey}
          thunderforestKey={thunderforestKey}
          onBasemap={setBasemap}
          view={view}
          onPick={onPick}
        />
        <InfoCard
          picks={picks}
          plan={plan}
          planLine={selPlanLine}
          line={selLine}
          station={selStation}
          service={selService}
          serviceFc={serviceFc}
          services={services}
          hash={hash}
          atYear={at.mode === 'year' ? at.year : null}
          onChoose={(h) => {
            setPicks([]);
            setFollow(false);
            setHash(h);
          }}
          onClose={() => {
            setPicks([]);
            setHash({});
          }}
        />
        {loading ? (
          <div className="fmap-status" role="status">
            불러오는 중…
          </div>
        ) : error ? (
          <div className="fmap-status error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="yearband" role="group" aria-label="연도 띠(연도별 개통 예정 건수)">
          <button
            type="button"
            className="btn icon"
            aria-label="이전 연도"
            onClick={() => go(stepAt(at, years, -1))}
            disabled={at.mode === 'year' && at.year === years[0]}
          >
            ‹
          </button>
          <button
            type="button"
            className="btn icon"
            aria-label="다음 연도"
            onClick={() => go(stepAt(at, years, 1))}
            disabled={at.mode === 'future'}
          >
            ›
          </button>
          <ol className="bars">
            {years.map((y) => {
              const n = timeline.years.find((x) => x.year === y)?.count ?? 0;
              const cur = at.mode === 'year' && at.year === y;
              return (
                <li key={y}>
                  <button
                    type="button"
                    aria-pressed={cur}
                    onClick={() => go({ mode: 'year', year: y })}
                    className={at.mode === 'year' && y <= at.year ? 'in' : undefined}
                  >
                    <span className="bar" style={{ height: `${Math.max(n ? 18 : 6, (n / max) * 100)}%` }} />
                    {/* 이름 = 보이는 연도 + 숨은 건수(WCAG 2.5.3 — 보이는 글자가 이름 앞에 오게) */}
                    <span className="lbl num">{y}</span> <span className="sr-only">년, 개통 예정 {n}건</span>
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                aria-pressed={at.mode === 'future'}
                aria-label={`목표 미정 (${timeline.undated}건)`}
                onClick={() => go({ mode: 'future' })}
                className={`undated${at.mode === 'future' ? ' in' : ''}`}
              >
                <span
                  className="bar"
                  style={{ height: `${Math.max(timeline.undated ? 18 : 6, (timeline.undated / max) * 100)}%` }}
                />
                <span className="lbl">미정</span>
              </button>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}

function DiffList({ diff, onShow }: { diff: MapDiff; onShow: (h: MapHash) => void }) {
  const sec = (title: string, items: MapDiff['addedLines'], cls: string) =>
    items.length ? (
      <>
        <h3 className="fp-sub">
          {title} {items.length}
        </h3>
        <ul className={`fp-list ${cls}`}>
          {items.slice(0, 60).map((it) => (
            <li key={it.key}>
              <a
                href={
                  it.kind === 'plan'
                    ? `/plans/${encodeURIComponent(it.id)}/`
                    : it.kind === 'line'
                      ? `/lines/${encodeURIComponent(it.id)}/`
                      : `/stations/${encodeURIComponent(it.id)}/`
                }
              >
                {it.name}
              </a>
              <button
                type="button"
                className="linkish"
                onClick={() =>
                  onShow(
                    it.kind === 'station' ? { station: it.id } : it.kind === 'plan' ? { plan: it.id } : { line: it.id },
                  )
                }
              >
                지도에서
              </button>
            </li>
          ))}
          {items.length > 60 ? <li className="muted">외 {items.length - 60}개</li> : null}
        </ul>
      </>
    ) : null;
  const none =
    !diff.addedLines.length && !diff.removedLines.length && !diff.addedStations.length && !diff.removedStations.length;
  return (
    <div data-testid="future-diff">
      {sec('새로 생기는 노선', diff.addedLines, 'added')}
      {sec('사라지는 노선(대체·폐지)', diff.removedLines, 'removed')}
      {sec('새로 생기는 역', diff.addedStations, 'added')}
      {sec('사라지는 역(폐역 예정)', diff.removedStations, 'removed')}
      {none ? <p className="fp-hint">앞 칸과 비교해 바뀌는 노선·역이 없습니다.</p> : null}
    </div>
  );
}

function InfoCard({
  picks,
  plan,
  planLine,
  line,
  station,
  service,
  serviceFc,
  services,
  hash,
  atYear,
  onChoose,
  onClose,
}: {
  picks: Pick[];
  plan: PlanSummary | null | 'loading';
  planLine: Record<string, unknown> | undefined;
  line: Record<string, unknown> | undefined;
  station: Record<string, unknown> | undefined;
  service: MapService | undefined;
  serviceFc: FC | null | 'loading';
  services: MapService[];
  hash: MapHash;
  atYear: number | null;
  onChoose: (h: MapHash) => void;
  onClose: () => void;
}) {
  if (picks.length > 1)
    return (
      <section className="fmap-info" aria-label="겹친 항목 고르기">
        <div className="info-head">
          <h2 className="fp-h">이 자리에 {picks.length}개</h2>
          <button type="button" className="linkish" onClick={onClose}>
            닫기
          </button>
        </div>
        <ul className="fp-list">
          {picks.map((p, i) => (
            <li key={i}>
              <button
                type="button"
                className="linkish strong"
                onClick={() =>
                  onChoose(
                    p.kind !== 'line'
                      ? { station: String(p.props.station_id) }
                      : p.props.plan_id
                        ? { plan: String(p.props.plan_id) }
                        : { line: String(p.props.line_id) },
                  )
                }
              >
                {String(p.props.name_ko)}
              </button>
              <span className="muted">
                {p.kind === 'station' ? '역' : p.kind === 'depot' ? '차량기지' : p.props.plan_id ? '계획' : '노선'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    );
  if (!hash.plan && !hash.line && !hash.station && !hash.service) return null;
  let body: React.ReactNode = null;
  if (hash.service) {
    const planned =
      serviceFc && serviceFc !== 'loading' && serviceFc.features.some((f) => f.properties.status !== 'operating');
    body = (
      <>
        <p className="eyebrow">운행 계통</p>
        <h2 className="info-title">
          <i
            className="dot"
            style={{
              // 계통 색, 없으면 대표 노선 색(API 계산, Q127 A)
              background:
                (serviceFc && serviceFc !== 'loading'
                  ? (serviceFc.features[0]?.properties.color as string | null)
                  : null) ||
                service?.color ||
                '#F5B700',
            }}
            aria-hidden="true"
          />{' '}
          {service?.name_ko ?? hash.service}
        </h2>
        {service ? <p className="fp-hint">{serviceKindLabel(service.kind)}</p> : null}
        {serviceFc === 'loading' ? (
          <p className="fp-hint">운행 구간을 불러오는 중…</p>
        ) : !serviceFc || serviceFc.features.length === 0 ? (
          <p className="fp-hint">지도에 그릴 운행 구간이 없습니다.</p>
        ) : (
          <p className="fp-hint">
            실선 = 지금 정차하며 다니는 구간{planned ? ' · 점선 = 운행 예정 노선(공사 중·계획)' : ''}. 선형은 노선
            선형에서 잘라 낸 것입니다.
          </p>
        )}
        <a
          className="btn"
          href={`/services/${encodeURIComponent(hash.service)}/`}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          운행 계통 상세 보기
        </a>
      </>
    );
  } else if (hash.plan) {
    if (plan === 'loading') body = <p className="fp-hint">계획 정보를 불러오는 중…</p>;
    else if (!plan) body = <p className="fp-hint">계획 정보를 찾지 못했습니다.</p>;
    else {
      const t = plan.target_open;
      body = (
        <>
          <p className="eyebrow">계획</p>
          <h2 className="info-title">{plan.name_ko}</h2>
          <div className="badges">
            <StageBadge stage={plan.stage && isCode('planStage', plan.stage) ? plan.stage : null} />
            {t?.delayed ? <span className="badge delayed">지연</span> : null}
          </div>
          <dl className="kv">
            <dt>{plan.opened?.value ? '개통' : '개통 예정'}</dt>
            <dd>
              {plan.opened?.value
                ? formatFuzzy(plan.opened as never)
                : t?.value
                  ? targetLabel(t.value, t.precision)
                  : '목표 미정'}
            </dd>
            {t?.basis ? (
              <>
                <dt>근거</dt>
                <dd>
                  {codeLabel('milestoneBasis', t.basis)}
                  {t.as_of ? ` · ${formatFuzzy(t.as_of)} 발표` : ''}
                  {plan.target_source ? <span className="name-sub">{plan.target_source.publisher}</span> : null}
                </dd>
              </>
            ) : null}
            {plan.station_count ? (
              <>
                <dt>신설 역</dt>
                <dd>{plan.station_count}개</dd>
              </>
            ) : null}
            <dt>선형</dt>
            <dd>
              {plan.shape
                ? (GEOMETRY_QUALITY_LABELS[plan.shape.quality] ?? plan.shape.quality)
                : '지도 선형 없음(위치 미확인)'}
            </dd>
          </dl>
          {!planLine && plan.shape ? (
            <p className="fp-hint">
              {atYear
                ? `${atYear}년 지도에는 아직 보이지 않습니다(개통 예정이 더 늦거나 단계 필터 밖).`
                : '지금 보기에는 없습니다.'}
            </p>
          ) : null}
          <a
            className="btn"
            href={`/plans/${encodeURIComponent(plan.id)}/`}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            계획 상세 보기
          </a>
        </>
      );
    }
  } else if (hash.line) {
    body = (
      <>
        <p className="eyebrow">노선</p>
        <h2 className="info-title">{line ? String(line.name_ko) : hash.line}</h2>
        {line ? (
          <p className="fp-hint">
            <i
              className="dot"
              style={{ background: (line.color as string) || STATUS_COLORS[String(line.status)] }}
              aria-hidden="true"
            />{' '}
            {statusText(line.status)}
          </p>
        ) : (
          <p className="fp-hint">이 보기에는 선이 없습니다.</p>
        )}
        <LineServices lineId={hash.line} services={services} onChoose={onChoose} />
        <a
          className="btn"
          href={`/lines/${encodeURIComponent(hash.line)}/`}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          노선 상세 보기
        </a>
      </>
    );
  } else if (hash.station && station?.kind === 'depot') {
    const fn = Array.isArray(station.functions) ? (station.functions as string[]) : [];
    const served = Array.isArray(station.served) ? (station.served as string[]) : [];
    body = (
      <>
        <p className="eyebrow">차량기지</p>
        <h2 className="info-title">{String(station.name_ko)}</h2>
        <p className="fp-hint" data-testid="depot-info">
          {fn.length
            ? fn.map((f) => (isCode('depotFunction', f) ? codeLabel('depotFunction', f) : f)).join(' · ')
            : '기능 미확인'}
          {station.operator ? ` · ${String(station.operator)}` : ''}
          {bool(station.approximate) ? ' · 근사 좌표' : ''}
        </p>
        {served.length ? <p className="fp-hint">담당 노선: {served.join(', ')}</p> : null}
        <a
          className="btn"
          href={`/stations/${encodeURIComponent(hash.station)}/`}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          차량기지 상세 보기
        </a>
      </>
    );
  } else if (hash.station) {
    body = (
      <>
        <p className="eyebrow">역</p>
        <h2 className="info-title">{station ? String(station.name_ko) : hash.station}</h2>
        {station ? (
          <p className="fp-hint">
            {bool(station.future) ? '이 시점에 새로 생기는 역' : statusText(station.status)}
            {bool(station.approximate) ? ' · 근사 좌표' : ''}
          </p>
        ) : (
          <p className="fp-hint">이 보기에는 역이 없습니다.</p>
        )}
        <a
          className="btn"
          href={`/stations/${encodeURIComponent(hash.station)}/`}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          역 상세 보기
        </a>
      </>
    );
  }
  return (
    <section className="fmap-info" aria-live="polite" data-testid="future-selected">
      <div className="info-head">
        <span />
        <button type="button" className="linkish" onClick={onClose} aria-label="정보 창 닫기">
          닫기 ✕
        </button>
      </div>
      {body}
    </section>
  );
}

/** 노선 정보 창: 이 노선을 지나는 운행 계통 — 누르면 계통 전체 구간 강조 */
function LineServices({
  lineId,
  services,
  onChoose,
}: {
  lineId: string;
  services: MapService[];
  onChoose: (h: MapHash) => void;
}) {
  const list = services.filter((s) => s.line_ids.includes(lineId));
  if (!list.length) return null;
  return (
    <>
      <h3 className="fp-sub">지나는 운행 계통 {list.length}</h3>
      <ul className="fp-list">
        {list.map((s) => (
          <li key={s.id}>
            <i style={{ background: s.color || '#F5B700' }} aria-hidden="true" />
            <button type="button" className="linkish" onClick={() => onChoose({ service: s.id })}>
              {s.name_ko}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Legend({ odbl }: { odbl: boolean }) {
  const rows: { dash?: string; w: number; label: string; color: string; op?: number }[] = [
    { w: 4, label: '공사·시운전 이상(실선)', color: STAGE_COLORS.construction! },
    { w: 4, dash: '8 5', label: '기본계획~실시설계(굵은 점선)', color: STAGE_COLORS.basic_plan! },
    { w: 2, dash: '3 3', label: '그 전 단계(가는 점선)', color: STAGE_COLORS.feasibility! },
    { w: 2, dash: '3 3', label: '선형 미확정(개략)', color: '#7A8798', op: 0.75 },
    { w: 2.5, label: '운영 중(수도권 전철 공식 색, 그 밖 상태색)', color: STATUS_COLORS.operating! },
    { w: FREIGHT_LINE.width, label: FREIGHT_LINE.label, color: FREIGHT_LINE.color },
  ];
  return (
    <>
      <ul className="legend-lines">
        {rows.map((r) => (
          <li key={r.label}>
            <svg width="36" height="10" aria-hidden="true">
              <line
                x1="0"
                y1="5"
                x2="36"
                y2="5"
                stroke={r.color}
                strokeWidth={r.w}
                strokeDasharray={r.dash}
                strokeOpacity={r.op ?? 1}
              />
            </svg>
            {r.label}
          </li>
        ))}
        <li>
          <svg width="36" height="12" aria-hidden="true">
            <circle cx="18" cy="6" r="4" fill="#fff" stroke={STATUS_COLORS.under_construction} strokeWidth="2" />
          </svg>
          새 역(속이 빈 원)
        </li>
        <li>
          <svg width="36" height="12" aria-hidden="true">
            <circle cx="18" cy="6" r="4" fill="#9AA3AD" stroke="#6B7480" strokeWidth="1.5" opacity="0.7" />
          </svg>
          근사 좌표 역(회색)
        </li>
      </ul>
      <p className="fp-hint">
        색 없는 계획은 단계 대표색 + 선 위 이름 라벨. 연장 계획은 기존 노선 색으로 이어 그립니다.
        {odbl ? ' 선형 일부 © OpenStreetMap 기여자(ODbL).' : ''}
      </p>
    </>
  );
}
