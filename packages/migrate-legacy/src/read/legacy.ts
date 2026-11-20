/**
 * 기존 저장소 원본 읽기(WP 3.1). 기존 저장소는 읽기 전용 — 이 모듈은 파일을 읽기만 한다.
 * 경로: LEGACY_ROOT(기본 /home/kimyw/Git/future-rail-db).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type {
  LEvent,
  LLine,
  LLineNameOverride,
  LLineStation,
  LOsmLineMap,
  LPlan,
  LPlanProgram,
  LPlanRoute,
  LRollingStock,
  LRouteMap,
  LService,
  LSource,
  LStation,
  LTagoRaw,
  LTagoRoute,
  LTimetableSummary,
  LTrainClass,
  LTrainNumberRange,
  LTransferCenter,
} from './types';
import { readYamlRecords, type YamlRecords } from './yaml';

export const DEFAULT_LEGACY_ROOT = '/home/kimyw/Git/future-rail-db';

export function legacyRoot(): string {
  return process.env.LEGACY_ROOT ?? DEFAULT_LEGACY_ROOT;
}

export function legacyExists(root = legacyRoot()): boolean {
  return existsSync(join(root, 'data/build/stations.json')) && existsSync(join(root, 'data/own/sources.yaml'));
}

/** YAML 레코드 + id 별 주석 */
export interface Commented<T> {
  items: T[];
  /** 레코드 id(또는 키) → 주석 */
  notes: Map<string, string>;
  header: string | null;
  file: string;
}

function commented<T>(rec: YamlRecords<T>, keyOf: (t: T) => string): Commented<T> {
  const notes = new Map<string, string>();
  rec.items.forEach((it, i) => {
    const c = rec.comments[i];
    if (c) notes.set(keyOf(it), c);
  });
  return { items: rec.items, notes, header: rec.header, file: rec.file };
}

export interface LegacyData {
  root: string;
  build: {
    stations: LStation[];
    lines: LLine[];
    lineStations: LLineStation[];
    plans: LPlan[];
    events: LEvent[];
    timetableSummaries: LTimetableSummary[];
  };
  own: {
    sources: Commented<LSource>;
    services: Commented<LService>;
    trainClasses: Commented<LTrainClass>;
    trainNumberRanges: Commented<LTrainNumberRange>;
    rollingStock: Commented<LRollingStock>;
    transferCenters: Commented<LTransferCenter>;
    planPrograms: Commented<LPlanProgram>;
    routeMaps: Commented<LRouteMap>;
    eventsManual: Commented<LEvent>;
    stationsManual: Commented<{ id: string }>;
    linesManual: Commented<{ id: string }>;
    /** 계획 YAML(파일 여러 개를 합침) — gazette_keywords·national·주석 */
    plans: Commented<LPlan>;
    planRoutes: Commented<LPlanRoute>;
    osmLineMap: Commented<LOsmLineMap>;
    lineNames: Commented<LLineNameOverride>;
    tagoRoutes: LTagoRoute[];
  };
  /** 파일 머리 주석(상대 경로 → 주석) */
  headers: Map<string, string>;
  terminology: string | null;
  tagoStations: { subwayStationId: string; subwayStationName: string; subwayRouteName?: string }[];
  /** TAGO 시간표 raw 파일 이름 목록(지연 읽기) */
  tagoTimetableFiles: string[];
  readTago: (file: string) => LTagoRaw;
}

function json<T>(root: string, rel: string): T {
  return JSON.parse(readFileSync(join(root, rel), 'utf8')) as T;
}

export function loadLegacy(root = legacyRoot()): LegacyData {
  if (!legacyExists(root)) throw new Error(`기존 저장소를 찾을 수 없음: ${root} (LEGACY_ROOT)`);
  const headers = new Map<string, string>();
  const y = <T>(rel: string, keyOf: (t: T) => string): Commented<T> => {
    const r = readYamlRecords<T>(join(root, rel));
    if (r.header) headers.set(rel, r.header);
    return commented(r, keyOf);
  };
  const byId = <T extends { id: string }>(t: T) => t.id;

  // 계획 YAML 여러 파일 합치기
  const planDir = 'data/own/plans';
  const planFiles = readdirSync(join(root, planDir))
    .filter((f) => f.endsWith('.yaml'))
    .sort();
  const plans: Commented<LPlan> = { items: [], notes: new Map(), header: null, file: planDir };
  for (const f of planFiles) {
    const c = y<LPlan>(`${planDir}/${f}`, byId);
    plans.items.push(...c.items);
    for (const [k, v] of c.notes) plans.notes.set(k, v);
  }

  const tagoDir = join(root, 'data/public/raw/src-tago-subway/timetable');
  const tagoTimetableFiles = existsSync(tagoDir)
    ? readdirSync(tagoDir)
        .filter((f) => f.endsWith('.json.gz'))
        .sort()
    : [];
  const tagoStationsPath = join(root, 'data/public/raw/src-tago-subway/stations.json');
  const termPath = join(root, 'docs/TERMINOLOGY.md');

  return {
    root,
    build: {
      stations: json(root, 'data/build/stations.json'),
      lines: json(root, 'data/build/lines.json'),
      lineStations: json(root, 'data/build/line-stations.json'),
      plans: json(root, 'data/build/plans.json'),
      events: json(root, 'data/build/events.json'),
      timetableSummaries: json(root, 'data/build/timetable-summaries.json'),
    },
    own: {
      sources: y<LSource>('data/own/sources.yaml', byId),
      services: y<LService>('data/own/services.yaml', byId),
      trainClasses: y<LTrainClass>('data/own/train-classes.yaml', byId),
      trainNumberRanges: y<LTrainNumberRange>('data/own/train-number-ranges.yaml', byId),
      rollingStock: y<LRollingStock>('data/own/rolling-stock-numbers.yaml', byId),
      transferCenters: y<LTransferCenter>('data/own/transfer-centers.yaml', byId),
      planPrograms: y<LPlanProgram>('data/own/plan-programs.yaml', byId),
      routeMaps: y<LRouteMap>('data/own/route-maps.yaml', byId),
      eventsManual: y<LEvent>('data/own/events-manual.yaml', byId),
      stationsManual: y('data/own/stations-manual.yaml', byId),
      linesManual: y('data/own/lines-manual.yaml', byId),
      plans,
      planRoutes: y('data/own/geometry/plan-routes.yaml', (t: LPlanRoute) => t.plan_id),
      osmLineMap: y('data/own/overrides/osm-line-map.yaml', (t: LOsmLineMap) => t.line_id),
      lineNames: y('data/own/overrides/line-names.yaml', (t: LLineNameOverride) => t.key),
      tagoRoutes: y<LTagoRoute>('data/own/overrides/tago-route-services.yaml', (t) => t.route_id).items,
    },
    headers,
    terminology: existsSync(termPath) ? readFileSync(termPath, 'utf8') : null,
    tagoStations: existsSync(tagoStationsPath)
      ? (JSON.parse(readFileSync(tagoStationsPath, 'utf8')) as { items: LegacyData['tagoStations'] }).items
      : [],
    tagoTimetableFiles,
    readTago: (file) => JSON.parse(gunzipSync(readFileSync(join(tagoDir, file))).toString('utf8')) as LTagoRaw,
  };
}
