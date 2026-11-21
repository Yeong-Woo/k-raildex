/** 탭·필터 링크 — 서버에서 그리는 <a> 목록(JS 없이 동작, NFR-WEB-002). 현재 값은 aria-current */
export interface TabItem {
  value: string;
  label: string;
  href: string;
  count?: number;
}

export function LinkTabs({
  items,
  current,
  label,
  small,
}: {
  items: TabItem[];
  current: string;
  label: string;
  small?: boolean;
}) {
  return (
    <ul className={`tabs${small ? ' small' : ''}`} aria-label={label}>
      {items.map((t) => (
        <li key={t.value}>
          <a href={t.href} aria-current={t.value === current ? 'true' : undefined}>
            {t.label}
            {t.count != null ? <span className="count">{t.count.toLocaleString('ko-KR')}</span> : null}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="filter-row">
      <span className="label">{label}</span>
      {children}
    </div>
  );
}
