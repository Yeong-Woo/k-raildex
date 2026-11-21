import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { entityUiMeta } from '@k-raildex/contracts';
import { cn } from '@k-raildex/ui';
import {
  Cog,
  Database,
  Gauge,
  Globe,
  History,
  Inbox,
  LayoutDashboard,
  Map as MapIcon,
  Moon,
  Search,
  Settings2,
  Sheet,
  Sun,
  Trash2,
} from 'lucide-react';
import { NAV_GROUPS, toSlug } from '../lib/entity-types';
import { GlobalSearch } from './GlobalSearch';

function NavLink({
  to,
  params,
  search,
  children,
}: {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      params={params as never}
      search={search as never}
      activeOptions={search ? { includeSearch: true, exact: false } : undefined}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg-muted hover:bg-muted hover:text-fg"
      activeProps={{ className: 'bg-muted text-fg font-medium' }}
    >
      {children}
    </Link>
  );
}

export function Shell() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | null>(() => {
    try {
      return (localStorage.getItem('theme') as 'light' | 'dark' | null) ?? null;
    } catch {
      return null;
    }
  });
  const navigate = useNavigate();

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try {
      if (theme) localStorage.setItem('theme', theme);
      else localStorage.removeItem('theme');
    } catch {
      /* 저장 불가 */
    }
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const dark = theme === 'dark' || (theme === null && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-bg-elevated p-3">
        <div className="px-2 text-sm font-bold">한국철도도감 · 관리</div>
        <button
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm text-fg-muted hover:bg-muted"
        >
          <Search className="size-4" /> 검색 <kbd className="ml-auto text-xs">⌘K</kbd>
        </button>
        <nav className="flex flex-col gap-0.5">
          <NavLink to="/">
            <LayoutDashboard className="size-4" /> 대시보드
          </NavLink>
        </nav>
        {NAV_GROUPS.map((g) => (
          <nav key={g.label} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1 px-2 text-xs font-semibold text-fg-muted">
              <Database className="size-3" /> {g.label}
            </div>
            {g.types.map((t) => (
              <NavLink key={t} to="/data/$type" params={{ type: toSlug(t) }}>
                {entityUiMeta[t].label}
              </NavLink>
            ))}
          </nav>
        ))}
        <nav className="flex flex-col gap-0.5">
          <div className="px-2 text-xs font-semibold text-fg-muted">지도</div>
          <NavLink to="/map" search={{ tab: 'edit' }}>
            <MapIcon className="size-4" /> 지도 편집
          </NavLink>
          <NavLink to="/map" search={{ tool: 'line' }}>
            <MapIcon className="size-4" /> 노선 편집
          </NavLink>
          <NavLink to="/map" search={{ tool: 'geometry' }}>
            <MapIcon className="size-4" /> 계획 선형 편집
          </NavLink>
          <NavLink to="/map" search={{ tab: 'future' }}>
            <MapIcon className="size-4" /> 미래 지도
          </NavLink>
          <NavLink to="/map" search={{ tab: 'satellite' }}>
            <MapIcon className="size-4" /> 위성 비교
          </NavLink>
          <NavLink to="/map" search={{ tool: 'osm' }}>
            <MapIcon className="size-4" /> OSM 매핑 점검
          </NavLink>
        </nav>
        <nav className="flex flex-col gap-0.5">
          <div className="px-2 text-xs font-semibold text-fg-muted">검수·기록</div>
          <NavLink to="/quality">
            <Gauge className="size-4" /> 품질
          </NavLink>
          <NavLink to="/changesets">
            <Inbox className="size-4" /> 변경 묶음
          </NavLink>
          <NavLink to="/bulk">
            <Sheet className="size-4" /> 여러 건 입력
          </NavLink>
          <NavLink to="/trash">
            <Trash2 className="size-4" /> 휴지통
          </NavLink>
        </nav>
        <nav className="flex flex-col gap-0.5">
          <div className="px-2 text-xs font-semibold text-fg-muted">조사</div>
          <NavLink to="/external">
            <Globe className="size-4" /> 외부 API
          </NavLink>
        </nav>
        <nav className="flex flex-col gap-0.5">
          <div className="px-2 text-xs font-semibold text-fg-muted">운영</div>
          <NavLink to="/jobs">
            <Cog className="size-4" /> 작업
          </NavLink>
          <NavLink to="/settings">
            <Settings2 className="size-4" /> 설정
          </NavLink>
        </nav>
        <div className="mt-auto flex items-center gap-1 px-1">
          <button
            className={cn('rounded p-1.5 text-fg-muted hover:bg-muted')}
            title="테마 전환"
            onClick={() => setTheme(dark ? 'light' : 'dark')}
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <History className="ml-auto size-4 text-fg-muted" aria-hidden />
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6">
        <Outlet />
      </main>
      <GlobalSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onPick={(type, id) => {
          setSearchOpen(false);
          void navigate({ to: '/data/$type/$id', params: { type: toSlug(type), id } });
        }}
      />
    </div>
  );
}
