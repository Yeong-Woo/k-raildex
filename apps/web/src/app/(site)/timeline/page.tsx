/** 연표(P2 `/timeline/`): 최신 10년. 지난 연대는 `/timeline/<연대>s/` */
import type { Metadata } from 'next';
import { DecadeNav, TimelineBody } from '@/components/timeline';
import { getTimelineDecade, getTimelineDecades, getTimelineUndatedCount } from '@/lib/data';
import { pageMeta } from '@/lib/site';
import { firstParam, paths, withQuery } from '@/lib/urls';

export const metadata: Metadata = pageMeta(
  '연표',
  '대한민국 철도의 개통·폐지·명칭 변경·계획 반영 기록을 연도별로 — 최근 10년.',
  '/timeline/',
);

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function TimelinePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [decades, undated] = await Promise.all([getTimelineDecades(), getTimelineUndatedCount()]);
  const latest = Math.max(...decades.map((d) => d.decade), new Date().getFullYear() - (new Date().getFullYear() % 10));
  const page = await getTimelineDecade(latest);
  const type = firstParam(sp.type) ?? 'all';
  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
      <div className="page-head">
        <h1>연표</h1>
        <p className="lead">
          {latest}년대 철도 기록입니다(최신 연도 먼저). 지난 연대는 아래 목차에서 고릅니다. 계획 사업의 단계 변화는 각{' '}
          <a href={paths.plans()}>계획</a> 상세의 단계 이력에도 있습니다.
        </p>
        <DecadeNav decades={decades} current={latest} undated={undated} />
      </div>
      <TimelineBody
        events={page.items}
        type={type}
        typeHref={(t) => withQuery(paths.timeline(), {}, { type: t }, { type: 'all' })}
      />
    </div>
  );
}
