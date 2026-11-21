/** 사이트맵·Atom·robots 문서 만들기(순수 함수 — test/xml.test.ts). WP 7.5, NFR-WEB-003 */

export function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

const abs = (base: string, path: string) => `${base}${path.startsWith('/') ? '' : '/'}${path}`;

/** lastmod 는 YYYY-MM-DD(또는 ISO)만 싣는다 */
export function sitemapXml(base: string, entries: readonly { path: string; lastmod: string | null }[]): string {
  const rows = entries.map((e) => {
    const lm = e.lastmod ? `<lastmod>${escapeXml(e.lastmod.slice(0, 10))}</lastmod>` : '';
    return `  <url><loc>${escapeXml(abs(base, e.path))}</loc>${lm}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`;
}

export function robotsTxt(base: string): string {
  return ['User-agent: *', 'Allow: /', 'Disallow: /api/', '', `Sitemap: ${base}/sitemap.xml`, ''].join('\n');
}

export interface FeedItem {
  version: number;
  committed_at: string;
  entity_count: number;
  entities: { id: string; type: string; name_ko: string; url_path: string | null }[];
}

/** 데이터 변경(변경 묶음 반영)마다 항목 하나. 링크 = 첫 공개 개체, 없으면 홈 */
export function atomXml(base: string, siteName: string, items: readonly FeedItem[]): string {
  const updated = items[0]?.committed_at ?? new Date(0).toISOString();
  const entries = items.map((it) => {
    const first = it.entities.find((e) => e.url_path);
    const link = abs(base, first?.url_path ?? '/');
    const names = it.entities.map((e) => e.name_ko);
    const title =
      names.length === 0
        ? `데이터 판 #${it.version}`
        : `${names.slice(0, 3).join(', ')}${it.entity_count > 3 ? ` 외 ${it.entity_count - 3}건` : ''} 갱신`;
    const list = it.entities
      .map(
        (e) =>
          `<li>${e.url_path ? `<a href="${escapeXml(abs(base, e.url_path))}">${escapeXml(e.name_ko)}</a>` : escapeXml(e.name_ko)}</li>`,
      )
      .join('');
    const summary = `데이터 판 #${it.version} — 개체 ${it.entity_count}건 변경${list ? `<ul>${list}</ul>` : ''}`;
    return [
      '  <entry>',
      `    <id>${escapeXml(`${base}/changes.xml#v${it.version}`)}</id>`,
      `    <title>${escapeXml(title)}</title>`,
      `    <updated>${escapeXml(new Date(it.committed_at).toISOString())}</updated>`,
      `    <link rel="alternate" href="${escapeXml(link)}"/>`,
      `    <content type="html">${escapeXml(summary)}</content>`,
      '  </entry>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="ko">',
    `  <id>${escapeXml(`${base}/`)}</id>`,
    `  <title>${escapeXml(`${siteName} 변경 기록`)}</title>`,
    `  <updated>${escapeXml(new Date(updated).toISOString())}</updated>`,
    `  <link rel="self" href="${escapeXml(`${base}/changes.xml`)}"/>`,
    `  <link rel="alternate" href="${escapeXml(`${base}/`)}"/>`,
    `  <author><name>${escapeXml(siteName)}</name></author>`,
    ...entries,
    '</feed>',
    '',
  ].join('\n');
}
