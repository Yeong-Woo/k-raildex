/**
 * 옛 앵커 → 새 앵커(FR-WEB-004, Q69 A). 서버는 `#…` 를 볼 수 없어 페이지에 작은 인라인 스크립트를 넣는다.
 * 예: `/plans/programs/#national_rail_4` → `#pp-national-rail-4`, `/plans/?program=…#program-national_rail_4` → `#program-pp-national-rail-4`.
 */
import { getRedirectList } from '@/lib/data';
import { legacyAnchorScript } from '@/lib/redirects';

export async function LegacyAnchors({ types }: { types: string[] }) {
  const list = await getRedirectList().catch(() => []);
  const pairs = list.filter((r) => types.includes(r.type)).map((r) => [r.old_id, r.new_id] as const);
  if (pairs.length === 0) return null;
  return <script dangerouslySetInnerHTML={{ __html: legacyAnchorScript(pairs) }} />;
}
