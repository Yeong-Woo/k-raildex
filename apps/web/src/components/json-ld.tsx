/** 구조화 데이터(NFR-WEB-003). `</script>` 가 끼지 않게 '<' 를 이스케이프한다 */
import { siteUrl } from '@/lib/site';

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}

/** 이동 경로 BreadcrumbList(마지막 항목은 현재 페이지) */
export function BreadcrumbLd({ items }: { items: { label: string; path: string }[] }) {
  const base = siteUrl();
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((it, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: it.label,
          item: `${base}${it.path}`,
        })),
      }}
    />
  );
}
