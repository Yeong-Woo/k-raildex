/**
 * 코드값 단일 정의 (docs/03-data-model.md 5절).
 * DB 의 CHECK 제약은 이 목록과 같아야 한다 — packages/db 의 시험(codes-sync)이 pg_constraint 와 대조한다.
 * 값을 추가·삭제하면 SQL 마이그레이션의 CHECK 도 함께 바꾼다.
 */

export interface CodeInfo {
  /** 한국어 라벨 */
  readonly ko: string;
  /** 설명(선택) */
  readonly desc?: string;
}

type CodeTable<K extends string> = { readonly [P in K]: CodeInfo };

function table<const K extends string>(t: CodeTable<K>) {
  const values = Object.keys(t) as K[];
  return { values: values as readonly K[], labels: t } as const;
}

export const codes = {
  entityType: table({
    source: { ko: '출처' },
    operator: { ko: '운영기관' },
    station: { ko: '역' },
    line_station: { ko: '정거장' },
    line: { ko: '노선' },
    train_class: { ko: '열차 등급' },
    service: { ko: '운행 계통' },
    plan_program: { ko: '상위 계획' },
    plan: { ko: '계획 사업' },
    event: { ko: '연표 이벤트' },
    train_number_range: { ko: '열차번호대' },
    rolling_stock_range: { ko: '차량번호대' },
    transfer_center: { ko: '환승센터' },
    route_map: { ko: '노선도' },
    glossary_term: { ko: '용어' },
    facility: { ko: '시설' },
  }),
  status: table({
    operating: { ko: '운영 중' },
    suspended: { ko: '휴업', desc: '운행 중지, 공식 폐지 아님' },
    under_construction: { ko: '공사 중' },
    planned: { ko: '계획' },
    abandoned: { ko: '계획 폐기' },
    closed: { ko: '폐선·폐역·운행 종료' },
  }),
  stationKind: table({
    station: { ko: '여객역' },
    freight: { ko: '화물역' },
    operational: {
      ko: '운전 취급',
      desc: '여객·화물 취급 없이 교행·대피·조성만 하는 정거장(신호장·신호소·조차장 — 구분은 정거장의 코레일 정거장 등급, 0044)',
    },
    // 차량기지는 시설(facilityKind), 분기점·연결선은 지선(line). 신호장·신호소·조차장은 2026-11-28 시설에서 되돌림(0044)
  }),
  /** 한국철도공사 정거장 등급(직제상 지위, 직제규정 시행세칙 — 0031) */
  korailStationClass: table({
    management: { ko: '관리역', desc: '소속 역을 거느리는 역(1~3급)' },
    ordinary: { ko: '보통역' },
    operating_halt: { ko: '운전간이역' },
    staffed_halt: { ko: '배치간이역' },
    consigned_ticket: { ko: '갑종 위탁발매소' },
    unstaffed_halt: { ko: '무배치간이역', desc: '을종 위탁 포함' },
    temporary_platform: { ko: '임시승강장' },
    yard: { ko: '조차장' },
    signal_station: { ko: '신호장' },
    signal_post: { ko: '신호소' },
  }),
  /** 시설 종류(0035) */
  facilityKind: table({
    depot: { ko: '차량기지' },
    test_track: { ko: '시험 선로', desc: '차량·부품 시험용 선로(영업 노선 아님, Q141)' },
    // 신호장·신호소·조차장은 2026-11-28 정거장으로 되돌림(구분 = 정거장의 코레일 정거장 등급, 0044·0045)
  }),
  /** 시설 ↔ 노선 역할(0035) */
  facilityLineRole: table({
    serves: { ko: '담당 노선', desc: '이 시설이 차량을 맡는 노선' },
    connects: { ko: '붙은 선로', desc: '시설이 이어진 노선(기지선 등)' },
  }),
  /** 시설(차량기지) 기능(0035) */
  facilityFunction: table({
    stabling: { ko: '주박', desc: '열차를 세워 두는 곳' },
    inspection: { ko: '검수', desc: '일상·월상 점검' },
    light_maintenance: { ko: '경정비' },
    heavy_maintenance: { ko: '중정비' },
    track_maintenance: { ko: '시설·선로 보수', desc: '차량이 아닌 선로·전기 시설 보수기지' },
  }),
  coordSource: table({
    official: { ko: '기관 공개 좌표' },
    manual: { ko: '수기 확인' },
    derived: { ko: '추정(지오코더·대표점)' },
  }),
  coordBasis: table({
    parcel: { ko: '고시 지번' },
    district: { ko: '법정동 대표점' },
    township: { ko: '읍·면 대표점' },
    existing_station: { ko: '기존 역 좌표' },
  }),
  regionBasis: table({
    address: { ko: '주소' },
    interpolated: { ko: '노선 순서 보간' },
    manual: { ko: '수기 지정' },
  }),
  lineCategory: table({
    high_speed: { ko: '고속선' },
    conventional: { ko: '일반선' },
    metro: { ko: '지하철' },
    light_rail: { ko: '경전철' },
    tram: { ko: '노면전차' },
    monorail: { ko: '모노레일' },
    maglev: { ko: '자기부상' },
  }),
  railClass: table({
    high_speed: { ko: '고속철도' },
    conventional: { ko: '일반철도' },
    urban: { ko: '도시철도' },
  }),
  lineRole: table({
    depot_line: { ko: '기지선' },
    connecting_line: { ko: '연결선' },
    wye: { ko: '삼각선' },
  }),
  track: table({
    single: { ko: '단선' },
    double: { ko: '복선' },
    quadruple: { ko: '복복선' },
    sextuple: { ko: '3복선' },
    single_parallel: { ko: '단선 병렬' },
    partial_double: { ko: '부분 복선' },
  }),
  serviceKind: table({
    high_speed: { ko: '고속열차' },
    intercity: { ko: '일반열차' },
    wide_area: { ko: '광역전철' },
    metro: { ko: '도시철도' },
    tourist: { ko: '관광열차' },
  }),
  stopPatternType: table({
    local: { ko: '완행' },
    express: { ko: '급행' },
    rapid: { ko: '쾌속' },
    limited: { ko: '특정 정차' },
  }),
  trainClassTier: table({
    high_speed: { ko: '고속' },
    semi_high_speed: { ko: '준고속' },
    express: { ko: '특급' },
    local: { ko: '일반' },
    commuter: { ko: '통근' },
  }),
  trainClassStatus: table({
    active: { ko: '운행 중' },
    retired: { ko: '폐지' },
  }),
  operatorKind: table({
    national_corp: { ko: '공기업(국가)' },
    local_corp: { ko: '지방공기업' },
    private: { ko: '민간' },
    government: { ko: '정부·지자체' },
    other: { ko: '기타' },
  }),
  operatorStatus: table({
    active: { ko: '운영 중' },
    merged: { ko: '통합' },
    dissolved: { ko: '해산' },
  }),
  planProgramKind: table({
    territorial: { ko: '국토종합계획' },
    national_rail: { ko: '국가철도망 구축계획' },
    metro_network: { ko: '도시철도망 구축계획' },
    wide_area_transport: { ko: '광역교통 시행계획' },
    wide_area_improvement: { ko: '광역교통개선대책' },
    transfer_center: { ko: '환승센터 기본계획' },
    other: { ko: '기타' },
  }),
  planProgramStatus: table({
    current: { ko: '현행' },
    superseded: { ko: '대체됨' },
    draft: { ko: '안' },
  }),
  noticeKind: table({
    approval: { ko: '확정·고시' },
    amendment: { ko: '변경' },
    correction: { ko: '정정' },
    submission: { ko: '제출(안)' },
    other: { ko: '기타' },
  }),
  planScope: table({
    line: { ko: '노선' },
    station: { ko: '역' },
    facility: { ko: '기타 시설' },
  }),
  planRefClass: table({
    new: { ko: '신규' },
    review: { ko: '추가검토' },
    continued: { ko: '기시행' },
  }),
  planRefCategory: table({
    high_speed: { ko: '고속철도' },
    conventional: { ko: '일반철도' },
    wide_area: { ko: '광역철도' },
    urban: { ko: '도시철도' },
  }),
  /** 진행 순서대로. abandoned·dormant 는 진행도 밖 */
  planStage: table({
    concept: { ko: '구상' },
    plan_listed: { ko: '상위계획 반영' },
    prefeasibility: { ko: '사전타당성조사' },
    feasibility: { ko: '예비타당성조사' },
    strategic_eia: { ko: '전략환경영향평가' },
    basic_plan: { ko: '기본계획' },
    basic_design: { ko: '기본설계' },
    eia: { ko: '환경영향평가' },
    detail_design: { ko: '실시설계' },
    construction: { ko: '착공·시공' },
    trial_run: { ko: '시운전' },
    opened: { ko: '개통' },
    abandoned: { ko: '폐기' },
    dormant: { ko: '휴면', desc: '후속 상위 계획 미반영' },
  }),
  planStageEventKind: table({
    reached: { ko: '도달' },
    withdrawn: { ko: '철회·보류' },
    dormant: { ko: '휴면' },
  }),
  planStageEventOrigin: table({
    manual: { ko: '수기' },
    gazette_auto: { ko: '관보 자동' },
    agent: { ko: '에이전트' },
  }),
  /** Q94 A: estimate 는 쓰지 않는다(DB CHECK 로 금지) */
  milestoneBasis: table({
    official: { ko: '공식' },
    press: { ko: '보도' },
    estimate: { ko: '추정', desc: '사용 금지(Q94 A)' },
  }),
  planLineRole: table({
    new: { ko: '신설' },
    extends: { ko: '연장' },
    upgrades: { ko: '개량' },
    shares: { ko: '선로 공용' },
    replaces: { ko: '대체(개통 시 사라짐)' },
  }),
  planStationRole: table({
    new: { ko: '신설' },
    existing: { ko: '기존(환승)' },
    closes: { ko: '폐역 예정' },
    subject: { ko: '사업 대상 역' },
  }),
  planRelation: table({
    succeeded_by: { ko: '후속 사업' },
    part_of: { ko: '후속 사업에 포함' },
    same_corridor: { ko: '같은 축' },
    related: { ko: '관련' },
  }),
  planGeometryKind: table({
    schematic: { ko: '개략(경유역)' },
    traced: { ko: '도면 추출' },
    official: { ko: '공식 좌표' },
  }),
  eventType: table({
    opened: { ko: '개통' },
    closed: { ko: '폐지' },
    suspended: { ko: '휴업' },
    resumed: { ko: '운행 재개' },
    renamed: { ko: '명칭 변경' },
    transfer_opened: { ko: '환승 개시' },
    service_started: { ko: '운행 개시' },
    service_ended: { ko: '운행 종료' },
    stage_changed: { ko: '단계 변경' },
    plan_listed: { ko: '계획 반영' },
    other: { ko: '기타' },
  }),
  eventOrigin: table({
    manual: { ko: '수기' },
    chronology: { ko: '철도통합연표' },
    agent: { ko: '에이전트' },
  }),
  tnrGroup: table({
    high_speed: { ko: '고속열차' },
    intercity: { ko: '일반열차' },
    wide_area: { ko: '광역전철' },
    metro: { ko: '도시철도' },
    freight: { ko: '화물' },
    non_revenue: { ko: '비영업' },
    other: { ko: '기타' },
  }),
  parityRule: table({
    odd_down_even_up: { ko: '홀수 하행·짝수 상행' },
    odd_up_even_down: { ko: '홀수 상행·짝수 하행' },
    none: { ko: '규칙 없음' },
  }),
  rsrGroup: table({
    high_speed: { ko: '고속철도차량' },
    intercity: { ko: '간선 전동차' },
    wide_area: { ko: '광역철도차량' },
    metro: { ko: '도시철도 전동차' },
    locomotive: { ko: '기관차' },
    coach: { ko: '객차·발전차' },
    freight: { ko: '화차' },
    other: { ko: '기타' },
  }),
  rsrStatus: table({
    operating: { ko: '운행 중' },
    planned: { ko: '도입 예정' },
    closed: { ko: '전량 퇴역' },
  }),
  transferCenterKind: table({
    complex: { ko: '복합환승센터' },
    transfer: { ko: '환승센터' },
  }),
  transferCenterStatus: table({
    planned: { ko: '계획' },
    design: { ko: '설계' },
    construction: { ko: '공사' },
    completed: { ko: '준공' },
    withdrawn: { ko: '철회·중단' },
    unknown: { ko: '미확인' },
  }),
  tcPlanRefClass: table({
    pilot: { ko: '시범사업' },
    candidate: { ko: '구축 가능 거점' },
    new: { ko: '신규' },
    continued: { ko: '계속' },
    review: { ko: '추가검토' },
  }),
  sourceType: table({
    dataset_file: { ko: '데이터셋 파일' },
    dataset_api: { ko: '데이터셋 API' },
    notice: { ko: '고시·공고' },
    law: { ko: '법령' },
    press_release: { ko: '보도자료' },
    official_page: { ko: '공식 누리집' },
    news: { ko: '언론 보도' },
    map_image: { ko: '노선도·위치도' },
    manual: { ko: '수기 정리' },
    wiki: { ko: '위키(보조)' },
  }),
  sourceRefresh: table({
    yearly: { ko: '매년' },
    quarterly: { ko: '분기' },
    monthly: { ko: '매월' },
    on_event: { ko: '변경 시' },
    once: { ko: '1회' },
  }),
  licenseClass: table({
    public_work: { ko: '공공저작물(저작권법 제7조)' },
    kogl_1: { ko: '공공누리 제1유형' },
    kogl_2: { ko: '공공누리 제2유형' },
    kogl_3: { ko: '공공누리 제3유형' },
    kogl_4: { ko: '공공누리 제4유형' },
    open: { ko: '공개 라이선스' },
    restricted: { ko: '권리 제한' },
    unknown: { ko: '미상' },
  }),
  documentKind: table({
    original: { ko: '원본' },
    text_extract: { ko: '추출 텍스트' },
    snapshot: { ko: '스냅샷' },
    page_image: { ko: '쪽 이미지' },
    figure_crop: { ko: '잘라 낸 그림' },
    upload: { ko: '업로드' },
  }),
  sourceDocumentRole: table({
    original: { ko: '원본' },
    text_extract: { ko: '추출 텍스트' },
    snapshot: { ko: '스냅샷' },
    attachment: { ko: '첨부' },
  }),
  attachmentKind: table({
    quote: { ko: '원문 발췌' },
    link: { ko: '링크' },
    image: { ko: '이미지' },
    document: { ko: '문서' },
  }),
  attachmentOrigin: table({
    manual: { ko: '수기' },
    agent: { ko: '에이전트' },
  }),
  routeMapMode: table({
    embed: { ko: '파일 게시' },
    link: { ko: '링크만' },
  }),
  dayType: table({
    weekday: { ko: '평일' },
    saturday: { ko: '토요일' },
    holiday: { ko: '휴일' },
  }),
  direction: table({
    up: { ko: '상행' },
    down: { ko: '하행' },
    inner: { ko: '내선' },
    outer: { ko: '외선' },
    unknown: { ko: '미상' },
  }),
  reviewStatus: table({
    verified: { ko: '검수 완료' },
    unverified: { ko: '검수 전' },
    flagged: { ko: '이의 있음' },
  }),
  entityNameKind: table({
    alias: { ko: '별칭' },
    former: { ko: '옛 이름' },
    sub: { ko: '부역명' },
    internal: { ko: '내부 표기', desc: '검색만, 화면 별칭에 표시 안 함' },
    abbr: { ko: '약칭' },
    legal: { ko: '법정 명칭' },
    source_raw: { ko: '원문 이름' },
  }),
  nameLang: table({
    ko: { ko: '한국어' },
    en: { ko: '영어' },
    hanja: { ko: '한자' },
  }),
  fuzzyPrecision: table({
    day: { ko: '일' },
    month: { ko: '월' },
    half: { ko: '반기' },
    year: { ko: '연' },
    unknown: { ko: '미상' },
  }),
  area: table({
    capital: { ko: '수도권' },
    southeast: { ko: '동남권' },
    daegyeong: { ko: '대경권' },
    chungcheong: { ko: '충청권' },
    honam: { ko: '호남권' },
    gangwon: { ko: '강원권' },
    jeju: { ko: '제주권' },
    national: { ko: '전국' },
  }),
  appUserKind: table({
    admin: { ko: '관리자' },
    system: { ko: '시스템' },
    agent: { ko: '에이전트' },
    web: { ko: '공개 사이트' },
  }),
  tokenScope: table({
    'public:read': { ko: '공개 읽기' },
    'admin:read': { ko: '관리 읽기' },
    'admin:write': { ko: '관리 쓰기' },
    'proposal:write': { ko: '제안 제출' },
    'system:write': { ko: '시스템 쓰기' },
  }),
  changesetOrigin: table({
    admin_edit: { ko: '관리자 편집' },
    bulk_import: { ko: '여러 건 입력' },
    importer: { ko: '수집기' },
    agent: { ko: '에이전트' },
    legacy_migration: { ko: '기존 시스템 이관' },
    revert: { ko: '되돌리기' },
  }),
  changesetStatus: table({
    draft: { ko: '검수 대기' },
    applying: { ko: '반영 중' },
    applied: { ko: '반영됨' },
    failed: { ko: '실패' },
    rejected: { ko: '반려' },
    superseded: { ko: '대체됨' },
  }),
  changeOp: table({
    create: { ko: '생성' },
    update: { ko: '수정' },
    delete: { ko: '삭제(휴지통)' },
    restore: { ko: '복구' },
    purge: { ko: '영구 삭제' },
    merge_station: { ko: '역 병합' },
    rename_id: { ko: 'ID 변경' },
    replace_children: { ko: '하위 목록 교체' },
  }),
  apiProvider: table({
    data_go_kr: { ko: '공공데이터포털' },
    kric: { ko: '레일포털(KRIC)' },
    tago: { ko: 'TAGO' },
    vworld: { ko: 'VWorld' },
    seoul_open: { ko: '서울 열린데이터광장' },
    law_go_kr: { ko: '법제처' },
    other: { ko: '기타' },
  }),
  apiResponseFormat: table({
    xml: { ko: 'XML' },
    json: { ko: 'JSON' },
  }),
  apiCallOrigin: table({
    admin: { ko: '관리자' },
    importer: { ko: '수집기' },
    agent: { ko: '에이전트' },
  }),
} as const;

export type CodeDomain = keyof typeof codes;
export type Code<D extends CodeDomain> = (typeof codes)[D]['values'][number];

/** 사업 단계 진행도(정렬·비교용). abandoned·dormant 는 -1 */
export const PLAN_STAGE_PROGRESS: Readonly<Record<Code<'planStage'>, number>> = {
  concept: 0,
  plan_listed: 1,
  prefeasibility: 2,
  feasibility: 3,
  strategic_eia: 4,
  basic_plan: 5,
  basic_design: 6,
  eia: 7,
  detail_design: 8,
  construction: 9,
  trial_run: 10,
  opened: 11,
  abandoned: -1,
  dormant: -1,
};

export function codeLabel<D extends CodeDomain>(domain: D, value: Code<D>): string {
  const labels = codes[domain].labels as Record<string, CodeInfo>;
  return labels[value]?.ko ?? value;
}

export function isCode<D extends CodeDomain>(domain: D, value: unknown): value is Code<D> {
  return typeof value === 'string' && (codes[domain].values as readonly string[]).includes(value);
}
