/** 지도(FR-ADM-070~076): 역·시설·노선 편집(역 그룹 좌표 / 시설 좌표 / 현재 노선 노선역 — 2026-11-28 한 화면으로 통합) · 미래 노선 편집 · 미래 지도 · 위성 비교 · OSM 매핑 점검.
 * 화면 전환은 사이드바 메뉴만 쓴다(탭 줄 없음). 역·선 클릭 → 정보 팝업(map/FeaturePopup). */
import { lazy, Suspense } from 'react';
import { useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { Empty } from '@k-raildex/ui';
import type { PickKind } from '../map/pick';

// MapLibre 는 무거우므로 지도 화면에서만 불러온다
const EditMap = lazy(() => import('../map/EditMap').then((m) => ({ default: m.EditMap })));
const FacilityEditMap = lazy(() => import('../map/FacilityEditMap').then((m) => ({ default: m.FacilityEditMap })));
const FutureMap = lazy(() => import('../map/FutureMap').then((m) => ({ default: m.FutureMap })));
const SatelliteCompare = lazy(() => import('../map/SatelliteCompare').then((m) => ({ default: m.SatelliteCompare })));
const PlanGeometryEditor = lazy(() =>
  import('../map/PlanGeometryEditor').then((m) => ({ default: m.PlanGeometryEditor })),
);
const LineMapEditor = lazy(() => import('../map/LineMapEditor').then((m) => ({ default: m.LineMapEditor })));
const OsmMappingCheck = lazy(() => import('../map/OsmMappingCheck').then((m) => ({ default: m.OsmMappingCheck })));

type RouteTab = 'edit' | 'future' | 'satellite';
/** 라우트 검증(router.tsx MapSearch.tab)에 없는 도구 탭 — `?tool=` 으로 둔다(검증되지 않은 검색 키는 그대로 남는다) */
type ToolTab = 'geometry' | 'osm';
const TOOL_TABS: readonly ToolTab[] = ['geometry', 'osm'];
/** 역·시설·노선 편집의 대상(`?target=`, 없으면 역 그룹). 옛 링크 `?tool=line` 은 노선 대상으로 */
const TARGETS: readonly [PickKind, string][] = [
  ['station', '역 그룹'],
  ['facility', '시설'],
  ['line', '노선'],
];

/** 라우트가 검증하지 않는 지도 도구 검색 키(tool·plan·line) */
interface ToolSearch {
  tool?: ToolTab;
  tab?: 'edit';
  station?: string;
  plan?: string;
  line?: string;
  /** 역·시설·노선 편집: 대상(target=facility·line, facility=fac-…, line=line-…) */
  target?: 'facility' | 'line';
  facility?: string;
}

/** 화면 이름(전환은 사이드바 "지도" 메뉴에서) */
const TITLES: Record<RouteTab | ToolTab, string> = {
  edit: '역·시설·노선 편집',
  geometry: '미래 노선 편집',
  future: '미래 지도',
  satellite: '위성 비교',
  osm: 'OSM 매핑 점검',
};

export function MapPage() {
  const search = useSearch({ from: '/map' });
  const raw = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const navigate = useNavigate({ from: '/map' });
  const tool = TOOL_TABS.includes(raw.tool as ToolTab) ? (raw.tool as ToolTab) : null;
  const legacyLine = raw.tool === 'line';
  const tab: RouteTab | ToolTab = legacyLine ? 'edit' : (tool ?? search.tab ?? 'edit');
  const target: PickKind =
    legacyLine || raw.target === 'line' ? 'line' : raw.target === 'facility' ? 'facility' : 'station';
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

  const setTool = (patch: ToolSearch) =>
    void navigate({
      search: ((s: Record<string, unknown>) => {
        const next: Record<string, unknown> = { ...s, ...patch };
        for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
        return next;
      }) as never,
      replace: true,
    });
  /** 지도에서 누른 역 그룹·시설·노선 → 그 대상 편집으로(다른 대상의 고른 것은 그대로 둔다) */
  const pick = (kind: PickKind, id: string | null) =>
    setTool({
      tool: undefined,
      tab: 'edit',
      target: kind === 'station' ? undefined : kind,
      [kind]: id ?? undefined,
    });

  return (
    <div className="-m-6 flex h-screen flex-col">
      <div className="flex items-center gap-4 border-b border-border bg-bg-elevated px-6 pt-3">
        <h1 className="pb-2 text-lg font-bold">
          지도 <span className="font-normal text-fg-muted">· {TITLES[tab]}</span>
        </h1>
      </div>
      <div className="relative min-h-0 flex-1">
        <Suspense fallback={<Empty>지도 불러오는 중…</Empty>}>
          {tab === 'geometry' ? (
            <PlanGeometryEditor
              planId={str(raw.plan)}
              onPlanChange={(id) => setTool({ tool: 'geometry', plan: id ?? undefined })}
            />
          ) : tab === 'osm' ? (
            <OsmMappingCheck
              lineId={str(raw.line)}
              onLineChange={(id) => setTool({ tool: 'osm', line: id ?? undefined })}
            />
          ) : tab === 'edit' ? (
            <div className="absolute inset-0 flex flex-col">
              <div
                className="flex gap-1 border-b border-border bg-bg-elevated px-3 py-1.5 text-sm"
                role="group"
                aria-label="편집 대상"
              >
                {TARGETS.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={target === k}
                    data-testid={`edit-target-${k}`}
                    className={
                      target === k
                        ? 'rounded-full border border-primary bg-primary/10 px-3 py-0.5 font-semibold'
                        : 'rounded-full border border-border px-3 py-0.5 hover:bg-muted'
                    }
                    onClick={() => setTool({ tool: undefined, target: k === 'station' ? undefined : k })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="relative min-h-0 flex-1">
                {target === 'facility' ? (
                  <FacilityEditMap
                    facilityId={str(raw.facility)}
                    onSelect={(id) => pick('facility', id)}
                    onPick={pick}
                  />
                ) : target === 'line' ? (
                  <LineMapEditor lineId={str(raw.line)} onLineChange={(id) => pick('line', id)} onPick={pick} />
                ) : (
                  <EditMap onPick={pick} />
                )}
              </div>
            </div>
          ) : tab === 'future' ? (
            <FutureMap />
          ) : (
            <SatelliteCompare />
          )}
        </Suspense>
      </div>
    </div>
  );
}
