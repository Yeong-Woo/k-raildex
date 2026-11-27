/** 지도(FR-ADM-070~076): 역 편집 · 현재 노선 편집 · 미래 노선 편집 · 미래 지도 · 위성 비교 · OSM 매핑 점검.
 * 화면 전환은 사이드바 메뉴만 쓴다(탭 줄 없음). 역·선 클릭 → 정보 팝업(map/FeaturePopup). */
import { lazy, Suspense } from 'react';
import { useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { Empty } from '@k-raildex/ui';

// MapLibre 는 무거우므로 지도 화면에서만 불러온다
const EditMap = lazy(() => import('../map/EditMap').then((m) => ({ default: m.EditMap })));
const FutureMap = lazy(() => import('../map/FutureMap').then((m) => ({ default: m.FutureMap })));
const SatelliteCompare = lazy(() => import('../map/SatelliteCompare').then((m) => ({ default: m.SatelliteCompare })));
const PlanGeometryEditor = lazy(() =>
  import('../map/PlanGeometryEditor').then((m) => ({ default: m.PlanGeometryEditor })),
);
const LineMapEditor = lazy(() => import('../map/LineMapEditor').then((m) => ({ default: m.LineMapEditor })));
const OsmMappingCheck = lazy(() => import('../map/OsmMappingCheck').then((m) => ({ default: m.OsmMappingCheck })));

type RouteTab = 'edit' | 'future' | 'satellite';
/** 라우트 검증(router.tsx MapSearch.tab)에 없는 도구 탭 — `?tool=` 으로 둔다(검증되지 않은 검색 키는 그대로 남는다) */
type ToolTab = 'line' | 'geometry' | 'osm';
const TOOL_TABS: readonly ToolTab[] = ['line', 'geometry', 'osm'];

/** 라우트가 검증하지 않는 지도 도구 검색 키(tool·plan·line) */
interface ToolSearch {
  tool?: ToolTab;
  plan?: string;
  line?: string;
}

/** 화면 이름(전환은 사이드바 "지도" 메뉴에서) */
const TITLES: Record<RouteTab | ToolTab, string> = {
  edit: '역 편집',
  line: '현재 노선 편집',
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
  const tab: RouteTab | ToolTab = tool ?? search.tab ?? 'edit';
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

  return (
    <div className="-m-6 flex h-screen flex-col">
      <div className="flex items-center gap-4 border-b border-border bg-bg-elevated px-6 pt-3">
        <h1 className="pb-2 text-lg font-bold">
          지도 <span className="font-normal text-fg-muted">· {TITLES[tab]}</span>
        </h1>
      </div>
      <div className="relative min-h-0 flex-1">
        <Suspense fallback={<Empty>지도 불러오는 중…</Empty>}>
          {tab === 'line' ? (
            <LineMapEditor
              lineId={str(raw.line)}
              onLineChange={(id) => setTool({ tool: 'line', line: id ?? undefined })}
            />
          ) : tab === 'geometry' ? (
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
            <EditMap />
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
