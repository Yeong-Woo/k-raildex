/**
 * 전체 변환: 기존 데이터 → 계약 Create 형태의 op 묶음(적재 순서 = docs/07-migration.md 2절).
 */
import type { EntityType, LineStationCreate, OperatorCreate, TimetableSet } from '@k-raildex/contracts';
import type { Op } from '@k-raildex/domain';
import type { LegacyData } from '../read/legacy';
import { parseTerminology } from '../read/terminology';
import type { LPlanRoute } from '../read/types';
import { fuzzyRepairs, MigrationReport, programId, transferCenterId } from './common';
import {
  isStoredEvent,
  transformEvent,
  transformGlossary,
  transformRollingStock,
  transformRouteMap,
  transformTrainNumberRange,
  transformTransferCenter,
} from './misc';
import { transformNetwork } from './network';
import { OPERATORS } from './operator-map';
import { planRelations, transformPlan, transformPlanProgram } from './plan';
import { transformService, transformTrainClass } from './service';
import { transformSource } from './source';
import { tagoStationMap, transformTagoTimetables } from './timetable';
import type { TagoRouteConfig } from '../importers';

export interface Stage {
  key: string;
  title: string;
  ops: Op[];
}

export interface IdRedirect {
  old_id: string;
  new_id: string;
  reason: string;
}

export interface TransformResult {
  stages: Stage[];
  timetables: TimetableSet[];
  redirects: IdRedirect[];
  report: MigrationReport;
  /** 개체 종류별 생성 수 */
  counts: Record<string, number>;
}

const create = (entity_type: EntityType, data: unknown): Op => ({ op: 'create', entity_type, data });

/** 자기 참조(부모·후속·병합 대상)가 먼저 오도록 정렬 */
export function topoSort<T>(items: T[], idOf: (t: T) => string, depOf: (t: T) => string | null | undefined): T[] {
  const byId = new Map(items.map((t) => [idOf(t), t]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const out: T[] = [];
  const visit = (t: T) => {
    const id = idOf(t);
    if (done.has(id)) return;
    if (visiting.has(id)) throw new Error(`자기 참조 순환: ${id}`);
    visiting.add(id);
    const dep = depOf(t);
    if (dep && byId.has(dep)) visit(byId.get(dep)!);
    visiting.delete(id);
    done.add(id);
    out.push(t);
  };
  items.forEach(visit);
  return out;
}

export function transformAll(legacy: LegacyData, opts: { timetables?: boolean } = {}): TransformResult {
  const report = new MigrationReport();
  fuzzyRepairs.length = 0;
  const { build, own } = legacy;
  const stages: Stage[] = [];
  const counts: Record<string, number> = {};
  const push = (key: string, title: string, ops: Op[]) => {
    stages.push({ key, title, ops });
    for (const o of ops) if (o.op === 'create') counts[o.entity_type] = (counts[o.entity_type] ?? 0) + 1;
  };

  // 2. 출처
  const sources = own.sources.items.map((s) => transformSource(s, report, own.sources.notes.get(s.id) ?? null));
  push(
    'source',
    '출처',
    sources.map((s) => create('source', s)),
  );
  const sourceById = new Map(own.sources.items.map((s) => [s.id, s]));

  // 5~7. 역·노선·노선역 (운영기관은 노선에서 모으므로 먼저 계산)
  const net = transformNetwork(
    {
      stations: build.stations,
      lines: build.lines,
      lineStations: build.lineStations,
      services: own.services.items,
      tagoRoutes: own.tagoRoutes,
      linesManual: own.linesManual,
      stationsManual: own.stationsManual,
      lineNames: own.lineNames,
      osmLineMap: own.osmLineMap,
    },
    report,
  );

  // 12. 번호대(운영기관 근거 수집을 위해 먼저 변환)
  const tnrs = own.trainNumberRanges.items
    .map((r) => transformTrainNumberRange(r, report, own.trainNumberRanges.notes.get(r.id) ?? null))
    .filter((x) => x !== null);
  const rsrs = own.rollingStock.items
    .map((r) => transformRollingStock(r, report, own.rollingStock.notes.get(r.id) ?? null))
    .filter((x) => x !== null);

  // 4. 운영기관: 노선·번호대에서 쓰인 것만. 출처 = 그 노선·번호대의 레코드 출처
  const use = net.operatorUse;
  for (const r of [...tnrs, ...rsrs]) {
    const u = use.get(r.operator_id) ?? { sources: new Set<string>(), checked_at: '0000-00-00', lines: [] };
    for (const s of r.sources) u.sources.add(s.source_id);
    if (r.checked_at > u.checked_at) u.checked_at = r.checked_at;
    u.lines.push(r.id);
    use.set(r.operator_id, u);
  }
  const operators: OperatorCreate[] = [];
  for (const def of OPERATORS) {
    const u = use.get(def.id);
    if (!u) {
      report.add('운영기관 대응표에 있으나 쓰이지 않음(생성 안 함)', def.id);
      continue;
    }
    operators.push({
      id: def.id,
      name_ko: def.name_ko,
      name_en: null,
      name_full: null,
      short_ko: null,
      kind: def.kind,
      status: def.ended?.status ?? 'active',
      merged_into_id: def.ended?.merged_into_id ?? null,
      founded: null,
      ended: def.ended ? { value: def.ended.date, precision: 'day' } : null,
      homepage: null,
      checked_at: u.checked_at,
      provenance_note: `이관: 기존 노선 operator_name·번호대 operator 에서 생성(${u.lines.length}건: ${u.lines.slice(0, 5).join(', ')}${u.lines.length > 5 ? ' …' : ''})`,
      review_status: 'unverified',
      editor_note: def.ended?.note ?? null,
      extra: def.legacyEnum ? { legacy_enum: def.legacyEnum } : {},
      sources: [
        ...[...u.sources].sort().map((source_id) => ({ source_id, field: null, locator: null, note: null })),
        // 상태 필드 출처(status·merged_into_id·ended)
        ...(def.ended?.sources ?? []).flatMap((source_id) =>
          (['status', 'merged_into_id', 'ended'] as const).map((field) => ({
            source_id,
            field,
            locator: source_id === 'src-kric-chronology' ? '철도통합연표 4707' : null,
            note: null,
          })),
        ),
      ],
      names: [],
      external_refs: [],
    });
  }
  push(
    'operator',
    '운영기관',
    operators.map((o) => create('operator', o)),
  );

  const stations = topoSort(
    net.stations,
    (s) => s.id,
    (s) => s.merge_into_id,
  );
  push(
    'station',
    '역',
    stations.map((s) => create('station', s)),
  );
  push('network', '노선·노선역', [
    ...net.lines.map((l) => create('line', l)),
    ...net.lineStations.map((x) => create('line_station', x)),
  ]);

  const lsByStation = new Map<string, LineStationCreate[]>();
  for (const x of net.lineStations) lsByStation.set(x.station_id, [...(lsByStation.get(x.station_id) ?? []), x]);

  // 8. 열차 등급 → 운행 계통
  const tcs = topoSort(
    own.trainClasses.items,
    (t) => t.id,
    (t) => t.successor_id,
  ).map((t) => transformTrainClass(t, report, own.trainClasses.notes.get(t.id) ?? null));
  const services = own.services.items.map((s) =>
    transformService(s, lsByStation, report, own.services.notes.get(s.id) ?? null),
  );
  push('service', '열차 등급·운행 계통', [
    ...tcs.map((t) => create('train_class', t)),
    ...services.map((s) => create('service', s)),
  ]);

  // 9. 상위 계획
  const programs = topoSort(
    own.planPrograms.items.map((p, i) => ({ p, i })),
    (x) => x.p.id,
    (x) => x.p.parent,
  ).map((x) => transformPlanProgram(x.p, x.i + 1, report, own.planPrograms.notes.get(x.p.id) ?? null));
  push(
    'plan_program',
    '상위 계획',
    programs.map((p) => create('plan_program', p)),
  );

  // 10. 계획 사업 (+ 관계는 update)
  const yamlPlans = new Map(own.plans.items.map((p) => [p.id, p]));
  const routesByPlan = new Map<string, LPlanRoute[]>();
  for (const r of own.planRoutes.items) {
    if (!build.plans.some((p) => p.id === r.plan_id)) report.add('plan-routes.yaml 의 계획 없음', r.plan_id);
    routesByPlan.set(r.plan_id, [...(routesByPlan.get(r.plan_id) ?? []), r]);
  }
  const ctx = {
    sources: sourceById,
    lines: new Map(build.lines.map((l) => [l.id, l])),
    stations: new Map(build.stations.map((s) => [s.id, s])),
    parentOf: new Map<string, string>(),
    stationsWithGeom: new Set(net.stations.filter((s) => s.geom).map((s) => s.id)),
  };
  if (ctx.parentOf.size === 0) report.count('노선 parent_line_id(기존 데이터에 없음 → 연장 extends 판정 0)', 0);
  const plans = build.plans.map((p) =>
    transformPlan(p, yamlPlans.get(p.id), routesByPlan.get(p.id) ?? [], ctx, report, own.plans.notes.get(p.id) ?? null),
  );
  const planIds = new Set(build.plans.map((p) => p.id));
  const relationOps: Op[] = [];
  for (const p of build.plans) {
    const rel = planRelations(p, planIds, report);
    if (rel.length) relationOps.push({ op: 'update', entity_type: 'plan', id: p.id, data: { relations: rel } });
  }
  push('plan', '계획 사업', [...plans.map((p) => create('plan', p)), ...relationOps]);

  // 11. 환승센터·노선도
  const xcs = own.transferCenters.items.map((t) =>
    transformTransferCenter(t, report, own.transferCenters.notes.get(t.id) ?? null),
  );
  const maps = own.routeMaps.items.map((m) => transformRouteMap(m, report, own.routeMaps.notes.get(m.id) ?? null));
  push('transfer_center', '환승센터·노선도', [
    ...xcs.map((x) => create('transfer_center', x)),
    ...maps.map((m) => create('route_map', m)),
  ]);

  // 12. 번호대
  push('number_range', '열차번호대·차량번호대', [
    ...tnrs.map((t) => create('train_number_range', t)),
    ...rsrs.map((r) => create('rolling_stock_range', r)),
  ]);

  // 13. 연표: 수기 + 철도통합연표 기원만
  const manualIds = new Set(own.eventsManual.items.map((e) => e.id));
  const existing = new Set<string>([
    ...build.lines.map((l) => l.id),
    ...build.stations.map((s) => s.id),
    ...own.services.items.map((s) => s.id),
    ...build.plans.map((p) => p.id),
  ]);
  const stored = build.events.filter((e) => isStoredEvent(e, manualIds));
  for (const id of manualIds) if (!build.events.some((e) => e.id === id)) report.add('수기 이벤트가 빌드에 없음', id);
  const events = stored.map((e) =>
    transformEvent(e, manualIds.has(e.id), existing, report, own.eventsManual.notes.get(e.id) ?? null),
  );
  report.count('이벤트.파생(저장 안 함, D-3)', build.events.length - stored.length);
  push(
    'event',
    '연표 이벤트',
    events.map((e) => create('event', e)),
  );

  // 15. 용어
  if (legacy.terminology) {
    const g = parseTerminology(legacy.terminology);
    const terms = transformGlossary(g.terms, g.updatedAt ?? '2026-10-11', report);
    push(
      'glossary_term',
      '용어',
      terms.map((t) => create('glossary_term', t)),
    );
  } else report.add('용어 사전 없음', 'docs/TERMINOLOGY.md');

  // 14. 시간표 — TAGO 세트는 수집기 구현(buildTagoSets)으로. 운행정보 보강 세트는 적재 단계에서 수집기 kric-train-ops 로(load.ts)
  let timetables: TimetableSet[] = [];
  if (opts.timetables !== false) {
    timetables = transformTagoTimetables(
      (function* () {
        for (const f of legacy.tagoTimetableFiles) yield legacy.readTago(f);
      })(),
      own.tagoRoutes as unknown as TagoRouteConfig[],
      tagoStationMap(build.stations),
      build.timetableSummaries,
      {
        stationIds: new Set(build.stations.map((s) => s.id)),
        serviceLines: new Map(own.services.items.map((s) => [s.id, s.line_ids])),
        lsByStation,
      },
      report,
    );
  }

  // 17. id 리다이렉트(상위 계획 pp-, 환승센터 xc-)
  const redirects: IdRedirect[] = [
    ...own.planPrograms.items.map((p) => ({
      old_id: p.id,
      new_id: programId(p.id),
      reason: '상위 계획 id 접두사(Q69 A)',
    })),
    ...own.transferCenters.items.map((t) => ({
      old_id: t.id,
      new_id: transferCenterId(t.id),
      reason: '환승센터 id 접두사(Q69 A)',
    })),
  ];

  for (const r of fuzzyRepairs) report.add('퍼지 날짜 "일·월 00" 정밀도 보정', r);
  return { stages, timetables, redirects, report, counts };
}
