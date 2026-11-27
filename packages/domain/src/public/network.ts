/**
 * 공개 읽기 모델 — 노선·역·운행 계통·시간표(docs/04-api.md 5절, docs/06-public-web.md 2절).
 * 역 상태·권역·검수 상속 등 파생 값은 DB 뷰(v_station_status·v_*_area·v_station_review·v_unopened_target)로 읽는다.
 */
import {
  splitDayNote,
  type PublicFacilityDetail,
  type PublicLineDetail,
  type PublicLineListItem,
  type PublicServiceDetail,
  type PublicStationDetail,
  type PublicStationListItem,
  type PublicTimetable,
} from '@k-raildex/contracts';
import type { Queryable } from '../db';
import { attachmentsOf, eventsOf, fz, namesOf, paginate, REC_JSON, sourcesOf, TARGET_JSON, type Page } from './common';

type Row = Record<string, unknown>;

const UNOPENED_JSON = (u: string): string =>
  `CASE WHEN ${u}.precision IS NULL THEN NULL ELSE json_build_object('value', ${u}.value, 'precision', ${u}.precision) END`;

const OPERATORS_JSON = `coalesce((SELECT json_agg(json_build_object('id', o.id, 'name_ko', o.name_ko, 'role', lo.role) ORDER BY lo.ord)
  FROM line_operator lo JOIN operator o ON o.id = lo.operator_id AND o.deleted_at IS NULL WHERE lo.line_id = l.id), '[]'::json)`;

const LINE_COLS = `l.id, l.name_ko, l.name_en, l.name_full, l.category, l.rail_class, l.is_wide_area, l.line_role, l.status, l.color,
  l.length_km::float8 AS length_km, ${fz('l.opened')} AS opened, ${fz('l.closed')} AS closed, la.areas,
  coalesce((SELECT array_agg(lr.region_code ORDER BY lr.region_code) FROM line_region lr WHERE lr.line_id = l.id), '{}') AS regions,
  ${OPERATORS_JSON} AS operators,
  (SELECT p.id FROM line p WHERE p.id = l.parent_line_id AND p.deleted_at IS NULL) AS parent_line_id,
  (SELECT e.code FROM external_ref e WHERE e.entity_id = l.id AND e.system = 'molit_line_no'
    ORDER BY e.is_primary DESC, length(e.code), e.code LIMIT 1) AS line_no,
  (SELECT json_build_object('id', p.id, 'name_ko', p.name_ko) FROM v_line_branch b JOIN line p ON p.id = b.branch_of_line_id
    WHERE b.line_id = l.id) AS branch_of,
  l.review_status, ${UNOPENED_JSON('ut')} AS target_open`;

const LINE_FROM = `FROM line l JOIN v_line_area la ON la.line_id = l.id
  LEFT JOIN v_unopened_target ut ON ut.entity_type = 'line' AND ut.entity_id = l.id`;

export interface LineListQuery extends Page {
  rail_class?: string;
  category?: string;
  status?: string;
  area?: string;
  /** 시·도 코드 또는 슬러그 */
  region?: string;
  is_wide_area?: boolean;
  q?: string;
}

export async function publicLines(db: Queryable, q: LineListQuery) {
  const where: string[] = ['l.deleted_at IS NULL'];
  const params: unknown[] = [];
  const p = (v: unknown) => `$${params.push(v)}`;
  if (q.rail_class) where.push(`l.rail_class = ${p(q.rail_class)}`);
  if (q.category) where.push(`l.category = ${p(q.category)}`);
  if (q.status) where.push(`l.status = ${p(q.status)}`);
  if (q.area) where.push(`${p(q.area)} = ANY (la.areas)`);
  if (q.is_wide_area !== undefined) where.push(`l.is_wide_area = ${p(q.is_wide_area)}`);
  if (q.region) {
    const r = p(q.region);
    where.push(`EXISTS (SELECT 1 FROM line_region lr JOIN ref_region rr ON rr.code = lr.region_code
                         WHERE lr.line_id = l.id AND (rr.code = ${r} OR rr.slug = ${r}))`);
  }
  if (q.q) where.push(`(l.name_ko ILIKE ${p(`%${q.q}%`)} OR l.name_full ILIKE $${params.length} OR l.id = ${p(q.q)})`);
  const { rows } = await db.query<PublicLineListItem>(
    `SELECT ${LINE_COLS},
            (SELECT count(*)::int FROM v_station_line v WHERE v.line_id = l.id) AS station_count,
            l.passenger_service AS passenger
       ${LINE_FROM} WHERE ${where.join(' AND ')} ORDER BY l.id`,
    params,
  );
  return paginate(rows, q);
}

export async function publicLine(db: Queryable, id: string): Promise<PublicLineDetail | null> {
  const { rows } = await db.query<Row>(
    `SELECT ${LINE_COLS}, l.name_hanja, l.wide_area_note, l.passenger_service, l.owner, l.track, l.electrification,
            l.gauge_mm::float8 AS gauge_mm, l.design_speed_kmh::float8 AS design_speed_kmh, l.description,
            (SELECT json_build_object('id', s.id, 'name_ko', s.name_ko) FROM station s WHERE s.id = l.start_station_id AND s.deleted_at IS NULL) AS start_station,
            (SELECT json_build_object('id', s.id, 'name_ko', s.name_ko) FROM station s WHERE s.id = l.end_station_id AND s.deleted_at IS NULL) AS end_station,
            coalesce((SELECT json_agg(json_build_object('code', rr.code, 'name_ko', rr.name_ko) ORDER BY rr.ord)
                        FROM line_region lr JOIN ref_region rr ON rr.code = lr.region_code WHERE lr.line_id = l.id), '[]'::json) AS region_names,
            ${REC_JSON('l')} AS meta
       ${LINE_FROM} WHERE l.id = $1 AND l.deleted_at IS NULL`,
    [id],
  );
  const line = rows[0];
  if (!line) return null;
  const [stations, children, services, plans, branches] = await Promise.all([
    db.query(
      `SELECT v.station_id, v.seq, v.branch, v.km::float8 AS km, v.station_code, v.order_confirmed, v.name_ko, v.name_en, v.status,
              ${fz('v.opened')} AS opened, ${fz('v.closed')} AS closed,
              CASE WHEN o.id IS NULL THEN NULL ELSE json_build_object('id', o.id, 'name_ko', o.name_ko) END AS operator,
              coalesce((SELECT array_agg(DISTINCT v2.line_id ORDER BY v2.line_id) FROM v_station_line v2
                         WHERE v2.station_id = v.station_id AND v2.line_id <> v.line_id), '{}') AS transfer_line_ids
         FROM v_station_line v LEFT JOIN operator o ON o.id = v.operator_id AND o.deleted_at IS NULL
        WHERE v.line_id = $1 ORDER BY v.seq`,
      [id],
    ),
    db.query(`SELECT id, name_ko, status FROM line WHERE parent_line_id = $1 AND deleted_at IS NULL ORDER BY id`, [id]),
    db.query(
      `SELECT sv.id, sv.name_ko, sv.kind, sv.status FROM service_line sl JOIN service sv ON sv.id = sl.service_id AND sv.deleted_at IS NULL
        WHERE sl.line_id = $1 ORDER BY sv.id`,
      [id],
    ),
    db.query(
      `SELECT p.id AS plan_id, p.name_ko, pl.role, st.stage, ${TARGET_JSON('t', 'st.stage')} AS target_open
         FROM plan_line pl JOIN plan p ON p.id = pl.plan_id AND p.deleted_at IS NULL
         JOIN v_plan_stage st ON st.plan_id = p.id LEFT JOIN v_plan_target_open t ON t.plan_id = p.id
        WHERE pl.line_id = $1 ORDER BY t.date_from NULLS LAST, p.id`,
      [id],
    ),
    // 고시 노선번호로 계산한 지선(v_line_branch, 0033)
    db.query(
      `SELECT c.id, c.name_ko, c.status, c.line_role, b.line_no FROM v_line_branch b JOIN line c ON c.id = b.line_id
        WHERE b.branch_of_line_id = $1 ORDER BY b.line_no, c.id`,
      [id],
    ),
  ]);
  const [names, sources, attachments, events] = await Promise.all([
    namesOf(db, [id]),
    sourcesOf(db, [id]),
    attachmentsOf(db, [id]),
    eventsOf(db, id),
  ]);
  return {
    ...(line as unknown as PublicLineDetail),
    stations: stations.rows as PublicLineDetail['stations'],
    child_lines: children.rows as PublicLineDetail['child_lines'],
    branches: branches.rows as PublicLineDetail['branches'],
    services: services.rows as PublicLineDetail['services'],
    plans: plans.rows as PublicLineDetail['plans'],
    events,
    names: names.get(id) ?? [],
    sources,
    attachments,
  };
}

// ------------------------------------------------------------------ 역

export interface StationListQuery extends Page {
  area?: string;
  region?: string;
  status?: string;
  /** opened = 운영·휴업, unopened = 공사 중·계획, closed = 폐역·폐기 */
  opened?: 'opened' | 'unopened' | 'closed';
  line_class?: string;
  service_kind?: string;
  line_id?: string;
  q?: string;
  /** 시설(신호장·기지 등) 포함 — 기본은 여객역만 */
  include_facilities?: boolean;
}

const STATION_LIST_SQL = `
WITH vl AS (
  SELECT v.station_id, array_agg(v.line_id ORDER BY v.line_id) AS line_ids,
         coalesce(array_agg(DISTINCT v.station_code ORDER BY v.station_code) FILTER (WHERE v.station_code IS NOT NULL), '{}') AS codes,
         array_agg(DISTINCT v.rail_class ORDER BY v.rail_class) AS classes,
         bool_or(l.review_status = 'verified') AS line_verified
    FROM v_station_line v JOIN line l ON l.id = v.line_id GROUP BY v.station_id
), vs AS (
  SELECT ss.station_id, array_agg(DISTINCT ss.kind ORDER BY ss.kind) AS kinds FROM v_station_service ss GROUP BY ss.station_id
)
SELECT s.id, s.name_ko, s.name_en, s.kind, st.status, ${fz('st.opened')} AS opened, ${fz('st.closed')} AS closed,
       s.region_code, sa.areas,
       coalesce(vl.line_ids, '{}') AS line_ids,
       coalesce(vl.classes, ARRAY['conventional']) AS line_classes,
       coalesce(vs.kinds, '{}') AS service_kinds,
       coalesce(vl.codes, '{}') AS station_codes,
       CASE WHEN s.geom IS NULL THEN NULL ELSE json_build_object('lat', round(ST_Y(s.geom::geometry)::numeric, 6)::float8,
                                                                  'lng', round(ST_X(s.geom::geometry)::numeric, 6)::float8) END AS coord,
       (s.coord_basis IS NOT NULL) AS approximate,
       -- v_station_review 와 같은 규칙(소속 노선 하나라도 verified 면 verified)
       CASE WHEN s.review_status = 'flagged' THEN 'flagged'
            WHEN s.review_status = 'verified' OR coalesce(vl.line_verified, false) THEN 'verified' ELSE 'unverified' END AS review_status
  FROM station s
  JOIN v_station_status st ON st.station_id = s.id
  JOIN v_station_area sa ON sa.station_id = s.id
  LEFT JOIN vl ON vl.station_id = s.id
  LEFT JOIN vs ON vs.station_id = s.id`;

function bump(m: Record<string, number>, k: string): void {
  m[k] = (m[k] ?? 0) + 1;
}

export async function publicStations(db: Queryable, q: StationListQuery) {
  const where: string[] = ['s.deleted_at IS NULL'];
  const params: unknown[] = [];
  const p = (v: unknown) => `$${params.push(v)}`;
  if (!q.include_facilities) where.push(`s.kind = 'station'`);
  if (q.status) where.push(`st.status = ${p(q.status)}`);
  if (q.opened === 'opened') where.push(`st.status IN ('operating', 'suspended')`);
  if (q.opened === 'unopened') where.push(`st.status IN ('under_construction', 'planned')`);
  if (q.opened === 'closed') where.push(`st.status IN ('closed', 'abandoned')`);
  if (q.area) where.push(`${p(q.area)} = ANY (sa.areas)`);
  if (q.region) {
    const r = p(q.region);
    where.push(`s.region_code = (SELECT code FROM ref_region WHERE code = ${r} OR slug = ${r})`);
  }
  if (q.line_class) where.push(`${p(q.line_class)} = ANY (coalesce(vl.classes, ARRAY['conventional']))`);
  if (q.service_kind) where.push(`${p(q.service_kind)} = ANY (vs.kinds)`);
  if (q.line_id) where.push(`${p(q.line_id)} = ANY (vl.line_ids)`);
  if (q.q) {
    const like = p(`%${q.q}%`);
    where.push(`(s.name_ko ILIKE ${like} OR s.name_en ILIKE ${like}
                 OR EXISTS (SELECT 1 FROM v_station_line v WHERE v.station_id = s.id AND (v.name_ko ILIKE ${like} OR v.station_code = ${p(q.q)})))`);
  }
  const { rows } = await db.query<PublicStationListItem>(
    `${STATION_LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY s.name_ko, s.id`,
    params,
  );
  const facets = { status: {}, area: {}, line_class: {}, service_kind: {} } as Record<
    'status' | 'area' | 'line_class' | 'service_kind',
    Record<string, number>
  >;
  for (const r of rows) {
    bump(facets.status, r.status);
    for (const a of r.areas) bump(facets.area, a);
    for (const c of r.line_classes) bump(facets.line_class, c);
    for (const k of r.service_kinds) bump(facets.service_kind, k);
  }
  return { ...paginate(rows, q), facets };
}

export async function publicStation(db: Queryable, id: string): Promise<PublicStationDetail | null> {
  const { rows } = await db.query<Row>(
    `SELECT s.id, s.name_ko, s.name_en, s.name_hanja, s.name_full, s.kind, st.status, ${fz('st.opened')} AS opened,
            ${fz('st.closed')} AS closed, ${UNOPENED_JSON('ut')} AS target_open,
            (SELECT json_build_object('code', r.code, 'name_ko', r.name_ko, 'slug', r.slug) FROM ref_region r WHERE r.code = s.region_code) AS region,
            s.address,
            CASE WHEN s.geom IS NULL THEN NULL ELSE json_build_object('lat', round(ST_Y(s.geom::geometry)::numeric, 6)::float8,
                                                                       'lng', round(ST_X(s.geom::geometry)::numeric, 6)::float8) END AS coord,
            s.coord_source, s.coord_basis, (s.coord_basis IS NOT NULL) AS approximate, s.grade, s.history_text, s.intro_text,
            sa.areas, lc.line_classes, rv.review_status, ${REC_JSON('s')} AS meta
       FROM station s
       JOIN v_station_status st ON st.station_id = s.id
       JOIN v_station_area sa ON sa.station_id = s.id
       JOIN v_station_line_class lc ON lc.station_id = s.id
       JOIN v_station_review rv ON rv.station_id = s.id
       LEFT JOIN v_unopened_target ut ON ut.entity_type = 'station' AND ut.entity_id = s.id
      WHERE s.id = $1 AND s.deleted_at IS NULL`,
    [id],
  );
  const stn = rows[0];
  if (!stn) return null;
  const [lines, services, timetables, plans, centers] = await Promise.all([
    db.query<Row & { line_station_id: string }>(
      `SELECT v.line_station_id, v.line_id, l.name_ko AS line_name_ko, l.color AS line_color, v.rail_class, v.seq, v.branch,
              v.km::float8 AS km, v.station_code, v.name_ko, v.name_en, v.status, ${fz('v.opened')} AS opened, ${fz('v.closed')} AS closed,
              CASE WHEN o.id IS NULL THEN NULL ELSE json_build_object('id', o.id, 'name_ko', o.name_ko) END AS operator,
              coalesce((SELECT json_agg(json_build_object('id', n.station_id, 'name_ko', n.name_ko) ORDER BY n.seq DESC)
                          FROM (SELECT * FROM v_station_line n WHERE n.line_id = v.line_id AND n.seq < v.seq
                                   AND n.branch IS NOT DISTINCT FROM v.branch ORDER BY n.seq DESC LIMIT 1) n), '[]'::json) AS prev,
              coalesce((SELECT json_agg(json_build_object('id', n.station_id, 'name_ko', n.name_ko) ORDER BY n.seq)
                          FROM (SELECT * FROM v_station_line n WHERE n.line_id = v.line_id AND n.seq > v.seq
                                   AND n.branch IS NOT DISTINCT FROM v.branch ORDER BY n.seq LIMIT 1) n), '[]'::json) AS next
         FROM v_station_line v JOIN line l ON l.id = v.line_id
         LEFT JOIN operator o ON o.id = v.operator_id AND o.deleted_at IS NULL
        WHERE v.station_id = $1 ORDER BY l.rail_class, v.line_id, v.seq`,
      [id],
    ),
    db.query(
      `SELECT sv.id, sv.name_ko, sv.kind, bool_and(ss.assumed) AS assumed
         FROM v_station_service ss JOIN service sv ON sv.id = ss.service_id
        WHERE ss.station_id = $1 GROUP BY sv.id, sv.name_ko, sv.kind ORDER BY sv.kind, sv.id`,
      [id],
    ),
    db.query<Row & { day_note: string | null; set_id: string; source_id: string | null }>(
      `SELECT ts.set_id, x.line_id, ts.service_id, ts.route_code, ts.day_type, ts.direction, ts.direction_label, s.day_note,
              ts.data_as_of, s.source_id, ts.first_minute, ts.last_minute, ts.count, ts.by_hour
         FROM v_timetable_summary ts JOIN timetable_set s ON s.id = ts.set_id
         LEFT JOIN line_station x ON x.id = ts.line_station_id AND x.deleted_at IS NULL
        WHERE ts.station_id = $1
        ORDER BY x.line_id NULLS LAST, ts.route_code NULLS LAST, ts.day_type, ts.direction, ts.set_id`,
      [id],
    ),
    db.query(
      `SELECT p.id AS plan_id, p.name_ko, ps.role, st.stage, ${TARGET_JSON('t', 'st.stage')} AS target_open
         FROM plan_station ps JOIN plan p ON p.id = ps.plan_id AND p.deleted_at IS NULL
         JOIN v_plan_stage st ON st.plan_id = p.id LEFT JOIN v_plan_target_open t ON t.plan_id = p.id
        WHERE ps.station_id = $1 ORDER BY t.date_from NULLS LAST, p.id`,
      [id],
    ),
    db.query(
      `SELECT c.id, c.name_ko, c.status FROM transfer_center_station tcs JOIN transfer_center c ON c.id = tcs.center_id AND c.deleted_at IS NULL
        WHERE tcs.station_id = $1 ORDER BY c.id`,
      [id],
    ),
  ]);
  const lsIds = lines.rows.map((r) => r.line_station_id);
  const [names, sources, attachments, events] = await Promise.all([
    namesOf(db, [id]),
    sourcesOf(db, [id, ...lsIds]),
    attachmentsOf(db, [id]),
    eventsOf(db, id),
  ]);
  const tts = timetables.rows.map((r) => ({ ...r, day_note: splitDayNote(r.day_note).shown }));
  return {
    ...(stn as unknown as PublicStationDetail),
    lines: lines.rows.map(({ line_station_id: _ls, ...r }) => r) as PublicStationDetail['lines'],
    services: services.rows as PublicStationDetail['services'],
    timetables: tts as PublicStationDetail['timetables'],
    plans: plans.rows as PublicStationDetail['plans'],
    transfer_centers: centers.rows as PublicStationDetail['transfer_centers'],
    events,
    names: names.get(id) ?? [],
    sources,
    attachments,
  };
}

// ------------------------------------------------------------------ 운행 계통

const SERVICE_COLS = `sv.id, sv.name_ko, sv.name_en, sv.name_full, sv.kind, sv.status, sv.color,
  (SELECT json_build_object('id', c.id, 'name_ko', c.name_ko) FROM train_class c WHERE c.id = sv.train_class_id AND c.deleted_at IS NULL) AS train_class,
  ${fz('sv.opened')} AS opened, ${fz('sv.closed')} AS closed, va.areas,
  coalesce((SELECT array_agg(sl.line_id ORDER BY sl.seq) FROM service_line sl JOIN line l ON l.id = sl.line_id AND l.deleted_at IS NULL
             WHERE sl.service_id = sv.id), '{}') AS line_ids,
  sv.review_status`;

export interface ServiceListQuery extends Page {
  kind?: string;
  status?: string;
  area?: string;
  line_id?: string;
  train_class_id?: string;
}

export async function publicServices(db: Queryable, q: ServiceListQuery) {
  const where: string[] = ['sv.deleted_at IS NULL'];
  const params: unknown[] = [];
  const p = (v: unknown) => `$${params.push(v)}`;
  if (q.kind) where.push(`sv.kind = ${p(q.kind)}`);
  if (q.status) where.push(`sv.status = ${p(q.status)}`);
  if (q.area) where.push(`${p(q.area)} = ANY (va.areas)`);
  if (q.train_class_id) where.push(`sv.train_class_id = ${p(q.train_class_id)}`);
  if (q.line_id)
    where.push(`EXISTS (SELECT 1 FROM service_line sl WHERE sl.service_id = sv.id AND sl.line_id = ${p(q.line_id)})`);
  const { rows } = await db.query(
    `SELECT ${SERVICE_COLS},
            (SELECT count(*)::int FROM v_station_service ss WHERE ss.service_id = sv.id) AS stop_count
       FROM service sv JOIN v_service_area va ON va.service_id = sv.id
      WHERE ${where.join(' AND ')} ORDER BY sv.kind, sv.id`,
    params,
  );
  return paginate(rows, q);
}

export async function publicService(db: Queryable, id: string): Promise<PublicServiceDetail | null> {
  const { rows } = await db.query<Row>(
    `SELECT ${SERVICE_COLS}, sv.name_hanja, sv.description,
            (SELECT json_build_object('id', x.id, 'name_ko', x.name_ko) FROM service x WHERE x.id = sv.successor_id AND x.deleted_at IS NULL) AS successor,
            NOT EXISTS (SELECT 1 FROM stop_pattern sp WHERE sp.service_id = sv.id) AS stops_assumed,
            ${REC_JSON('sv')} AS meta
       FROM service sv JOIN v_service_area va ON va.service_id = sv.id WHERE sv.id = $1 AND sv.deleted_at IS NULL`,
    [id],
  );
  const svc = rows[0];
  if (!svc) return null;
  const [lines, patterns, tnr] = await Promise.all([
    db.query(
      `SELECT l.id, l.name_ko, l.color, l.status FROM service_line sl JOIN line l ON l.id = sl.line_id AND l.deleted_at IS NULL
        WHERE sl.service_id = $1 ORDER BY sl.seq`,
      [id],
    ),
    db.query(
      `SELECT sp.code, sp.name_ko, sp.name_en, sp.type, sp.note,
              coalesce((SELECT json_agg(json_build_object('station_id', v.station_id, 'name_ko', v.name_ko, 'line_id', v.line_id,
                                                          'station_code', v.station_code) ORDER BY ps.seq)
                          FROM stop_pattern_stop ps JOIN v_station_line v ON v.line_station_id = ps.line_station_id
                         WHERE ps.pattern_id = sp.id), '[]'::json) AS stops
         FROM stop_pattern sp WHERE sp.service_id = $1 ORDER BY sp.seq`,
      [id],
    ),
    db.query(
      `SELECT r.id, r.code_prefix, r.range_from, r.range_to, r."group", r.route_text
         FROM train_number_range_service x JOIN train_number_range r ON r.id = x.range_id AND r.deleted_at IS NULL
        WHERE x.service_id = $1 ORDER BY r.range_from, r.id`,
      [id],
    ),
  ]);
  const [names, sources, attachments, events] = await Promise.all([
    namesOf(db, [id]),
    sourcesOf(db, [id]),
    attachmentsOf(db, [id]),
    eventsOf(db, id),
  ]);
  return {
    ...(svc as unknown as PublicServiceDetail),
    lines: lines.rows as PublicServiceDetail['lines'],
    stop_patterns: patterns.rows as PublicServiceDetail['stop_patterns'],
    train_number_ranges: tnr.rows as PublicServiceDetail['train_number_ranges'],
    events,
    names: names.get(id) ?? [],
    sources,
    attachments,
  };
}

// ------------------------------------------------------------------ 시간표

export async function publicTimetable(db: Queryable, stationId: string): Promise<PublicTimetable | null> {
  const st = await db.query<{ id: string; name_ko: string }>(
    `SELECT id, name_ko FROM station WHERE id = $1 AND deleted_at IS NULL`,
    [stationId],
  );
  if (!st.rows[0]) return null;
  const { rows } = await db.query<Row & { day_note: string | null; set_id: string; source_id: string | null }>(
    `SELECT s.id AS set_id, x.line_id, s.service_id, s.route_code, s.day_type, s.direction, s.direction_label, s.day_note,
            s.data_as_of, s.source_id,
            coalesce((SELECT json_agg(json_build_object('minute', e.minute, 'dest_name', e.dest_name, 'dest_station_id', e.dest_station_id,
                                                        'train_no', e.train_no, 'note', e.note) ORDER BY e.minute, e.ord)
                        FROM timetable_entry e WHERE e.set_id = s.id), '[]'::json) AS entries
       FROM timetable_set s LEFT JOIN line_station x ON x.id = s.line_station_id AND x.deleted_at IS NULL
      WHERE s.station_id = $1
      ORDER BY x.line_id NULLS LAST, s.route_code NULLS LAST, s.day_type, s.direction, s.id`,
    [stationId],
  );
  const sets = rows.map((r) => ({ ...r, day_note: splitDayNote(r.day_note).shown }));
  return { station: st.rows[0], sets: sets as PublicTimetable['sets'] };
}

/** 시설 상세(0035) */
export async function publicFacility(db: Queryable, id: string): Promise<PublicFacilityDetail | null> {
  const { rows } = await db.query<Row>(
    `SELECT f.id, f.name_ko, f.name_en, f.name_full, f.kind, f.functions, f.status, ${fz('f.opened')} AS opened, ${fz('f.closed')} AS closed,
            (SELECT json_build_object('id', o.id, 'name_ko', o.name_ko) FROM operator o WHERE o.id = f.operator_id AND o.deleted_at IS NULL) AS operator,
            (SELECT json_build_object('code', r.code, 'name_ko', r.name_ko, 'slug', r.slug) FROM ref_region r WHERE r.code = f.region_code) AS region,
            f.address,
            CASE WHEN f.geom IS NULL THEN NULL ELSE json_build_object('lat', round(ST_Y(f.geom::geometry)::numeric, 6)::float8,
                                                                       'lng', round(ST_X(f.geom::geometry)::numeric, 6)::float8) END AS coord,
            (f.coord_basis IS NOT NULL) AS approximate, f.description, f.review_status,
            coalesce((SELECT json_agg(json_build_object('id', l.id, 'name_ko', l.name_ko, 'color', l.color) ORDER BY fl.ord, l.id)
                        FROM facility_line fl JOIN line l ON l.id = fl.line_id AND l.deleted_at IS NULL
                       WHERE fl.facility_id = f.id AND fl.role = 'serves'), '[]'::json) AS served_lines,
            coalesce((SELECT json_agg(json_build_object('id', l.id, 'name_ko', l.name_ko, 'line_role', l.line_role) ORDER BY fl.ord, l.id)
                        FROM facility_line fl JOIN line l ON l.id = fl.line_id AND l.deleted_at IS NULL
                       WHERE fl.facility_id = f.id AND fl.role = 'connects'), '[]'::json) AS connecting_lines,
            ${REC_JSON('f')} AS meta
       FROM facility f WHERE f.id = $1 AND f.deleted_at IS NULL`,
    [id],
  );
  const f = rows[0];
  if (!f) return null;
  const [names, sources, attachments] = await Promise.all([
    namesOf(db, [id]),
    sourcesOf(db, [id]),
    attachmentsOf(db, [id]),
  ]);
  return { ...(f as unknown as PublicFacilityDetail), names: names.get(id) ?? [], sources, attachments };
}
