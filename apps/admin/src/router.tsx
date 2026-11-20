import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { Shell } from './layout/Shell';
import { Dashboard } from './pages/Dashboard';
import { EntityList } from './pages/EntityList';
import { EntityDetail } from './pages/EntityDetail';
import { Changesets } from './pages/Changesets';
import { ChangesetDetail } from './pages/ChangesetDetail';
import { Trash } from './pages/Trash';
import { Quality } from './pages/Quality';
import { MapPage } from './pages/MapPage';
import { Bulk } from './pages/Bulk';
import { External, type ExternalSearch } from './pages/External';

const rootRoute = createRootRoute({ component: Shell });

const dashboard = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Dashboard });

export interface ListSearch {
  q?: string;
  status?: string;
  review_status?: string;
  offset?: number;
  sort?: string;
}
const list = createRoute({
  getParentRoute: () => rootRoute,
  path: '/data/$type',
  validateSearch: (s: Record<string, unknown>): ListSearch => ({
    q: typeof s.q === 'string' ? s.q : undefined,
    status: typeof s.status === 'string' ? s.status : undefined,
    review_status: typeof s.review_status === 'string' ? s.review_status : undefined,
    offset: typeof s.offset === 'number' ? s.offset : undefined,
    sort: typeof s.sort === 'string' ? s.sort : undefined,
  }),
  component: EntityList,
});
const detail = createRoute({
  getParentRoute: () => rootRoute,
  path: '/data/$type/$id',
  validateSearch: (s: Record<string, unknown>): { tab?: string } => ({
    tab: typeof s.tab === 'string' ? s.tab : undefined,
  }),
  component: EntityDetail,
});
const changesets = createRoute({
  getParentRoute: () => rootRoute,
  path: '/changesets',
  validateSearch: (s: Record<string, unknown>): { status?: string } => ({
    status: typeof s.status === 'string' ? s.status : undefined,
  }),
  component: Changesets,
});
const changeset = createRoute({ getParentRoute: () => rootRoute, path: '/changesets/$id', component: ChangesetDetail });
const trash = createRoute({ getParentRoute: () => rootRoute, path: '/trash', component: Trash });

const quality = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quality',
  validateSearch: (s: Record<string, unknown>): { rule?: string; offset?: number } => ({
    rule: typeof s.rule === 'string' ? s.rule : undefined,
    offset: typeof s.offset === 'number' ? s.offset : undefined,
  }),
  component: Quality,
});

export interface MapSearch {
  tab?: 'edit' | 'future' | 'satellite';
  /** 지도 편집: 고른 역 */
  station?: string;
  /** 미래 지도: 연도 또는 'future'(목표 미정 포함 끝 칸) */
  at?: string;
  stage_min?: string;
  undated?: boolean;
}
const map = createRoute({
  getParentRoute: () => rootRoute,
  path: '/map',
  validateSearch: (s: Record<string, unknown>): MapSearch => ({
    tab: s.tab === 'future' || s.tab === 'satellite' || s.tab === 'edit' ? s.tab : undefined,
    station: typeof s.station === 'string' ? s.station : undefined,
    at: typeof s.at === 'string' || typeof s.at === 'number' ? String(s.at) : undefined,
    stage_min: typeof s.stage_min === 'string' ? s.stage_min : undefined,
    undated: typeof s.undated === 'boolean' ? s.undated : undefined,
  }),
  component: MapPage,
});

import { Jobs } from './pages/Jobs';
import { Settings } from './pages/Settings';

const jobs = createRoute({ getParentRoute: () => rootRoute, path: '/jobs', component: Jobs });
const settings = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: Settings });
const bulk = createRoute({ getParentRoute: () => rootRoute, path: '/bulk', component: Bulk });

const external = createRoute({
  getParentRoute: () => rootRoute,
  path: '/external',
  validateSearch: (s: Record<string, unknown>): ExternalSearch => ({
    endpoint: typeof s.endpoint === 'string' ? s.endpoint : undefined,
    tab: s.tab === 'call' || s.tab === 'history' || s.tab === 'edit' ? s.tab : undefined,
  }),
  component: External,
});

const routeTree = rootRoute.addChildren([
  dashboard,
  list,
  detail,
  changesets,
  changeset,
  trash,
  quality,
  map,
  bulk,
  external,
  jobs,
  settings,
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
