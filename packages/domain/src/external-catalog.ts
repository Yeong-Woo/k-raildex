/**
 * 외부 API 초기 카탈로그(FR-ADM-106). 기존 시스템 수집 스크립트(future-rail-db packages/pipeline/src/ingest/*)와
 * 조사 문서(docs/legacy/research/data-sources.md)에서 호출 주소·매개변수를 확인한 것만 싣는다(주소를 지어내지 않는다).
 * 키 변수 이름은 .env.example 과 같다. seedApiCatalog 는 id 기준 upsert(삭제한 항목은 되살리지 않음).
 *
 * 넣지 않은 것: 공공데이터포털 철도역 정보·도시철도역사 표준데이터(기존 시스템은 파일 데이터로만 받았고 API 주소 기록 없음),
 * 코레일 열차운행정보(B551457/run/v2 — 기존 스크립트에서도 오퍼레이션 경로 "미확인 후보").
 */
import type { Queryable } from './db';
import { upsertApiEndpoint, type ApiEndpointCreate, type ApiParamDef } from './external-api';

const p = (name: string, label: string, extra: Partial<ApiParamDef> = {}): ApiParamDef => ({
  name,
  label,
  required: false,
  kind: 'text',
  ...extra,
});
const fixed = (name: string, value: string, label = '형식'): ApiParamDef =>
  p(name, label, { default: value, fixed: true });

const TAGO_PAGING = { page_param: 'pageNo', size_param: 'numOfRows', total_path: 'response.body.totalCount' };
const tagoPage = (size: string) => [
  p('numOfRows', '한 쪽 행 수', { kind: 'int', default: size }),
  p('pageNo', '쪽 번호', { kind: 'int', default: '1' }),
  fixed('_type', 'json', '응답 형식'),
];

export interface CatalogSeedEntry {
  endpoint: ApiEndpointCreate;
  /** 근거(기존 시스템 파일·문서) */
  legacy: string;
}

export const API_CATALOG_SEED: readonly CatalogSeedEntry[] = [
  // --- TAGO 지하철정보(data.go.kr 15098554) ---
  {
    legacy: 'future-rail-db packages/pipeline/src/ingest/fetch-tago-subway.ts',
    endpoint: {
      id: 'tago-subway-station-list',
      provider: 'tago',
      name_ko: 'TAGO 지하철정보 — 키워드 역 목록(GetKwrdFndSubwaySttnList)',
      base_url: 'http://apis.data.go.kr/1613000/SubwayInfo/GetKwrdFndSubwaySttnList',
      params: [p('subwayStationName', '역 이름 검색어', { example: '서울역' }), ...tagoPage('100')],
      key_param: 'serviceKey',
      key_env: 'DATA_GO_KR_KEY_TAGO_SUBWAY',
      response_format: 'json',
      paging: TAGO_PAGING,
      compare: { code_field: 'subwayStationId', name_field: 'subwayStationName' },
      daily_limit: 10000,
      external_system: 'tago_subway',
      source_id: 'src-tago-subway',
      doc_url: 'https://www.data.go.kr/data/15098554/openapi.do',
      note: '공공데이터포털 "일반 인증키(Decoding)"를 키 변수에 넣는다. 개발계정 일 10,000건',
    },
  },
  {
    legacy: 'future-rail-db packages/pipeline/src/ingest/fetch-tago-timetable.ts',
    endpoint: {
      id: 'tago-subway-station-timetable',
      provider: 'tago',
      name_ko: 'TAGO 지하철정보 — 역별 시간표(GetSubwaySttnAcctoSchdulList)',
      base_url: 'http://apis.data.go.kr/1613000/SubwayInfo/GetSubwaySttnAcctoSchdulList',
      params: [
        p('subwayStationId', 'TAGO 역 ID', {
          required: true,
          kind: 'station_ref',
          ref_system: 'tago_subway',
          example: 'MTRS11133',
        }),
        p('dailyTypeCode', '요일 구분(01 평일·02 토요일·03 공휴일)', {
          required: true,
          kind: 'enum',
          options: ['01', '02', '03'],
          default: '01',
        }),
        p('upDownTypeCode', '상하행(U 상행·D 하행)', {
          required: true,
          kind: 'enum',
          options: ['U', 'D'],
          default: 'U',
        }),
        ...tagoPage('500'),
      ],
      key_param: 'serviceKey',
      key_env: 'DATA_GO_KR_KEY_TAGO_SUBWAY',
      response_format: 'json',
      paging: TAGO_PAGING,
      daily_limit: 10000,
      external_system: null,
      source_id: 'src-tago-subway',
      doc_url: 'https://www.data.go.kr/data/15098554/openapi.do',
      note: '역 ID 마다 요일 3 × 상하행 2 조합. 429(초당 제한)가 잦으면 간격을 두고 호출',
    },
  },
  // --- TAGO 열차정보(data.go.kr 15098552) ---
  {
    legacy: 'future-rail-db packages/pipeline/src/ingest/fetch-train-timetable.ts (fetchTago)',
    endpoint: {
      id: 'tago-train-vehicle-kinds',
      provider: 'tago',
      name_ko: 'TAGO 열차정보 — 차량 종류 목록(getVhcleKndList)',
      base_url: 'http://apis.data.go.kr/1613000/TrainInfo/getVhcleKndList',
      params: tagoPage('500'),
      key_param: 'serviceKey',
      key_env: 'DATA_GO_KR_KEY_TAGO_TRAIN',
      response_format: 'json',
      paging: TAGO_PAGING,
      daily_limit: 10000,
      source_id: 'src-tago-train',
      doc_url: 'https://www.data.go.kr/data/15098552/openapi.do',
    },
  },
  {
    legacy: 'future-rail-db packages/pipeline/src/ingest/fetch-train-timetable.ts (fetchTago)',
    endpoint: {
      id: 'tago-train-city-codes',
      provider: 'tago',
      name_ko: 'TAGO 열차정보 — 도시 코드 목록(getCtyCodeList)',
      base_url: 'http://apis.data.go.kr/1613000/TrainInfo/getCtyCodeList',
      params: tagoPage('500'),
      key_param: 'serviceKey',
      key_env: 'DATA_GO_KR_KEY_TAGO_TRAIN',
      response_format: 'json',
      paging: TAGO_PAGING,
      daily_limit: 10000,
      source_id: 'src-tago-train',
      doc_url: 'https://www.data.go.kr/data/15098552/openapi.do',
    },
  },
  {
    legacy: 'future-rail-db packages/pipeline/src/ingest/fetch-train-timetable.ts (fetchTago)',
    endpoint: {
      id: 'tago-train-city-stations',
      provider: 'tago',
      name_ko: 'TAGO 열차정보 — 시·도별 기차역 목록(getCtyAcctoTrainSttnList)',
      base_url: 'http://apis.data.go.kr/1613000/TrainInfo/getCtyAcctoTrainSttnList',
      params: [
        p('cityCode', '도시 코드(getCtyCodeList 의 citycode)', { required: true, example: '11' }),
        ...tagoPage('500'),
      ],
      key_param: 'serviceKey',
      key_env: 'DATA_GO_KR_KEY_TAGO_TRAIN',
      response_format: 'json',
      paging: TAGO_PAGING,
      compare: { code_field: 'nodeid', name_field: 'nodename' },
      daily_limit: 10000,
      external_system: 'tago_train',
      source_id: 'src-tago-train',
      doc_url: 'https://www.data.go.kr/data/15098552/openapi.do',
    },
  },
  {
    legacy: 'future-rail-db packages/pipeline/src/ingest/fetch-train-timetable.ts (--od)',
    endpoint: {
      id: 'tago-train-od-trains',
      provider: 'tago',
      name_ko: 'TAGO 열차정보 — 출·도착지 기반 열차 정보(getStrtpntAlocFndTrainInfo)',
      base_url: 'http://apis.data.go.kr/1613000/TrainInfo/getStrtpntAlocFndTrainInfo',
      params: [
        p('depPlaceId', '출발역 ID', { required: true, kind: 'station_ref', ref_system: 'tago_train' }),
        p('arrPlaceId', '도착역 ID', { required: true, kind: 'station_ref', ref_system: 'tago_train' }),
        p('depPlandTime', '출발일(YYYYMMDD)', { required: true, kind: 'date', example: '20261121' }),
        ...tagoPage('500'),
      ],
      key_param: 'serviceKey',
      key_env: 'DATA_GO_KR_KEY_TAGO_TRAIN',
      response_format: 'json',
      paging: TAGO_PAGING,
      daily_limit: 10000,
      source_id: 'src-tago-train',
      doc_url: 'https://www.data.go.kr/data/15098552/openapi.do',
    },
  },
  // --- 레일포털(KRIC) ---
  {
    legacy: 'future-rail-db packages/pipeline/src/ingest/fetch-kric-station-info.ts',
    endpoint: {
      id: 'kric-station-info',
      provider: 'kric',
      name_ko: '레일포털 — 역사별 정보(convenientInfo/stationInfo)',
      base_url: 'https://openapi.kric.go.kr/openapi/convenientInfo/stationInfo',
      params: [
        fixed('format', 'json'),
        p('railOprIsttCd', '운영기관 코드', { required: true, example: 'S1' }),
        p('lnCd', '선 코드', { required: true, example: '1' }),
      ],
      key_param: 'serviceKey',
      key_env: 'KRIC_KEY',
      response_format: 'json',
      rows_path: 'body',
      source_id: 'src-kric-api-station-info',
      note: '운영기관 코드 + 선 코드를 둘 다 줘야 응답한다(코드 목록은 API 가 주지 않음). resultCode 00 정상 · 03 데이터 없음 · 30 미등록 키 · 41 승인 대기',
    },
  },
  {
    legacy: 'future-rail-db packages/pipeline/src/ingest/fetch-kric.ts',
    endpoint: {
      id: 'kric-subway-route-info',
      provider: 'kric',
      name_ko: '레일포털 — 도시철도 전체노선정보(trainUseInfo/subwayRouteInfo)',
      base_url: 'https://openapi.kric.go.kr/openapi/trainUseInfo/subwayRouteInfo',
      params: [
        fixed('format', 'json'),
        p('mreaWideCd', '권역(01 수도권·02 부산·03 대구·04 광주·05 대전)', {
          required: true,
          kind: 'enum',
          options: ['01', '02', '03', '04', '05'],
          default: '01',
        }),
        p('lnCd', '선 코드(예 A1·I2)'),
      ],
      key_param: 'serviceKey',
      key_env: 'KRIC_KEY',
      response_format: 'json',
      rows_path: 'body',
      source_id: 'src-kric-route-info',
      doc_url: 'https://www.data.go.kr/data/15041666/openapi.do',
      note: '응답: lnCd·mreaWideCd·railOprIsttCd·routCd·routNm·stinCd·stinConsOrdr·stinNm',
    },
  },
  // --- VWorld ---
  {
    legacy: 'future-rail-db packages/pipeline/src/ingest/geocode.ts (geocode)',
    endpoint: {
      id: 'vworld-address-geocode',
      provider: 'vworld',
      name_ko: 'VWorld — 주소 → 좌표(지오코더 getcoord)',
      base_url: 'https://api.vworld.kr/req/address',
      params: [
        fixed('service', 'address', '서비스'),
        fixed('request', 'getcoord', '요청'),
        fixed('version', '2.0', '버전'),
        fixed('crs', 'epsg:4326', '좌표계'),
        fixed('format', 'json'),
        p('type', '주소 유형', { required: true, kind: 'enum', options: ['road', 'parcel'], default: 'road' }),
        p('refine', '정제', { kind: 'enum', options: ['true', 'false'], default: 'true' }),
        p('simple', '간략', { kind: 'enum', options: ['true', 'false'], default: 'false' }),
        p('address', '주소', { required: true, example: '서울특별시 중구 한강대로 405' }),
      ],
      key_param: 'key',
      key_env: 'VWORLD_API_KEY',
      response_format: 'json',
      source_id: 'src-vworld-geocoder',
    },
  },
  {
    legacy: 'future-rail-db packages/pipeline/src/ingest/geocode.ts (district)',
    endpoint: {
      id: 'vworld-search',
      provider: 'vworld',
      name_ko: 'VWorld — 검색(search)',
      base_url: 'https://api.vworld.kr/req/search',
      params: [
        fixed('service', 'search', '서비스'),
        fixed('request', 'search', '요청'),
        fixed('version', '2.0', '버전'),
        fixed('crs', 'EPSG:4326', '좌표계'),
        p('query', '검색어', { required: true }),
        p('type', '검색 유형', { default: 'district', example: 'district' }),
        p('category', '분류', { example: 'L4' }),
        p('size', '한 쪽 건수', { kind: 'int', default: '10' }),
        p('page', '쪽 번호', { kind: 'int', default: '1' }),
        fixed('format', 'json'),
        fixed('errorformat', 'json', '오류 형식'),
      ],
      key_param: 'key',
      key_env: 'VWORLD_API_KEY',
      response_format: 'json',
      paging: { page_param: 'page', size_param: 'size' },
      source_id: 'src-vworld-geocoder',
    },
  },
  // --- 서울 열린데이터광장 ---
  {
    legacy: 'future-rail-db packages/pipeline/src/ingest/fetch-seoul-open.ts',
    endpoint: {
      id: 'seoul-open-subway-station',
      provider: 'seoul_open',
      name_ko: '서울 열린데이터광장 — 노선별 지하철역 정보(OA-15442)',
      base_url: 'http://openapi.seoul.go.kr:8088/{KEY}/json/{service}/{start}/{end}/',
      params: [
        p('service', '서비스 이름', { required: true, default: 'SearchSTNBySubwayLineInfo' }),
        p('start', '시작 행(1부터)', { required: true, kind: 'int', default: '1' }),
        p('end', '끝 행(한 번에 1,000행까지)', { required: true, kind: 'int', default: '1000' }),
      ],
      key_param: 'KEY',
      key_env: 'SEOUL_OPEN_KEY',
      response_format: 'json',
      paging: { start_param: 'start', end_param: 'end' },
      source_id: 'src-seoul-open-oa15442',
      note: '키가 URL 경로에 들어간다({KEY}). 응답 원문·기록의 URL 에서는 가린다',
    },
  },
  // --- 법제처 국가법령정보센터 DRF ---
  {
    legacy: 'docs/legacy/research/data-sources.md (고시 검색 – 국가법령정보센터 Open API)',
    endpoint: {
      id: 'law-drf-admrul-search',
      provider: 'law_go_kr',
      name_ko: '법제처 DRF — 행정규칙(고시) 검색(lawSearch.do)',
      base_url: 'https://www.law.go.kr/DRF/lawSearch.do',
      params: [
        p('target', '대상', { required: true, default: 'admrul' }),
        fixed('type', 'XML'),
        p('query', '검색어', { required: true, example: '철도거리표' }),
      ],
      key_param: 'OC',
      key_env: 'LAW_GO_KR_OC',
      response_format: 'xml',
      note: 'OC = 법제처 Open API 신청 아이디',
    },
  },
  {
    legacy: 'docs/legacy/research/data-sources.md · docs/legacy/SOURCES.md (lawService.do)',
    endpoint: {
      id: 'law-drf-admrul-service',
      provider: 'law_go_kr',
      name_ko: '법제처 DRF — 행정규칙 본문(lawService.do)',
      base_url: 'https://www.law.go.kr/DRF/lawService.do',
      params: [
        p('target', '대상', { required: true, default: 'admrul' }),
        p('ID', '행정규칙 ID', { required: true, example: '2100000232070' }),
        fixed('type', 'XML'),
      ],
      key_param: 'OC',
      key_env: 'LAW_GO_KR_OC',
      response_format: 'xml',
    },
  },
];

/** 카탈로그 시드(id 기준 upsert). 출처·외부 시스템이 아직 DB 에 없으면 그 연결만 비운다 */
export async function seedApiCatalog(
  db: Queryable,
  authorId: string | null = null,
): Promise<{ created: string[]; updated: string[]; skipped: string[] }> {
  const out = { created: [] as string[], updated: [] as string[], skipped: [] as string[] };
  for (const { endpoint } of API_CATALOG_SEED) {
    const e = { ...endpoint };
    if (e.source_id) {
      const s = await db.query(`SELECT 1 FROM source WHERE id = $1 AND deleted_at IS NULL`, [e.source_id]);
      if (!s.rows.length) e.source_id = null;
    }
    if (e.external_system) {
      const s = await db.query(`SELECT 1 FROM ref_external_system WHERE code = $1`, [e.external_system]);
      if (!s.rows.length) e.external_system = null;
    }
    const r = await upsertApiEndpoint(db, e, authorId);
    out[r].push(e.id);
  }
  return out;
}
