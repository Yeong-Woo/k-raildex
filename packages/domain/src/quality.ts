/**
 * 품질(Soft 규칙, docs/03-data-model.md 8-3절) — 경고·품질 대시보드용. 적용을 막지 않는다.
 * 규칙마다 SQL 하나가 (entity_type, entity_id, detail) 행을 낸다. 라벨은 entityLabels 로 붙인다.
 * 이관 검수 목록(X-*)도 같은 틀로 둔다.
 */
import type { EntityType } from '@k-raildex/contracts';
import type { Queryable } from './db';
import { DomainError } from './errors';
import { entityLabels } from './list';
import { ENTITY_SPECS } from './mapping';

export interface QualityRule {
  id: string;
  title: string;
  /** 계산하지 않는 규칙의 사유 */
  note?: string;
  /** (entity_type, entity_id, detail, sort_key) 를 내는 SQL. null 이면 항상 0건 */
  sql: string | null;
}

export interface QualityItem {
  entity_type: EntityType;
  entity_id: string;
  label: string;
  detail: string | null;
}

/** REC(checked_at) 열이 있는 개체 테이블 */
const CURATED_TABLES = Object.values(ENTITY_SPECS)
  .filter((s) => s.curated)
  .map((s) => ({ type: s.type, table: s.table }));

const checkedAtUnion = CURATED_TABLES.map(
  (t) =>
    `SELECT '${t.type}'::text AS entity_type, id AS entity_id, 'checked_at ' || checked_at::text AS detail, checked_at::text AS sort_key
       FROM "${t.table}" WHERE deleted_at IS NULL AND checked_at < current_date - interval '1 year'`,
).join('\nUNION ALL ');

export const QUALITY_RULES: readonly QualityRule[] = [
  {
    id: 'V-S01',
    title: '출처가 위키뿐',
    sql: `SELECT e.type AS entity_type, e.id AS entity_id, string_agg(s.id, ', ' ORDER BY s.id) AS detail, e.id AS sort_key
            FROM entity e
            JOIN record_source rs ON rs.entity_id = e.id AND rs.field IS NULL
            JOIN source s ON s.id = rs.source_id
           WHERE e.deleted_at IS NULL
           GROUP BY e.id, e.type
          HAVING bool_and(s.type = 'wiki')`,
  },
  {
    id: 'V-S02',
    title: '운영 중 여객역인데 좌표 없음 / 시·도 미상',
    sql: `SELECT 'station' AS entity_type, s.id AS entity_id,
                 concat_ws(', ', CASE WHEN s.geom IS NULL AND s.coord_same_as_id IS NULL THEN '좌표 없음' END,
                                 CASE WHEN s.region_code IS NULL THEN '시·도 미상' END) AS detail,
                 s.name_ko || s.id AS sort_key
            FROM station s JOIN v_station_status st ON st.station_id = s.id
           WHERE s.deleted_at IS NULL AND s.kind = 'station' AND st.status = 'operating'
             AND ((s.geom IS NULL AND s.coord_same_as_id IS NULL) OR s.region_code IS NULL)`,
  },
  {
    id: 'V-S03',
    title: '좌표가 시·도 경계 밖',
    note: '시·도 경계 데이터가 아직 없어 계산하지 않음(경계 확보 시 구현)',
    sql: null,
  },
  {
    id: 'V-S04',
    title: '같은 노선 인접 역 거리 30km 초과 또는 km 역행',
    sql: `WITH seqd AS (
            SELECT x.id, x.line_id, x.seq, x.km, s.geom,
                   lag(x.id) OVER w AS prev_id, lag(x.km) OVER w AS prev_km, lag(s.geom) OVER w AS prev_geom
              FROM line_station x
              JOIN line l ON l.id = x.line_id AND l.deleted_at IS NULL
              JOIN station s ON s.id = x.station_id
             WHERE x.deleted_at IS NULL
            WINDOW w AS (PARTITION BY x.line_id, coalesce(x.branch, '') ORDER BY x.seq)
          )
          SELECT 'line_station' AS entity_type, id AS entity_id,
                 concat_ws(', ',
                   CASE WHEN geom IS NOT NULL AND prev_geom IS NOT NULL AND ST_Distance(geom, prev_geom) > 30000
                        THEN '앞 역(' || prev_id || ')과 ' || round((ST_Distance(geom, prev_geom) / 1000)::numeric, 1) || 'km' END,
                   CASE WHEN km IS NOT NULL AND prev_km IS NOT NULL AND km < prev_km
                        THEN 'km 역행(' || prev_km || ' → ' || km || ')' END) AS detail,
                 line_id || lpad(seq::text, 5, '0') AS sort_key
            FROM seqd
           WHERE prev_id IS NOT NULL
             AND ((geom IS NOT NULL AND prev_geom IS NOT NULL AND ST_Distance(geom, prev_geom) > 30000)
               OR (km IS NOT NULL AND prev_km IS NOT NULL AND km < prev_km))`,
  },
  {
    id: 'V-S05',
    title: '역 순서 미확인(order_confirmed=false)',
    sql: `SELECT 'line_station' AS entity_type, x.id AS entity_id, x.line_id || ' #' || x.seq AS detail,
                 x.line_id || lpad(x.seq::text, 5, '0') AS sort_key
            FROM line_station x JOIN line l ON l.id = x.line_id AND l.deleted_at IS NULL
           WHERE x.deleted_at IS NULL AND NOT x.order_confirmed`,
  },
  {
    id: 'V-S06',
    title: '같은 이름의 역이 1km 안에 따로 있음(병합 후보)',
    sql: `SELECT 'station' AS entity_type, a.id AS entity_id,
                 b.id || ' 와 ' || round(ST_Distance(a.geom, b.geom)::numeric) || 'm' AS detail, a.name_ko || a.id AS sort_key
            FROM station a JOIN station b ON b.name_ko = a.name_ko AND b.id > a.id
           WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL AND a.geom IS NOT NULL AND b.geom IS NOT NULL
             AND a.merge_into_id IS DISTINCT FROM b.id AND b.merge_into_id IS DISTINCT FROM a.id
             AND ST_DWithin(a.geom, b.geom, 1000)`,
  },
  {
    id: 'V-S07',
    title: '확인일(checked_at)이 1년 이상 지남',
    sql: checkedAtUnion,
  },
  {
    id: 'V-S08',
    title: '단계 이력이 상위계획 반영뿐인데 검수 완료',
    sql: `SELECT 'plan' AS entity_type, p.id AS entity_id, NULL::text AS detail, p.name_ko || p.id AS sort_key
            FROM plan p
           WHERE p.deleted_at IS NULL AND p.review_status = 'verified'
             AND EXISTS (SELECT 1 FROM plan_stage_event e WHERE e.plan_id = p.id)
             AND NOT EXISTS (SELECT 1 FROM plan_stage_event e WHERE e.plan_id = p.id AND e.stage <> 'plan_listed')`,
  },
  {
    id: 'V-S09',
    title: '열차번호대 범위 겹침',
    sql: `SELECT 'train_number_range' AS entity_type, a.id AS entity_id,
                 b.id || ' (' || b.range_from || '~' || b.range_to || ')' AS detail, a.operator_id || a.range_from AS sort_key
            FROM train_number_range a
            JOIN train_number_range b ON b.id <> a.id AND b.operator_id = a.operator_id
                 AND coalesce(b.code_prefix, '') = coalesce(a.code_prefix, '')
                 AND b.range_from <= a.range_to AND a.range_from <= b.range_to
           WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL
             AND (a.valid_to_to IS NULL OR b.valid_from_from IS NULL OR a.valid_to_to >= b.valid_from_from)
             AND (b.valid_to_to IS NULL OR a.valid_from_from IS NULL OR b.valid_to_to >= a.valid_from_from)`,
  },
  {
    id: 'V-S10',
    title: '노선·계획 색(color)에 필드 출처 없음',
    sql: `SELECT t.entity_type, t.id AS entity_id, t.color AS detail, t.id AS sort_key FROM (
            SELECT 'line'::text AS entity_type, id, color FROM line WHERE deleted_at IS NULL AND color IS NOT NULL
            UNION ALL SELECT 'plan', id, color FROM plan WHERE deleted_at IS NULL AND color IS NOT NULL
          ) t
           WHERE NOT EXISTS (SELECT 1 FROM record_source rs WHERE rs.entity_id = t.id AND rs.field = 'color')`,
  },
  {
    id: 'V-S11',
    title: '미개통 계획(노선)인데 개통 예정 없음 — 미래 지도에 안 나옴',
    sql: `SELECT 'plan' AS entity_type, p.id AS entity_id, s.stage AS detail, p.name_ko || p.id AS sort_key
            FROM plan p JOIN v_plan_stage s ON s.plan_id = p.id
           WHERE p.deleted_at IS NULL AND p.scope = 'line'
             AND s.stage IS DISTINCT FROM 'opened' AND s.stage IS DISTINCT FROM 'abandoned' AND s.stage IS DISTINCT FROM 'dormant'
             AND NOT EXISTS (SELECT 1 FROM v_plan_target_open t WHERE t.plan_id = p.id AND t.date_from IS NOT NULL)`,
  },
  {
    id: 'V-S12',
    title: '미래 지도 대상인데 선형이 개략(schematic)뿐',
    sql: `SELECT 'plan' AS entity_type, m.plan_id AS entity_id,
                 CASE WHEN sh.plan_id IS NULL THEN '선형 없음' ELSE '개략 선형뿐' END AS detail, m.name_ko || m.plan_id AS sort_key
            FROM map_at_plans(NULL, 'concept', false) m
            LEFT JOIN v_plan_shape sh ON sh.plan_id = m.plan_id
           WHERE sh.plan_id IS NULL OR sh.quality = 'schematic'`,
  },
  {
    id: 'V-S13',
    title: '개통 예정이 지났는데 미개통(지연)',
    sql: `SELECT 'plan' AS entity_type, t.plan_id AS entity_id, '예정 ' || t.value AS detail, t.date_to::text || t.plan_id AS sort_key
            FROM v_plan_target_open t JOIN v_plan_stage s ON s.plan_id = t.plan_id
           WHERE t.date_to < current_date
             AND s.stage IS DISTINCT FROM 'opened' AND s.stage IS DISTINCT FROM 'abandoned'`,
  },
  {
    id: 'V-S14',
    title: '시간표 세트의 노선별 역 미해석',
    sql: `SELECT 'station' AS entity_type, ts.station_id AS entity_id,
                 ts.id || ' (' || ts.route_code || ', ' || ts.day_type || ', ' || ts.direction || ')' AS detail, ts.id AS sort_key
            FROM timetable_set ts JOIN station s ON s.id = ts.station_id AND s.deleted_at IS NULL
           WHERE ts.line_station_id IS NULL`,
  },
  // ---- 이관 검수 목록(docs/07-migration.md)
  {
    id: 'X-milestone-auto',
    title: '이관 기대 일정 출처 자동 선택(검수 필요)',
    sql: `SELECT 'plan' AS entity_type, m.plan_id AS entity_id, m.stage || ' ' || coalesce(m.expected_value, '') AS detail,
                 m.plan_id || m.id AS sort_key
            FROM plan_milestone m JOIN plan p ON p.id = m.plan_id AND p.deleted_at IS NULL
           WHERE m.note LIKE '%자동 선택(검수 필요)%'`,
  },
  {
    id: 'X-stage-override',
    title: '현재 단계를 수동 지정(stage_override)한 계획',
    sql: `SELECT 'plan' AS entity_type, p.id AS entity_id, p.stage_override AS detail, p.name_ko || p.id AS sort_key
            FROM plan p WHERE p.deleted_at IS NULL AND p.stage_override IS NOT NULL`,
  },
  {
    id: 'X-source-license-unknown',
    title: '라이선스 미상(unknown) 출처',
    sql: `SELECT 'source' AS entity_type, s.id AS entity_id, s.title AS detail, s.id AS sort_key
            FROM source s WHERE s.deleted_at IS NULL AND s.license_class = 'unknown'`,
  },
];

export function qualityRule(id: string): QualityRule {
  const r = QUALITY_RULES.find((x) => x.id === id);
  if (!r) throw new DomainError('not_found', `품질 규칙 ${id} 가 없음`);
  return r;
}

/** 규칙별 건수 */
export async function qualitySummary(
  db: Queryable,
): Promise<{ rules: { id: string; title: string; count: number; note?: string }[] }> {
  const rules: { id: string; title: string; count: number; note?: string }[] = [];
  for (const r of QUALITY_RULES) {
    let count = 0;
    if (r.sql) {
      const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${r.sql}) q`);
      count = rows[0]?.n ?? 0;
    }
    rules.push({ id: r.id, title: r.title, count, ...(r.note ? { note: r.note } : {}) });
  }
  return { rules };
}

/** 규칙 하나의 대상 목록 */
export async function qualityItems(
  db: Queryable,
  ruleId: string,
  opts: { limit: number; offset: number },
): Promise<{
  rule: { id: string; title: string; note?: string };
  items: QualityItem[];
  total: number;
  limit: number;
  offset: number;
}> {
  const r = qualityRule(ruleId);
  const rule = { id: r.id, title: r.title, ...(r.note ? { note: r.note } : {}) };
  if (!r.sql) return { rule, items: [], total: 0, limit: opts.limit, offset: opts.offset };
  const total = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${r.sql}) q`);
  const { rows } = await db.query<{ entity_type: EntityType; entity_id: string; detail: string | null }>(
    `SELECT entity_type, entity_id, detail FROM (${r.sql}) q ORDER BY sort_key, entity_id LIMIT $1 OFFSET $2`,
    [opts.limit, opts.offset],
  );
  const labels = await entityLabels(
    db,
    rows.map((x) => x.entity_id),
  );
  return {
    rule,
    items: rows.map((x) => ({
      entity_type: x.entity_type,
      entity_id: x.entity_id,
      label: labels.get(x.entity_id)?.label ?? x.entity_id,
      detail: x.detail && x.detail.length ? x.detail : null,
    })),
    total: total.rows[0]?.n ?? 0,
    limit: opts.limit,
    offset: opts.offset,
  };
}
