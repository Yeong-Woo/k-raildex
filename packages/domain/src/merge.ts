/**
 * 역 병합 미리 보기(FR-ADM-062): 적용기(merge_station)가 할 일을 저장 없이 목록으로 보여 준다.
 * 노선별 역 — 대상 역에 같은 노선이 없으면 옮김(move), 있으면 그쪽으로 합침(combine, 원본 쪽은 삭제).
 * 참조 — 원본 역을 가리키는 행 수(대상으로 바뀐다). 이름이 다르면 원본 이름이 대상의 옛 이름으로 들어간다.
 */
import type { Queryable } from './db';
import { DomainError } from './errors';

export interface MergePreviewStation {
  id: string;
  name_ko: string;
  merge_into_id: string | null;
  has_geom: boolean;
  lines: { line_id: string; line_name: string; status: string }[];
}
export interface MergePreview {
  from: MergePreviewStation;
  into: MergePreviewStation;
  line_stations: {
    id: string;
    line_id: string;
    line_name: string;
    status: string;
    action: 'move' | 'combine';
    twin_id: string | null;
    twin_status: string | null;
  }[];
  references: { table: string; count: number }[];
  /** 두 역 좌표 사이 거리(m) — 한쪽이라도 좌표가 없으면 null */
  distance_m: number | null;
  /** 원본 이름이 대상의 옛 이름으로 들어가는지 */
  adds_former_name: boolean;
  /** 원본의 병합할 역(merge_into_id)이 대상과 같은지 */
  matches_merge_into: boolean;
}

async function station(db: Queryable, id: string): Promise<MergePreviewStation> {
  const r = await db.query<{ id: string; name_ko: string; merge_into_id: string | null; has_geom: boolean }>(
    `SELECT id, name_ko, merge_into_id, geom IS NOT NULL AS has_geom FROM station WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  const s = r.rows[0];
  if (!s) throw new DomainError('not_found', `역 ${id} 가 없음`);
  const lines = await db.query<{ line_id: string; line_name: string; status: string }>(
    `SELECT x.line_id, l.name_ko AS line_name, x.status FROM line_station x JOIN line l ON l.id = x.line_id
      WHERE x.station_id = $1 AND x.deleted_at IS NULL ORDER BY l.name_ko, x.line_id`,
    [id],
  );
  return { ...s, lines: lines.rows };
}

export async function mergePreview(db: Queryable, fromId: string, intoId: string): Promise<MergePreview> {
  if (fromId === intoId) throw new DomainError('validation', '같은 역으로 병합할 수 없음');
  const [from, into] = [await station(db, fromId), await station(db, intoId)];
  const ls = await db.query<MergePreview['line_stations'][number]>(
    `SELECT x.id, x.line_id, l.name_ko AS line_name, x.status,
            CASE WHEN t.id IS NULL THEN 'move' ELSE 'combine' END AS action, t.id AS twin_id, t.status AS twin_status
       FROM line_station x JOIN line l ON l.id = x.line_id
       LEFT JOIN LATERAL (SELECT y.id, y.status FROM line_station y
                           WHERE y.station_id = $2 AND y.line_id = x.line_id AND y.deleted_at IS NULL LIMIT 1) t ON true
      WHERE x.station_id = $1 AND x.deleted_at IS NULL
      ORDER BY l.name_ko, x.id`,
    [fromId, intoId],
  );
  const refs = await db.query<{ table: string; count: number }>(
    `SELECT t AS table, c::int AS count FROM (
       SELECT 'plan_station' AS t, count(*) AS c FROM plan_station WHERE station_id = $1
       UNION ALL SELECT 'transfer_center_station', count(*) FROM transfer_center_station WHERE station_id = $1
       UNION ALL SELECT 'event_target', count(*) FROM event_target WHERE entity_id = $1
       UNION ALL SELECT 'timetable_set', count(*) FROM timetable_set WHERE station_id = $1
       UNION ALL SELECT 'timetable_entry', count(*) FROM timetable_entry WHERE dest_station_id = $1
       UNION ALL SELECT 'line(시종점)', count(*) FROM line WHERE (start_station_id = $1 OR end_station_id = $1) AND deleted_at IS NULL
       UNION ALL SELECT 'station(병합할 역·좌표 같음)', count(*) FROM station
                  WHERE (merge_into_id = $1 OR coord_same_as_id = $1) AND id <> $1 AND deleted_at IS NULL
       UNION ALL SELECT 'plan_geometry(경유 역)', count(*) FROM plan_geometry WHERE $1 = ANY (via_station_ids)
       UNION ALL SELECT 'entity_attachment', count(*) FROM entity_attachment WHERE entity_id = $1
     ) q WHERE c > 0`,
    [fromId],
  );
  const dist = await db.query<{ d: number | null }>(
    `SELECT round(ST_Distance(a.geom, b.geom))::int AS d FROM station a, station b WHERE a.id = $1 AND b.id = $2`,
    [fromId, intoId],
  );
  return {
    from,
    into,
    line_stations: ls.rows,
    references: refs.rows,
    distance_m: dist.rows[0]?.d ?? null,
    adds_former_name: from.name_ko !== into.name_ko,
    matches_merge_into: from.merge_into_id === intoId,
  };
}
