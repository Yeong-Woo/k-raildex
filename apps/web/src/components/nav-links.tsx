'use client';
/** 머리 탐색 — 현재 절에 aria-current(경로 앞부분으로 판정). 링크 자체는 JS 없이도 동작 */
import { usePathname } from 'next/navigation';

export interface NavItem {
  href: string;
  label: string;
  /** 이 앞부분으로 시작하는 경로를 현재로 본다 */
  match: string;
}

export function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname() ?? '/';
  return (
    <nav className="nav" aria-label="주 메뉴">
      {items.map((n) => (
        <a key={n.href} href={n.href} aria-current={path.startsWith(n.match) ? 'page' : undefined}>
          {n.label}
        </a>
      ))}
    </nav>
  );
}
