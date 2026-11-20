import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { Shell } from './layout/Shell';
import { Dashboard } from './pages/Dashboard';
import { EntityList } from './pages/EntityList';
import { EntityDetail } from './pages/EntityDetail';
import { Changesets } from './pages/Changesets';
import { ChangesetDetail } from './pages/ChangesetDetail';
import { Trash } from './pages/Trash';

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

const routeTree = rootRoute.addChildren([dashboard, list, detail, changesets, changeset, trash]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
