/**
 * 역변환·대조(WP 3.10, docs/07-migration.md 4절). 새 DB → 기존 JSON 형태(역·노선·노선-역·계획·연표·시간표 요약)를 다시 만들어
 * data/build/*.json 과 필드 단위로 비교한다. 역 상태·개통일은 노선별 역에서 다시 계산한 값(v_station_status)으로 비교한다.
 * 이 역변환은 대조 전용이다(기존 사이트 공급에 쓰지 않는다, FR-MIG-003).
 */
import { REGIONS } from '@k-raildex/db';
import { runHardRules, type Queryable, type Violation } from '@k-raildex/domain';
import type { LegacyData } from './read/legacy';
import type { LFuzzy } from './read/types';
import type { TransformResult } from './transform';
import { LINE_CODE_SYSTEMS } from './transform/network';

type Obj = Record<string, unknown>;

// ---------------------------------------------------------------------------- 비교 도구

/** null·undefined·빈 배열·빈 객체를 지우고 키를 정렬(기존 JSON 은 빈 값을 생략한다) */
export function clean(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    const a = v.map(clean).filter((x) => x !== undefined);
    return a.length ? a : undefined;
  }
  if (typeof v === 'object') {
    const out: Obj = {};
    for (const k of Object.keys(v as Obj).sort()) {
      const c = clean((v as Obj)[k]);
      if (c !== undefined) out[k] = c;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (typeof v === 'string' && v === '') return undefined;
  return v;
}

export function same(a: unknown, b: unknown): boolean {
  const ca = clean(a);
  const cb = clean(b);
  if (typeof ca === 'number' && typeof cb === 'number') return Math.abs(ca - cb) < 1e-7;
  return JSON.stringify(ca) === JSON.stringify(cb);
}

const sorted = (a: unknown[] | undefined | null): unknown[] | undefined =>
  a ? [...a].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))) : undefined;

const fz = (value: unknown, precision: unknown): LFuzzy | undefined =>
  precision == null
    ? undefined
    : value == null
      ? { precision: String(precision) }
      : { value: String(value), precision: String(precision) };

const num = (v: unknown): number | undefined => (v == null ? undefined : Number(v));

const REGION_NAME = new Map<string, string>(REGIONS.map((r) => [r.code, r.name]));

export interface FieldDiff {
  count: number;
  /** 의도된 차이 분류(D-1~D-7) 또는 설명. 없으면 미설명 차이 */
  intended: string | null;
  samples: { id: string; legacy: unknown; migrated: unknown }[];
}

export interface EntityDiff {
  entity: string;
  legacyCount: number;
  migratedCount: number;
  missing: string[];
  extra: string[];
  fields: Record<string, FieldDiff>;
}

/** 필드별 의도된 차이 분류. (entity, field, 레코드) → 분류 문자열 또는 null */
type Classifier = (field: string, legacy: Obj, migrated: Obj) => string | null;

function diffEntity(
  entity: string,
  legacy: Obj[],
  migrated: Obj[],
  keyOf: (o: Obj) => string,
  fields: string[],
  classify: Classifier,
): EntityDiff {
  const mById = new Map(migrated.map((m) => [keyOf(m), m]));
  const lById = new Map(legacy.map((l) => [keyOf(l), l]));
  const out: EntityDiff = {
    entity,
    legacyCount: legacy.length,
    migratedCount: migrated.length,
    missing: [...lById.keys()].filter((k) => !mById.has(k)),
    extra: [...mById.keys()].filter((k) => !lById.has(k)),
    fields: {},
  };
  for (const [id, l] of lById) {
    const m = mById.get(id);
    if (!m) continue;
    for (const f of fields) {
      if (same(l[f], m[f])) continue;
      const intended = classify(f, l, m);
      const key = intended ? `${f} [${intended}]` : f;
      const d = (out.fields[key] ??= { count: 0, intended, samples: [] });
      d.count++;
      if (d.samples.length < 5) d.samples.push({ id, legacy: clean(l[f]) ?? null, migrated: clean(m[f]) ?? null });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------- 역변환

async function rows<T = Obj>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

function group<T extends Obj>(list: T[], key: string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of list) {
    const k = String(r[key]);
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
}

async function commonLinks(db: Queryable) {
  const names = group(
    await rows(db, `SELECT entity_id, name, kind FROM entity_name WHERE kind = 'alias' ORDER BY entity_id, ord`),
    'entity_id',
  );
  const refs = group(
    await rows(db, `SELECT entity_id, system, code FROM external_ref ORDER BY entity_id, id`),
    'entity_id',
  );
  const srcs = group(
    await rows(db, `SELECT entity_id, source_id FROM record_source WHERE field IS NULL ORDER BY entity_id, ord`),
    'entity_id',
  );
  return {
    aliases: (id: string) => names.get(id)?.map((r) => String(r.name)),
    refs: (id: string) => refs.get(id) ?? [],
    sources: (id: string) => srcs.get(id)?.map((r) => String(r.source_id)) ?? [],
  };
}

/** codes{} 재구성: 값 하나면 문자열, 여럿이면 배열 */
function codesOf(list: Obj[], systemName: (s: string) => string, joinComma = false): Obj | undefined {
  const m = new Map<string, string[]>();
  for (const r of list) {
    const k = systemName(String(r.system));
    m.set(k, [...(m.get(k) ?? []), String(r.code)]);
  }
  if (!m.size) return undefined;
  const out: Obj = {};
  for (const [k, v] of m) out[k] = joinComma ? v.join(',') : v.length === 1 ? v[0] : [...v].sort();
  return out;
}

export async function reverseStations(db: Queryable): Promise<{ stations: Obj[]; lineStations: Obj[] }> {
  const c = await commonLinks(db);
  const st = await rows(
    db,
    `SELECT s.*, ST_Y(s.geom::geometry) AS lat, ST_X(s.geom::geometry) AS lng,
            v.status AS calc_status, v.opened_value AS c_ov, v.opened_precision AS c_op, v.closed_value AS c_cv, v.closed_precision AS c_cp,
            v.line_count, a.areas, lc.line_classes, rv.review_status AS inherited_review,
            (SELECT array_agg(DISTINCT ss.kind ORDER BY ss.kind) FROM v_station_service ss WHERE ss.station_id = s.id) AS service_kinds
       FROM station s JOIN v_station_status v ON v.station_id = s.id
       JOIN v_station_area a ON a.station_id = s.id JOIN v_station_line_class lc ON lc.station_id = s.id
       JOIN v_station_review rv ON rv.station_id = s.id
      WHERE s.deleted_at IS NULL ORDER BY s.id`,
  );
  const ls = await rows(
    db,
    `SELECT x.* FROM line_station x JOIN line l ON l.id = x.line_id AND l.deleted_at IS NULL WHERE x.deleted_at IS NULL ORDER BY x.line_id, x.seq`,
  );
  const lsByStation = group(ls, 'station_id');
  const stations = st.map((s) => {
    const id = String(s.id);
    const mine = lsByStation.get(id) ?? [];
    const refs = [...c.refs(id), ...mine.flatMap((x) => c.refs(String(x.id)))];
    const lineIds = [...new Set(mine.map((x) => String(x.line_id)))];
    return {
      id,
      name: { ko: s.name_ko, en: s.name_en, hanja: s.name_hanja },
      aliases: sorted(c.aliases(id)),
      status: s.calc_status,
      kind: s.kind === 'station' ? undefined : s.kind,
      region: s.region_code ? REGION_NAME.get(String(s.region_code)) : undefined,
      address: s.address,
      lat: num(s.lat),
      lng: num(s.lng),
      coord_source: s.coord_source,
      coord_basis: s.coord_basis,
      opened_at: fz(s.c_ov, s.c_op),
      closed_at: fz(s.c_cv, s.c_cp),
      line_ids: sorted(lineIds),
      // 기존 환승 그룹 = 역 자신(노선 둘 이상) — 역 = 그룹이라 저장하지 않고 다시 만든다
      transfer_group: lineIds.length > 1 ? id : undefined,
      codes: codesOf(refs, (x) => x),
      grade: s.grade,
      merge_into: s.merge_into_id,
      related_line_names: (s.extra as Obj | null)?.related_line_names,
      history: s.history_text,
      intro: s.intro_text,
      provenance: { sources: sorted(c.sources(id)), checked_at: fmtDate(s.checked_at), note: s.provenance_note },
      line_classes: s.line_classes,
      service_kinds: s.service_kinds,
      review_status: s.inherited_review === 'verified' ? 'verified' : 'auto',
      areas: s.areas,
    };
  });
  const lineStations = ls.map((x) => ({
    id: x.id,
    line_id: x.line_id,
    station_id: x.station_id,
    order: x.seq,
    station_code: x.station_code,
    km: num(x.km),
    branch: x.branch,
    order_confirmed: x.order_confirmed,
    provenance: { sources: sorted(c.sources(String(x.id))) },
  }));
  return { stations, lineStations };
}

function fmtDate(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v);
}

const LINE_SYSTEM_BACK = new Map(Object.entries(LINE_CODE_SYSTEMS).map(([k, v]) => [v, k]));

export async function reverseLines(db: Queryable): Promise<Obj[]> {
  const c = await commonLinks(db);
  const ls = await rows(
    db,
    `SELECT l.*, a.areas,
            (SELECT array_agg(r.region_code ORDER BY r.region_code) FROM line_region r WHERE r.line_id = l.id) AS regions
       FROM line l JOIN v_line_area a ON a.line_id = l.id WHERE l.deleted_at IS NULL ORDER BY l.id`,
  );
  return ls.map((l) => {
    const id = String(l.id);
    const extra = (l.extra ?? {}) as Obj;
    return {
      id,
      name: { ko: l.name_ko, en: l.name_en, hanja: l.name_hanja, full: l.name_full },
      aliases: sorted(c.aliases(id)),
      category: l.category,
      rail_class: l.rail_class,
      review_status: l.review_status === 'verified' ? 'verified' : 'auto',
      areas: l.areas,
      is_wide_area: l.is_wide_area,
      passenger_service: l.passenger_service === true ? undefined : l.passenger_service,
      line_role: l.line_role,
      status: l.status,
      region: sorted(((l.regions as string[] | null) ?? []).map((r) => REGION_NAME.get(r) ?? r)),
      owner: l.owner,
      // D-4: 운영기관 참조 + 원문은 extra.operator_name_raw
      operator_name: extra.operator_name_raw,
      length_km: num(l.length_km),
      opened_at: fz(l.opened_value, l.opened_precision),
      closed_at: fz(l.closed_value, l.closed_precision),
      description: l.description,
      codes: codesOf(c.refs(id), (s) => LINE_SYSTEM_BACK.get(s) ?? s, true),
      provenance: { sources: sorted(c.sources(id)), checked_at: fmtDate(l.checked_at), note: l.provenance_note },
      start_station_id: l.start_station_id,
      end_station_id: l.end_station_id,
      color: l.color,
      track: l.track,
      gauge_mm: l.gauge_mm,
    };
  });
}

export function legacyProgramId(ppId: string): string {
  return ppId.replace(/^pp-/, '').replace(/-/g, '_');
}

export async function reversePlans(db: Queryable): Promise<Obj[]> {
  const c = await commonLinks(db);
  const plans = await rows(
    db,
    `SELECT p.*, s.stage AS calc_stage, t.value AS t_value, t.precision AS t_precision, a.areas
       FROM plan p JOIN v_plan_stage s ON s.plan_id = p.id JOIN v_plan_area a ON a.plan_id = p.id
       LEFT JOIN v_plan_target_open t ON t.plan_id = p.id WHERE p.deleted_at IS NULL ORDER BY p.id`,
  );
  const refs = group(await rows(db, `SELECT * FROM plan_ref ORDER BY plan_id, seq`), 'plan_id');
  const ev = group(await rows(db, `SELECT * FROM plan_stage_event ORDER BY plan_id, id`), 'plan_id');
  const pl = group(await rows(db, `SELECT * FROM plan_line ORDER BY plan_id`), 'plan_id');
  const ps = group(await rows(db, `SELECT * FROM plan_station ORDER BY plan_id`), 'plan_id');
  const pr = group(await rows(db, `SELECT * FROM plan_region ORDER BY plan_id`), 'plan_id');
  const rel = group(await rows(db, `SELECT * FROM plan_relation ORDER BY plan_id, id`), 'plan_id');
  return plans.map((p) => {
    const id = String(p.id);
    return {
      id,
      name: { ko: p.name_ko, en: p.name_en, full: p.name_full },
      aliases: sorted(c.aliases(id)),
      plan_refs: (refs.get(id) ?? []).map((r) => ({
        program: legacyProgramId(String(r.program_id)),
        class: r.class,
        category: r.category,
        timing: r.timing,
        section: r.section,
        content: r.content,
        length_km: num(r.length_km),
        cost_100m_krw: num(r.cost_100m_krw),
        task_group: r.task_group,
        source: r.source_id,
        edition: r.edition,
      })),
      stage: p.calc_stage,
      stage_history: sorted(
        (ev.get(id) ?? []).map((e) => ({
          stage: e.stage,
          date: fz(e.date_value, e.date_precision),
          note: e.note,
          source: e.source_id,
        })),
      ),
      target_open: fz(p.t_value, p.t_precision),
      line_ids: sorted((pl.get(id) ?? []).map((x) => x.line_id)),
      station_ids: sorted((ps.get(id) ?? []).map((x) => x.station_id)),
      related_plans: sorted(
        (rel.get(id) ?? []).map((r) => ({
          plan_id: r.target_plan_id,
          relation: r.relation,
          note: r.note,
          source: r.source_id,
        })),
      ),
      areas: p.areas,
      regions: sorted((pr.get(id) ?? []).map((r) => REGION_NAME.get(String(r.region_code)) ?? r.region_code)),
      operator_name: p.operator_text,
      opened_at: fz(p.opened_value, p.opened_precision),
      description: p.description,
      review_status: p.review_status === 'verified' ? 'verified' : 'auto',
      provenance: { sources: sorted(c.sources(id)), checked_at: fmtDate(p.checked_at), note: p.provenance_note },
    };
  });
}

// ---------------------------------------------------------------------------- 대조

export interface VerifyResult {
  date: string;
  counts: { entity: string; legacy: number | null; migrated: number; note: string }[];
  diffs: EntityDiff[];
  events: { stored: number; derived: number; legacyIdsMissing: string[]; fieldDiffs: EntityDiff };
  timetables: { sets: number; entries: number; summaryDiffs: EntityDiff };
  hardViolations: Violation[];
  stageMismatch: { id: string; legacy: string; computed: string | null }[];
  roleStats: Record<string, number>;
  migrationIssues: Record<string, string[]>;
  migrationStats: Record<string, number>;
  unexplained: number;
  ok: boolean;
  summaryLine: string;
}

const STATION_FIELDS = [
  'name',
  'aliases',
  'status',
  'kind',
  'region',
  'address',
  'lat',
  'lng',
  'coord_source',
  'coord_basis',
  'opened_at',
  'closed_at',
  'line_ids',
  'transfer_group',
  'codes',
  'grade',
  'merge_into',
  'related_line_names',
  'history',
  'intro',
  'provenance',
  'line_classes',
  'service_kinds',
  'review_status',
  'areas',
];

const LINE_FIELDS = [
  'name',
  'aliases',
  'category',
  'rail_class',
  'review_status',
  'areas',
  'is_wide_area',
  'passenger_service',
  'line_role',
  'status',
  'region',
  'owner',
  'operator_name',
  'length_km',
  'opened_at',
  'closed_at',
  'description',
  'codes',
  'provenance',
  'start_station_id',
  'end_station_id',
  'color',
  'track',
  'gauge_mm',
];

const PLAN_FIELDS = [
  'name',
  'aliases',
  'plan_refs',
  'stage',
  'stage_history',
  'target_open',
  'line_ids',
  'station_ids',
  'related_plans',
  'areas',
  'regions',
  'operator_name',
  'opened_at',
  'description',
  'review_status',
  'provenance',
];

function normLegacyStation(s: Obj): Obj {
  const prov = s.provenance as Obj;
  const codes = s.codes as Obj | undefined;
  return {
    ...s,
    aliases: sorted(s.aliases as unknown[]),
    line_ids: sorted(s.line_ids as unknown[]),
    codes: codes
      ? Object.fromEntries(Object.entries(codes).map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v]))
      : undefined,
    provenance: { ...prov, sources: sorted(prov.sources as unknown[]) },
  };
}

export async function runVerify(db: Queryable, legacy: LegacyData, tr: TransformResult): Promise<VerifyResult> {
  const date = new Date().toISOString().slice(0, 10);
  const { build, own } = legacy;
  const multiLine = new Set(
    [...group(build.lineStations as unknown as Obj[], 'station_id').entries()]
      .filter(([, v]) => v.length > 1)
      .map(([k]) => k),
  );

  // 정차 패턴에서 뺀 정차역(이관 리포트) — 역 정차 계통 차이의 원인
  const droppedStops = new Set<string>();
  for (const [k, list] of tr.report.issues)
    if (k.startsWith('정차 패턴 정차역'))
      for (const x of list) {
        const m = /: (stn-[a-z0-9-]+)/.exec(x);
        if (m) droppedStops.add(m[1]!);
      }

  // ---- 개체 수
  const cnt = async (sql: string) => Number((await rows<{ n: string }>(db, sql))[0]!.n);
  const live = (t: string) => cnt(`SELECT count(*) AS n FROM "${t}" WHERE deleted_at IS NULL`);
  const derivedEvents = await cnt(
    `SELECT count(*) AS n FROM v_event_derived d WHERE NOT EXISTS (SELECT 1 FROM event e WHERE e.id = d.id)`,
  );
  const storedEvents = await live('event');
  const ttSets = await cnt(`SELECT count(*) AS n FROM timetable_set`);
  const ttEntries = await cnt(`SELECT count(*) AS n FROM timetable_entry`);
  const counts: VerifyResult['counts'] = [
    { entity: 'source', legacy: own.sources.items.length, migrated: await live('source'), note: '' },
    {
      entity: 'operator',
      legacy: null,
      migrated: await live('operator'),
      note: '기존에 없던 개체(노선 operator_name·번호대 enum 에서 생성)',
    },
    { entity: 'station', legacy: build.stations.length, migrated: await live('station'), note: '' },
    {
      entity: 'line_station',
      legacy: build.lineStations.length,
      migrated: await live('line_station'),
      note: 'D-1 id 변경',
    },
    { entity: 'line', legacy: build.lines.length, migrated: await live('line'), note: '' },
    { entity: 'train_class', legacy: own.trainClasses.items.length, migrated: await live('train_class'), note: '' },
    { entity: 'service', legacy: own.services.items.length, migrated: await live('service'), note: '' },
    {
      entity: 'plan_program',
      legacy: own.planPrograms.items.length,
      migrated: await live('plan_program'),
      note: 'D-5 id 변경',
    },
    { entity: 'plan', legacy: build.plans.length, migrated: await live('plan'), note: '' },
    {
      entity: 'event',
      legacy: build.events.length,
      migrated: storedEvents + derivedEvents,
      note: `테이블 ${storedEvents} + 파생 뷰 ${derivedEvents} (D-3)`,
    },
    {
      entity: 'transfer_center',
      legacy: own.transferCenters.items.length,
      migrated: await live('transfer_center'),
      note: 'D-5 id 변경',
    },
    { entity: 'route_map', legacy: own.routeMaps.items.length, migrated: await live('route_map'), note: '' },
    {
      entity: 'train_number_range',
      legacy: own.trainNumberRanges.items.length,
      migrated: await live('train_number_range'),
      note: '',
    },
    {
      entity: 'rolling_stock_range',
      legacy: own.rollingStock.items.length,
      migrated: await live('rolling_stock_range'),
      note: '',
    },
    {
      entity: 'glossary_term',
      legacy: tr.counts.glossary_term ?? 0,
      migrated: await live('glossary_term'),
      note: 'TERMINOLOGY.md 파싱 항목 수',
    },
    { entity: 'timetable_set', legacy: build.timetableSummaries.length, migrated: ttSets, note: '' },
    {
      entity: 'timetable_entry',
      legacy: build.timetableSummaries.reduce((a, s) => a + s.count, 0),
      migrated: ttEntries,
      note: '기존 = 요약 count 합(운행정보 보강 세트 포함)',
    },
  ];

  // ---- Hard 위반(전체 개체)
  const ids = (await rows<{ id: string }>(db, `SELECT id FROM entity WHERE deleted_at IS NULL`)).map((r) => r.id);
  const hardViolations = await runHardRules(db, ids);

  // ---- 역·노선별 역
  const rev = await reverseStations(db);
  const stationDiff = diffEntity(
    'station',
    build.stations.map((s) => normLegacyStation(s as unknown as Obj)),
    rev.stations,
    (o) => String(o.id),
    STATION_FIELDS,
    (f, l) => {
      if (f === 'review_status') return 'D-2';
      if (f === 'service_kinds' && droppedStops.has(String(l.id)))
        return '정차역 노선별 역 미해석으로 제외(이관 리포트)';
      if ((f === 'opened_at' || f === 'closed_at') && multiLine.has(String(l.id))) return 'D-6';
      return null;
    },
  );
  const lsLegacy = build.lineStations.map((x) => ({
    ...(x as unknown as Obj),
    provenance: { sources: sorted(x.provenance.sources) },
  }));
  const lsDiff = diffEntity(
    'line_station',
    lsLegacy,
    rev.lineStations,
    (o) => `${String(o.line_id)}|${String(o.station_id)}`,
    ['id', 'order', 'station_code', 'km', 'branch', 'order_confirmed', 'provenance'],
    (f) => (f === 'id' ? 'D-1' : null),
  );

  // ---- 노선
  const lineDiff = diffEntity(
    'line',
    build.lines.map((l) => ({
      ...(l as unknown as Obj),
      aliases: sorted(l.aliases),
      region: sorted(l.region),
      provenance: { ...l.provenance, sources: sorted(l.provenance.sources) },
    })),
    await reverseLines(db),
    (o) => String(o.id),
    LINE_FIELDS,
    () => null,
  );

  // ---- 계획
  const plansRev = await reversePlans(db);
  const planDiff = diffEntity(
    'plan',
    build.plans.map((p) => ({
      ...(p as unknown as Obj),
      aliases: sorted(p.aliases),
      line_ids: sorted(p.line_ids),
      station_ids: sorted(p.station_ids),
      regions: sorted(p.regions),
      stage_history: sorted(p.stage_history),
      related_plans: sorted(p.related_plans),
      provenance: { ...p.provenance, sources: sorted(p.provenance.sources) },
    })),
    plansRev,
    (o) => String(o.id),
    PLAN_FIELDS,
    (f) => (f === 'target_open' ? 'D-7' : f === 'stage' ? '계산 단계 ≠ 기존 stage(검수 목록)' : null),
  );
  const revById = new Map(plansRev.map((p) => [String(p.id), p]));
  const stageMismatch = build.plans
    .filter((p) => revById.get(p.id) && revById.get(p.id)!.stage !== p.stage)
    .map((p) => ({ id: p.id, legacy: p.stage, computed: (revById.get(p.id)!.stage as string | null) ?? null }));
  const roleStats: Record<string, number> = {};
  for (const r of await rows<{ k: string; n: string }>(
    db,
    `SELECT 'plan_line.' || role AS k, count(*) AS n FROM plan_line GROUP BY role
     UNION ALL SELECT 'plan_station.' || role, count(*) FROM plan_station GROUP BY role`,
  ))
    roleStats[r.k] = Number(r.n);

  // ---- 연표: 저장분 필드 + 파생 뷰 id
  const evRows = await rows(
    db,
    `SELECT e.id, e.type, e.date_value, e.date_precision, e.title, e.note FROM event e WHERE e.deleted_at IS NULL`,
  );
  const evTargets = group(await rows(db, `SELECT event_id, entity_id FROM event_target`), 'event_id');
  const evAreas = group(await rows(db, `SELECT event_id, area_code FROM event_area`), 'event_id');
  const evSrc = await commonLinks(db);
  const allIds = new Set((await rows<{ id: string }>(db, `SELECT id FROM v_event_all`)).map((r) => r.id));
  const storedIds = new Set(evRows.map((r) => String(r.id)));
  const pick = (ids: string[], prefix: RegExp) => sorted(ids.filter((i) => prefix.test(i)));
  const evMigrated = evRows.map((e) => {
    const t = (evTargets.get(String(e.id)) ?? []).map((x) => String(x.entity_id));
    return {
      id: e.id,
      type: e.type,
      date: fz(e.date_value, e.date_precision),
      title: e.title,
      note: e.note,
      line_ids: pick(t, /^line-/),
      station_ids: pick(t, /^stn-/),
      service_ids: pick(t, /^svc-/),
      plan_ids: pick(t, /^plan-/),
      areas: sorted((evAreas.get(String(e.id)) ?? []).map((x) => x.area_code)),
      provenance: { sources: sorted(evSrc.sources(String(e.id))) },
    };
  });
  const evLegacy = build.events
    .filter((e) => storedIds.has(e.id))
    .map((e) => ({
      ...(e as unknown as Obj),
      line_ids: sorted(e.line_ids),
      station_ids: sorted(e.station_ids),
      service_ids: sorted(e.service_ids),
      plan_ids: sorted(e.plan_ids),
      areas: sorted(e.areas),
      provenance: { sources: sorted(e.provenance.sources) },
    }));
  const evDiff = diffEntity(
    'event(저장분)',
    evLegacy,
    evMigrated,
    (o) => String(o.id),
    ['type', 'date', 'title', 'note', 'line_ids', 'station_ids', 'service_ids', 'plan_ids', 'areas', 'provenance'],
    (f, l) =>
      f === 'date' && /-00$/.test(String((l.date as Obj | undefined)?.value ?? '')) ? '"일 00" 정밀도 보정' : null,
  );
  const legacyIdsMissing = build.events.filter((e) => !allIds.has(e.id)).map((e) => e.id);

  // ---- 시간표 요약
  const ttRev = await rows(
    db,
    `SELECT set_id AS id, station_id, service_id, route_code, day_type, direction, direction_label, data_as_of,
            first_minute, last_minute, count, by_hour FROM v_timetable_summary`,
  );
  const hhmm = (m: unknown) =>
    m == null
      ? undefined
      : `${String(Math.floor(Number(m) / 60)).padStart(2, '0')}:${String(Number(m) % 60).padStart(2, '0')}`;
  const ttDiff = diffEntity(
    'timetable_summary',
    build.timetableSummaries.map((s) => ({ ...(s as unknown as Obj) })),
    ttRev.map((r) => ({
      ...r,
      first: hhmm(r.first_minute),
      last: hhmm(r.last_minute),
      count: Number(r.count),
    })),
    (o) => String(o.id),
    [
      'station_id',
      'service_id',
      'route_code',
      'day_type',
      'direction',
      'direction_label',
      'data_as_of',
      'first',
      'last',
      'count',
      'by_hour',
    ],
    (f, l) => {
      if (!String(l.route_code).startsWith('MTR') && ['first', 'last', 'count', 'by_hour'].includes(f))
        return '운행정보 보강 세트 시각 행 미재구성';
      if (['count', 'by_hour', 'first', 'last'].includes(f)) return '같은 분 다른 종착 행 제외(PK)';
      return null;
    },
  );

  const diffs = [stationDiff, lsDiff, lineDiff, planDiff];
  const all = [...diffs, evDiff, ttDiff];
  const unexplained =
    all.reduce(
      (a, d) =>
        a +
        d.missing.length +
        d.extra.length +
        Object.values(d.fields)
          .filter((f) => !f.intended)
          .reduce((x, f) => x + f.count, 0),
      0,
    ) + legacyIdsMissing.length;
  const rep = tr.report.toJSON();
  const ok = hardViolations.length === 0;
  return {
    date,
    counts,
    diffs,
    events: { stored: storedEvents, derived: derivedEvents, legacyIdsMissing, fieldDiffs: evDiff },
    timetables: { sets: ttSets, entries: ttEntries, summaryDiffs: ttDiff },
    hardViolations,
    stageMismatch,
    roleStats,
    migrationIssues: rep.issues,
    migrationStats: rep.stats,
    unexplained,
    ok,
    summaryLine: `Hard 위반 ${hardViolations.length}, 미설명 차이 ${unexplained}, 단계 불일치 ${stageMismatch.length}`,
  };
}
