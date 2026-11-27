/**
 * 시간표 수집기가 쓰는 망 정보(역 이름·별칭·상태, 노선역, 운행 계통의 노선·정차 패턴·권역, 외부 코드).
 * DB 에서 읽거나(loadNetworkContext) 이관 도구처럼 다른 원천에서 같은 모양으로 만든다.
 */
import type { Queryable } from '@k-raildex/domain';
import { baseKey } from './names';

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
  /** 노선 상태 — 분기역 시간표 행 나누기에서 운영·휴업 노선만 길로 쓴다 */
  line_status?: string | null;
}

export interface NetService {
  id: string;
  line_ids: string[];
  /** 정차 패턴별 역 id 순서 */
  stop_patterns: string[][];
  /** 정차 패턴별 노선역 id 순서(stop_patterns 와 같은 모양) — 분기역 시간표 나누기(Q148) */
  stop_pattern_ls?: string[][];
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
    `SELECT ls.id, ls.line_id, ls.station_id, ls.seq, ls.station_code, l.line_role, l.status AS line_status
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
  const sp = await db.query<{ service_id: string; pattern_id: string; station_id: string; ls_id: string }>(
    `SELECT p.service_id, p.id AS pattern_id, ls.station_id, ls.id AS ls_id
       FROM stop_pattern p JOIN stop_pattern_stop x ON x.pattern_id = p.id JOIN line_station ls ON ls.id = x.line_station_id
      ORDER BY p.service_id, p.seq, p.id, x.seq`,
  );
  const patterns = new Map<string, Map<string, string[]>>();
  const patternLs = new Map<string, Map<string, string[]>>();
  for (const r of sp.rows) {
    const m = patterns.get(r.service_id) ?? new Map<string, string[]>();
    patterns.set(r.service_id, m);
    const list = m.get(r.pattern_id) ?? [];
    m.set(r.pattern_id, list);
    list.push(r.station_id);
    const ml = patternLs.get(r.service_id) ?? new Map<string, string[]>();
    patternLs.set(r.service_id, ml);
    (ml.get(r.pattern_id) ?? ml.set(r.pattern_id, []).get(r.pattern_id)!).push(r.ls_id);
  }
  const services = new Map<string, NetService>(
    sv.rows.map((r) => [
      r.id,
      {
        id: r.id,
        line_ids: r.line_ids ?? [],
        areas: r.areas ?? [],
        stop_patterns: [...(patterns.get(r.id)?.values() ?? [])],
        stop_pattern_ls: [...(patternLs.get(r.id)?.values() ?? [])],
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

/**
 * 분기역 시간표를 노선역별로 나눈다(round-07 Q148, 2026-11-27 사용자 결정 "시간표 데이터는 노선역에 붙이고 UI 는 탭으로 구분").
 * 세트의 노선역을 정하지 못했고(운행 계통 노선에 그 역의 노선역이 둘 이상) 행마다 행선지 역(id, 없으면 이름)이 있으면, 행마다
 * "이 역을 떠나 이 역을 다시 지나지 않고 행선지까지 가는 가장 짧은 길(구간 수)의 첫 구간이 어느 노선인가"로 고른다
 * (예: 1호선 계통 구로 — 인천행 = 경인선, 천안·소요산행 = 경부선; 청량리 — 서울역 쪽 = 1호선, 소요산 쪽 = 경원선).
 * 길은 먼저 그 운행 계통의 정차 패턴(이웃 정차역)으로 찾고(계통이 쓰지 않는 선로로 질러가지 않게), 없으면 운영·휴업 노선망
 * (이웃 노선역, seq 순)으로 찾는다. 그래도 못 정한 행은 정차 패턴이 그 역에서 쓰는 노선역이 하나뿐이면 그것으로 둔다.
 * 행이 모두 한 노선역이면 세트에 그 노선역을 적고, 여럿이면 노선역마다 세트를 나눈다(id = 원래 id + "--" + 노선 id 꼬리).
 * 정하지 못한 행(행선지 없음·길이 같음)은 노선역 없는 원래 id 세트에 남는다(품질 V-S14).
 */
export interface SplittableSet {
  id: string;
  station_id: string;
  line_station_id: string | null;
  service_id: string | null;
  entries: { dest_station_id?: string | null; dest_name?: string | null }[];
}

export function lineStationSplitter(
  lineStations: readonly Pick<NetLineStation, 'id' | 'line_id' | 'station_id' | 'seq' | 'line_role' | 'line_status'>[],
  serviceOf: (serviceId: string) => Pick<NetService, 'line_ids' | 'stop_patterns' | 'stop_pattern_ls'> | undefined,
  /** 행선지 역 id 가 없는 행(TAGO)은 행선지 이름(이름·별칭, 괄호 부역명 무시)으로 역을 찾는다 — 미개통 역은 뺀다 */
  stations?: Iterable<NetStation>,
): <T extends SplittableSet>(set: T) => T[] {
  const byName = new Map<string, string[]>();
  for (const st of stations ?? []) {
    if (st.status && UNOPENED.has(st.status)) continue;
    for (const n of new Set([st.name_ko, ...st.aliases].map(baseKey))) {
      const l = byName.get(n) ?? byName.set(n, []).get(n)!;
      if (!l.includes(st.id)) l.push(st.id);
    }
  }
  const RUNNING = new Set(['operating', 'suspended']);
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  const byLine = new Map<string, Pick<NetLineStation, 'station_id' | 'seq'>[]>();
  const byStation = new Map<string, Pick<NetLineStation, 'id' | 'line_id' | 'line_role'>[]>();
  for (const ls of lineStations) {
    (byStation.get(ls.station_id) ?? byStation.set(ls.station_id, []).get(ls.station_id)!).push(ls);
    if (ls.line_status && !RUNNING.has(ls.line_status)) continue;
    (byLine.get(ls.line_id) ?? byLine.set(ls.line_id, []).get(ls.line_id)!).push(ls);
  }
  const lineNeighbors = new Map<string, Map<string, string[]>>(); // line → station → 이웃 역
  for (const [lineId, list] of byLine) {
    const sorted = [...list].sort((a, b) => a.seq - b.seq);
    const m = new Map<string, string[]>();
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i]!.station_id;
      const nb: string[] = [];
      if (i > 0) nb.push(sorted[i - 1]!.station_id);
      if (i < sorted.length - 1) nb.push(sorted[i + 1]!.station_id);
      m.set(cur, [...(m.get(cur) ?? []), ...nb]);
      if (i > 0) link(sorted[i - 1]!.station_id, cur);
    }
    lineNeighbors.set(lineId, m);
  }
  const cache = new Map<string, number | null>();
  /** 그래프 g 에서 start 들로 떠나(from 은 다시 지나지 않음) dest 까지의 구간 수 */
  const bfs = (g: Map<string, Set<string>>, from: string, start: string[], dest: string): number | null => {
    let best: number | null = null;
    if (start.length) {
      const seen = new Set<string>([from, ...start]);
      let frontier = [...start];
      let d = 1;
      while (frontier.length && best === null) {
        if (frontier.includes(dest)) best = d;
        const next: string[] = [];
        for (const s of frontier)
          for (const n of g.get(s) ?? [])
            if (!seen.has(n)) {
              seen.add(n);
              next.push(n);
            }
        frontier = next;
        d++;
      }
    }
    return best;
  };
  /** 노선망: 역 from 에서 노선 lineId 를 따라 떠나 dest 까지 */
  const dist = (from: string, lineId: string, dest: string): number | null => {
    const key = `${from}|${lineId}|${dest}`;
    if (!cache.has(key)) cache.set(key, bfs(adj, from, lineNeighbors.get(lineId)?.get(from) ?? [], dest));
    return cache.get(key)!;
  };
  /** 운행 계통 정차 패턴 그래프(계통마다 한 번) */
  const svcGraph = new Map<string, Map<string, Set<string>>>();
  const graphOf = (serviceId: string): Map<string, Set<string>> => {
    let g = svcGraph.get(serviceId);
    if (g) return g;
    g = new Map();
    for (const p of serviceOf(serviceId)?.stop_patterns ?? [])
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1]!;
        const b = p[i]!;
        if (a === b) continue;
        (g.get(a) ?? g.set(a, new Set()).get(a)!).add(b);
        (g.get(b) ?? g.set(b, new Set()).get(b)!).add(a);
      }
    svcGraph.set(serviceId, g);
    return g;
  };
  const tail = (lineId: string) => lineId.replace(/^line-/, '');

  return <T extends SplittableSet>(set: T): T[] => {
    if (set.line_station_id || !set.service_id) return [set];
    const svc = serviceOf(set.service_id);
    const lines = new Set(svc?.line_ids ?? []);
    let cand = (byStation.get(set.station_id) ?? []).filter((x) => lines.has(x.line_id));
    if (cand.some((x) => !x.line_role)) cand = cand.filter((x) => !x.line_role);
    if (cand.length < 2) return [set];
    const groups = new Map<string | null, T['entries']>();
    const onService = (stId: string) => (byStation.get(stId) ?? []).some((x) => lines.has(x.line_id));
    const destOf = (e: T['entries'][number]): string | null => {
      if (e.dest_station_id) return e.dest_station_id;
      if (!e.dest_name) return null;
      const hits = byName.get(baseKey(e.dest_name)) ?? [];
      const mine = hits.filter(onService);
      return mine.length === 1 ? mine[0]! : hits.length === 1 ? hits[0]! : null;
    };
    // 정차 패턴 그래프에서 이 역의 이웃 → 그 이웃이 있는 후보 노선(하나일 때만)
    const g = graphOf(set.service_id);
    const hops = [...(g.get(set.station_id) ?? [])].map((n) => ({
      n,
      lines: cand.filter((c) => (byStation.get(n) ?? []).some((x) => x.line_id === c.line_id)),
    }));
    // 정차 패턴이 이 역에서 쓰는 후보 노선역(못 정한 행의 마지막 기준)
    const patternLs = new Set<string>();
    for (const [i, p] of (svc?.stop_patterns ?? []).entries())
      p.forEach((st, j) => {
        const lsId = svc?.stop_pattern_ls?.[i]?.[j];
        if (st === set.station_id && lsId && cand.some((c) => c.id === lsId)) patternLs.add(lsId);
      });
    const viaPattern = (dest: string): string | null => {
      const ds = hops
        .map((h) => ({ h, d: bfs(g, set.station_id, [h.n], dest) }))
        .filter((x): x is { h: (typeof hops)[number]; d: number } => x.d !== null)
        .sort((a, b) => a.d - b.d);
      if (!ds.length) return null;
      const best = ds.filter((x) => x.d === ds[0]!.d).flatMap((x) => x.h.lines.map((c) => c.id));
      const uniq = [...new Set(best)];
      return uniq.length === 1 ? uniq[0]! : null;
    };
    for (const e of set.entries) {
      let pick: string | null = null;
      const dest = destOf(e);
      if (dest && dest !== set.station_id) pick = viaPattern(dest);
      if (!pick && dest && dest !== set.station_id) {
        const own = cand.filter((c) => (byStation.get(dest) ?? []).some((x) => x.line_id === c.line_id));
        const ds = cand
          .map((c) => ({ c, d: dist(set.station_id, c.line_id, dest) }))
          .filter((x): x is { c: (typeof cand)[number]; d: number } => x.d !== null)
          .sort((a, b) => a.d - b.d);
        if (ds.length && (ds.length === 1 || ds[0]!.d < ds[1]!.d)) pick = ds[0]!.c.id;
        else if (own.length === 1) pick = own[0]!.id;
      }
      if (!pick && patternLs.size === 1) pick = [...patternLs][0]!;
      (groups.get(pick) ?? groups.set(pick, []).get(pick)!).push(e);
    }
    const resolved = [...groups.keys()].filter((k): k is string => k !== null);
    if (!resolved.length) return [set];
    if (resolved.length === 1 && !groups.has(null)) return [{ ...set, line_station_id: resolved[0]! }];
    const lineOf = new Map(cand.map((c) => [c.id, c.line_id]));
    const out: T[] = [];
    if (groups.has(null)) out.push({ ...set, entries: groups.get(null)! });
    for (const lsId of resolved.sort())
      out.push({
        ...set,
        id: `${set.id}--${tail(lineOf.get(lsId)!)}`,
        line_station_id: lsId,
        entries: groups.get(lsId)!,
      });
    return out;
  };
}
