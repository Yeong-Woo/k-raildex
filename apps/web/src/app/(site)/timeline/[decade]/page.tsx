/** 연표 연대 페이지(`/timeline/2010s/`, 기존 Q87 B). 최신 연대는 `/timeline/` 이 맡는다 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DecadeNav, TimelineBody } from '@/components/timeline';
import { getTimelineDecade, getTimelineDecades, getTimelineUndatedCount } from '@/lib/data';
import { pageMeta } from '@/lib/site';
import { firstParam, parseDecade, paths, withQuery } from '@/lib/urls';

type Params = Promise<{ decade: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { decade } = await params;
  const d = parseDecade(decade);
  if (d === null) notFound();
  return pageMeta(
    `연표 ${d}년대`,
    `${d}년대 대한민국 철도의 개통·폐지·명칭 변경·계획 반영 기록.`,
    paths.timelineDecade(d),
  );
}

export default async function DecadePage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const { decade } = await params;
  const sp = await searchParams;
  const d = parseDecade(decade);
  if (d === null) notFound();
  const [decades, undated] = await Promise.all([getTimelineDecades(), getTimelineUndatedCount()]);
  if (!decades.some((x) => x.decade === d)) notFound();
  const page = await getTimelineDecade(d);
  const type = firstParam(sp.type) ?? 'all';
  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
      <div className="page-head">
        <h1>연표 — {d}년대</h1>
        <p className="lead">
          {d}~{d + 9}년의 철도 기록 {page.items.length.toLocaleString('ko-KR')}건. 최근 기록은{' '}
          <a href={paths.timeline()}>연표</a>.
        </p>
        <DecadeNav decades={decades} current={d} undated={undated} />
      </div>
      <TimelineBody
        events={page.items}
        type={type}
        typeHref={(t) => withQuery(paths.timelineDecade(d), {}, { type: t }, { type: 'all' })}
      />
    </div>
  );
}
