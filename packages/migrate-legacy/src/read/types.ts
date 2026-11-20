/**
 * 기존 시스템(future-rail-db) 데이터 형태 — packages/schema/*.schema.json 의 필드 중 이관에 쓰는 것만.
 * 값은 빌드 산출물(data/build/*.json)이 기준이고, 빌드에 없는 편집용 필드·주석은 data/own/**\/*.yaml 에서 읽는다.
 */

export interface LFuzzy {
  value?: string | null;
  precision: string;
}

export interface LName {
  ko: string;
  en?: string;
  hanja?: string;
  full?: string;
}

export interface LProvenance {
  sources: string[];
  checked_at: string;
  note?: string;
}

export type LCodes = Record<string, string | string[]>;

export interface LStation {
  id: string;
  name: LName;
  aliases?: string[];
  status: string;
  kind?: string;
  region?: string;
  address?: string;
  lat?: number;
  lng?: number;
  coord_source?: string;
  coord_basis?: string;
  opened_at?: LFuzzy;
  closed_at?: LFuzzy;
  line_ids?: string[];
  transfer_group?: string;
  codes?: LCodes;
  grade?: string;
  merge_into?: string;
  related_line_names?: string[];
  history?: string;
  intro?: string;
  provenance: LProvenance;
  line_classes?: string[];
  service_kinds?: string[];
  review_status?: string;
  areas?: string[];
}

export interface LLine {
  id: string;
  name: LName;
  aliases?: string[];
  category: string;
  rail_class?: string;
  is_wide_area?: boolean;
  passenger_service?: boolean;
  line_role?: string;
  status: string;
  region?: string[];
  owner?: string;
  operator_name?: string;
  start_station_id?: string;
  end_station_id?: string;
  length_km?: number;
  opened_at?: LFuzzy;
  closed_at?: LFuzzy;
  track?: string;
  electrification?: string;
  gauge_mm?: number;
  design_speed_kmh?: number;
  color?: string;
  description?: string;
  codes?: LCodes;
  review_status?: string;
  areas?: string[];
  provenance: LProvenance;
}

export interface LLineStation {
  id: string;
  line_id: string;
  station_id: string;
  order: number;
  km?: number;
  branch?: string;
  station_code?: string;
  order_confirmed?: boolean;
  provenance: LProvenance;
}

export interface LPlanRef {
  program: string;
  edition?: string;
  timing?: string;
  class: string;
  category?: string;
  section?: string;
  content?: string;
  length_km?: number;
  cost_100m_krw?: number;
  task_group?: string;
  source: string;
  locator?: string;
}

export interface LStageEvent {
  stage: string;
  date: LFuzzy;
  note?: string;
  source: string;
}

export interface LPlan {
  id: string;
  name: LName;
  aliases?: string[];
  plan_refs: LPlanRef[];
  stage: string;
  stage_history?: LStageEvent[];
  target_open?: LFuzzy;
  opened_at?: LFuzzy;
  line_ids?: string[];
  station_ids?: string[];
  related_plans?: { plan_id: string; relation: string; note?: string; source?: string }[];
  areas?: string[];
  regions?: string[];
  operator_name?: string;
  description?: string;
  review_status?: string;
  provenance: LProvenance;
  /** YAML 전용 */
  national?: boolean;
  gazette_keywords?: string[];
}

export interface LEvent {
  id: string;
  type: string;
  date: LFuzzy;
  title: string;
  line_ids?: string[];
  station_ids?: string[];
  service_ids?: string[];
  plan_ids?: string[];
  areas?: string[];
  note?: string;
  provenance: LProvenance;
}

export interface LTimetableSummary {
  id: string;
  station_id: string;
  service_id?: string;
  route_code: string;
  day_type: string;
  direction: string;
  direction_label?: string;
  first: string;
  last: string;
  count: number;
  by_hour: number[];
  detail_file: string;
  data_as_of: string;
  provenance: LProvenance;
}

export interface LSource {
  id: string;
  title: string;
  publisher: string;
  url?: string;
  type: string;
  dataset_key?: string;
  license: string;
  attribution?: string;
  published_at?: string;
  data_as_of?: string;
  retrieved_at: string;
  refresh?: string;
  download?: Record<string, unknown>;
  note?: string;
}

export interface LStopPattern {
  id: string;
  name: LName;
  type: string;
  station_ids: string[];
  note?: string;
}

export interface LService {
  id: string;
  name: LName;
  aliases?: string[];
  kind: string;
  train_class_id?: string;
  line_ids: string[];
  stop_patterns?: LStopPattern[];
  status: string;
  color?: string;
  description?: string;
  opened_at?: LFuzzy;
  closed_at?: LFuzzy;
  areas?: string[];
  review_status?: string;
  provenance: LProvenance;
}

export interface LTrainClass {
  id: string;
  name: LName;
  aliases?: string[];
  tier: string;
  status?: string;
  retired_at?: LFuzzy;
  successor_id?: string;
  max_speed_kmh?: number;
  started_at?: LFuzzy;
  ended_at?: LFuzzy;
  description?: string;
  codes?: LCodes;
  review_status?: string;
  provenance: LProvenance;
}

export interface LTrainNumberRange {
  id: string;
  operator: string;
  code_prefix?: string;
  range_from: number;
  range_to: number;
  group: string;
  train_class_id?: string;
  service_ids?: string[];
  line_ids?: string[];
  route_text?: string;
  parity_rule?: string;
  note?: string;
  valid_from?: LFuzzy;
  valid_to?: LFuzzy;
  review_status?: string;
  provenance: LProvenance;
}

export interface LRollingStock {
  id: string;
  operator: string;
  series: string;
  number_prefix?: string;
  number_from: number;
  number_to: number;
  digits: number;
  group: string;
  model?: string;
  train_class_id?: string;
  service_ids?: string[];
  line_ids?: string[];
  formation?: {
    label?: string;
    from?: string;
    to?: string;
    count?: number;
    cars?: number;
    code_prefix?: string;
    note?: string;
  };
  number_rule?: string;
  status: string;
  introduced_at?: LFuzzy;
  retired_at?: LFuzzy;
  owner_note?: string;
  note?: string;
  review_status?: string;
  provenance: LProvenance;
}

export interface LTransferCenter {
  id: string;
  name: LName;
  aliases?: string[];
  kind: string;
  region?: string;
  area?: string;
  station_ids?: string[];
  plan_ids?: string[];
  plan_refs: {
    program: string;
    class: string;
    name: string;
    cost_100m_krw?: number;
    rail_now?: string;
    rail_future?: string;
    page?: string;
    note?: string;
    source: string;
  }[];
  status: string;
  status_as_of?: LFuzzy;
  status_source: string;
  status_history?: { status: string; date: LFuzzy; note?: string; source: string }[];
  description?: string;
  review_status?: string;
  provenance: LProvenance;
}

export interface LPlanProgram {
  id: string;
  kind: string;
  name: LName;
  short: string;
  round?: number;
  region?: string;
  period?: { from?: number; to?: number };
  issuer?: string;
  legal_basis?: string;
  status: string;
  parent?: string;
  notices?: { kind: string; title: string; number?: string; date: LFuzzy; note?: string; source: string }[];
  summary?: string;
  rail_points?: string[];
  figures?: { label: string; value: string; source?: string }[];
  document_note?: string;
  review_status?: string;
  provenance: LProvenance;
}

export interface LRouteMap {
  id: string;
  title: LName;
  publisher: string;
  region?: string;
  mode: string;
  file?: string;
  url: string;
  license: string;
  attribution: string;
  as_of?: string;
  provenance: LProvenance;
}

export interface LPlanRoute {
  plan_id: string;
  kind: string;
  via?: string[];
  coordinates?: number[][] | number[][][];
  note?: string;
  source?: string;
}

export interface LOsmLineMap {
  line_id: string;
  relations?: number[];
  way_names?: string[];
  ways?: number[];
  bbox?: number[];
  share_with?: string[];
  claim_first?: unknown;
  note?: string;
}

export interface LLineNameOverride {
  key: string;
  slug?: string;
  en?: string;
  drop?: boolean;
  en_source?: string;
  color_source?: string;
  opened_source?: string;
  status_source?: string;
  is_wide_area_source?: string;
  rail_class_source?: string;
  note?: string;
}

export interface LTagoRoute {
  route_id: string;
  name: string;
  service_id?: string;
  direction?: Record<string, string>;
}

export interface LTagoRaw {
  subwayStationId: string;
  station_id?: string;
  retrieved_at: string;
  items: {
    subwayRouteId: string;
    endSubwayStationNm?: string;
    depTime: string;
    arrTime: string;
    dailyTypeCode: string;
    upDownTypeCode: string;
  }[];
}
