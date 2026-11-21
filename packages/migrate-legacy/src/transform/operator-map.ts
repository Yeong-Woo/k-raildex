/**
 * 운영기관 대응표(WP 3.2 operator-map). 기존 데이터에는 운영기관 개체가 없고
 * 노선 operator_name(원문 문자열 23종)과 번호대 operator enum 만 있다 → 이름 하나당 운영기관 하나.
 * - name_ko 는 기존 원문 표기 그대로(가장 흔한 표기). kind 는 이름(공사·주식회사 등)에서 판단하고 모르면 other.
 * - 기존 enum 라벨은 apps/web/src/lib/labels.ts RSN_OPERATOR_LABEL.
 * 이 표에 없는 원문은 이관 리포트 "운영기관 미매칭" 으로 남는다.
 */
import type { Code } from '@k-raildex/contracts';

export interface OperatorDef {
  id: string;
  name_ko: string;
  kind: Code<'operatorKind'>;
  /** 기존 번호대 operator enum */
  legacyEnum?: string;
  /** 상태가 active 가 아닌 기관(기본 active). 필드 출처(status·merged_into_id·ended)를 함께 둔다(C-1) */
  ended?: {
    status: 'merged' | 'dissolved';
    merged_into_id: string | null;
    date: string;
    sources: string[];
    note: string;
  };
}

export const OPERATORS: OperatorDef[] = [
  { id: 'op-korail', name_ko: '한국철도공사', kind: 'national_corp', legacyEnum: 'korail' },
  {
    id: 'op-sr',
    name_ko: '주식회사 SR',
    kind: 'private',
    legacyEnum: 'sr',
    // round-04 Q102: "SR 은 2026-09-01 자로 모두 코레일에 통합"(사용자 확인). 기존 데이터의 근거는 운영 통합 공지·보도·연표뿐
    ended: {
      status: 'merged',
      merged_into_id: 'op-korail',
      date: '2026-09-01',
      sources: ['src-sr-integration-notice', 'src-news-segye-suseo-ktx-2026', 'src-kric-chronology'],
      note: '사용자 확인(round-04 Q102), 1차 출처 보강 필요 — 법인 합병(통합) 근거 법령·고시·공시 미확보. 지금 근거: SR 누리집 공지(9월 1일 운행 열차부터 KTX 예매), 세계일보 2026-09-01(기관 통합 완료), 철도통합연표 4707 "코레일-에스알 9월 1일 하나로"',
    },
  },
  { id: 'op-seoul-metro', name_ko: '서울교통공사', kind: 'local_corp', legacyEnum: 'seoul_metro' },
  { id: 'op-incheon-transit', name_ko: '인천교통공사', kind: 'local_corp', legacyEnum: 'incheon_transit' },
  { id: 'op-seoul-metro9', name_ko: '서울시메트로9호선㈜', kind: 'private', legacyEnum: 'seoul_metro9' },
  { id: 'op-airport-railroad', name_ko: '공항철도주식회사', kind: 'private', legacyEnum: 'airport_railroad' },
  { id: 'op-neotrans', name_ko: '네오트랜스(주)', kind: 'private', legacyEnum: 'neotrans' },
  // 기존 enum gtx 의 라벨은 "GTX 운영사" — 노선 원문의 GTX-A 운영사 표기(지티엑스에이운영)에 붙인다(검수 필요)
  { id: 'op-gtx-a-operation', name_ko: '지티엑스에이운영', kind: 'other', legacyEnum: 'gtx' },
  { id: 'op-ui-sinseol', name_ko: '우이신설경전철운영㈜', kind: 'private', legacyEnum: 'ui_sinseol' },
  { id: 'op-sillim', name_ko: '남서울경전철 주식회사', kind: 'private', legacyEnum: 'sillim' },
  { id: 'op-gimpo-goldline', name_ko: '김포골드라인에스알에스㈜', kind: 'private', legacyEnum: 'gimpo_goldline' },
  { id: 'op-u-line', name_ko: '의정부경량전철㈜', kind: 'private', legacyEnum: 'u_line' },
  { id: 'op-busan-transit', name_ko: '부산교통공사', kind: 'local_corp' },
  { id: 'op-busan-gimhae-lrt', name_ko: '부산-김해경전철㈜', kind: 'private' },
  { id: 'op-daegu-transit', name_ko: '대구교통공사', kind: 'local_corp' },
  { id: 'op-daejeon-transit', name_ko: '대전교통공사', kind: 'local_corp' },
  { id: 'op-gwangju-transit', name_ko: '광주교통공사', kind: 'local_corp' },
  { id: 'op-yongin-lrt', name_ko: '용인경전철', kind: 'other' },
  { id: 'op-incheon-airport', name_ko: '인천국제공항공사', kind: 'national_corp' },
  { id: 'op-namyangju-urban', name_ko: '남양주도시공사', kind: 'local_corp' },
];

export interface OperatorAssignment {
  operator_id: string;
  note: string | null;
}

/** 노선 operator_name 원문 → 운영기관(여럿이면 순서대로). note = 원문 단서 */
export const LINE_OPERATOR_NAMES: Readonly<Record<string, OperatorAssignment[]>> = {
  한국철도공사: [{ operator_id: 'op-korail', note: null }],
  '한국철도공사 (철도청)': [{ operator_id: 'op-korail', note: '원문 "(철도청)"' }],
  '주식회사 SR': [{ operator_id: 'op-sr', note: null }],
  '한국철도공사 / 주식회사 SR': [
    { operator_id: 'op-korail', note: null },
    { operator_id: 'op-sr', note: null },
  ],
  '주식회사 SR / 지티엑스에이운영': [
    { operator_id: 'op-sr', note: null },
    { operator_id: 'op-gtx-a-operation', note: null },
  ],
  서울교통공사: [{ operator_id: 'op-seoul-metro', note: null }],
  '서울시메트로9호선㈜(4101~4125) / 서울교통공사 9호선운영부문(4126~4138)': [
    { operator_id: 'op-seoul-metro9', note: '역번호 4101~4125' },
    { operator_id: 'op-seoul-metro', note: '9호선운영부문, 역번호 4126~4138' },
  ],
  인천교통공사: [{ operator_id: 'op-incheon-transit', note: null }],
  공항철도주식회사: [{ operator_id: 'op-airport-railroad', note: null }],
  '네오트랜스(주)': [{ operator_id: 'op-neotrans', note: null }],
  '우이신설경전철운영㈜': [{ operator_id: 'op-ui-sinseol', note: null }],
  '남서울경전철 주식회사': [{ operator_id: 'op-sillim', note: null }],
  '김포골드라인에스알에스㈜': [{ operator_id: 'op-gimpo-goldline', note: null }],
  '의정부경량전철㈜': [{ operator_id: 'op-u-line', note: null }],
  부산교통공사: [{ operator_id: 'op-busan-transit', note: null }],
  '부산-김해경전철㈜': [{ operator_id: 'op-busan-gimhae-lrt', note: null }],
  대구교통공사: [{ operator_id: 'op-daegu-transit', note: null }],
  대전교통공사: [{ operator_id: 'op-daejeon-transit', note: null }],
  광주교통공사: [{ operator_id: 'op-gwangju-transit', note: null }],
  용인경전철: [{ operator_id: 'op-yongin-lrt', note: null }],
  인천국제공항공사: [{ operator_id: 'op-incheon-airport', note: null }],
  남양주도시공사: [{ operator_id: 'op-namyangju-urban', note: null }],
};

/**
 * 번호대 operator 가 enum "other" 인 것: id 접두사로 운영기관을 정한다(route_text 의 노선명 기준, 검수 필요).
 * 긴 접두사부터 비교한다.
 */
export const OTHER_RANGE_OPERATOR: Readonly<Record<string, string>> = {
  'tnr-arex': 'op-airport-railroad',
  'tnr-metro9': 'op-seoul-metro9',
  'tnr-sinbundang': 'op-neotrans',
  'tnr-u-line': 'op-u-line',
  'tnr-everline': 'op-yongin-lrt',
  'tnr-ui-sinseol': 'op-ui-sinseol',
  'tnr-gimpo-goldline': 'op-gimpo-goldline',
  'tnr-sillim': 'op-sillim',
  'tnr-icn-': 'op-incheon-transit',
};

export function operatorOfEnum(legacyEnum: string, rangeId: string): string | null {
  if (legacyEnum === 'other') {
    const hit = Object.keys(OTHER_RANGE_OPERATOR)
      .sort((a, b) => b.length - a.length)
      .find((p) => rangeId.startsWith(p));
    return hit ? OTHER_RANGE_OPERATOR[hit]! : null;
  }
  return OPERATORS.find((o) => o.legacyEnum === legacyEnum)?.id ?? null;
}
