/**
 * 계획 시간표 변환(WP 3.6 → WP 8.2 에서 수집기로 일원화).
 * - TAGO 세트: 기존 raw(data/public/raw/src-tago-subway/timetable/*.json.gz)를 수집기 tago-timetable 의 buildTagoSets 로 묶는다
 *   (기존 build-timetables.ts 와 같은 규칙. 같은 구현을 수집기가 재수집 때 쓴다). 기존 요약(data/build/timetable-summaries.json)과
 *   편수·방면 라벨을 대조해 리포트에 남긴다.
 * - 레일포털 운행정보 보강 세트(1,323)는 적재 단계에서 수집기 kric-train-ops 를 DB 에 대해 실행해 만든다(load.ts, Q104 A).
 * 시간표는 개체가 아니라 기계적 데이터라 도메인 적용기를 거치지 않는다(Q98 A).
 */
import type { LineStationCreate, TimetableSet } from '@k-raildex/contracts';
import { buildTagoSets, lineStationResolver, tagoMinute, type TagoRawFile, type TagoRouteConfig } from '../importers';
import type { LStation, LTimetableSummary } from '../read/types';
import type { MigrationReport } from './common';

export { tagoMinute };

export function tagoStationMap(stations: LStation[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of stations) {
    const c = s.codes?.tago_subway;
    if (!c) continue;
    for (const t of Array.isArray(c) ? c : [c]) m.set(t, s.id);
  }
  return m;
}

export interface TimetableContext {
  stationIds: Set<string>;
  serviceLines: Map<string, string[]>;
  lsByStation: Map<string, LineStationCreate[]>;
}

/** TAGO raw → 세트(수집기 구현) + 기존 요약과 대조 */
export function transformTagoTimetables(
  files: Iterable<TagoRawFile>,
  routes: TagoRouteConfig[],
  tagoToStation: Map<string, string>,
  summaries: LTimetableSummary[],
  ctx: TimetableContext,
  report: MigrationReport,
): TimetableSet[] {
  const built = buildTagoSets(files, routes, {
    tagoToStation,
    hasStation: (id) => ctx.stationIds.has(id),
    hasService: (id) => ctx.serviceLines.has(id),
    lineStationOf: lineStationResolver([...ctx.lsByStation.values()].flat(), (id) => ctx.serviceLines.get(id)),
  });
  for (const [kind, list] of built.issues.items) for (const d of list) report.add(kind, d);
  report.count('시간표.노선별 역 해석(TAGO)', built.stats.line_station_resolved);

  const legacy = new Map(summaries.filter((s) => s.route_code.startsWith('MTR')).map((s) => [s.id, s]));
  for (const s of built.sets) {
    const l = legacy.get(s.id);
    if (!l) {
      report.add('시간표 TAGO 세트가 기존 요약에 없음', s.id);
      continue;
    }
    legacy.delete(s.id);
    if (l.count !== s.entries.length)
      report.add('시간표 행 수 ≠ 기존 요약 count', `${s.id}: ${s.entries.length} vs ${l.count}`);
    if ((l.direction_label ?? null) !== s.direction_label)
      report.add('시간표 방면 라벨 ≠ 기존 요약', `${s.id}: ${s.direction_label} vs ${l.direction_label}`);
  }
  for (const id of legacy.keys()) report.add('시간표 기존 TAGO 요약을 raw 에서 재구성하지 못함', id);
  return built.sets;
}
