import { describe, expect, it } from 'vitest';
import { atomXml, escapeXml, robotsTxt, sitemapXml } from '../src/lib/xml';

describe('사이트맵·robots·Atom(WP 7.5)', () => {
  it('이스케이프', () => {
    expect(escapeXml(`a<b>&"'`)).toBe('a&lt;b&gt;&amp;&quot;&apos;');
  });
  it('사이트맵은 절대 주소 + lastmod(날짜만)', () => {
    const x = sitemapXml('https://k-raildex.com', [
      { path: '/', lastmod: null },
      { path: '/lines/line-a/', lastmod: '2026-11-21T09:00:00Z' },
    ]);
    expect(x).toContain('<loc>https://k-raildex.com/</loc></url>');
    expect(x).toContain('<loc>https://k-raildex.com/lines/line-a/</loc><lastmod>2026-11-21</lastmod>');
    expect(x.startsWith('<?xml')).toBe(true);
  });
  it('robots 는 /api/ 제외 + 사이트맵', () => {
    const r = robotsTxt('https://k-raildex.com');
    expect(r).toContain('Disallow: /api/');
    expect(r).toContain('Sitemap: https://k-raildex.com/sitemap.xml');
  });
  it('Atom: 데이터 판마다 항목, 링크는 첫 공개 개체', () => {
    const x = atomXml('https://k-raildex.com', '한국철도도감', [
      {
        version: 228,
        committed_at: '2026-11-21T09:35:06.470932+00:00',
        entity_count: 5,
        entities: [
          { id: 'x', type: 'line', name_ko: 'A&B선', url_path: null },
          { id: 'line-b', type: 'line', name_ko: '나선', url_path: '/lines/line-b/' },
        ],
      },
    ]);
    expect(x).toContain('<id>https://k-raildex.com/changes.xml#v228</id>');
    expect(x).toContain('<link rel="alternate" href="https://k-raildex.com/lines/line-b/"/>');
    expect(x).toContain('<title>A&amp;B선, 나선 외 2건 갱신</title>');
    expect(x).toContain('<updated>2026-11-21T09:35:06.470Z</updated>');
  });
});
