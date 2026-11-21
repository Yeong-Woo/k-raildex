/** 지도(FR-ADM-070~076): 지도 편집 · 계획 선형 편집 · OSM 매핑 점검 · 미래 지도 미리 보기 · 위성 비교 */
import { lazy, Suspense } from 'react';
import { useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { Empty, Tabs, TabsList, TabsTrigger } from '@k-raildex/ui';

// MapLibre 는 무거우므로 지도 화면에서만 불러온다
const EditMap = lazy(() => import('../map/EditMap').then((m) => ({ default: m.EditMap })));
const FutureMap = lazy(() => import('../map/FutureMap').then((m) => ({ default: m.FutureMap })));
const SatelliteCompare = lazy(() => import('../map/SatelliteCompare').then((m) => ({ default: m.SatelliteCompare })));
const PlanGeometryEditor = lazy(() =>
  import('../map/PlanGeometryEditor').then((m) => ({ default: m.PlanGeometryEditor })),
);
const OsmMappingCheck = lazy(() => import('../map/OsmMappingCheck').then((m) => ({ default: m.OsmMappingCheck })));

type RouteTab = 'edit' | 'future' | 'satellite';
/** 라우트 검증(router.tsx MapSearch.tab)에 없는 도구 탭 — `?tool=` 으로 둔다(검증되지 않은 검색 키는 그대로 남는다) */
type ToolTab = 'geometry' | 'osm';
const TOOL_TABS: readonly ToolTab[] = ['geometry', 'osm'];

/** 라우트가 검증하지 않는 지도 도구 검색 키(tool·plan·line) */
interface ToolSearch {
  tool?: ToolTab;
  plan?: string;
  line?: string;
}

export function MapPage() {
  const search = useSearch({ from: '/map' });
  const raw = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const navigate = useNavigate({ from: '/map' });
  const tool = TOOL_TABS.includes(raw.tool as ToolTab) ? (raw.tool as ToolTab) : null;
  const tab: RouteTab | ToolTab = tool ?? search.tab ?? 'edit';
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

  const go = (t: string) =>
    void navigate({
      search: (TOOL_TABS.includes(t as ToolTab) ? { tool: t } : { tab: t as RouteTab }) as never,
    });
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
        <h1 className="pb-2 text-lg font-bold">지도</h1>
        <Tabs value={tab} onValueChange={go}>
          <TabsList className="border-b-0">
            <TabsTrigger value="edit">지도 편집</TabsTrigger>
            <TabsTrigger value="geometry">계획 선형 편집</TabsTrigger>
            <TabsTrigger value="osm">OSM 매핑 점검</TabsTrigger>
            <TabsTrigger value="future">미래 지도 미리 보기</TabsTrigger>
            <TabsTrigger value="satellite">위성 비교</TabsTrigger>
          </TabsList>
        </Tabs>
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
