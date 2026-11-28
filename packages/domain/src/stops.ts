/**
 * 정거장(2026-11-28 사용자 지시 — "정거장"을 "정거장"이라 부름, 식별자 line_station 그대로, 0044·0045).
 * - lineStopTable: 노선 정거장 순서 표(위키백과 "역 목록"과 비슷하게) — 정거장 번호·이름(한자·로마자)·구분(코레일 정거장 등급
 *   조차장·신호장·신호소, 없으면 역 그룹 종류)·접속 노선·역간 거리·영업 거리(km)·소재지. 파생 값(v_line_stop·v_line_stop_link).
 * - stopNeighbors: 한 역 그룹의 모든 노선 앞뒤 정거장(v_stop_neighbor) — 분기·여러 노선이면 여러 개.
 * 거리 = 두 정거장 km 차이(둘 다 있을 때만, 없으면 null = 미확인).
 */
import type { Queryable } from './db';
import { DomainError } from './errors';

export interface StopLinkRef {
  line_station_id: string;
  station_id: string;
  name_ko: string | null;
  distance_km: number | null;
  /** sequence = 같은 노선·지선에서 이웃, branch = 지선이 갈라지는 정거장과 지선 첫 정거장 */
  basis: 'sequence' | 'branch';
}

export interface LineStopRow {
  line_station_id: string;
  pos: number;
  branch: string | null;
  station_id: string;
  station_code: string | null;
  name_ko: string | null;
  name_hanja: string | null;
  name_en: string | null;
  /** 조차장·신호장·신호소(코레일 정거장 등급) 또는 역 그룹 종류 station·freight·operational */
  stop_class: string;
  korail_class: string | null;
  status: string;
  opened: unknown;
  closed: unknown;
  km: number | null;
  /** 앞 정거장(본선 이웃, 지선 첫 정거장이면 갈라지는 정거장)과 역간 거리 */
  prev: StopLinkRef[];
  next: StopLinkRef[];
  /** 같은 역 그룹에 정거장이 있는 다른 노선 */
  connections: { line_id: string; name_ko: string | null; status: string }[];
  region_code: string | null;
  region_name: string | null;
  address: string | null;
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

/** 노선 정거장 순서 표. 본선(branch 없음) 먼저, 지선은 이름 순. 노선이 없으면 not_found */
export async function lineStopTable(db: Queryable, lineId: string): Promise<LineStopRow[]> {
  const line = await db.query(`SELECT 1 FROM line WHERE id = $1 AND deleted_at IS NULL`, [lineId]);
  if (!line.rowCount) throw new DomainError('not_found', `노선 없음: ${lineId}`);
  const { rows } = await db.query<
    Omit<LineStopRow, 'prev' | 'next' | 'km' | 'opened' | 'closed'> & {
      km: unknown;
      opened_value: string | null;
      opened_precision: string | null;
      closed_value: string | null;
      closed_precision: string | null;
    }
  >(
    `SELECT v.line_station_id, v.pos, v.branch, v.station_id, x.station_code, v.name_ko, s.name_hanja,
            coalesce(x.name_en, s.name_en) AS name_en, v.stop_class, x.korail_class, v.status, v.km,
            x.opened_value, x.opened_precision, x.closed_value, x.closed_precision,
            s.region_code, r.name_ko AS region_name, s.address,
            coalesce((SELECT json_agg(json_build_object('line_id', o.line_id, 'name_ko', ol.name_ko, 'status', o.status)
                                      ORDER BY ol.name_ko, o.line_id)
                        FROM line_station o JOIN line ol ON ol.id = o.line_id AND ol.deleted_at IS NULL
                       WHERE o.station_id = v.station_id AND o.deleted_at IS NULL AND o.line_id <> v.line_id), '[]') AS connections
       FROM v_line_stop v
       JOIN line_station x ON x.id = v.line_station_id
       JOIN station s ON s.id = v.station_id
       LEFT JOIN ref_region r ON r.code = s.region_code
      WHERE v.line_id = $1
      ORDER BY v.branch NULLS FIRST, v.pos`,
    [lineId],
  );
  const links = await db.query<{
    from_ls: string;
    from_id: string;
    from_name: string | null;
    to_ls: string;
    to_id: string;
    to_name: string | null;
    distance_km: unknown;
    basis: 'sequence' | 'branch';
  }>(
    `SELECT from_ls, from_id, from_name, to_ls, to_id, to_name, distance_km, basis
       FROM v_line_stop_link WHERE line_id = $1`,
    [lineId],
  );
  const prev = new Map<string, StopLinkRef[]>();
  const next = new Map<string, StopLinkRef[]>();
  const push = (m: Map<string, StopLinkRef[]>, k: string, v: StopLinkRef) => m.set(k, [...(m.get(k) ?? []), v]);
  for (const l of links.rows) {
    const d = num(l.distance_km);
    push(next, l.from_ls, {
      line_station_id: l.to_ls,
      station_id: l.to_id,
      name_ko: l.to_name,
      distance_km: d,
      basis: l.basis,
    });
    push(prev, l.to_ls, {
      line_station_id: l.from_ls,
      station_id: l.from_id,
      name_ko: l.from_name,
      distance_km: d,
      basis: l.basis,
    });
  }
  const fz = (value: string | null, precision: string | null) => (precision ? { value, precision } : null);
  return rows.map(({ opened_value, opened_precision, closed_value, closed_precision, ...r }) => ({
    ...r,
    km: num(r.km),
    opened: fz(opened_value, opened_precision),
    closed: fz(closed_value, closed_precision),
    prev: prev.get(r.line_station_id) ?? [],
    next: next.get(r.line_station_id) ?? [],
  }));
}

export interface StopNeighbor {
  line_id: string;
  line_name_ko: string | null;
  line_station_id: string;
  branch: string | null;
  direction: 'prev' | 'next';
  neighbor_station_id: string;
  neighbor_line_station_id: string;
  neighbor_name: string | null;
  distance_km: number | null;
  basis: 'sequence' | 'branch';
}

/** 한 역 그룹의 앞뒤 정거장(모든 노선) */
export async function stopNeighbors(db: Queryable, stationId: string): Promise<StopNeighbor[]> {
  const found = await db.query(`SELECT 1 FROM station WHERE id = $1 AND deleted_at IS NULL`, [stationId]);
  if (!found.rowCount) throw new DomainError('not_found', `역 그룹 없음: ${stationId}`);
  const { rows } = await db.query<Omit<StopNeighbor, 'distance_km'> & { distance_km: unknown }>(
    `SELECT n.line_id, l.name_ko AS line_name_ko, n.line_station_id, n.branch, n.direction, n.neighbor_station_id,
            n.neighbor_line_station_id, n.neighbor_name, n.distance_km, n.basis
       FROM v_stop_neighbor n JOIN line l ON l.id = n.line_id
      WHERE n.station_id = $1
      ORDER BY l.name_ko, n.line_id, n.branch NULLS FIRST, n.direction DESC, n.neighbor_name`,
    [stationId],
  );
  return rows.map((r) => ({ ...r, distance_km: num(r.distance_km) }));
}
