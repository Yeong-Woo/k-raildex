/**
 * 관리 앱 폼 메타데이터 (WP 2.4, docs/05-admin-app.md FR-ADM-021).
 * 계약의 모든 필드에 라벨·위젯·그룹을 준다. 빠진 필드가 있으면 시험(ui-meta.test.ts)이 실패한다.
 */
import type { CodeDomain } from './codes';
import type { EntityType } from './ids';

export type Widget =
  | { kind: 'id' }
  | { kind: 'text' }
  | { kind: 'textarea' }
  | { kind: 'markdown' }
  | { kind: 'number'; integer?: boolean }
  | { kind: 'boolean' }
  | { kind: 'code'; domain: CodeDomain }
  | { kind: 'fuzzy' }
  | { kind: 'date' }
  | { kind: 'point' }
  | { kind: 'color' }
  | { kind: 'url' }
  | { kind: 'ref'; target: EntityType }
  | { kind: 'refs'; target: EntityType }
  | { kind: 'region' }
  | { kind: 'regions' }
  | { kind: 'area' }
  | { kind: 'areas' }
  | { kind: 'document' }
  | { kind: 'json' }
  | { kind: 'string_list' }
  | { kind: 'sources' }
  | { kind: 'names' }
  | { kind: 'external_refs' }
  /** 특수 편집기(05 문서 4절). 관리 앱이 editor 이름으로 컴포넌트를 고른다 */
  | { kind: 'editor'; editor: string };

export interface FieldMeta {
  label: string;
  widget: Widget;
  group: string;
  help?: string;
  /** 생성 후 고칠 수 없다(id — 변경은 "ID 변경" 동작) */
  createOnly?: boolean;
}

export interface GroupMeta {
  key: string;
  label: string;
}

export interface EntityUiMeta {
  label: string;
  /** 목록 표 기본 열 */
  listColumns: string[];
  /** 화면 제목으로 쓰는 필드 */
  titleField: string;
  groups: GroupMeta[];
  fields: Record<string, FieldMeta>;
}

// ---------------------------------------------------------------------------
// 공통 묶음
// ---------------------------------------------------------------------------

const GROUPS = {
  basic: { key: 'basic', label: '기본 정보' },
  class: { key: 'class', label: '분류' },
  location: { key: 'location', label: '위치' },
  dates: { key: 'dates', label: '날짜' },
  relations: { key: 'relations', label: '관계' },
  detail: { key: 'detail', label: '상세' },
  names: { key: 'names', label: '이름·별칭·외부 코드' },
  provenance: { key: 'provenance', label: '출처·검수' },
  memo: { key: 'memo', label: '메모' },
} as const satisfies Record<string, GroupMeta>;

type G = keyof typeof GROUPS;
const f = (label: string, widget: Widget, group: G, extra: Partial<FieldMeta> = {}): FieldMeta => ({
  label,
  widget,
  group,
  ...extra,
});

const W = {
  text: { kind: 'text' },
  textarea: { kind: 'textarea' },
  md: { kind: 'markdown' },
  int: { kind: 'number', integer: true },
  num: { kind: 'number' },
  bool: { kind: 'boolean' },
  fuzzy: { kind: 'fuzzy' },
  date: { kind: 'date' },
  point: { kind: 'point' },
  color: { kind: 'color' },
  url: { kind: 'url' },
  region: { kind: 'region' },
  regions: { kind: 'regions' },
  json: { kind: 'json' },
  strings: { kind: 'string_list' },
} as const satisfies Record<string, Widget>;
const code = (domain: CodeDomain): Widget => ({ kind: 'code', domain });
const ref = (target: EntityType): Widget => ({ kind: 'ref', target });
const refs = (target: EntityType): Widget => ({ kind: 'refs', target });
const editor = (name: string): Widget => ({ kind: 'editor', editor: name });

const idField = (help?: string) => ({
  id: f('ID', { kind: 'id' }, 'basic', { createOnly: true, ...(help ? { help } : {}) }),
});

const nameFields = (hanja: boolean) => ({
  name_ko: f('이름', W.text, 'basic', { help: '역은 "역" 접미사 없이' }),
  name_en: f('영문 이름', W.text, 'basic', { help: '기관 공개 영문명만(추정 로마자 금지)' }),
  ...(hanja ? { name_hanja: f('한자', W.text, 'basic') } : {}),
  name_full: f('정식 명칭', W.text, 'basic'),
});

const commonLinks = {
  sources: f('출처', { kind: 'sources' }, 'provenance', {
    help: '레코드 전체 출처 1개 이상 + 필요하면 필드 단위 출처',
  }),
  names: f('별칭·옛 이름', { kind: 'names' }, 'names'),
  external_refs: f('외부 코드', { kind: 'external_refs' }, 'names'),
};

const recFields = {
  checked_at: f('확인일', W.date, 'provenance', { help: '출처와 마지막으로 대조한 날' }),
  provenance_note: f('출처 메모(공개)', W.textarea, 'provenance'),
  review_status: f('검수 상태', code('reviewStatus'), 'provenance'),
  editor_note: f('내부 메모(비공개)', W.md, 'memo'),
  extra: f('부가 정보(JSON)', W.json, 'memo'),
  ...commonLinks,
};

const groups = (...keys: G[]): GroupMeta[] => keys.map((k) => GROUPS[k]);
const STD_GROUPS = groups('basic', 'class', 'location', 'dates', 'relations', 'detail', 'names', 'provenance', 'memo');

// ---------------------------------------------------------------------------
// 개체별
// ---------------------------------------------------------------------------

export const entityUiMeta: Readonly<Record<EntityType, EntityUiMeta>> = {
  source: {
    label: '출처',
    titleField: 'title',
    listColumns: ['id', 'title', 'publisher', 'type', 'license_class', 'retrieved_at', 'checked_at'],
    groups: STD_GROUPS,
    fields: {
      ...idField('src-<슬러그>'),
      title: f('제목', W.text, 'basic'),
      publisher: f('발행처', W.text, 'basic'),
      type: f('유형', code('sourceType'), 'class'),
      url: f('URL', W.url, 'basic'),
      license: f('라이선스(원문)', W.text, 'class'),
      license_class: f('라이선스 구분', code('licenseClass'), 'class', { help: '원문 공개 다운로드 판정(Q75)' }),
      attribution: f('출처 표시 문구', W.textarea, 'detail'),
      published: f('발행일', W.fuzzy, 'dates'),
      published_raw: f('발행일 원문', W.text, 'dates'),
      data_as_of: f('데이터 기준일(원문)', W.text, 'dates'),
      retrieved_at: f('수집일', W.date, 'dates'),
      refresh: f('갱신 주기', code('sourceRefresh'), 'detail'),
      notice_number: f('고시·공고 번호', W.text, 'basic'),
      dataset_key: f('데이터셋 키(호환)', W.text, 'detail'),
      download: f('자동 다운로드 정보', W.json, 'detail'),
      note: f('메모', W.textarea, 'memo'),
      documents: f('원문 문서', editor('source_documents'), 'relations'),
      ...recFields,
    },
  },
  operator: {
    label: '운영기관',
    titleField: 'name_ko',
    listColumns: ['id', 'name_ko', 'short_ko', 'kind', 'status'],
    groups: STD_GROUPS,
    fields: {
      ...idField('op-<슬러그>'),
      ...nameFields(false),
      short_ko: f('약칭', W.text, 'basic'),
      kind: f('종류', code('operatorKind'), 'class'),
      status: f('상태', code('operatorStatus'), 'class'),
      merged_into_id: f('통합된 기관', ref('operator'), 'relations'),
      founded: f('설립', W.fuzzy, 'dates'),
      ended: f('종료', W.fuzzy, 'dates'),
      homepage: f('누리집', W.url, 'detail'),
      ...recFields,
    },
  },
  station: {
    label: '역',
    titleField: 'name_ko',
    listColumns: ['id', 'name_ko', 'kind', 'region_code', 'review_status', 'updated_at'],
    groups: STD_GROUPS,
    fields: {
      ...idField('stn-<영문 슬러그>'),
      ...nameFields(true),
      kind: f('역 종류', code('stationKind'), 'class'),
      korail_class: f('정거장 등급(코레일)', code('korailStationClass'), 'class', {
        help: '한국철도공사 직제상 지위 — 코레일 관리 역만',
      }),
      korail_mgmt_grade: f('관리역 등급(급)', W.int, 'class', { help: '관리역일 때 1~3급' }),
      managed_by_id: f('관리역(소속)', ref('station'), 'class', { help: '이 역을 관할하는 관리역' }),
      region_code: f('시·도', W.region, 'location'),
      region_basis: f('시·도 근거', code('regionBasis'), 'location'),
      address: f('주소', W.text, 'location'),
      geom: f('대표 좌표', W.point, 'location'),
      coord_source: f('좌표 출처', code('coordSource'), 'location'),
      coord_basis: f('근사 좌표 근거', code('coordBasis'), 'location', { help: '역 자체 위치가 아닌 대표점일 때' }),
      coord_query: f('근사 위치 질의', W.text, 'location', { help: '고시 지번·법정동 — 지오코더 입력' }),
      coord_same_as_id: f('좌표를 빌려 올 역', ref('station'), 'location'),
      coord_note: f('좌표 메모', W.textarea, 'location'),
      grade: f('역등급(KRIC 철도역 정보 원문)', W.text, 'detail', { help: '코레일 정거장 등급과 다른 체계(0~3)' }),
      history_text: f('역연혁(원문)', W.textarea, 'detail'),
      intro_text: f('역소개(원문)', W.textarea, 'detail'),
      merge_into_id: f('개통 때 병합할 역', ref('station'), 'relations', { help: '공사 중 분리 정거장(Q73)' }),
      own_status: f('단독 상태', code('status'), 'dates', { help: '노선별 역이 없는 역에서만' }),
      own_opened: f('단독 개통일', W.fuzzy, 'dates'),
      own_closed: f('단독 폐지일', W.fuzzy, 'dates'),
      ...recFields,
    },
  },
  line_station: {
    label: '노선별 역',
    titleField: 'id',
    listColumns: ['id', 'line_id', 'station_id', 'seq', 'station_code', 'status'],
    groups: groups('basic', 'class', 'location', 'dates', 'names', 'provenance', 'memo'),
    fields: {
      ...idField('ls-<노선>--<역>'),
      line_id: f('노선', ref('line'), 'basic', { createOnly: true }),
      station_id: f('역', ref('station'), 'basic'),
      seq: f('순서', W.int, 'basic'),
      branch: f('지선', W.text, 'basic'),
      km: f('영업거리(km)', W.num, 'basic'),
      station_code: f('역번호', W.text, 'basic'),
      order_confirmed: f('순서 확정', W.bool, 'basic'),
      gap_confirmed_prev_id: f('앞 역 거리 확인', ref('line_station'), 'basic', {
        help: '앞 역과의 거리가 V-S04 상한을 넘지만 맞다고 확인한 앞 노선별 역. 품질 화면 [거리 맞음]으로 채운다',
      }),
      name_ko: f('노선별 이름', W.text, 'basic', { help: '역 대표 이름과 다를 때만' }),
      name_en: f('노선별 영문 이름', W.text, 'basic'),
      operator_id: f('운영기관', ref('operator'), 'class', { help: '비우면 노선 운영기관' }),
      status: f('상태', code('status'), 'class'),
      opened: f('개통일', W.fuzzy, 'dates'),
      closed: f('폐지일', W.fuzzy, 'dates'),
      geom: f('승강장 좌표', W.point, 'location'),
      note: f('메모', W.textarea, 'memo'),
      ...commonLinks,
    },
  },
  line: {
    label: '노선',
    titleField: 'name_ko',
    listColumns: ['id', 'name_ko', 'rail_class', 'category', 'status', 'is_wide_area', 'review_status'],
    groups: STD_GROUPS,
    fields: {
      ...idField('line-<슬러그>'),
      ...nameFields(true),
      category: f('범주', code('lineCategory'), 'class'),
      rail_class: f('법적 분류', code('railClass'), 'class'),
      is_wide_area: f('광역철도 지정', W.bool, 'class'),
      wide_area_note: f('광역철도 지정 메모', W.text, 'class'),
      passenger_service: f('여객 취급', W.bool, 'class'),
      line_role: f('시설 선로', code('lineRole'), 'class'),
      status: f('상태', code('status'), 'class'),
      owner: f('시설 소유', W.text, 'detail'),
      start_station_id: f('기점 역', ref('station'), 'relations'),
      end_station_id: f('종점 역', ref('station'), 'relations'),
      length_km: f('연장(km)', W.num, 'detail'),
      opened: f('최초 개통', W.fuzzy, 'dates'),
      closed: f('폐지', W.fuzzy, 'dates'),
      track: f('선로 수', code('track'), 'detail'),
      electrification: f('전철화', W.text, 'detail'),
      gauge_mm: f('궤간(mm)', W.int, 'detail'),
      design_speed_kmh: f('설계속도(km/h)', W.int, 'detail'),
      color: f('노선색', W.color, 'detail', { help: '공식 노선색만(출처 field=color)' }),
      description: f('설명', W.md, 'detail'),
      parent_line_id: f('합칠 노선', ref('line'), 'relations', { help: '기존 공사 구간 노선(Q22)' }),
      regions: f('지나는 시·도', W.regions, 'location'),
      operators: f('운영기관', editor('line_operators'), 'relations'),
      osm_map: f('OSM 선형 대응', editor('line_osm_map'), 'location'),
      ...recFields,
    },
  },
  train_class: {
    label: '열차 등급',
    titleField: 'name_ko',
    listColumns: ['id', 'name_ko', 'tier', 'status'],
    groups: STD_GROUPS,
    fields: {
      ...idField('tc-<슬러그>'),
      ...nameFields(true),
      tier: f('등급 수준', code('trainClassTier'), 'class'),
      status: f('상태', code('trainClassStatus'), 'class'),
      successor_id: f('승계 등급', ref('train_class'), 'relations'),
      max_speed_kmh: f('최고속도(km/h)', W.int, 'detail'),
      started: f('도입', W.fuzzy, 'dates'),
      ended: f('폐지', W.fuzzy, 'dates'),
      description: f('설명', W.md, 'detail'),
      ...recFields,
    },
  },
  service: {
    label: '운행 계통',
    titleField: 'name_ko',
    listColumns: ['id', 'name_ko', 'kind', 'status', 'train_class_id'],
    groups: STD_GROUPS,
    fields: {
      ...idField('svc-<슬러그>'),
      ...nameFields(true),
      kind: f('종류', code('serviceKind'), 'class'),
      train_class_id: f('열차 등급', ref('train_class'), 'class'),
      status: f('상태', code('status'), 'class'),
      color: f('안내색', W.color, 'detail'),
      opened: f('운행 개시', W.fuzzy, 'dates'),
      closed: f('운행 종료', W.fuzzy, 'dates'),
      successor_id: f('후속 계통', ref('service'), 'relations'),
      description: f('설명', W.md, 'detail'),
      lines: f('지나는 노선(순서)', { kind: 'refs', target: 'line' }, 'relations'),
      stop_patterns: f('정차 패턴', editor('stop_patterns'), 'relations'),
      ...recFields,
    },
  },
  plan_program: {
    label: '상위 계획',
    titleField: 'name_ko',
    listColumns: ['id', 'short', 'name_ko', 'kind', 'round', 'status'],
    groups: STD_GROUPS,
    fields: {
      ...idField('pp-<종류>-<차수>'),
      ...nameFields(false),
      kind: f('종류', code('planProgramKind'), 'class'),
      short: f('짧은 라벨', W.text, 'basic'),
      round: f('차수', W.int, 'basic'),
      region_code: f('시·도', W.region, 'location'),
      period_from: f('기간 시작(연)', W.int, 'dates'),
      period_to: f('기간 끝(연)', W.int, 'dates'),
      issuer: f('수립·고시 주체', W.text, 'detail'),
      legal_basis: f('근거 법령', W.text, 'detail'),
      status: f('상태', code('planProgramStatus'), 'class'),
      parent_id: f('상위 계획', ref('plan_program'), 'relations'),
      summary: f('요지', W.textarea, 'detail'),
      document_note: f('원문 확보 상태', W.textarea, 'detail'),
      ord: f('표시 순서', W.int, 'basic'),
      notices: f('고시 이력', editor('plan_program_notices'), 'relations'),
      points: f('철도 부문 요지', W.strings, 'detail'),
      figures: f('규모', editor('plan_program_figures'), 'detail'),
      ...recFields,
    },
  },
  plan: {
    label: '계획 사업',
    titleField: 'name_ko',
    listColumns: ['id', 'name_ko', 'scope', 'review_status', 'updated_at'],
    groups: STD_GROUPS,
    fields: {
      ...idField('plan-<노선>-<구간>'),
      ...nameFields(false),
      scope: f('범위', code('planScope'), 'class'),
      opened: f('실제 개통', W.fuzzy, 'dates'),
      operator_text: f('운영 예정 기관', W.text, 'detail'),
      description: f('설명', W.md, 'detail'),
      is_national: f('전국 사업', W.bool, 'class'),
      stage_override: f('현재 단계 수동 지정', code('planStage'), 'class', {
        help: '예외용 — 평소에는 단계 이력에서 계산',
      }),
      color: f('공식 노선색', W.color, 'detail', { help: '공식 색이 있을 때만(출처 field=color)' }),
      refs: f('상위 계획 반영 내역', editor('plan_refs'), 'relations'),
      stage_events: f('단계 이력', editor('plan_stages'), 'dates'),
      milestones: f('기대 일정', editor('plan_milestones'), 'dates', { help: '공식·보도 근거만(Q94)' }),
      lines: f('노선과 역할', editor('plan_lines'), 'relations'),
      stations: f('역과 역할', editor('plan_stations'), 'relations'),
      regions: f('시·도', W.regions, 'location'),
      relations: f('관련 계획', editor('plan_relations'), 'relations'),
      geometries: f('선형', editor('plan_geometries'), 'location'),
      watch_keywords: f('관보 감시 키워드', W.strings, 'detail'),
      ...recFields,
    },
  },
  event: {
    label: '연표 이벤트',
    titleField: 'title',
    listColumns: ['id', 'date', 'type', 'title', 'origin'],
    groups: STD_GROUPS,
    fields: {
      ...idField('evt-<유형>-<대상>-<날짜>'),
      type: f('유형', code('eventType'), 'class'),
      date: f('날짜', W.fuzzy, 'dates'),
      title: f('제목', W.text, 'basic'),
      note: f('메모(공개)', W.textarea, 'detail'),
      origin: f('기원', code('eventOrigin'), 'class'),
      targets: f('대상 개체', editor('event_targets'), 'relations'),
      area_codes: f('권역', { kind: 'areas' }, 'location'),
      ...recFields,
    },
  },
  train_number_range: {
    label: '열차번호대',
    titleField: 'id',
    listColumns: ['id', 'operator_id', 'code_prefix', 'range_from', 'range_to', 'group'],
    groups: STD_GROUPS,
    fields: {
      ...idField('tnr-<슬러그>'),
      operator_id: f('운영기관', ref('operator'), 'basic'),
      code_prefix: f('약호', W.text, 'basic'),
      range_from: f('번호 시작', W.int, 'basic'),
      range_to: f('번호 끝', W.int, 'basic'),
      group: f('묶음', code('tnrGroup'), 'class'),
      train_class_id: f('열차 등급', ref('train_class'), 'class'),
      route_text: f('운행 구간(원문)', W.text, 'detail'),
      parity_rule: f('홀짝 규칙', code('parityRule'), 'detail'),
      valid_from: f('적용 시작', W.fuzzy, 'dates'),
      valid_to: f('적용 끝', W.fuzzy, 'dates'),
      note: f('메모', W.textarea, 'memo'),
      service_ids: f('운행 계통', refs('service'), 'relations'),
      line_ids: f('노선', refs('line'), 'relations'),
      ...recFields,
    },
  },
  rolling_stock_range: {
    label: '차량번호대',
    titleField: 'series',
    listColumns: ['id', 'operator_id', 'series', 'number_from', 'number_to', 'group', 'model', 'status'],
    groups: STD_GROUPS,
    fields: {
      ...idField('rsn-<슬러그>'),
      operator_id: f('운영기관', ref('operator'), 'basic'),
      series: f('호대(원문)', W.text, 'basic'),
      number_prefix: f('번호 접두', W.text, 'basic'),
      number_from: f('번호 시작', W.int, 'basic'),
      number_to: f('번호 끝', W.int, 'basic'),
      digits: f('자릿수', W.int, 'basic'),
      group: f('묶음', code('rsrGroup'), 'class'),
      model: f('형식', W.text, 'class'),
      train_class_id: f('열차 등급', ref('train_class'), 'class'),
      number_rule: f('번호 규칙', W.textarea, 'detail'),
      status: f('상태', code('rsrStatus'), 'class'),
      introduced: f('도입', W.fuzzy, 'dates'),
      retired: f('퇴역', W.fuzzy, 'dates'),
      owner_note: f('소유 메모', W.textarea, 'detail'),
      formation_label: f('편성 호칭', W.text, 'detail'),
      formation_from: f('첫 편성번호', W.text, 'detail'),
      formation_to: f('끝 편성번호', W.text, 'detail'),
      formation_count: f('편성 수', W.int, 'detail'),
      formation_cars: f('편성당 량수', W.int, 'detail'),
      formation_code_prefix: f('편성 약호', W.text, 'detail'),
      formation_note: f('편성 메모', W.textarea, 'detail'),
      note: f('메모', W.textarea, 'memo'),
      service_ids: f('운행 계통', refs('service'), 'relations'),
      line_ids: f('노선', refs('line'), 'relations'),
      ...recFields,
    },
  },
  transfer_center: {
    label: '환승센터',
    titleField: 'name_ko',
    listColumns: ['id', 'name_ko', 'kind', 'status', 'region_code'],
    groups: STD_GROUPS,
    fields: {
      ...idField('xc-<슬러그>'),
      ...nameFields(false),
      kind: f('종류', code('transferCenterKind'), 'class'),
      region_code: f('시·도', W.region, 'location'),
      area_code: f('권역', { kind: 'area' }, 'location'),
      status: f('상태', code('transferCenterStatus'), 'class'),
      status_as_of: f('상태 기준 시점', W.fuzzy, 'dates'),
      status_source_id: f('상태 출처', ref('source'), 'provenance'),
      description: f('설명', W.md, 'detail'),
      plan_refs: f('기본계획 반영 내역', editor('transfer_center_plan_refs'), 'relations'),
      status_events: f('상태 이력', editor('transfer_center_status_events'), 'dates'),
      station_ids: f('연계 역', refs('station'), 'relations'),
      plan_ids: f('연계 계획', refs('plan'), 'relations'),
      ...recFields,
    },
  },
  route_map: {
    label: '노선도',
    titleField: 'title_ko',
    listColumns: ['id', 'title_ko', 'publisher', 'mode', 'as_of'],
    groups: STD_GROUPS,
    fields: {
      ...idField('map-<슬러그>'),
      title_ko: f('제목', W.text, 'basic'),
      title_en: f('영문 제목', W.text, 'basic'),
      publisher: f('발행처', W.text, 'basic'),
      region: f('지역', W.text, 'location'),
      mode: f('게시 방식', code('routeMapMode'), 'class'),
      document_id: f('이미지 문서', { kind: 'document' }, 'detail'),
      url: f('원본 페이지', W.url, 'basic'),
      license: f('라이선스', W.text, 'class'),
      attribution: f('출처 표시 문구', W.textarea, 'detail'),
      as_of: f('기준일', W.text, 'dates'),
      width: f('너비(px)', W.int, 'detail'),
      height: f('높이(px)', W.int, 'detail'),
      ...recFields,
    },
  },
  glossary_term: {
    label: '용어',
    titleField: 'term_ko',
    listColumns: ['id', 'term_ko', 'section', 'ord'],
    groups: STD_GROUPS,
    fields: {
      ...idField('term-<슬러그>'),
      term_ko: f('용어', W.text, 'basic'),
      term_en: f('영문', W.text, 'basic'),
      section: f('절', W.text, 'class'),
      definition: f('정의', W.md, 'detail'),
      basis: f('근거·출처', W.md, 'detail'),
      example: f('예', W.md, 'detail'),
      caution: f('주의', W.md, 'detail'),
      ord: f('순서', W.int, 'basic'),
      ...recFields,
    },
  },
};
