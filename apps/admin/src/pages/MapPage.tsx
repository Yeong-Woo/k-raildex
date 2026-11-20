/** 지도(FR-ADM-070~076): 지도 편집 · 미래 지도 미리 보기 · 위성 비교 */
import { lazy, Suspense } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Empty, Tabs, TabsList, TabsTrigger } from '@k-raildex/ui';

// MapLibre 는 무거우므로 지도 화면에서만 불러온다
const EditMap = lazy(() => import('../map/EditMap').then((m) => ({ default: m.EditMap })));
const FutureMap = lazy(() => import('../map/FutureMap').then((m) => ({ default: m.FutureMap })));
const SatelliteCompare = lazy(() => import('../map/SatelliteCompare').then((m) => ({ default: m.SatelliteCompare })));

export function MapPage() {
  const search = useSearch({ from: '/map' });
  const navigate = useNavigate({ from: '/map' });
  const tab = search.tab ?? 'edit';
  return (
    <div className="-m-6 flex h-screen flex-col">
      <div className="flex items-center gap-4 border-b border-border bg-bg-elevated px-6 pt-3">
        <h1 className="pb-2 text-lg font-bold">지도</h1>
        <Tabs value={tab} onValueChange={(t) => void navigate({ search: { tab: t as typeof tab } })}>
          <TabsList className="border-b-0">
            <TabsTrigger value="edit">지도 편집</TabsTrigger>
            <TabsTrigger value="future">미래 지도 미리 보기</TabsTrigger>
            <TabsTrigger value="satellite">위성 비교</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="relative min-h-0 flex-1">
        <Suspense fallback={<Empty>지도 불러오는 중…</Empty>}>
          {tab === 'edit' ? <EditMap /> : tab === 'future' ? <FutureMap /> : <SatelliteCompare />}
        </Suspense>
      </div>
    </div>
  );
}
