/**
 * 계획 시간표 변환(WP 3.6). 세트 = data/build/timetable-summaries.json(4,249).
 * 시각 행 = TAGO raw(data/public/raw/src-tago-subway/timetable/*.json.gz)를 기존 build-timetables.ts 와 같은 규칙으로 다시 묶어 만든다
 * (기존 public/timetable/*.json 산출물은 저장소에 남아 있지 않다). 레일포털 운행정보 보강분(route_code 가 MTR 이 아닌 세트)의
 * 시각 행은 역명 해석 규칙(RAFIS 약어 등)이 커서 이 단계에서는 재구성하지 않고 세트만 이관한다(리포트).
 * 시간표는 개체가 아니라 기계적 데이터라 도메인 적용기를 거치지 않고 한 트랜잭션 SQL 로 쓴다(load.ts).
 */
import type { LineStationCreate, TimetableSet } from '@k-raildex/contracts';
import type { LStation, LTagoRaw, LTagoRoute, LTimetableSummary } from '../read/types';
import type { MigrationReport } from './common';

const DAY: Record<string, string> = { '01': 'weekday', '02': 'saturday', '03': 'holiday' };
const DIR_DEFAULT: Record<string, string> = { U: 'up', D: 'down' };

/** TAGO "HHMMSS" → 분(04시 이전은 24~27시). 기존 normTime 과 같은 규칙 */
export function tagoMinute(raw: string | undefined): number | null {
  if (!raw || raw === '0') return null;
  const s = raw.padStart(6, '0');
  if (!/^\d{6}$/.test(s)) return null;
  let h = Number(s.slice(0, 2));
  const m = Number(s.slice(2, 4));
  if (h < 4) h += 24;
  return h * 60 + m;
}

/** "HH:MM" 또는 "HHMM"(24시 이후 표기) → 분 */
export function hhmmToMinute(t: string): number {
  const d = t.replace(':', '');
  return Number(d.slice(0, 2)) * 60 + Number(d.slice(2, 4));
}

export interface TagoRows {
  /** 세트 id → (분, 종착) 행 */
  rows: Map<string, { minute: number; to: string | null }[]>;
  unmatchedTago: string[];
}

/** TAGO raw 묶음 → 세트 id 별 행(기존 build-timetables.ts 1~131행과 같은 묶음·중복 제거) */
export function groupTagoRaw(
  files: Iterable<LTagoRaw>,
  tagoToStation: Map<string, string>,
  routes: LTagoRoute[],
): TagoRows {
  const sorted = [...routes].sort((a, b) => b.route_id.length - a.route_id.length);
  const routeOf = (id: string) => sorted.find((r) => id.startsWith(r.route_id));
  const rows = new Map<string, { minute: number; to: string | null }[]>();
  const unmatchedTago: string[] = [];
  for (const raw of files) {
    const stationId = tagoToStation.get(raw.subwayStationId);
    if (!stationId) {
      unmatchedTago.push(raw.subwayStationId);
      continue;
    }
    const groups = new Map<
      string,
      { route: string; day: string; dir: string; rows: { minute: number; to: string | null }[] }
    >();
    for (const it of raw.items) {
      const minute = tagoMinute(it.depTime) ?? tagoMinute(it.arrTime);
      if (minute == null) continue;
      const key = `${it.subwayRouteId}|${it.dailyTypeCode}|${it.upDownTypeCode}`;
      const g = groups.get(key) ?? { route: it.subwayRouteId, day: it.dailyTypeCode, dir: it.upDownTypeCode, rows: [] };
      groups.set(key, g);
      g.rows.push({ minute, to: it.endSubwayStationNm?.trim() || null });
    }
    for (const g of groups.values()) {
      const day = DAY[g.day];
      if (!day) continue;
      const dir = routeOf(g.route)?.direction?.[g.dir] ?? DIR_DEFAULT[g.dir] ?? 'unknown';
      const seen = new Set<string>();
      const uniq = g.rows.filter((r) => {
        const k = `${r.minute}|${r.to ?? ''}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const id = `tt-${stationId.replace(/^stn-/, '')}-${g.route.toLowerCase()}-${day}-${dir}`;
      rows.set(id, [...(rows.get(id) ?? []), ...uniq]);
    }
  }
  for (const list of rows.values()) list.sort((a, b) => a.minute - b.minute || (a.to ?? '').localeCompare(b.to ?? ''));
  return { rows, unmatchedTago };
}

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

export function transformTimetables(
  summaries: LTimetableSummary[],
  tago: TagoRows,
  ctx: TimetableContext,
  report: MigrationReport,
): TimetableSet[] {
  const out: TimetableSet[] = [];
  for (const s of summaries) {
    if (!ctx.stationIds.has(s.station_id)) {
      report.add('시간표 역 없음(세트 제외)', s.id);
      continue;
    }
    const serviceId = s.service_id && ctx.serviceLines.has(s.service_id) ? s.service_id : null;
    if (s.service_id && !serviceId) report.add('시간표 운행 계통 없음(service_id 비움)', `${s.id}: ${s.service_id}`);
    // 노선별 역: 운행 계통 노선 ∩ 역의 노선별 역
    let lsId: string | null = null;
    const lsList = ctx.lsByStation.get(s.station_id) ?? [];
    if (serviceId) {
      const lines = new Set(ctx.serviceLines.get(serviceId));
      const cand = lsList.filter((x) => lines.has(x.line_id));
      if (cand.length === 1) lsId = cand[0]!.id;
    }
    if (!lsId) report.add('시간표 노선별 역 미해석', `${s.id} (${s.service_id ?? '운행 계통 없음'})`);
    else report.count('시간표.노선별 역 해석');

    let entries: TimetableSet['entries'] = [];
    if (s.route_code.startsWith('MTR')) {
      const rows = tago.rows.get(s.id);
      if (!rows) report.add('시간표 시각 행 재구성 실패(TAGO raw 없음)', s.id);
      for (const r of rows ?? []) {
        entries.push({ minute: r.minute, dest_name: r.to, dest_station_id: null, train_no: '', note: null });
      }
      if (rows && rows.length !== s.count)
        report.add('시간표 행 수 ≠ 기존 요약 count', `${s.id}: ${rows.length} vs ${s.count}`);
    } else {
      entries = [];
      report.count('시간표.운행정보 보강 세트(시각 행 미재구성)');
    }
    out.push({
      id: s.id,
      station_id: s.station_id,
      line_station_id: lsId,
      service_id: serviceId,
      route_code: s.route_code,
      day_type: s.day_type as TimetableSet['day_type'],
      direction: s.direction as TimetableSet['direction'],
      direction_label: s.direction_label ?? null,
      day_note: null,
      data_as_of: s.data_as_of ?? null,
      source_id: s.provenance.sources[0]!,
      import_run_id: null,
      entries,
    });
  }
  return out;
}
