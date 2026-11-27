/**
 * 시간표 수집기가 쓰는 망 정보(역 이름·별칭·상태, 노선역, 운행 계통의 노선·정차 패턴·권역, 외부 코드).
 * DB 에서 읽거나(loadNetworkContext) 이관 도구처럼 다른 원천에서 같은 모양으로 만든다.
 */
import type { Queryable } from '@k-raildex/domain';

export interface NetStation {
  id: string;
  name_ko: string;
  aliases: string[];
  /** 파생 상태(v_station_status). planned·under_construction 은 역명 해석 후보에서 뺀다 */
  status: string | null;
}

export interface NetLineStation {
  id: string;
  line_id: string;
  station_id: string;
  seq: number;
  station_code: string | null;
  /** 노선 역할(기지선·연결선·삼각선이면 값) — 시간표 노선역 해석에서 후보가 여럿이면 뺀다 */
  line_role?: string | null;
}

export interface NetService {
  id: string;
  line_ids: string[];
  /** 정차 패턴별 역 id 순서 */
  stop_patterns: string[][];
  areas: string[];
}

export interface NetworkContext {
  stations: Map<string, NetStation>;
  /** 노선 순서(seq)대로 */
  lineStations: NetLineStation[];
  services: Map<string, NetService>;
  /** TAGO 지하철역 ID → 역 id */
  tagoToStation: Map<string, string>;
  /** RAFIS 역명(external_ref rafis code) → 역 id 목록 */
  rafisRefs: Map<string, string[]>;
}

export const UNOPENED = new Set(['planned', 'under_construction']);

export async function loadNetworkContext(db: Queryable): Promise<NetworkContext> {
  const st = await db.query<{ id: string; name_ko: string; aliases: string[] | null; status: string | null }>(
    `SELECT s.id, s.name_ko, ss.status,
            (SELECT array_agg(n.name ORDER BY n.ord, n.id) FROM entity_name n
              WHERE n.entity_id = s.id AND n.kind = 'alias' AND n.lang = 'ko') AS aliases
       FROM station s LEFT JOIN v_station_status ss ON ss.station_id = s.id
      WHERE s.deleted_at IS NULL`,
  );
  const stations = new Map<string, NetStation>(
    st.rows.map((r) => [r.id, { id: r.id, name_ko: r.name_ko, aliases: r.aliases ?? [], status: r.status }]),
  );
  const ls = await db.query<NetLineStation>(
    `SELECT ls.id, ls.line_id, ls.station_id, ls.seq, ls.station_code, l.line_role
       FROM line_station ls JOIN line l ON l.id = ls.line_id
      WHERE ls.deleted_at IS NULL AND l.deleted_at IS NULL
      ORDER BY ls.line_id, ls.seq`,
  );
  const sv = await db.query<{ id: string; line_ids: string[] | null; areas: string[] | null }>(
    `SELECT s.id,
            (SELECT array_agg(sl.line_id ORDER BY sl.seq) FROM service_line sl WHERE sl.service_id = s.id) AS line_ids,
            a.areas
       FROM service s LEFT JOIN v_service_area a ON a.service_id = s.id
      WHERE s.deleted_at IS NULL`,
  );
  const sp = await db.query<{ service_id: string; pattern_id: string; station_id: string }>(
    `SELECT p.service_id, p.id AS pattern_id, ls.station_id
       FROM stop_pattern p JOIN stop_pattern_stop x ON x.pattern_id = p.id JOIN line_station ls ON ls.id = x.line_station_id
      ORDER BY p.service_id, p.seq, p.id, x.seq`,
  );
  const patterns = new Map<string, Map<string, string[]>>();
  for (const r of sp.rows) {
    const m = patterns.get(r.service_id) ?? new Map<string, string[]>();
    patterns.set(r.service_id, m);
    const list = m.get(r.pattern_id) ?? [];
    m.set(r.pattern_id, list);
    list.push(r.station_id);
  }
  const services = new Map<string, NetService>(
    sv.rows.map((r) => [
      r.id,
      {
        id: r.id,
        line_ids: r.line_ids ?? [],
        areas: r.areas ?? [],
        stop_patterns: [...(patterns.get(r.id)?.values() ?? [])],
      },
    ]),
  );
  const refs = await db.query<{ system: string; code: string; station_id: string }>(
    `SELECT e.system, e.code, coalesce(ls.station_id, e.entity_id) AS station_id
       FROM external_ref e LEFT JOIN line_station ls ON ls.id = e.entity_id
      WHERE e.system IN ('tago_subway', 'rafis')
      ORDER BY e.system, e.code, e.id`,
  );
  const tagoToStation = new Map<string, string>();
  const rafisRefs = new Map<string, string[]>();
  for (const r of refs.rows) {
    if (!stations.has(r.station_id)) continue;
    if (r.system === 'tago_subway') {
      if (!tagoToStation.has(r.code)) tagoToStation.set(r.code, r.station_id);
    } else {
      const l = rafisRefs.get(r.code) ?? [];
      rafisRefs.set(r.code, l);
      if (!l.includes(r.station_id)) l.push(r.station_id);
    }
  }
  return { stations, lineStations: ls.rows, services, tagoToStation, rafisRefs };
}

/** 세트의 노선역: 운행 계통 노선 ∩ 역의 노선역이 하나일 때만(Q72 A) */
export function lineStationResolver(
  lineStations: Iterable<Pick<NetLineStation, 'id' | 'line_id' | 'station_id' | 'line_role'>>,
  serviceLines: (serviceId: string) => string[] | undefined,
): (stationId: string, serviceId: string | null) => string | null {
  const byStation = new Map<string, { id: string; line_id: string; line_role?: string | null }[]>();
  for (const ls of lineStations) {
    const l = byStation.get(ls.station_id) ?? [];
    byStation.set(ls.station_id, l);
    l.push(ls);
  }
  return (stationId, serviceId) => {
    if (!serviceId) return null;
    const lines = new Set(serviceLines(serviceId) ?? []);
    const cand = (byStation.get(stationId) ?? []).filter((x) => lines.has(x.line_id));
    if (cand.length === 1) return cand[0]!.id;
    // 후보가 여럿이면 기지선·연결선·삼각선(line_role) 노선역을 뺀다(예: 병점 = 경부선·병점기지선 → 경부선, 2026-11-27)
    const main = cand.filter((x) => !x.line_role);
    return main.length === 1 ? main[0]!.id : null;
  };
}
