/** 운행 계통 정차 패턴 비교표·운행 시간 요약(순수 함수 — test/patterns.test.ts) */

export interface PatternStop {
  station_id: string;
  name_ko: string;
  line_id: string;
  station_code: string | null;
}
export interface Pattern {
  code: string;
  name_ko: string;
  stops: PatternStop[];
}

export interface MatrixRow {
  station_id: string;
  name_ko: string;
  line_id: string;
  station_code: string | null;
  /** 패턴 code → 정차 여부 */
  stops: Record<string, boolean>;
}

/**
 * 비교표 행 순서: 정차역이 가장 많은 패턴을 뼈대로 삼고, 다른 패턴에만 있는 역은
 * 그 패턴에서 바로 앞에 오는 (이미 놓인) 역 뒤에 끼워 넣는다.
 */
export function stopMatrix(patterns: readonly Pattern[]): MatrixRow[] {
  if (patterns.length === 0) return [];
  const sorted = [...patterns].sort((a, b) => b.stops.length - a.stops.length);
  const rows: MatrixRow[] = [];
  const index = new Map<string, MatrixRow>();
  const blank = () => Object.fromEntries(patterns.map((p) => [p.code, false])) as Record<string, boolean>;
  for (const p of sorted) {
    let prevPos = -1;
    for (const s of p.stops) {
      let row = index.get(s.station_id);
      if (!row) {
        row = {
          station_id: s.station_id,
          name_ko: s.name_ko,
          line_id: s.line_id,
          station_code: s.station_code,
          stops: blank(),
        };
        rows.splice(prevPos + 1, 0, row);
        index.set(s.station_id, row);
      }
      row.stops[p.code] = true;
      prevPos = rows.indexOf(row);
    }
  }
  return rows;
}

export interface TimetableSummaryLike {
  service_id: string | null;
  day_type: string;
  direction: string;
  direction_label: string | null;
  day_note: string | null;
  first_minute: number | null;
  last_minute: number | null;
  count: number;
  data_as_of: string | null;
}

export interface ServiceHours {
  station_id: string;
  station_name: string;
  day_type: string;
  direction: string;
  direction_label: string | null;
  day_note: string | null;
  first_minute: number | null;
  last_minute: number | null;
  count: number;
  /** 평균 배차(분) = 운행 시간 / (편수 - 1). 2편 미만이면 null */
  headway: number | null;
  data_as_of: string | null;
}

/** 한 역의 시간표 요약 중 이 운행 계통 것만 → 운행 시간·배차 행 */
export function serviceHoursAt(
  stationId: string,
  stationName: string,
  serviceId: string,
  summaries: readonly TimetableSummaryLike[],
): ServiceHours[] {
  return summaries
    .filter((t) => t.service_id === serviceId)
    .map((t) => ({
      station_id: stationId,
      station_name: stationName,
      day_type: t.day_type,
      direction: t.direction,
      direction_label: t.direction_label,
      day_note: t.day_note,
      first_minute: t.first_minute,
      last_minute: t.last_minute,
      count: t.count,
      headway:
        t.count >= 2 && t.first_minute != null && t.last_minute != null && t.last_minute > t.first_minute
          ? Math.round((t.last_minute - t.first_minute) / (t.count - 1))
          : null,
      data_as_of: t.data_as_of,
    }));
}

const DAY_ORDER = ['weekday', 'saturday', 'holiday'];
export function compareDayType(a: string, b: string): number {
  return DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b);
}
