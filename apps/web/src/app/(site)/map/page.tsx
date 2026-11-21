/**
 * 지도·미래 지도(P1 `/map/`, docs/06 3절). 서버는 연도별 건수(/v1/public/map/timeline)와 배경 지도 키만 넘기고,
 * 지도 자료는 브라우저가 web Route Handler(/api/map/*)로 받는다(FR-WEB-002). MapLibre 는 이 페이지에서만 받는다.
 * VWorld 키(VWORLD_API_KEY)는 서버 환경 변수 — 브라우저 타일 주소에 들어가는 도메인 묶인 공개 키다(관리 앱과 같음).
 */
import type { Metadata } from 'next';
import { FutureMap } from '@/components/map/future-map';
import { getMapTimeline } from '@/lib/data';
import { parseStageKey, STAGE_MIN } from '@/lib/map-years';
import { pageMeta } from '@/lib/site';
import { firstParam } from '@/lib/urls';

export const metadata: Metadata = pageMeta(
  '지도·미래 지도',
  '대한민국 철도 지도 — 현재 노선·역과, 연도를 옮기며 개통 예정(공식·보도 근거) 계획이 더해지는 미래 지도. 선 모양은 사업 단계.',
  '/map/',
);

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function MapPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const stage = parseStageKey(firstParam(sp.stage));
  const timeline = await getMapTimeline(STAGE_MIN[stage]);
  const at = firstParam(sp.at) ?? null;
  return (
    <>
      <h1 className="sr-only">지도·미래 지도</h1>
      <FutureMap
        initialAt={at}
        initialStage={stage}
        timeline={timeline}
        vworldKey={process.env.VWORLD_API_KEY?.trim() || null}
      />
    </>
  );
}
