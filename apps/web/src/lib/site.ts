/** 사이트 공통 상수·메타데이터 도우미 */
import type { Metadata } from 'next';

export const SITE_NAME = '한국철도도감';

/** 정규 주소 기준(canonical·OpenGraph). SITE_URL 이 없으면 로컬 개발 주소 */
export function siteUrl(): string {
  return (process.env.SITE_URL || 'http://127.0.0.1:5303').replace(/\/+$/, '');
}

/** 페이지 메타데이터: 제목·설명·canonical(끝 '/' 유지)·OpenGraph */
export function pageMeta(title: string, description: string, path: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path, types: { 'application/atom+xml': '/changes.xml' } },
    openGraph: { title, description, url: path, siteName: SITE_NAME, locale: 'ko_KR', type: 'website' },
  };
}

/** 설명문을 메타데이터 길이(약 160자)로 */
export function clip(text: string, n = 160): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
