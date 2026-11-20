/** 그 밖의 개체 변환(WP 3.6): 연표 이벤트·열차번호대·차량번호대·환승센터·노선도·용어 */
import type {
  EventCreate,
  GlossaryTermCreate,
  RollingStockRangeCreate,
  RouteMapCreate,
  TrainNumberRangeCreate,
  TransferCenterCreate,
} from '@k-raildex/contracts';
import type { ParsedTerm } from '../read/terminology';
import type { LEvent, LRollingStock, LRouteMap, LTrainNumberRange, LTransferCenter } from '../read/types';
import {
  aliasNames,
  fuzzy,
  nameCols,
  programId,
  rec,
  regionCode,
  transferCenterId,
  type MigrationReport,
} from './common';
import { operatorOfEnum } from './operator-map';

export const CHRONOLOGY_SOURCE = 'src-kric-chronology';

/** 이벤트는 수기(events-manual.yaml) + 철도통합연표 기원만 저장한다. 나머지는 DB 뷰가 같은 id 로 만든다(D-3) */
export function isStoredEvent(e: LEvent, manualIds: Set<string>): boolean {
  return manualIds.has(e.id) || e.provenance.sources.includes(CHRONOLOGY_SOURCE);
}

export function transformEvent(
  e: LEvent,
  manual: boolean,
  existing: Set<string>,
  report: MigrationReport,
  editorNote: string | null,
): EventCreate {
  const targets: EventCreate['targets'] = [];
  for (const id of [...(e.line_ids ?? []), ...(e.station_ids ?? []), ...(e.service_ids ?? []), ...(e.plan_ids ?? [])]) {
    if (!existing.has(id)) {
      report.add('이벤트 대상 개체 없음(대상 제외)', `${e.id}: ${id}`);
      continue;
    }
    if (!targets.some((t) => t.entity_id === id)) targets.push({ entity_id: id, role: 'subject' });
  }
  return {
    id: e.id,
    type: e.type as EventCreate['type'],
    date: fuzzy(e.date, `event ${e.id}.date`)!,
    title: e.title,
    note: e.note ?? null,
    origin: manual ? 'manual' : 'chronology',
    ...rec(e.provenance, { editorNote }),
    names: [],
    external_refs: [],
    targets,
    area_codes: [...new Set((e.areas ?? []) as EventCreate['area_codes'])],
  };
}

export function transformTrainNumberRange(
  r: LTrainNumberRange,
  report: MigrationReport,
  editorNote: string | null,
): TrainNumberRangeCreate | null {
  const op = operatorOfEnum(r.operator, r.id);
  if (!op) {
    report.add('운영기관 미매칭(번호대 제외)', `${r.id}: operator ${r.operator}`);
    return null;
  }
  if (r.operator === 'other') report.count('번호대.operator other → id 접두사로 운영기관');
  const where = `train_number_range ${r.id}`;
  return {
    id: r.id,
    operator_id: op,
    code_prefix: r.code_prefix ?? null,
    range_from: r.range_from,
    range_to: r.range_to,
    group: r.group as TrainNumberRangeCreate['group'],
    train_class_id: r.train_class_id ?? null,
    route_text: r.route_text ?? null,
    parity_rule: (r.parity_rule as TrainNumberRangeCreate['parity_rule']) ?? null,
    valid_from: fuzzy(r.valid_from, `${where}.valid_from`),
    valid_to: fuzzy(r.valid_to, `${where}.valid_to`),
    note: r.note ?? null,
    ...rec(r.provenance, { review: r.review_status, editorNote, extra: { operator_enum: r.operator } }),
    names: [],
    external_refs: [],
    service_ids: [...new Set(r.service_ids ?? [])],
    line_ids: [...new Set(r.line_ids ?? [])],
  };
}

export function transformRollingStock(
  r: LRollingStock,
  report: MigrationReport,
  editorNote: string | null,
): RollingStockRangeCreate | null {
  const op = operatorOfEnum(r.operator, r.id);
  if (!op) {
    report.add('운영기관 미매칭(번호대 제외)', `${r.id}: operator ${r.operator}`);
    return null;
  }
  const where = `rolling_stock_range ${r.id}`;
  const f = r.formation;
  return {
    id: r.id,
    operator_id: op,
    series: r.series,
    number_prefix: r.number_prefix ?? null,
    number_from: r.number_from,
    number_to: r.number_to,
    digits: r.digits,
    group: r.group as RollingStockRangeCreate['group'],
    model: r.model ?? null,
    train_class_id: r.train_class_id ?? null,
    number_rule: r.number_rule ?? null,
    status: r.status as RollingStockRangeCreate['status'],
    introduced: fuzzy(r.introduced_at, `${where}.introduced_at`),
    retired: fuzzy(r.retired_at, `${where}.retired_at`),
    owner_note: r.owner_note ?? null,
    formation_label: f?.label ?? null,
    formation_from: f?.from != null ? String(f.from) : null,
    formation_to: f?.to != null ? String(f.to) : null,
    formation_count: f?.count ?? null,
    formation_cars: f?.cars ?? null,
    formation_code_prefix: f?.code_prefix ?? null,
    formation_note: f?.note ?? null,
    note: r.note ?? null,
    ...rec(r.provenance, { review: r.review_status, editorNote, extra: { operator_enum: r.operator } }),
    names: [],
    external_refs: [],
    service_ids: [...new Set(r.service_ids ?? [])],
    line_ids: [...new Set(r.line_ids ?? [])],
  };
}

export function transformTransferCenter(
  t: LTransferCenter,
  report: MigrationReport,
  editorNote: string | null,
): TransferCenterCreate {
  const where = `transfer_center ${t.id}`;
  const region = regionCode(t.region);
  if (t.region && !region) report.add('시·도 이름 해석 실패', `${where}: ${t.region}`);
  return {
    id: transferCenterId(t.id),
    ...(nameCols(t.name, false) as { name_ko: string; name_en: string | null; name_full: string | null }),
    kind: t.kind as TransferCenterCreate['kind'],
    region_code: region,
    area_code: (t.area as TransferCenterCreate['area_code']) ?? null,
    status: t.status as TransferCenterCreate['status'],
    status_as_of: fuzzy(t.status_as_of, `${where}.status_as_of`),
    status_source_id: t.status_source,
    description: t.description ?? null,
    ...rec(t.provenance, { review: t.review_status, editorNote, extra: { legacy_id: t.id } }),
    names: [
      ...aliasNames(t.aliases, t.name.ko),
      {
        name: t.id,
        kind: 'internal',
        lang: 'ko',
        valid_from: null,
        valid_to: null,
        source_id: null,
        note: '기존 id(Q69 A)',
      },
    ],
    external_refs: [],
    plan_refs: t.plan_refs.map((r) => ({
      program_id: programId(r.program),
      class: r.class as TransferCenterCreate['plan_refs'][number]['class'],
      name_raw: r.name,
      cost_100m_krw: r.cost_100m_krw ?? null,
      rail_now: r.rail_now ?? null,
      rail_future: r.rail_future ?? null,
      page: r.page ?? null,
      note: r.note ?? null,
      source_id: r.source,
    })),
    status_events: (t.status_history ?? []).map((h, i) => ({
      status: h.status as TransferCenterCreate['status'],
      date: fuzzy(h.date, `${where}.status_history.${i}.date`)!,
      note: h.note ?? null,
      source_id: h.source,
    })),
    station_ids: [...new Set(t.station_ids ?? [])],
    plan_ids: [...new Set(t.plan_ids ?? [])],
  };
}

/** 노선도: 파일 게시(embed)는 문서 저장소 적재(WP 3.7) 전이라 링크로 이관하고 리포트한다 */
export function transformRouteMap(m: LRouteMap, report: MigrationReport, editorNote: string | null): RouteMapCreate {
  if (m.mode === 'embed')
    report.add('노선도 embed → link(문서 적재 WP 3.7 이후 embed 로)', `${m.id} file ${m.file ?? '-'}`);
  return {
    id: m.id,
    title_ko: m.title.ko,
    title_en: m.title.en ?? null,
    publisher: m.publisher,
    region: m.region ?? null,
    mode: 'link',
    document_id: null,
    url: m.url,
    license: m.license,
    attribution: m.attribution,
    as_of: m.as_of ?? null,
    width: null,
    height: null,
    ...rec(m.provenance, {
      editorNote,
      extra: m.file ? { legacy_mode: m.mode, legacy_file: m.file } : { legacy_mode: m.mode },
    }),
    names: [],
    external_refs: [],
  };
}

export const GLOSSARY_SOURCE = 'src-manual-curation';

/** 용어 id: term-<절 번호>-<절 안 순번>(한글 용어를 로마자로 바꾸지 않는다) */
export function transformGlossary(
  terms: ParsedTerm[],
  checkedAt: string,
  report: MigrationReport,
): GlossaryTermCreate[] {
  const out: GlossaryTermCreate[] = [];
  const perSection = new Map<number, number>();
  for (const [i, t] of terms.entries()) {
    const n = (perSection.get(t.sectionNo) ?? 0) + 1;
    perSection.set(t.sectionNo, n);
    // 절 머리 본문(### 앞의 표·설명)은 절 이름을 용어로 하는 항목으로
    const term = t.term ?? t.section;
    if (t.term == null) report.add('용어 사전 절 머리 본문 → 절 이름 항목으로 적재', `${t.sectionNo}. ${t.section}`);
    const definition = [t.definition, t.rest].filter(Boolean).join('\n\n');
    if (!t.definition) report.count('용어.정의 글머리 없음(본문 전체를 정의로)');
    if (!definition) {
      report.add('용어 본문 없음(제외)', term);
      continue;
    }
    out.push({
      id: `term-${t.sectionNo}-${n}`,
      term_ko: term,
      term_en: null,
      section: t.section,
      definition,
      basis: t.basis,
      example: t.example,
      caution: t.caution,
      ord: i + 1,
      checked_at: checkedAt,
      provenance_note: 'docs/TERMINOLOGY.md 이관(Q86 A)',
      review_status: 'unverified',
      editor_note: null,
      extra: {},
      sources: [{ source_id: GLOSSARY_SOURCE, field: null, locator: 'docs/TERMINOLOGY.md', note: null }],
      names: [],
      external_refs: [],
    });
  }
  return out;
}
