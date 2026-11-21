/** 사이트맵(WP 7.5, NFR-WEB-003) — 공개 API `/v1/public/sitemap-entries` 의 경로 + SITE_URL */
import { getSitemapEntries } from '@/lib/data';
import { siteUrl } from '@/lib/site';
import { sitemapXml } from '@/lib/xml';

export const dynamic = 'force-dynamic';

export async function GET() {
  const items = await getSitemapEntries();
  return new Response(sitemapXml(siteUrl(), items), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=3600',
    },
  });
}
