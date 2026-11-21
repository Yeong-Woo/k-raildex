/** 소개·비상업 고지(P2 `/about/`, NFR-WEB-004·005) */
import type { Metadata } from 'next';
import { pageMeta } from '@/lib/site';
import { paths } from '@/lib/urls';

export const metadata: Metadata = pageMeta(
  '소개',
  '한국철도도감 소개 — 대한민국 철도의 현재와 계획을 출처와 함께 정리하는 비상업 공개 자료. 라이선스와 이용 조건.',
  '/about/',
);

export default function AboutPage() {
  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)', maxWidth: '52rem' }}>
      <div className="page-head">
        <h1>소개</h1>
        <p className="lead">
          한국철도도감(K-Raildex)은 대한민국 철도의 현재 정보(노선·역·운행 계통·열차·시간표)와 계획 정보(상위 계획·계획
          사업·단계·근거 고시)를 출처와 함께 정리하는 공개 자료입니다.
        </p>
      </div>
      <div className="prose-text">
        <h2>원칙</h2>
        <ul>
          <li>모든 사실에 출처와 확인일을 붙입니다. 확인하지 못한 값은 비워 두고 “미확인”으로 표시합니다.</li>
          <li>출처는 법령·고시 → 국토교통부·국가철도공단·운영기관 → 언론 → 위키(보조) 순으로 믿습니다.</li>
          <li>
            물리 노선과 운행 계통을 구분합니다. “광역철도”는 노선의 법적 지정, “광역전철”은 운행 계통의 종류입니다.
            열차번호와 차량번호, 열차 등급과 차량 형식도 서로 다릅니다.
          </li>
          <li>
            계획 사업은 늘 사업 단계와 함께 보이고, 개통 예정은 공식 발표·보도로 확인한 것만 싣습니다(바뀔 수 있음).
          </li>
          <li>
            사람이 검수하지 않은 값에는 “검수 전” 배지를 붙입니다. 틀린 곳은 각 페이지의 “오류 제보”로 알려 주세요.
          </li>
        </ul>
        <h2 id="non-commercial">비상업 고지</h2>
        <p>
          이 사이트는 비상업 공개 자료입니다. 광고·유료 기능·후원 결제가 없고, 방문자 추적(쿠키·분석 스크립트)을 하지
          않습니다. 공공누리 제4유형(비상업·변경 금지) 저작물을 원본 그대로 싣기 때문에 상업적 기능을 넣지 않습니다.
        </p>
        <h2 id="licenses">라이선스</h2>
        <ul>
          <li>
            <b>공공누리</b>: 공공기관 저작물은 각 출처의 공공누리 유형에 따라 출처를 표시합니다. 제4유형 원문은 변경
            없이 비상업 조건으로만 제공합니다.
          </li>
          <li>
            <b>OpenStreetMap</b>: 지도 선형 일부는 © OpenStreetMap 기여자, ODbL 을 따릅니다. OSM 자료는 자체 데이터와
            분리해 지도에만 씁니다.
          </li>
          <li>
            <b>배경 지도</b>: VWorld(국토교통부). 쓸 수 없을 때는 OpenStreetMap 표준 타일.
          </li>
          <li>
            <b>글꼴</b>: Pretendard(SIL Open Font License 1.1), 사이트에서 직접 제공합니다(외부 글꼴 서버 없음).
          </li>
        </ul>
        <p>
          출처별 조건과 원문 내려받기는 <a href={paths.sources()}>출처·라이선스</a>에 모았습니다.
        </p>
        <h2>참고 사이트</h2>
        <p>
          화면 구성은 여러 철도 정보 사이트를 참고했지만 데이터는 복제하지 않고 1차 출처에서 직접 모읍니다. 새 소식은{' '}
          <a href="/changes.xml">변경 기록(Atom)</a>으로 받아 볼 수 있습니다.
        </p>
      </div>
    </div>
  );
}
