/** robots.txt(WP 7.5) — 모두 허용, Route Handler(/api/) 제외, 사이트맵 주소 */
import { siteUrl } from '@/lib/site';
import { robotsTxt } from '@/lib/xml';

export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(robotsTxt(siteUrl()), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}
