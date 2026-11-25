/** 연표 "연도 미상"(`/timeline/unknown/`, Q117 A): 날짜를 모르는 기록. 기존 `?area=`(권역) 그대로 받는다 */
import type { Metadata } from 'next';
import { DecadeNav, TimelineAreaTabs, TimelineBody, TIMELINE_AREAS } from '@/components/timeline';
import { getTimelineDecades, getTimelineUndated } from '@/lib/data';
import { pageMeta } from '@/lib/site';
import { firstParam, paths, pickParam, withQuery } from '@/lib/urls';

export const metadata: Metadata = pageMeta(
  '연표 — 연도 미상',
  '날짜를 확인하지 못한 대한민국 철도 기록(개통·폐지·명칭 변경 등).',
  '/timeline/unknown/',
);

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function TimelineUnknownPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const area = pickParam(sp.area, TIMELINE_AREAS, 'all');
  const [decades, items] = await Promise.all([
    getTimelineDecades(),
    getTimelineUndated(area === 'all' ? undefined : area),
  ]);
  const undated = area === 'all' ? items.length : (await getTimelineUndated()).length;
  const type = firstParam(sp.type) ?? 'all';
  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
      <div className="page-head">
        <h1>연표 — 연도 미상</h1>
        <p className="lead">
          날짜를 확인하지 못한 기록 {items.length.toLocaleString('ko-KR')}건입니다. 날짜가 확인되면 해당 연대로
          옮겨집니다. 날짜가 있는 기록은 <a href={paths.timeline()}>연표</a>.
        </p>
        <DecadeNav decades={decades} current="unknown" undated={undated} />
      </div>
      <TimelineAreaTabs
        area={area}
        href={(a) => withQuery(paths.timelineUnknown(), { area, type }, { area: a }, { type: 'all', area: 'all' })}
      />
      <TimelineBody
        events={items}
        type={type}
        typeHref={(t) => withQuery(paths.timelineUnknown(), { area, type }, { type: t }, { type: 'all', area: 'all' })}
      />
    </div>
  );
}
