/**
 * 정거장(0042, 2026-11-28 사용자 지시 — A안): 역·화물역·신호장·신호소·조차장을 노선 순서로 엮은 파생 값(저장하지 않음).
 * - lineStops: 노선 정거장 순서(v_line_stop) + 그 노선 안의 앞뒤 정거장·거리(v_line_stop_link)
 * - stopNeighbors: 한 정거장(역 그룹 또는 시설)의 모든 노선 앞뒤 정거장(v_stop_neighbor) — 분기·여러 노선이면 여러 개
 * 거리 = 두 정거장 km 차이(둘 다 있을 때만, 없으면 null = 미확인).
 */
import type { Queryable } from './db';
import { DomainError } from './errors';

export type StopNodeType = 'station' | 'facility';
export const STOP_NODE_TYPES: readonly StopNodeType[] = ['station', 'facility'];

export interface StopRef {
  node_type: StopNodeType;
  node_id: string;
  name_ko: string | null;
  distance_km: number | null;
  /** sequence = 같은 노선·지선에서 이웃, branch = 지선이 갈라지는 노선역과 지선 첫 정거장 */
  basis: 'sequence' | 'branch';
  branch: string | null;
}

export interface LineStop {
  pos: number;
  branch: string | null;
  node_type: StopNodeType;
  node_id: string;
  line_station_id: string | null;
  stop_kind: string;
  name_ko: string | null;
  km: number | null;
  status: string;
  prev: StopRef[];
  next: StopRef[];
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

/** 노선 정거장 순서. 본선(branch 없음) 먼저, 지선은 이름 순. 노선이 없으면 not_found */
export async function lineStops(db: Queryable, lineId: string): Promise<LineStop[]> {
  const line = await db.query(`SELECT 1 FROM line WHERE id = $1 AND deleted_at IS NULL`, [lineId]);
  if (!line.rowCount) throw new DomainError('not_found', `노선 없음: ${lineId}`);
  const { rows } = await db.query<Omit<LineStop, 'prev' | 'next' | 'km'> & { km: unknown }>(
    `SELECT pos, branch, node_type, node_id, line_station_id, stop_kind, name_ko, km, status
       FROM v_line_stop WHERE line_id = $1 ORDER BY branch NULLS FIRST, pos`,
    [lineId],
  );
  const links = await db.query<{
    branch: string | null;
    from_type: StopNodeType;
    from_id: string;
    from_name: string | null;
    to_type: StopNodeType;
    to_id: string;
    to_name: string | null;
    distance_km: unknown;
    basis: 'sequence' | 'branch';
  }>(
    `SELECT branch, from_type, from_id, from_name, to_type, to_id, to_name, distance_km, basis
       FROM v_line_stop_link WHERE line_id = $1`,
    [lineId],
  );
  const key = (t: string, id: string) => `${t}:${id}`;
  const prev = new Map<string, StopRef[]>();
  const next = new Map<string, StopRef[]>();
  const push = (m: Map<string, StopRef[]>, k: string, v: StopRef) => {
    const list = m.get(k) ?? [];
    list.push(v);
    m.set(k, list);
  };
  for (const l of links.rows) {
    const d = num(l.distance_km);
    push(next, key(l.from_type, l.from_id), {
      node_type: l.to_type,
      node_id: l.to_id,
      name_ko: l.to_name,
      distance_km: d,
      basis: l.basis,
      branch: l.branch,
    });
    push(prev, key(l.to_type, l.to_id), {
      node_type: l.from_type,
      node_id: l.from_id,
      name_ko: l.from_name,
      distance_km: d,
      basis: l.basis,
      branch: l.branch,
    });
  }
  // 한 정거장이 본선·지선 두 번 나오지는 않지만(노선역은 노선마다 한 번), 앞뒤는 그 정거장의 모든 링크를 보여 준다
  return rows.map((r) => ({
    ...r,
    km: num(r.km),
    prev: prev.get(key(r.node_type, r.node_id)) ?? [],
    next: next.get(key(r.node_type, r.node_id)) ?? [],
  }));
}

export interface StopNeighbor {
  line_id: string;
  line_name_ko: string | null;
  branch: string | null;
  direction: 'prev' | 'next';
  neighbor_type: StopNodeType;
  neighbor_id: string;
  neighbor_name: string | null;
  distance_km: number | null;
  basis: 'sequence' | 'branch';
}

/** 한 정거장의 앞뒤 정거장(모든 노선). type = station(역 그룹) | facility(시설) */
export async function stopNeighbors(db: Queryable, type: string, id: string): Promise<StopNeighbor[]> {
  if (!STOP_NODE_TYPES.includes(type as StopNodeType))
    throw new DomainError('validation', `정거장 종류는 station·facility 만: ${type}`);
  const table = type === 'station' ? 'station' : 'facility';
  const found = await db.query(`SELECT 1 FROM ${table} WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!found.rowCount) throw new DomainError('not_found', `${type} 없음: ${id}`);
  const { rows } = await db.query<Omit<StopNeighbor, 'distance_km'> & { distance_km: unknown }>(
    `SELECT n.line_id, l.name_ko AS line_name_ko, n.branch, n.direction, n.neighbor_type, n.neighbor_id,
            n.neighbor_name, n.distance_km, n.basis
       FROM v_stop_neighbor n JOIN line l ON l.id = n.line_id
      WHERE n.node_type = $1 AND n.node_id = $2
      ORDER BY l.name_ko, n.line_id, n.branch NULLS FIRST, n.direction DESC, n.neighbor_name`,
    [type, id],
  );
  return rows.map((r) => ({ ...r, distance_km: num(r.distance_km) }));
}
