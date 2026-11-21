/** 변경 기록 Atom(WP 7.5, 기존 `/changes.xml` 승계) — 공개 API `/v1/public/feed/changes`(반영된 변경 묶음 = 데이터 판) */
import { getFeed } from '@/lib/data';
import { SITE_NAME, siteUrl } from '@/lib/site';
import { atomXml } from '@/lib/xml';

export const dynamic = 'force-dynamic';

export async function GET() {
  const items = await getFeed(50);
  return new Response(atomXml(siteUrl(), SITE_NAME, items), {
    headers: {
      'content-type': 'application/atom+xml; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=600',
    },
  });
}
