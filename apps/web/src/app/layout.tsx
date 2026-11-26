import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
// Pretendard Variable(SIL OFL 1.1) 동적 부분 집합 — 빌드가 woff2 를 /_next/static 으로 옮겨 자가 호스팅한다(외부 CDN 없음, R1)
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './globals.css';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { THEME_KEY } from '@/lib/theme';
import { getVersion } from '@/lib/data';
import { OG_IMAGE, SITE_NAME, siteUrl } from '@/lib/site';

// 데이터는 요청 때 공개 API 에서(FR-WEB-001) — 빌드 때 미리 그리지 않는다. fetch 캐시(30초·태그)는 lib/api.ts
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: `${SITE_NAME} — 대한민국 철도의 지금과 앞으로`, template: `%s · ${SITE_NAME}` },
  description: '대한민국 철도의 노선·역·운행 계통·시간표와 계획 사업을 출처와 함께 정리한 비상업 공개 자료.',
  applicationName: SITE_NAME,
  openGraph: { siteName: SITE_NAME, locale: 'ko_KR', type: 'website', images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', images: [OG_IMAGE.url] },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F5F7F9' },
    { media: '(prefers-color-scheme: dark)', color: '#101317' },
  ],
};

/** 첫 그림 전에 저장된 배색을 적용(깜박임 없음). 값이 없으면 OS 설정을 따른다 */
const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const version = await getVersion().catch(() => null);
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <a className="skip" href="#main">
          본문으로 건너뛰기
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter dataVersion={version} />
      </body>
    </html>
  );
}
