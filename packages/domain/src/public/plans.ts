/**
 * 공개 읽기 모델 — 계획 사업·상위 계획·환승센터(docs/04-api.md 5절).
 * 현재 단계·개통 목표·권역은 뷰(v_plan_stage·v_plan_target_open·v_plan_area). 감시 키워드(plan_watch_keyword)는 내부용이라 싣지 않는다.
 */
import type { PublicPlanDetail, PublicPlanListItem, PublicTransferCenterDetail } from '@k-raildex/contracts';
import type { Queryable } from '../db';
import {
  attachmentsOf,
  eventsOf,
  fz,
  namesOf,
  paginate,
  REC_JSON,
  sourcesOf,
  TARGET_JSON,
  withChildSources,
  type Page,
} from './common';

type Row = Record<string, unknown>;

const PLAN_COLS = `p.id, p.name_ko, p.name_en, p.name_full, p.scope, st.stage, plan_stage_progress(st.stage) AS stage_progress,
  ${TARGET_JSON('t', 'st.stage')} AS target_open, ${fz('p.opened')} AS opened, pa.areas,
  coalesce((SELECT array_agg(pr.region_code ORDER BY pr.region_code) FROM plan_region pr WHERE pr.plan_id = p.id), '{}') AS regions,
  p.is_national, p.color, p.review_status`;

const PLAN_FROM = `FROM plan p JOIN v_plan_stage st ON st.plan_id = p.id JOIN v_plan_area pa ON pa.plan_id = p.id
  LEFT JOIN v_plan_target_open t ON t.plan_id = p.id`;

const PLAN_LIST_EXTRA = `
  coalesce((SELECT json_agg(json_build_object('program_id', f.program_id, 'program_short', pg.short, 'class', f.class,
                                              'category', f.category, 'section', f.section) ORDER BY f.seq)
              FROM plan_ref f JOIN plan_program pg ON pg.id = f.program_id AND pg.deleted_at IS NULL WHERE f.plan_id = p.id), '[]'::json) AS refs,
  coalesce((SELECT json_agg(json_build_object('line_id', pl.line_id, 'role', pl.role) ORDER BY pl.line_id)
              FROM plan_line pl JOIN line l ON l.id = pl.line_id AND l.deleted_at IS NULL WHERE pl.plan_id = p.id), '[]'::json) AS lines,
  (SELECT count(*)::int FROM plan_station ps JOIN station s ON s.id = ps.station_id AND s.deleted_at IS NULL WHERE ps.plan_id = p.id) AS station_count`;

export interface PlanListQuery extends Page {
  program_id?: string;
  stage?: string;
  /** active = 개통·폐기·휴면 아님, opened, abandoned, dormant */
  state?: 'active' | 'opened' | 'abandoned' | 'dormant';
  /** 이 단계 이상(진행도) */
  stage_min?: string;
  area?: string;
  region?: string;
  scope?: string;
  ref_class?: string;
  category?: string;
  line_id?: string;
  station_id?: string;
  has_target?: boolean;
  q?: string;
}

export async function publicPlans(db: Queryable, q: PlanListQuery) {
  const { where, params } = planWhere(q);
  const { rows } = await db.query<PublicPlanListItem>(
    `SELECT ${PLAN_COLS}, ${PLAN_LIST_EXTRA} ${PLAN_FROM} WHERE ${where.join(' AND ')}
      ORDER BY plan_stage_progress(st.stage) DESC, t.date_from NULLS LAST, p.id`,
    params,
  );
  return paginate(rows, q);
}

function planWhere(q: PlanListQuery): { where: string[]; params: unknown[] } {
  const where: string[] = ['p.deleted_at IS NULL'];
  const params: unknown[] = [];
  const p = (v: unknown) => `$${params.push(v)}`;
  if (q.program_id)
    where.push(`EXISTS (SELECT 1 FROM plan_ref f WHERE f.plan_id = p.id AND f.program_id = ${p(q.program_id)})`);
  if (q.ref_class)
    where.push(`EXISTS (SELECT 1 FROM plan_ref f WHERE f.plan_id = p.id AND f.class = ${p(q.ref_class)})`);
  if (q.category)
    where.push(`EXISTS (SELECT 1 FROM plan_ref f WHERE f.plan_id = p.id AND f.category = ${p(q.category)})`);
  if (q.stage) where.push(`st.stage = ${p(q.stage)}`);
  if (q.stage_min) where.push(`plan_stage_progress(st.stage) >= plan_stage_progress(${p(q.stage_min)})`);
  if (q.state === 'active') where.push(`st.stage IS NOT NULL AND st.stage NOT IN ('opened', 'abandoned', 'dormant')`);
  else if (q.state) where.push(`st.stage = ${p(q.state)}`);
  if (q.area) where.push(`${p(q.area)} = ANY (pa.areas)`);
  if (q.region) {
    const r = p(q.region);
    where.push(`EXISTS (SELECT 1 FROM plan_region pr JOIN ref_region rr ON rr.code = pr.region_code
                         WHERE pr.plan_id = p.id AND (rr.code = ${r} OR rr.slug = ${r}))`);
  }
  if (q.scope) where.push(`p.scope = ${p(q.scope)}`);
  if (q.line_id)
    where.push(`EXISTS (SELECT 1 FROM plan_line pl WHERE pl.plan_id = p.id AND pl.line_id = ${p(q.line_id)})`);
  if (q.station_id)
    where.push(`EXISTS (SELECT 1 FROM plan_station ps WHERE ps.plan_id = p.id AND ps.station_id = ${p(q.station_id)})`);
  if (q.has_target !== undefined) where.push(q.has_target ? `t.plan_id IS NOT NULL` : `t.plan_id IS NULL`);
  if (q.q) {
    const like = p(`%${q.q}%`);
    where.push(`(p.name_ko ILIKE ${like} OR p.name_full ILIKE ${like}
                 OR EXISTS (SELECT 1 FROM plan_ref f WHERE f.plan_id = p.id AND f.section ILIKE ${like}))`);
  }
  return { where, params };
}

export async function publicPlan(db: Queryable, id: string): Promise<PublicPlanDetail | null> {
  const { rows } = await db.query<Row>(
    `SELECT ${PLAN_COLS}, p.description, p.operator_text,
            (SELECT json_build_object('quality', sh.quality, 'odbl', sh.odbl) FROM v_plan_shape sh WHERE sh.plan_id = p.id) AS shape,
            ${REC_JSON('p')} AS meta
       ${PLAN_FROM} WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [id],
  );
  const plan = rows[0] as (Row & { target_open: { value: string | null } | null }) | undefined;
  if (!plan) return null;
  const [events, milestones, refs, lines, stations, relations, centers] = await Promise.all([
    db.query<Row & { source_id: string | null }>(
      `SELECT e.stage, e.kind, ${fz('e.date')} AS date, e.note, e.source_id FROM plan_stage_event e
        WHERE e.plan_id = $1 ORDER BY e.date_from NULLS LAST, plan_stage_progress(e.stage), e.id`,
      [id],
    ),
    db.query<Row & { source_id: string | null }>(
      `SELECT m.stage, ${fz('m.expected')} AS expected, m.basis, ${fz('m.as_of')} AS as_of, m.source_id, m.note
         FROM plan_milestone m WHERE m.plan_id = $1 ORDER BY m.stage, m.as_of_from DESC NULLS LAST, m.id DESC`,
      [id],
    ),
    db.query<Row & { source_id: string | null }>(
      `SELECT f.program_id, pg.short AS program_short, pg.name_ko AS program_name_ko, f.class, f.category, f.section,
              f.edition, f.timing, f.content, f.length_km::float8 AS length_km, f.cost_100m_krw::float8 AS cost_100m_krw,
              f.task_group, f.source_id, f.locator
         FROM plan_ref f JOIN plan_program pg ON pg.id = f.program_id AND pg.deleted_at IS NULL
        WHERE f.plan_id = $1 ORDER BY f.seq`,
      [id],
    ),
    db.query(
      `SELECT l.id AS line_id, l.name_ko, l.status, l.color, pl.role,
              (SELECT json_build_object('id', s.id, 'name_ko', s.name_ko) FROM line_station x JOIN station s ON s.id = x.station_id
                WHERE x.id = pl.from_line_station_id AND x.deleted_at IS NULL AND s.deleted_at IS NULL) AS from_station,
              (SELECT json_build_object('id', s.id, 'name_ko', s.name_ko) FROM line_station x JOIN station s ON s.id = x.station_id
                WHERE x.id = pl.to_line_station_id AND x.deleted_at IS NULL AND s.deleted_at IS NULL) AS to_station,
              pl.note
         FROM plan_line pl JOIN line l ON l.id = pl.line_id AND l.deleted_at IS NULL
        WHERE pl.plan_id = $1 ORDER BY pl.role, l.id`,
      [id],
    ),
    db.query(
      `SELECT s.id AS station_id, s.name_ko, st.status, ps.role
         FROM plan_station ps JOIN station s ON s.id = ps.station_id AND s.deleted_at IS NULL
         JOIN v_station_status st ON st.station_id = s.id
        WHERE ps.plan_id = $1 ORDER BY ps.role, s.name_ko, s.id`,
      [id],
    ),
    db.query(
      `SELECT x.target_plan_id AS plan_id, q.name_ko, x.relation, 'out' AS direction, x.note
         FROM plan_relation x JOIN plan q ON q.id = x.target_plan_id AND q.deleted_at IS NULL WHERE x.plan_id = $1
       UNION ALL
       SELECT x.plan_id, q.name_ko, x.relation, 'in', x.note
         FROM plan_relation x JOIN plan q ON q.id = x.plan_id AND q.deleted_at IS NULL WHERE x.target_plan_id = $1
       ORDER BY 4 DESC, 1`,
      [id],
    ),
    db.query(
      `SELECT c.id, c.name_ko, c.status FROM transfer_center_plan x JOIN transfer_center c ON c.id = x.center_id AND c.deleted_at IS NULL
        WHERE x.plan_id = $1 ORDER BY c.id`,
      [id],
    ),
  ]);
  const [names, baseSources, attachments, evts] = await Promise.all([
    namesOf(db, [id]),
    sourcesOf(db, [id]),
    attachmentsOf(db, [id]),
    eventsOf(db, id),
  ]);
  // 단계 이력·기대 일정·반영 내역의 근거 출처도 출처 절에(공개 원문 다운로드 링크 포함)
  const sources = await withChildSources(db, baseSources, [
    ...events.rows.map((r) => r.source_id),
    ...milestones.rows.map((r) => r.source_id),
    ...refs.rows.map((r) => r.source_id),
  ]);
  const at = plan.target_open?.value ? plan.target_open.value.slice(0, 4) : 'future';
  return {
    ...(plan as unknown as PublicPlanDetail),
    stage_events: events.rows as PublicPlanDetail['stage_events'],
    milestones: milestones.rows as PublicPlanDetail['milestones'],
    refs: refs.rows as PublicPlanDetail['refs'],
    lines: lines.rows as PublicPlanDetail['lines'],
    stations: stations.rows as PublicPlanDetail['stations'],
    relations: relations.rows as PublicPlanDetail['relations'],
    transfer_centers: centers.rows as PublicPlanDetail['transfer_centers'],
    map_path: `/map/?at=${at}#plan=${id}`,
    events: evts,
    names: names.get(id) ?? [],
    sources,
    attachments,
  };
}

// ------------------------------------------------------------------ 상위 계획

const PROGRAM_SQL = `
SELECT pg.id, pg.name_ko, pg.name_en, pg.name_full, pg.kind, pg.short, pg.round, pg.region_code, pg.period_from, pg.period_to,
       pg.issuer, pg.legal_basis, pg.status,
       (SELECT x.id FROM plan_program x WHERE x.id = pg.parent_id AND x.deleted_at IS NULL) AS parent_id,
       pg.summary, pg.document_note, pg.ord,
       (SELECT count(DISTINCT f.plan_id)::int FROM plan_ref f JOIN plan p ON p.id = f.plan_id AND p.deleted_at IS NULL
         WHERE f.program_id = pg.id) AS plan_count,
       coalesce((SELECT json_agg(json_build_object('kind', n.kind, 'title', n.title, 'number', n.number, 'date', ${fz('n.date')},
                                                   'note', n.note, 'source_id', n.source_id) ORDER BY n.seq)
                   FROM plan_program_notice n WHERE n.program_id = pg.id), '[]'::json) AS notices,
       coalesce((SELECT json_agg(json_build_object('label', f.label, 'value', f.value, 'source_id', f.source_id) ORDER BY f.seq)
                   FROM plan_program_figure f WHERE f.program_id = pg.id), '[]'::json) AS figures,
       coalesce((SELECT array_agg(x.text ORDER BY x.seq) FROM plan_program_point x WHERE x.program_id = pg.id), '{}') AS points,
       pg.checked_at::text AS checked_at, pg.review_status
  FROM plan_program pg WHERE pg.deleted_at IS NULL`;

type ProgramRow = Row & {
  id: string;
  notices: { source_id: string | null }[];
  figures: { source_id: string | null }[];
};

async function programSources(db: Queryable, rows: ProgramRow[]) {
  const all = await sourcesOf(
    db,
    rows.map((r) => r.id),
  );
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      sources: await withChildSources(
        db,
        all.filter((s) => s.entity_id === r.id),
        [...r.notices.map((n) => n.source_id), ...r.figures.map((f) => f.source_id)],
      ),
    })),
  );
}

export async function publicPlanPrograms(db: Queryable, q: Page & { kind?: string; status?: string }) {
  const params: unknown[] = [];
  let extra = '';
  if (q.kind) extra += ` AND pg.kind = $${params.push(q.kind)}`;
  if (q.status) extra += ` AND pg.status = $${params.push(q.status)}`;
  const { rows } = await db.query<ProgramRow>(`${PROGRAM_SQL}${extra} ORDER BY pg.ord, pg.id`, params);
  const page = paginate(rows, q);
  return { ...page, items: await programSources(db, page.items) };
}

export async function publicPlanProgram(db: Queryable, id: string) {
  const { rows } = await db.query<ProgramRow>(`${PROGRAM_SQL} AND pg.id = $1`, [id]);
  if (!rows[0]) return null;
  const [withSources] = await programSources(db, rows);
  const plans = await publicPlans(db, { program_id: id, limit: 10_000, offset: 0 });
  return { ...withSources!, plans: plans.items };
}

// ------------------------------------------------------------------ 환승센터

const TC_COLS = `c.id, c.name_ko, c.name_en, c.name_full, c.kind, c.region_code, c.area_code, c.status, ${fz('c.status_as_of')} AS status_as_of,
  coalesce((SELECT array_agg(x.station_id ORDER BY x.station_id) FROM transfer_center_station x JOIN station s ON s.id = x.station_id
             AND s.deleted_at IS NULL WHERE x.center_id = c.id), '{}') AS station_ids,
  c.review_status`;

export async function publicTransferCenters(
  db: Queryable,
  q: Page & { status?: string; area?: string; region?: string; kind?: string },
) {
  const params: unknown[] = [];
  const where = ['c.deleted_at IS NULL'];
  if (q.status) where.push(`c.status = $${params.push(q.status)}`);
  if (q.kind) where.push(`c.kind = $${params.push(q.kind)}`);
  if (q.area) where.push(`c.area_code = $${params.push(q.area)}`);
  if (q.region) where.push(`c.region_code = $${params.push(q.region)}`);
  const { rows } = await db.query(
    `SELECT ${TC_COLS} FROM transfer_center c WHERE ${where.join(' AND ')} ORDER BY c.id`,
    params,
  );
  return paginate(rows, q);
}

export async function publicTransferCenter(db: Queryable, id: string): Promise<PublicTransferCenterDetail | null> {
  const { rows } = await db.query<Row>(
    `SELECT ${TC_COLS}, c.description,
            (SELECT s.id FROM source s WHERE s.id = c.status_source_id AND s.deleted_at IS NULL) AS status_source_id,
            ${REC_JSON('c')} AS meta
       FROM transfer_center c WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [id],
  );
  const tc = rows[0];
  if (!tc) return null;
  const [stations, plans, refs, evts] = await Promise.all([
    db.query(
      `SELECT s.id, s.name_ko, st.status FROM transfer_center_station x JOIN station s ON s.id = x.station_id AND s.deleted_at IS NULL
         JOIN v_station_status st ON st.station_id = s.id WHERE x.center_id = $1 ORDER BY s.name_ko, s.id`,
      [id],
    ),
    db.query(
      `SELECT p.id, p.name_ko, st.stage FROM transfer_center_plan x JOIN plan p ON p.id = x.plan_id AND p.deleted_at IS NULL
         JOIN v_plan_stage st ON st.plan_id = p.id WHERE x.center_id = $1 ORDER BY p.id`,
      [id],
    ),
    db.query<Row & { source_id: string | null }>(
      `SELECT r.program_id, r.class, r.name_raw, r.cost_100m_krw::float8 AS cost_100m_krw, r.rail_now, r.rail_future, r.page,
              r.note, r.source_id
         FROM transfer_center_plan_ref r JOIN plan_program pg ON pg.id = r.program_id AND pg.deleted_at IS NULL
        WHERE r.center_id = $1 ORDER BY r.seq`,
      [id],
    ),
    db.query<Row & { source_id: string | null }>(
      `SELECT e.status, ${fz('e.date')} AS date, e.note, e.source_id FROM transfer_center_status_event e
        WHERE e.center_id = $1 ORDER BY e.date_from NULLS LAST, e.id`,
      [id],
    ),
  ]);
  const [names, base, attachments] = await Promise.all([
    namesOf(db, [id]),
    sourcesOf(db, [id]),
    attachmentsOf(db, [id]),
  ]);
  const sources = await withChildSources(db, base, [
    tc.status_source_id as string | null,
    ...refs.rows.map((r) => r.source_id),
    ...evts.rows.map((r) => r.source_id),
  ]);
  return {
    ...(tc as unknown as PublicTransferCenterDetail),
    stations: stations.rows as PublicTransferCenterDetail['stations'],
    plans: plans.rows as PublicTransferCenterDetail['plans'],
    plan_refs: refs.rows as PublicTransferCenterDetail['plan_refs'],
    status_events: evts.rows as PublicTransferCenterDetail['status_events'],
    names: names.get(id) ?? [],
    sources,
    attachments,
  };
}
