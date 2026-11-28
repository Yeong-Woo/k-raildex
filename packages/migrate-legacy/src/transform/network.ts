/**
 * 역·노선·노선역 변환(WP 3.3, docs/07-migration.md 3-2·3-3절, Q70~Q73·Q95 A).
 */
import {
  lineStationId,
  type ExternalRef,
  type FuzzyDate,
  type LineCreate,
  type LineStationCreate,
  type SourceLink,
  type StationCreate,
} from '@k-raildex/contracts';
import type { Commented } from '../read/legacy';
import type {
  LCodes,
  LLine,
  LLineNameOverride,
  LLineStation,
  LOsmLineMap,
  LService,
  LStation,
  LTagoRoute,
} from '../read/types';
import { aliasNames, fuzzy, nameCols, rec, regionCode, regionCodes, type MigrationReport } from './common';
import { LINE_OPERATOR_NAMES } from './operator-map';

/** 역 문맥 외부 코드 체계(그대로 역에) */
export const STATION_CODE_SYSTEMS = new Set([
  'rafis',
  'korail_station_kilo',
  'korail_ktx_stations',
  'kric_station_info',
  'korail_station_loc',
  'korail_stn_cd',
  'tago_train',
]);
/** 노선 문맥 코드(노선역으로, Q72 A) */
export const LINE_CONTEXT_CODE_SYSTEMS = new Set(['tago_subway', 'kric_station_std', 'molit_metro_lines']);
/** 노선 codes 키 → 외부 시스템 코드(같은 키가 역·노선에 다른 뜻으로 쓰임) */
export const LINE_CODE_SYSTEMS: Readonly<Record<string, string>> = {
  kr_line_no: 'kr_line_no',
  molit_line_no: 'molit_line_no',
  kric_metro_line_info: 'kric_metro_line_info',
  kric_station_std: 'kric_station_std_line',
  korail_kilo_line: 'korail_kilo_line',
  molit_metro_lines: 'molit_metro_lines_line',
  kric_route: 'kric_route',
};

/** 상태 배분 순위: 값이 클수록 "덜 진행됐거나 끝난 쪽"(07 문서 3-2: 노선 공사 중이면 공사 중, 역 폐역이면 폐역) */
const STATUS_WEIGHT: Record<string, number> = {
  operating: 1,
  under_construction: 2,
  planned: 3,
  suspended: 4,
  closed: 5,
  abandoned: 6,
};

export function combineStatus(lineStatus: string, stationStatus: string): string {
  return (STATUS_WEIGHT[lineStatus] ?? 0) >= (STATUS_WEIGHT[stationStatus] ?? 0) ? lineStatus : stationStatus;
}

export function sameFuzzy(a: FuzzyDate | null, b: FuzzyDate | null): boolean {
  return a != null && b != null && a.value === b.value && a.precision === b.precision;
}

function codeList(v: string | string[]): string[] {
  return (Array.isArray(v) ? v : [v]).map(String);
}

/** 노선 코드 "I4101,I4401" 처럼 쉼표로 이은 코드값은 나눈다 */
export function splitLineCode(v: string): string[] {
  return /^[A-Za-z0-9]+(,[A-Za-z0-9]+)+$/.test(v) ? v.split(',') : [v];
}

function ref(system: string, code: string, note: string | null = null): ExternalRef {
  return { system, code, label: null, is_primary: false, source_id: null, note };
}

export interface NetworkInput {
  stations: LStation[];
  lines: LLine[];
  lineStations: LLineStation[];
  services: LService[];
  tagoRoutes: LTagoRoute[];
  linesManual: Commented<{ id: string; station_code_line_nos?: string[] }>;
  stationsManual: Commented<{ id: string }>;
  lineNames: Commented<LLineNameOverride>;
  osmLineMap: Commented<LOsmLineMap>;
}

export interface NetworkOutput {
  stations: StationCreate[];
  lines: LineCreate[];
  lineStations: LineStationCreate[];
  /** 운영기관별 근거(노선 출처·확인일) */
  operatorUse: Map<string, { sources: Set<string>; checked_at: string; lines: string[] }>;
}

const LINE_FIELD_SOURCE: Record<string, string> = {
  en_source: 'name_en',
  color_source: 'color',
  opened_source: 'opened',
  status_source: 'status',
  is_wide_area_source: 'is_wide_area',
  rail_class_source: 'rail_class',
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** line-names.yaml 항목 → 노선 id (slug → line-<slug>, 없으면 영문명 일치) */
function lineIdOfOverride(o: LLineNameOverride, lines: Map<string, LLine>): string | null {
  if (o.slug && lines.has(`line-${o.slug}`)) return `line-${o.slug}`;
  if (o.en) {
    const bySlug = `line-${slugify(o.en)}`;
    if (lines.has(bySlug)) return bySlug;
    for (const l of lines.values()) if (l.name.en === o.en) return l.id;
  }
  return null;
}

export function transformNetwork(input: NetworkInput, report: MigrationReport): NetworkOutput {
  const lineById = new Map(input.lines.map((l) => [l.id, l]));
  const stationById = new Map(input.stations.map((s) => [s.id, s]));
  const lsByStation = new Map<string, LLineStation[]>();
  for (const r of input.lineStations) {
    const list = lsByStation.get(r.station_id) ?? [];
    list.push(r);
    lsByStation.set(r.station_id, list);
  }

  // ---------------------------------------------------------------- 노선 문맥 코드 해석 도구
  // kric_station_std "역번호@노선번호" → 노선 codes.kric_station_std(쉼표 목록) 또는 lines-manual station_code_line_nos
  const linesOfStdCode = new Map<string, Set<string>>();
  const addStd = (code: string, lineId: string) => {
    const set = linesOfStdCode.get(code) ?? new Set();
    set.add(lineId);
    linesOfStdCode.set(code, set);
  };
  for (const l of input.lines) {
    const c = l.codes?.kric_station_std;
    if (c) for (const v of codeList(c)) for (const x of splitLineCode(v)) addStd(x, l.id);
  }
  for (const m of input.linesManual.items) for (const c of m.station_code_line_nos ?? []) addStd(String(c), m.id);
  // TAGO 역 id 접두사 → 운행 계통 → 운행 계통 노선
  const tagoRoutes = [...input.tagoRoutes].sort((a, b) => b.route_id.length - a.route_id.length);
  const serviceLines = new Map(input.services.map((s) => [s.id, new Set(s.line_ids)]));
  const linesOfTago = (code: string): Set<string> | null => {
    const r = tagoRoutes.find((t) => code.startsWith(t.route_id));
    return r?.service_id ? (serviceLines.get(r.service_id) ?? null) : null;
  };

  // ---------------------------------------------------------------- 노선역 + 역
  const lineStations: LineStationCreate[] = [];
  const lsRefs = new Map<string, ExternalRef[]>();
  const stations: StationCreate[] = [];

  for (const s of input.stations) {
    const where = `station ${s.id}`;
    const rows = (lsByStation.get(s.id) ?? []).slice().sort((a, b) => a.line_id.localeCompare(b.line_id));
    const stOpened = fuzzy(s.opened_at, `${where}.opened_at`);
    const stClosed = fuzzy(s.closed_at, `${where}.closed_at`);
    const lsIdOf = (lineId: string) => lineStationId(lineId, s.id);

    // 상태·개통일 배분
    const assigned = rows.map((r) => {
      const line = lineById.get(r.line_id);
      if (!line) throw new Error(`line-stations: 노선 ${r.line_id} 가 없음 (${r.id})`);
      const status = rows.length === 1 ? s.status : combineStatus(line.status, s.status);
      return { r, line, status };
    });
    const operatingCount = assigned.filter((a) => a.status === 'operating').length;
    if (rows.length > 1) report.count('역.다중 노선');
    let openedPlaced = false;
    for (const a of assigned) {
      let opened: FuzzyDate | null = null;
      let closed: FuzzyDate | null = null;
      if (rows.length === 1) {
        opened = stOpened;
        closed = stClosed;
      } else {
        const lineOpened = fuzzy(a.line.opened_at, `line ${a.line.id}.opened_at`);
        if (stOpened && (sameFuzzy(stOpened, lineOpened) || (a.status === 'operating' && operatingCount === 1))) {
          opened = stOpened;
          openedPlaced = true;
        }
        if (stClosed && (a.status === 'closed' || a.status === 'abandoned')) closed = stClosed;
      }
      if (a.status !== s.status) report.count('노선역.상태가 역 상태와 다름(배분)');
      lineStations.push({
        id: lsIdOf(a.r.line_id),
        line_id: a.r.line_id,
        station_id: s.id,
        seq: a.r.order,
        branch: a.r.branch ?? null,
        km: a.r.km ?? null,
        station_code: a.r.station_code ?? null,
        order_confirmed: a.r.order_confirmed ?? true,
        gap_confirmed_prev_id: null,
        branch_from_id: null,
        name_ko: null,
        name_en: null,
        operator_id: null,
        korail_class: null,
        korail_mgmt_grade: null,
        managed_by_id: null,
        status: a.status as LineStationCreate['status'],
        opened,
        closed,
        geom: null,
        note: null,
        // 노선의 출처와 다르면 노선역 출처로(기존 행의 provenance)
        sources: [...new Set(a.r.provenance.sources)].map((source_id) => ({
          source_id,
          field: null,
          locator: null,
          note: null,
        })),
        names: [],
        external_refs: [],
      });
    }
    if (rows.length > 1 && stOpened && !openedPlaced)
      report.add(
        '다중 노선 역 개통일 미배분(Q95 A, D-6)',
        `${s.id} ${stOpened.value ?? ''} (${rows.map((r) => r.line_id).join(', ')})`,
      );

    // 외부 코드
    const stationRefs: ExternalRef[] = [];
    const extraCodes: Record<string, unknown> = {};
    const lineIds = new Set(rows.map((r) => r.line_id));
    for (const [system, value] of Object.entries(s.codes ?? ({} as LCodes))) {
      for (const code of codeList(value)) {
        if (STATION_CODE_SYSTEMS.has(system)) {
          stationRefs.push(ref(system, code));
          continue;
        }
        if (!LINE_CONTEXT_CODE_SYSTEMS.has(system)) {
          report.add('알 수 없는 역 코드 체계(extra.codes 로 보관)', `${s.id} ${system}=${code}`);
          ((extraCodes[system] as string[] | undefined) ??= []).push(code);
          continue;
        }
        let target: string | null = null;
        if (lineIds.size === 1) target = [...lineIds][0]!;
        else if (system === 'kric_station_std') {
          const lc = code.split('@')[1];
          const cand = [...(lc ? (linesOfStdCode.get(lc) ?? []) : [])].filter((l) => lineIds.has(l));
          if (cand.length === 1) target = cand[0]!;
        } else if (system === 'tago_subway') {
          const cand = [...(linesOfTago(code) ?? [])].filter((l) => lineIds.has(l));
          if (cand.length === 1) target = cand[0]!;
        }
        if (target) {
          const id = lsIdOf(target);
          lsRefs.set(id, [...(lsRefs.get(id) ?? []), ref(system, code)]);
          report.count(`노선 문맥 코드.노선역으로.${system}`);
        } else {
          stationRefs.push(ref(system, code, '노선역 미해석 — 역에 보관(이관)'));
          report.add(
            '노선 문맥 코드 노선역 미해석(역에 보관)',
            `${s.id} ${system}=${code} (노선 ${[...lineIds].join(', ') || '없음'})`,
          );
        }
      }
    }

    const hasGeom = s.lat != null && s.lng != null;
    if (hasGeom !== (s.coord_source != null)) report.add('좌표·좌표 출처 불일치', s.id);
    const region = regionCode(s.region);
    if (s.region && !region) report.add('시·도 이름 해석 실패', `${where}: ${s.region}`);
    const extra: Record<string, unknown> = {};
    if (s.related_line_names?.length) extra.related_line_names = s.related_line_names;
    if (Object.keys(extraCodes).length) extra.codes = extraCodes;
    const noLines = rows.length === 0;
    if (noLines) report.count('역.노선 없음(own_*)');

    stations.push({
      id: s.id,
      ...(nameCols(s.name) as {
        name_ko: string;
        name_en: string | null;
        name_hanja: string | null;
        name_full: string | null;
      }),
      // 0039(2026-11-28): 역 그룹 종류는 여객역·화물역만 — 옛 신호장·조차장·차량기지·분기점은 여객역으로 들이고 시설·지선으로 따로 옮긴다
      kind: (s.kind === 'freight' ? 'freight' : 'station') as StationCreate['kind'],
      region_code: region,
      region_basis: null,
      address: s.address ?? null,
      geom: hasGeom && s.coord_source ? { lat: s.lat!, lng: s.lng! } : null,
      coord_source: hasGeom ? ((s.coord_source as StationCreate['coord_source']) ?? null) : null,
      coord_basis: hasGeom ? ((s.coord_basis as StationCreate['coord_basis']) ?? null) : null,
      coord_query: null,
      coord_same_as_id: null,
      coord_note: null,
      grade: s.grade ?? null,
      history_text: s.history ?? null,
      intro_text: s.intro ?? null,
      merge_into_id: s.merge_into ?? null,
      own_status: noLines ? (s.status as StationCreate['own_status']) : null,
      own_opened: noLines ? stOpened : null,
      own_closed: noLines ? stClosed : null,
      ...rec(s.provenance, { review: undefined, editorNote: input.stationsManual.notes.get(s.id) ?? null, extra }),
      names: aliasNames(s.aliases, s.name.ko),
      external_refs: stationRefs,
    });
    if (s.merge_into && !stationById.has(s.merge_into))
      report.add('merge_into 대상 역 없음', `${s.id} → ${s.merge_into}`);
  }
  for (const ls of lineStations) ls.external_refs = lsRefs.get(ls.id) ?? [];

  // ---------------------------------------------------------------- 노선
  const fieldSources = new Map<string, SourceLink[]>();
  const lineNotes = new Map<string, string[]>();
  for (const o of input.lineNames.items) {
    if (o.drop) continue;
    const lineId = lineIdOfOverride(o, lineById);
    const comment = input.lineNames.notes.get(o.key);
    if (!lineId) {
      const hasField = Object.keys(LINE_FIELD_SOURCE).some((k) => (o as unknown as Record<string, unknown>)[k]);
      if (hasField || comment) report.add('line-names.yaml 항목의 노선을 찾지 못함(필드 출처 미이관)', o.key);
      continue;
    }
    if (comment) lineNotes.set(lineId, [...(lineNotes.get(lineId) ?? []), comment]);
    for (const [k, field] of Object.entries(LINE_FIELD_SOURCE)) {
      const src = (o as unknown as Record<string, unknown>)[k];
      if (typeof src !== 'string') continue;
      const list = fieldSources.get(lineId) ?? [];
      if (!list.some((x) => x.source_id === src && x.field === field))
        list.push({ source_id: src, field, locator: null, note: 'line-names.yaml' });
      fieldSources.set(lineId, list);
    }
  }
  for (const [id, c] of input.linesManual.notes) lineNotes.set(id, [...(lineNotes.get(id) ?? []), c]);

  const osmByLine = new Map<string, { m: LOsmLineMap; priority: number }>();
  input.osmLineMap.items.forEach((m, i) => {
    if (!lineById.has(m.line_id)) {
      report.add('osm-line-map.yaml 의 노선 없음', m.line_id);
      return;
    }
    if (osmByLine.has(m.line_id)) {
      report.add('osm-line-map.yaml 노선 중복(첫 항목만)', m.line_id);
      return;
    }
    osmByLine.set(m.line_id, { m, priority: i });
  });

  const operatorUse: NetworkOutput['operatorUse'] = new Map();
  const lines: LineCreate[] = [];
  for (const l of input.lines) {
    const where = `line ${l.id}`;
    const operators: LineCreate['operators'] = [];
    if (l.operator_name) {
      const assigned = LINE_OPERATOR_NAMES[l.operator_name];
      if (!assigned) report.add('운영기관 미매칭', `${l.id}: ${l.operator_name}`);
      for (const a of assigned ?? []) {
        operators.push({ operator_id: a.operator_id, role: 'operator', note: a.note });
        const u = operatorUse.get(a.operator_id) ?? { sources: new Set<string>(), checked_at: '0000-00-00', lines: [] };
        for (const src of l.provenance.sources) u.sources.add(src);
        if (l.provenance.checked_at > u.checked_at) u.checked_at = l.provenance.checked_at;
        u.lines.push(l.id);
        operatorUse.set(a.operator_id, u);
      }
    }
    const refs: ExternalRef[] = [];
    const extraCodes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(l.codes ?? {})) {
      const system = LINE_CODE_SYSTEMS[k];
      for (const raw of codeList(v)) {
        if (!system) {
          report.add('알 수 없는 노선 코드 체계(extra.codes 로 보관)', `${l.id} ${k}=${raw}`);
          ((extraCodes[k] as string[] | undefined) ??= []).push(raw);
          continue;
        }
        for (const code of splitLineCode(raw)) refs.push(ref(system, code));
      }
    }
    const osm = osmByLine.get(l.id);
    let osmMap: LineCreate['osm_map'] = null;
    if (osm) {
      const notes = [osm.m.note];
      // share_with·ways 는 열(0019·0020), claim_first 는 priority 를 앞당겨(−1000) 표현
      osmMap = {
        relation_ids: osm.m.relations ?? [],
        way_names: osm.m.way_names ?? [],
        bbox: osm.m.bbox && osm.m.bbox.length === 4 ? (osm.m.bbox as [number, number, number, number]) : null,
        priority: osm.m.claim_first ? osm.priority - 1000 : osm.priority,
        include_construction: true,
        share_with: osm.m.share_with ?? [],
        way_ids: osm.m.ways ?? [],
        connect_terminals: false,
        note: notes.filter(Boolean).join('\n') || null,
      };
    }
    const extra: Record<string, unknown> = {};
    if (l.operator_name) extra.operator_name_raw = l.operator_name;
    if (Object.keys(extraCodes).length) extra.codes = extraCodes;
    const base = rec(l.provenance, {
      review: l.review_status,
      editorNote: lineNotes.get(l.id)?.join('\n\n') ?? null,
      extra,
    });
    lines.push({
      id: l.id,
      ...(nameCols(l.name) as {
        name_ko: string;
        name_en: string | null;
        name_hanja: string | null;
        name_full: string | null;
      }),
      category: l.category as LineCreate['category'],
      rail_class: l.rail_class as LineCreate['rail_class'],
      is_wide_area: l.is_wide_area ?? null,
      wide_area_note: null,
      passenger_service: l.passenger_service ?? true,
      line_role: (l.line_role as LineCreate['line_role']) ?? null,
      status: l.status as LineCreate['status'],
      owner: l.owner ?? null,
      start_station_id: l.start_station_id ?? null,
      end_station_id: l.end_station_id ?? null,
      length_km: l.length_km ?? null,
      opened: fuzzy(l.opened_at, `${where}.opened_at`),
      closed: fuzzy(l.closed_at, `${where}.closed_at`),
      track: (l.track as LineCreate['track']) ?? null,
      electrification: l.electrification ?? null,
      gauge_mm: l.gauge_mm ?? null,
      design_speed_kmh: l.design_speed_kmh ?? null,
      color: l.color ?? null,
      description: l.description ?? null,
      parent_line_id: null,
      branch_of_id: null,
      ...base,
      sources: [...base.sources, ...(fieldSources.get(l.id) ?? [])],
      names: aliasNames(l.aliases, l.name.ko),
      external_refs: refs,
      regions: regionCodes(l.region, where, report),
      operators,
      osm_map: osmMap,
    });
  }
  return { stations, lines, lineStations, operatorUse };
}
