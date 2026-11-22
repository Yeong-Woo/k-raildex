/**
 * 공개 읽기 모델 — 홈·권역·개통 예정·폐선·연표·번호 체계·검색·출처·노선도·용어·피드·사이트맵(docs/04-api.md 5절)
 */
import type { PublicHome } from '@k-raildex/contracts';
import type { Queryable } from '../db';
import {
  attachmentsOf,
  DOC_JSON,
  DOC_PUBLIC,
  fz,
  namesOf,
  paginate,
  SOURCE_DOCS_JSON,
  sourcesOf,
  TARGET_JSON,
  URL_PATH_SQL,
  type Page,
} from './common';

type Row = Record<string, unknown>;

/** 공개 개체 종류(피드·최근 변경에 싣는 것) */
const PUBLIC_TYPES = [
  'line',
  'station',
  'service',
  'plan',
  'plan_program',
  'transfer_center',
  'glossary_term',
  'route_map',
  'train_class',
  'train_number_range',
  'rolling_stock_range',
  'event',
  'source',
];

// ------------------------------------------------------------------ 권역

export async function publicAreas(db: Queryable) {
  type C = { k: string; n: number };
  const q = (sql: string) => db.query<C>(sql).then((r) => new Map(r.rows.map((x) => [x.k, x.n])));
  const [areas, regions, lines, stations, services, plans, rStations, rLines, rPlans] = await Promise.all([
    db.query<{ code: string; name_ko: string; name_en: string | null }>(
      `SELECT code, name_ko, name_en FROM ref_area ORDER BY ord`,
    ),
    db.query<{ code: string; name_ko: string; short_ko: string; slug: string; area_code: string }>(
      `SELECT code, name_ko, short_ko, slug, area_code FROM ref_region ORDER BY ord`,
    ),
    q(`SELECT a AS k, count(*)::int AS n FROM v_line_area, unnest(areas) a GROUP BY a`),
    q(`SELECT a AS k, count(*)::int AS n FROM station s JOIN v_station_area sa ON sa.station_id = s.id, unnest(sa.areas) a
        WHERE s.deleted_at IS NULL AND s.kind = 'station' GROUP BY a`),
    q(`SELECT a AS k, count(*)::int AS n FROM v_service_area, unnest(areas) a GROUP BY a`),
    q(`SELECT a AS k, count(*)::int AS n FROM v_plan_area, unnest(areas) a GROUP BY a`),
    q(
      `SELECT region_code AS k, count(*)::int AS n FROM station WHERE deleted_at IS NULL AND kind = 'station' GROUP BY 1`,
    ),
    q(
      `SELECT lr.region_code AS k, count(*)::int AS n FROM line_region lr JOIN line l ON l.id = lr.line_id AND l.deleted_at IS NULL GROUP BY 1`,
    ),
    q(
      `SELECT pr.region_code AS k, count(*)::int AS n FROM plan_region pr JOIN plan p ON p.id = pr.plan_id AND p.deleted_at IS NULL GROUP BY 1`,
    ),
  ]);
  return {
    items: areas.rows.map((a) => ({
      ...a,
      lines: lines.get(a.code) ?? 0,
      stations: stations.get(a.code) ?? 0,
      services: services.get(a.code) ?? 0,
      plans: plans.get(a.code) ?? 0,
      regions: regions.rows
        .filter((r) => r.area_code === a.code)
        .map((r) => ({
          ...r,
          stations: rStations.get(r.code) ?? 0,
          lines: rLines.get(r.code) ?? 0,
          plans: rPlans.get(r.code) ?? 0,
        })),
    })),
  };
}

// ------------------------------------------------------------------ 최근 변경(홈·Atom 피드)

/**
 * 데이터 판(data_version) 단위 변경. 변경 묶음의 제목·사유는 내부 작성 문구라 싣지 않고(개체 이름으로 표시),
 * 공개 개체(삭제 안 됨)만 최대 20개를 이름과 함께 보인다.
 */
export async function recentChanges(db: Queryable, limit = 20) {
  const { rows } = await db.query(
    `SELECT dv.version::int AS version, to_json(dv.committed_at) #>> '{}' AS committed_at,
            (SELECT count(*)::int FROM entity e WHERE e.id = ANY (dv.entity_ids) AND e.deleted_at IS NULL
                AND e.type = ANY ($2::text[])) AS entity_count,
            coalesce((SELECT json_agg(x ORDER BY x.type, x.id) FROM (
                SELECT e.id, e.type, ${NAME_SQL} AS name_ko, ${URL_PATH_SQL('e.type', 'e.id')} AS url_path
                  FROM entity e WHERE e.id = ANY (dv.entity_ids) AND e.deleted_at IS NULL AND e.type = ANY ($2::text[])
                 ORDER BY e.type, e.id LIMIT 20) x), '[]'::json) AS entities
       FROM data_version dv
      WHERE EXISTS (SELECT 1 FROM entity e WHERE e.id = ANY (dv.entity_ids) AND e.deleted_at IS NULL AND e.type = ANY ($2::text[]))
      ORDER BY dv.version DESC LIMIT $1`,
    [limit, PUBLIC_TYPES],
  );
  return rows as PublicHome['recent_changes'];
}

/** 개체 대표 이름(별칭 e = entity) */
const NAME_SQL = `coalesce(
  (SELECT name_ko FROM line WHERE id = e.id), (SELECT name_ko FROM station WHERE id = e.id),
  (SELECT name_ko FROM service WHERE id = e.id), (SELECT name_ko FROM plan WHERE id = e.id),
  (SELECT name_ko FROM plan_program WHERE id = e.id), (SELECT name_ko FROM transfer_center WHERE id = e.id),
  (SELECT term_ko FROM glossary_term WHERE id = e.id), (SELECT title_ko FROM route_map WHERE id = e.id),
  (SELECT name_ko FROM train_class WHERE id = e.id), (SELECT title FROM event WHERE id = e.id),
  (SELECT title FROM source WHERE id = e.id),
  (SELECT coalesce(code_prefix, '') || range_from || '~' || range_to FROM train_number_range WHERE id = e.id),
  (SELECT series FROM rolling_stock_range WHERE id = e.id), e.id)`;

// ------------------------------------------------------------------ 홈

const UPCOMING_PLAN_SQL = `
SELECT p.id, p.name_ko, st.stage, ${TARGET_JSON('t', 'st.stage')} AS target_open, pa.areas
  FROM plan p JOIN v_plan_stage st ON st.plan_id = p.id JOIN v_plan_area pa ON pa.plan_id = p.id
  JOIN v_plan_target_open t ON t.plan_id = p.id
 WHERE p.deleted_at IS NULL AND st.stage IS NOT NULL AND st.stage NOT IN ('opened', 'abandoned', 'dormant')
 ORDER BY t.date_from NULLS LAST, p.id`;

export async function publicHome(db: Queryable, version: number): Promise<PublicHome> {
  const counts = async (sql: string) => {
    const { rows } = await db.query<{ k: string; n: number }>(sql);
    return Object.fromEntries(rows.map((r) => [r.k ?? 'unknown', r.n])) as Record<string, number>;
  };
  const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
  const [lines, stations, services, stages, single, areas, upcoming, recent] = await Promise.all([
    counts(`SELECT status AS k, count(*)::int AS n FROM line WHERE deleted_at IS NULL GROUP BY 1`),
    counts(`SELECT st.status AS k, count(*)::int AS n FROM station s JOIN v_station_status st ON st.station_id = s.id
             WHERE s.deleted_at IS NULL AND s.kind = 'station' GROUP BY 1`),
    counts(`SELECT kind AS k, count(*)::int AS n FROM service WHERE deleted_at IS NULL GROUP BY 1`),
    counts(`SELECT coalesce(stage, 'unknown') AS k, count(*)::int AS n FROM v_plan_stage GROUP BY 1`),
    db.query<Record<string, number>>(
      `SELECT (SELECT count(*)::int FROM plan_program WHERE deleted_at IS NULL) AS plan_programs,
              (SELECT count(*)::int FROM transfer_center WHERE deleted_at IS NULL) AS transfer_centers,
              (SELECT count(*)::int FROM v_event_all) AS events,
              (SELECT count(*)::int FROM glossary_term WHERE deleted_at IS NULL) AS glossary_terms,
              (SELECT count(*)::int FROM source WHERE deleted_at IS NULL) AS sources`,
    ),
    publicAreas(db),
    db.query(`${UPCOMING_PLAN_SQL} LIMIT 12`),
    recentChanges(db, 10),
  ]);
  const active = Object.entries(stages)
    .filter(([k]) => !['opened', 'abandoned', 'dormant', 'unknown'].includes(k))
    .reduce((a, [, n]) => a + n, 0);
  const s = single.rows[0]!;
  return {
    data_version: version,
    stats: {
      lines: { total: sum(lines), by_status: lines },
      stations: { total: sum(stations), by_status: stations },
      services: { total: sum(services), by_kind: services },
      plans: { total: sum(stages), active, by_stage: stages },
      plan_programs: s.plan_programs!,
      transfer_centers: s.transfer_centers!,
      events: s.events!,
      glossary_terms: s.glossary_terms!,
      sources: s.sources!,
    },
    areas: areas.items as PublicHome['areas'],
    upcoming: upcoming.rows as PublicHome['upcoming'],
    recent_changes: recent,
  };
}

// ------------------------------------------------------------------ 개통 예정·폐선

export async function publicUpcoming(db: Queryable, q: { area?: string }) {
  const params: unknown[] = [];
  const area = q.area ? `$${params.push(q.area)}` : null;
  const [lines, stations, plans] = await Promise.all([
    db.query(
      `SELECT l.id, l.name_ko, l.status, ${UNOPENED('u')} AS target_open, la.areas,
              coalesce((SELECT array_agg(pl.plan_id ORDER BY pl.plan_id) FROM plan_line pl JOIN plan p ON p.id = pl.plan_id AND p.deleted_at IS NULL
                         WHERE pl.line_id = l.id AND pl.role IN ('new', 'extends')), '{}') AS plan_ids
         FROM v_unopened_target u JOIN line l ON l.id = u.entity_id JOIN v_line_area la ON la.line_id = l.id
        WHERE u.entity_type = 'line' ${area ? `AND ${area} = ANY (la.areas)` : ''}
        ORDER BY fuzzy_from(u.value, u.precision) NULLS LAST, l.id`,
      params,
    ),
    db.query(
      `SELECT s.id, s.name_ko, st.status, ${UNOPENED('u')} AS target_open, sa.areas,
              coalesce((SELECT array_agg(ps.plan_id ORDER BY ps.plan_id) FROM plan_station ps JOIN plan p ON p.id = ps.plan_id AND p.deleted_at IS NULL
                         WHERE ps.station_id = s.id), '{}') AS plan_ids
         FROM v_unopened_target u JOIN station s ON s.id = u.entity_id AND s.kind = 'station'
         JOIN v_station_status st ON st.station_id = s.id JOIN v_station_area sa ON sa.station_id = s.id
        WHERE u.entity_type = 'station' ${area ? `AND ${area} = ANY (sa.areas)` : ''}
        ORDER BY fuzzy_from(u.value, u.precision) NULLS LAST, s.name_ko, s.id`,
      params,
    ),
    db.query(
      area ? UPCOMING_PLAN_SQL.replace('ORDER BY', `AND ${area} = ANY (pa.areas) ORDER BY`) : UPCOMING_PLAN_SQL,
      params,
    ),
  ]);
  return { lines: lines.rows, stations: stations.rows, plans: plans.rows };
}

const UNOPENED = (u: string): string =>
  `CASE WHEN ${u}.precision IS NULL THEN NULL ELSE json_build_object('value', ${u}.value, 'precision', ${u}.precision) END`;

export async function publicClosed(db: Queryable) {
  const [lines, stations, services] = await Promise.all([
    db.query(
      `SELECT l.id, l.name_ko, ${fz('l.opened')} AS opened, ${fz('l.closed')} AS closed, la.areas
         FROM line l JOIN v_line_area la ON la.line_id = l.id WHERE l.deleted_at IS NULL AND l.status = 'closed'
        ORDER BY l.closed_from DESC NULLS LAST, l.id`,
    ),
    db.query(
      `SELECT s.id, s.name_ko, ${fz('st.opened')} AS opened, ${fz('st.closed')} AS closed, sa.areas
         FROM station s JOIN v_station_status st ON st.station_id = s.id JOIN v_station_area sa ON sa.station_id = s.id
        WHERE s.deleted_at IS NULL AND s.kind = 'station' AND st.status = 'closed'
        ORDER BY fuzzy_to(st.closed_value, st.closed_precision) DESC NULLS LAST, s.name_ko, s.id`,
    ),
    db.query(
      `SELECT sv.id, sv.name_ko, ${fz('sv.opened')} AS opened, ${fz('sv.closed')} AS closed, va.areas
         FROM service sv JOIN v_service_area va ON va.service_id = sv.id WHERE sv.deleted_at IS NULL AND sv.status = 'closed'
        ORDER BY sv.closed_from DESC NULLS LAST, sv.id`,
    ),
  ]);
  return { lines: lines.rows, stations: stations.rows, services: services.rows };
}

// ------------------------------------------------------------------ 연표

export interface TimelineQuery extends Page {
  decade?: number;
  year?: number;
  type?: string;
  /** 대상 개체 id */
  target?: string;
  area?: string;
  /** 파생 이벤트 포함(기본 true) */
  include_derived?: boolean;
  /** true = 날짜 미상 사건만, false = 날짜 있는 사건만(Q117 A) */
  undated?: boolean;
}

export async function publicTimeline(db: Queryable, q: TimelineQuery) {
  const where: string[] = ['true'];
  const params: unknown[] = [];
  const p = (v: unknown) => `$${params.push(v)}`;
  if (q.decade !== undefined) where.push(`(extract(year FROM x.d)::int / 10) * 10 = ${p(q.decade)}`);
  if (q.year !== undefined) where.push(`extract(year FROM x.d)::int = ${p(q.year)}`);
  if (q.type) where.push(`x.type = ${p(q.type)}`);
  if (q.target) where.push(`${p(q.target)} = ANY (x.targets)`);
  if (q.include_derived === false) where.push(`NOT x.derived`);
  if (q.undated === true) where.push(`x.d IS NULL`);
  if (q.undated === false) where.push(`x.d IS NOT NULL`);
  let areaCte = '';
  if (q.area) {
    // 권역: 수기 이벤트는 event_area, 그 밖은 대상 노선·역·계획·운행 계통의 권역
    const a = p(q.area);
    areaCte = `, hit AS (
        SELECT coalesce(array_agg(id), '{}') AS ids FROM (
          SELECT line_id AS id FROM v_line_area WHERE ${a} = ANY (areas)
          UNION ALL SELECT station_id FROM v_station_area WHERE ${a} = ANY (areas)
          UNION ALL SELECT plan_id FROM v_plan_area WHERE ${a} = ANY (areas)
          UNION ALL SELECT service_id FROM v_service_area WHERE ${a} = ANY (areas)) h)`;
    where.push(`(EXISTS (SELECT 1 FROM event_area ea WHERE ea.event_id = x.id AND ea.area_code = ${a})
                 OR x.targets && (SELECT ids FROM hit))`);
  }
  const base = `SELECT e.*, fuzzy_from(e.date_value, e.date_precision) AS d FROM v_event_all e`;
  const [items, decades] = await Promise.all([
    db.query<Row & { total: number }>(
      `WITH x AS (${base})${areaCte}
       SELECT x.id, x.type, ${fz('x.date')} AS date, x.title, x.note, x.derived, x.targets, count(*) OVER ()::int AS total
         FROM x WHERE ${where.join(' AND ')}
        ORDER BY x.d NULLS LAST, x.date_precision, x.id LIMIT ${p(q.limit)} OFFSET ${p(q.offset)}`,
      params,
    ),
    db.query<{ decade: number; count: number }>(
      `SELECT (extract(year FROM x.d)::int / 10) * 10 AS decade, count(*)::int AS count FROM (${base}) x
        WHERE x.d IS NOT NULL GROUP BY 1 ORDER BY 1`,
    ),
  ]);
  const total = items.rows[0]?.total ?? 0;
  return {
    items: items.rows.map(({ total: _t, ...r }) => r),
    total,
    limit: q.limit,
    offset: q.offset,
    decades: decades.rows,
  };
}

// ------------------------------------------------------------------ 번호 체계

const TNR_SQL = `
SELECT r.id, json_build_object('id', o.id, 'name_ko', o.name_ko) AS operator, r.code_prefix, r.range_from, r.range_to, r."group",
       (SELECT json_build_object('id', c.id, 'name_ko', c.name_ko) FROM train_class c WHERE c.id = r.train_class_id AND c.deleted_at IS NULL) AS train_class,
       r.route_text, r.parity_rule, ${fz('r.valid_from')} AS valid_from, ${fz('r.valid_to')} AS valid_to, r.note,
       coalesce((SELECT array_agg(x.line_id ORDER BY x.line_id) FROM train_number_range_line x JOIN line l ON l.id = x.line_id AND l.deleted_at IS NULL
                  WHERE x.range_id = r.id), '{}') AS line_ids,
       coalesce((SELECT array_agg(x.service_id ORDER BY x.service_id) FROM train_number_range_service x JOIN service s ON s.id = x.service_id
                  AND s.deleted_at IS NULL WHERE x.range_id = r.id), '{}') AS service_ids,
       r.checked_at::text AS checked_at
  FROM train_number_range r JOIN operator o ON o.id = r.operator_id
 WHERE r.deleted_at IS NULL`;

const RSR_SQL = `
SELECT r.id, json_build_object('id', o.id, 'name_ko', o.name_ko) AS operator, r.series, r.number_prefix, r.number_from, r.number_to,
       r.digits, r."group", r.model,
       (SELECT json_build_object('id', c.id, 'name_ko', c.name_ko) FROM train_class c WHERE c.id = r.train_class_id AND c.deleted_at IS NULL) AS train_class,
       r.number_rule, r.status, ${fz('r.introduced')} AS introduced, ${fz('r.retired')} AS retired, r.owner_note,
       json_build_object('label', r.formation_label, 'from', r.formation_from, 'to', r.formation_to, 'count', r.formation_count,
                         'cars', r.formation_cars, 'code_prefix', r.formation_code_prefix, 'note', r.formation_note) AS formation,
       r.note,
       coalesce((SELECT array_agg(x.line_id ORDER BY x.line_id) FROM rolling_stock_range_line x JOIN line l ON l.id = x.line_id AND l.deleted_at IS NULL
                  WHERE x.range_id = r.id), '{}') AS line_ids,
       coalesce((SELECT array_agg(x.service_id ORDER BY x.service_id) FROM rolling_stock_range_service x JOIN service s ON s.id = x.service_id
                  AND s.deleted_at IS NULL WHERE x.range_id = r.id), '{}') AS service_ids,
       r.checked_at::text AS checked_at
  FROM rolling_stock_range r JOIN operator o ON o.id = r.operator_id
 WHERE r.deleted_at IS NULL`;

async function withSources<T extends { id: string }>(db: Queryable, rows: T[]) {
  const all = await sourcesOf(
    db,
    rows.map((r) => r.id),
  );
  const by = new Map<string, typeof all>();
  for (const s of all) by.set(s.entity_id, [...(by.get(s.entity_id) ?? []), s]);
  return rows.map((r) => ({ ...r, sources: by.get(r.id) ?? [] }));
}

export async function publicTrains(db: Queryable) {
  const [tnr, rsr] = await Promise.all([
    db.query<Row & { id: string }>(`${TNR_SQL} ORDER BY o.id, r.range_from, r.id`),
    db.query<Row & { id: string }>(`${RSR_SQL} ORDER BY o.id, r.number_from, r.id`),
  ]);
  return {
    train_number_ranges: await withSources(db, tnr.rows),
    rolling_stock_ranges: await withSources(db, rsr.rows),
  };
}

/**
 * 번호 찾기(n = 숫자, 앞에 문자 접두가 있으면 접두로도 맞춘다). 열차번호대와 차량번호대를 따로 돌려준다(C-3).
 * 차량번호는 number_prefix + 숫자(digits 자리) 꼴이라 접두를 떼고 범위를 본다.
 */
export async function publicNumberSearch(db: Queryable, raw: string) {
  const m = /^\s*([^\d\s]*)\s*0*(\d{1,9})\s*$/.exec(raw);
  if (!m) return { n: raw, train_number_ranges: [], rolling_stock_ranges: [] };
  const prefix = m[1] ? m[1].toUpperCase() : null;
  const num = Number(m[2]);
  const [tnr, rsr] = await Promise.all([
    db.query<Row & { id: string }>(
      `${TNR_SQL} AND $1 BETWEEN r.range_from AND r.range_to AND ($2::text IS NULL OR upper(r.code_prefix) = $2)
        ORDER BY (r.range_to - r.range_from), r.id`,
      [num, prefix],
    ),
    db.query<Row & { id: string }>(
      `${RSR_SQL} AND $1 BETWEEN r.number_from AND r.number_to AND ($2::text IS NULL OR upper(r.number_prefix) = $2)
        ORDER BY (r.number_to - r.number_from), r.id`,
      [num, prefix],
    ),
  ]);
  return {
    n: raw,
    train_number_ranges: await withSources(db, tnr.rows),
    rolling_stock_ranges: await withSources(db, rsr.rows),
  };
}

export async function publicTrainClasses(db: Queryable) {
  const { rows } = await db.query<Row & { id: string }>(
    `SELECT c.id, c.name_ko, c.name_en, c.name_hanja, c.name_full, c.tier, c.status,
            (SELECT json_build_object('id', x.id, 'name_ko', x.name_ko) FROM train_class x WHERE x.id = c.successor_id AND x.deleted_at IS NULL) AS successor,
            c.max_speed_kmh, ${fz('c.started')} AS started, ${fz('c.ended')} AS ended, c.description,
            coalesce((SELECT json_agg(json_build_object('id', s.id, 'name_ko', s.name_ko) ORDER BY s.id) FROM service s
                       WHERE s.train_class_id = c.id AND s.deleted_at IS NULL), '[]'::json) AS services,
            c.checked_at::text AS checked_at, c.review_status
       FROM train_class c WHERE c.deleted_at IS NULL ORDER BY c.id`,
  );
  const names = await namesOf(
    db,
    rows.map((r) => r.id),
  );
  const items = await withSources(db, rows);
  return { items: items.map((r) => ({ ...r, names: names.get(r.id) ?? [] })) };
}

// ------------------------------------------------------------------ 검색(mv_search)

/**
 * 통합 검색: 이름·별칭·정식 명칭·영문·역번호·초성(03 문서 7절). 개체별로 가장 잘 맞는 이름 하나.
 * 내부 표기(alias_internal)·원문 이름(alias_source_raw)으로 맞으면 찾되 일치 이름은 보이지 않는다.
 */
export async function publicSearch(db: Queryable, q: { q: string; type?: string; area?: string; limit: number }) {
  const term = q.q.trim();
  if (!term) return { q: q.q, items: [], total: 0 };
  const { rows } = await db.query<Row & { total: number }>(
    `WITH m AS (
       SELECT s.entity_id, s.type, s.name, s.name_kind, s.code, s.area_codes, s.url_path,
              greatest(
                CASE WHEN lower(s.name) = lower($1) THEN 3 WHEN lower(s.name) LIKE lower($1) || '%' THEN 2
                     WHEN s.name ILIKE '%' || $1 || '%' THEN 1.2 ELSE similarity(s.name, $1) END,
                CASE WHEN s.code IS NOT NULL AND $1 = ANY (string_to_array(s.code, ' ')) THEN 3 ELSE 0 END,
                CASE WHEN $1 ~ '^[ㄱ-ㅎ]+$' AND s.chosung LIKE $1 || '%' THEN 2
                     WHEN $1 ~ '^[ㄱ-ㅎ]+$' AND s.chosung LIKE '%' || $1 || '%' THEN 1 ELSE 0 END
              ) + s.rank_boost / 100.0 AS score
         FROM mv_search s
        WHERE (s.name ILIKE '%' || $1 || '%' OR s.name % $1
               OR (s.code IS NOT NULL AND s.code ILIKE '%' || $1 || '%')
               OR ($1 ~ '^[ㄱ-ㅎ]+$' AND s.chosung LIKE '%' || $1 || '%'))
          AND ($2::text IS NULL OR s.type = $2) AND ($3::text IS NULL OR $3 = ANY (s.area_codes))
     ), best AS (
       SELECT DISTINCT ON (m.entity_id) m.* FROM m ORDER BY m.entity_id, m.score DESC, m.name_kind = 'name' DESC
     )
     SELECT b.entity_id AS id, b.type,
            coalesce((SELECT x.name FROM mv_search x WHERE x.entity_id = b.entity_id AND x.name_kind = 'name' LIMIT 1), b.name) AS name,
            CASE WHEN b.name_kind IN ('alias_internal', 'alias_source_raw') OR b.name_kind = 'name' THEN NULL ELSE b.name END AS matched,
            CASE WHEN b.name_kind IN ('alias_internal', 'alias_source_raw') OR b.name_kind = 'name' THEN NULL ELSE b.name_kind END AS matched_kind,
            (SELECT x.code FROM mv_search x WHERE x.entity_id = b.entity_id AND x.code IS NOT NULL LIMIT 1) AS station_codes,
            b.area_codes AS areas, b.url_path, round(b.score::numeric, 3)::float8 AS score, count(*) OVER ()::int AS total
       FROM best b ORDER BY b.score DESC, b.name, b.entity_id LIMIT $4`,
    [term, q.type ?? null, q.area ?? null, q.limit],
  );
  return { q: q.q, items: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0 };
}

// ------------------------------------------------------------------ 출처·노선도·용어

export async function publicSources(db: Queryable, q: Page & { type?: string; q?: string; with_documents?: boolean }) {
  const params: unknown[] = [];
  const where = ['s.deleted_at IS NULL'];
  if (q.type) where.push(`s.type = $${params.push(q.type)}`);
  if (q.q)
    where.push(
      `(s.title ILIKE $${params.push(`%${q.q}%`)} OR s.publisher ILIKE $${params.length} OR s.id = $${params.push(q.q)})`,
    );
  if (q.with_documents)
    where.push(
      `EXISTS (SELECT 1 FROM source_document sd JOIN document d ON d.id = sd.document_id WHERE sd.source_id = s.id AND ${DOC_PUBLIC})`,
    );
  const { rows } = await db.query(
    `SELECT s.id, s.title, s.publisher, s.type, s.url, s.license, s.license_class, s.attribution, ${fz('s.published')} AS published,
            s.published_raw, s.data_as_of, s.retrieved_at::text AS retrieved_at, s.notice_number, s.checked_at::text AS checked_at,
            coalesce(u.n, 0) AS used_by,
            ${SOURCE_DOCS_JSON} AS documents
       FROM source s
       LEFT JOIN (SELECT rs.source_id, count(*)::int AS n FROM record_source rs JOIN entity e ON e.id = rs.entity_id AND e.deleted_at IS NULL
                   GROUP BY rs.source_id) u ON u.source_id = s.id
      WHERE ${where.join(' AND ')} ORDER BY s.publisher, s.id`,
    params,
  );
  return paginate(rows, q);
}

export async function publicRouteMaps(db: Queryable) {
  const { rows } = await db.query<Row & { id: string }>(
    `SELECT m.id, m.title_ko, m.title_en, m.publisher, m.region, m.mode, m.url, m.license, m.attribution, m.as_of, m.width, m.height,
            (SELECT ${DOC_JSON} FROM document d WHERE d.id = m.document_id AND ${DOC_PUBLIC}) AS document,
            m.checked_at::text AS checked_at
       FROM route_map m WHERE m.deleted_at IS NULL ORDER BY m.id`,
  );
  const ids = rows.map((r) => r.id);
  const [withSrc, atts] = await Promise.all([withSources(db, rows), attachmentsOf(db, ids)]);
  return { items: withSrc.map((r) => ({ ...r, attachments: atts.filter((a) => a.entity_id === r.id) })) };
}

export async function publicTerms(db: Queryable) {
  const { rows } = await db.query<Row & { id: string }>(
    `SELECT g.id, g.term_ko, g.term_en, g.section, g.definition, g.basis, g.example, g.caution, g.checked_at::text AS checked_at
       FROM glossary_term g WHERE g.deleted_at IS NULL ORDER BY g.ord, g.id`,
  );
  const names = await namesOf(
    db,
    rows.map((r) => r.id),
  );
  const items = await withSources(db, rows);
  return { items: items.map((r) => ({ ...r, names: names.get(r.id) ?? [] })) };
}

// ------------------------------------------------------------------ 피드·사이트맵

export async function publicFeed(db: Queryable, limit: number) {
  return { items: await recentChanges(db, limit) };
}

/** 공개 사이트 경로와 마지막 갱신일(사이트맵). 고정 페이지 + 상세 페이지 + 시·도별 역 목록 */
export async function publicSitemap(db: Queryable) {
  const { rows } = await db.query<{ path: string; lastmod: string | null }>(
    `SELECT path, lastmod::text FROM (
       SELECT '/lines/' || id || '/' AS path, updated_at::date AS lastmod, 1 AS g, id FROM line WHERE deleted_at IS NULL
       UNION ALL SELECT '/stations/' || id || '/', updated_at::date, 2, id FROM station WHERE deleted_at IS NULL AND kind = 'station'
       UNION ALL SELECT '/services/' || id || '/', updated_at::date, 3, id FROM service WHERE deleted_at IS NULL
       UNION ALL SELECT '/plans/' || id || '/', updated_at::date, 4, id FROM plan WHERE deleted_at IS NULL
       UNION ALL SELECT '/transfer-centers/' || id || '/', updated_at::date, 5, id FROM transfer_center WHERE deleted_at IS NULL
       UNION ALL SELECT '/stations/region/' || slug || '/', NULL, 6, slug FROM ref_region
     ) x ORDER BY g, id`,
  );
  const fixed = [
    '/',
    '/lines/',
    '/stations/',
    '/services/',
    '/plans/',
    '/plans/programs/',
    '/map/',
    '/upcoming/',
    '/closed/',
    '/timeline/',
    '/trains/',
    '/train-classes/',
    '/transfer-centers/',
    '/maps/',
    '/terms/',
    '/sources/',
    '/about/',
  ].map((path) => ({ path, lastmod: null }));
  const items = [...fixed, ...rows];
  return { items, total: items.length };
}

// ------------------------------------------------------------------ 원문(공개 다운로드)

export interface PublicDocumentRow {
  id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  kind: string;
  license_class: string;
  notice: string | null;
  download_path: string;
  storage_key: string;
  sha256: string;
  page: number | null;
  source_ids: string[];
}

/** 공개 가능한 원문(Q39·Q75 A). 아니면 null(→ 404) */
export async function publicDocument(db: Queryable, id: string): Promise<PublicDocumentRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await db.query<
    { j: Omit<PublicDocumentRow, 'storage_key' | 'sha256' | 'page' | 'source_ids'> } & Row
  >(
    `SELECT ${DOC_JSON} AS j, d.storage_key, d.sha256, d.page,
            coalesce((SELECT array_agg(sd.source_id ORDER BY sd.source_id) FROM source_document sd JOIN source s ON s.id = sd.source_id
                       AND s.deleted_at IS NULL WHERE sd.document_id = coalesce(d.parent_document_id, d.id)), '{}') AS source_ids
       FROM document d WHERE d.id = $1 AND ${DOC_PUBLIC}`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    ...r.j,
    storage_key: r.storage_key as string,
    sha256: r.sha256 as string,
    page: r.page as number | null,
    source_ids: r.source_ids as string[],
  };
}
