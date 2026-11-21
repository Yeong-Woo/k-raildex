'use client';
/**
 * 라이트/다크 전환(R10: localStorage 한 값, 쿠키 없음). 기본은 OS 설정(prefers-color-scheme).
 * 첫 그림 전 적용은 layout 의 THEME_INIT_SCRIPT 가 맡아 깜박임이 없다. 아이콘은 CSS 가 data-theme 로 고른다.
 */
import { THEME_KEY } from '@/lib/theme';

export function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const current =
      root.dataset.theme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* 저장 못 하면 이번 페이지만 */
    }
  };
  return (
    <button
      type="button"
      className="btn icon theme-toggle"
      onClick={toggle}
      aria-label="밝은/어두운 화면 전환"
      title="밝은/어두운 화면 전환"
    >
      <svg
        className="sun"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <svg
        className="moon"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    </button>
  );
}
