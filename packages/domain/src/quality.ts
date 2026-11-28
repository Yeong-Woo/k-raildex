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
import { QUALITY_GUIDE_COMMON, QUALITY_GUIDES, type QualityGuide } from './quality-guide';

/**
 * 이관 기대 일정 메모의 관리용 표시(Q100 A). 이 표시가 든 줄은 공개 응답에서 뺀다(Q119 A) —
 * 검수하면서 메모를 고치면 품질 목록 X-milestone-auto 에서도 빠진다.
 */
export const MILESTONE_AUTO_MARK = '자동 선택(검수 필요)';
/** 기본계획 이상·미개통 단계(2026-11-27 사용자 결정 — 노선 개체·개통 예정·선형 검수는 이 단계부터, Q143) */
const BASIC_PLAN_OR_LATER_UNOPENED = `'basic_plan', 'basic_design', 'eia', 'detail_design', 'construction', 'trial_run'`;

export interface QualityRule {
  id: string;
  title: string;
  /** 계산하지 않는 규칙의 사유 */
  note?: string;
  /** (entity_type, entity_id, detail, sort_key) 를 내는 SQL. null 이면 항상 0건 */
  sql: string | null;
  /** SQL 이 action_ref 열도 낸다(행 단위 처리 단추용 — V-S04 거리 확인의 앞 정거장 id) */
  actionRef?: boolean;
}

export interface QualityItem {
  entity_type: EntityType;
  entity_id: string;
  label: string;
  detail: string | null;
  /** 행 처리 단추에 쓰는 값(규칙별 의미, actionRef 규칙만) */
  action_ref?: string | null;
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
    // 2026-11-25 사용자 지시: 상한을 정차역 종류로 — 양 끝이 고속열차(high_speed 계통) 정차역이면 80km,
    // 고속·일반열차(intercity) 정차역이면 50km, 그 밖 30km. km 역행은 그대로 잡는다
    title: '같은 노선 인접 역 거리 초과(고속 정차역 80km·일반열차 정차역 50km·그 밖 30km) 또는 km 역행',
    sql: `WITH stops AS (
            SELECT ls.station_id, bool_or(sv.kind = 'high_speed') AS hs
              FROM stop_pattern_stop sps
              JOIN stop_pattern sp ON sp.id = sps.pattern_id
              JOIN service sv ON sv.id = sp.service_id AND sv.deleted_at IS NULL AND sv.kind IN ('high_speed', 'intercity')
              JOIN line_station ls ON ls.id = sps.line_station_id AND ls.deleted_at IS NULL
             GROUP BY ls.station_id
          ), seqd AS (
            SELECT x.id, x.line_id, x.seq, x.km, s.geom, x.station_id, x.gap_confirmed_prev_id,
                   lag(x.id) OVER w AS prev_id, lag(x.km) OVER w AS prev_km, lag(s.geom) OVER w AS prev_geom,
                   lag(x.station_id) OVER w AS prev_station_id, lag(s.name_ko) OVER w AS prev_name
              FROM line_station x
              JOIN line l ON l.id = x.line_id AND l.deleted_at IS NULL
              JOIN station s ON s.id = x.station_id
             WHERE x.deleted_at IS NULL
            WINDOW w AS (PARTITION BY x.line_id, coalesce(x.branch, '') ORDER BY x.seq)
          ), lim AS (
            SELECT d.*, ST_Distance(d.geom, d.prev_geom) AS dist,
                   d.gap_confirmed_prev_id IS NOT DISTINCT FROM d.prev_id AS gap_ok,
                   CASE WHEN a.hs AND b.hs THEN 80000 WHEN a.station_id IS NOT NULL AND b.station_id IS NOT NULL THEN 50000
                        ELSE 30000 END AS max_m
              FROM seqd d
              LEFT JOIN stops a ON a.station_id = d.station_id
              LEFT JOIN stops b ON b.station_id = d.prev_station_id
             WHERE d.prev_id IS NOT NULL
          )
          SELECT 'line_station' AS entity_type, id AS entity_id,
                 concat_ws(', ',
                   CASE WHEN dist > max_m AND NOT gap_ok
                        THEN '앞 역 ' || prev_name || '(' || prev_id || ')과 ' || round((dist / 1000)::numeric, 1) || 'km(상한 ' || max_m / 1000 || 'km)' END,
                   CASE WHEN km IS NOT NULL AND prev_km IS NOT NULL AND km < prev_km
                        THEN 'km 역행(' || prev_km || ' → ' || km || ')' END) AS detail,
                 line_id || lpad(seq::text, 5, '0') AS sort_key,
                 CASE WHEN dist > max_m AND NOT gap_ok THEN prev_id END AS action_ref
            FROM lim
           WHERE (dist > max_m AND NOT gap_ok) OR (km IS NOT NULL AND prev_km IS NOT NULL AND km < prev_km)`,
    actionRef: true,
  },
  {
    id: 'V-S05',
    title: '정거장 순서 미확인(order_confirmed=false)',
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
             AND ST_DWithin(a.geom, b.geom, 1000)
             -- 별개 역으로 확인하면 어느 한쪽 내부 메모에 상대 id(2026-11-27 — X-station-near-other-name 과 같은 방식)
             AND position(b.id IN coalesce(a.editor_note, '')) = 0
             AND position(a.id IN coalesce(b.editor_note, '')) = 0`,
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
             AND NOT EXISTS (SELECT 1 FROM plan_stage_event e WHERE e.plan_id = p.id AND e.stage <> 'plan_listed')
             -- Q144 A: 최신(현행·초안) 상위 계획에 반영된 신규 사업은 상위계획 반영 단계뿐인 것이 정상
             AND NOT EXISTS (SELECT 1 FROM plan_ref r JOIN plan_program pp ON pp.id = r.program_id AND pp.deleted_at IS NULL
                              WHERE r.plan_id = p.id AND pp.status IN ('current', 'draft'))`,
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
             -- Q143 A: 기본계획 이상만(공식·보도 개통 예정은 대개 기본계획 이후에 나온다, Q94)
             AND s.stage IN (${BASIC_PLAN_OR_LATER_UNOPENED})
             AND NOT EXISTS (SELECT 1 FROM v_plan_target_open t WHERE t.plan_id = p.id AND t.date_from IS NOT NULL)`,
  },
  {
    id: 'V-S12',
    title: '미래 지도 대상인데 선형이 개략(schematic)뿐',
    sql: `SELECT 'plan' AS entity_type, m.plan_id AS entity_id,
                 CASE WHEN sh.plan_id IS NULL THEN '선형 없음' ELSE '개략 선형뿐' END AS detail, m.name_ko || m.plan_id AS sort_key
            FROM map_at_plans(NULL, 'concept', false) m
            JOIN v_plan_stage st ON st.plan_id = m.plan_id
            LEFT JOIN v_plan_shape sh ON sh.plan_id = m.plan_id
           WHERE (sh.plan_id IS NULL OR sh.quality = 'schematic')
             -- Q143 A: 기본계획 이상만
             AND st.stage IN (${BASIC_PLAN_OR_LATER_UNOPENED})`,
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
    title: '시간표 세트의 정거장 미해석',
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
           WHERE m.note LIKE '%${MILESTONE_AUTO_MARK}%'`,
  },
  {
    id: 'X-stage-override',
    title: '현재 단계를 수동 지정(stage_override)한 계획',
    sql: `SELECT 'plan' AS entity_type, p.id AS entity_id, p.stage_override AS detail, p.name_ko || p.id AS sort_key
            FROM plan p WHERE p.deleted_at IS NULL AND p.stage_override IS NOT NULL`,
  },
  {
    // Q101 A: 기존 abandoned 인데 단계 이력에 폐기 항목(날짜·출처)이 없어 override 로 임시 유지한 계획
    id: 'X-plan-abandoned-evidence',
    title: '폐기 근거 필요(stage_override = abandoned, 단계 이력에 폐기 없음)',
    sql: `SELECT 'plan' AS entity_type, p.id AS entity_id, '단계 이력에 폐기(abandoned) 항목 없음' AS detail, p.name_ko || p.id AS sort_key
            FROM plan p
           WHERE p.deleted_at IS NULL AND p.stage_override = 'abandoned'
             AND NOT EXISTS (SELECT 1 FROM plan_stage_event e WHERE e.plan_id = p.id AND e.stage = 'abandoned')`,
  },
  {
    // Q105 A: 이관 때 정거장으로 풀지 못해 정차 패턴에서 뺀 정차역(service.extra.dropped_stops).
    // 운행 계통 노선 목록을 보강하고 그 패턴에 그 역의 정차역을 다시 넣으면 목록에서 빠진다.
    id: 'X-service-dropped-stops',
    title: '정차 패턴에서 뺀 정차역(이관 때 정거장 미해석)',
    sql: `SELECT 'service' AS entity_type, sv.id AS entity_id,
                 (d->>'pattern') || ' #' || (d->>'seq') || ' ' || (d->>'station_id') || ' — ' ||
                 CASE d->>'reason' WHEN 'not_on_service_lines' THEN '운행 계통 노선에 정거장 없음'
                                   WHEN 'ambiguous' THEN '노선 모호(후보 ' || coalesce((SELECT string_agg(c, ', ') FROM jsonb_array_elements_text(d->'candidates') c), '') || ')'
                                   WHEN 'pattern_dropped' THEN '패턴 전체 제외(해석 정차역 2개 미만)'
                                   ELSE coalesce(d->>'reason', '') END AS detail,
                 sv.id || '|' || (d->>'pattern') || '|' || lpad(coalesce(d->>'seq', '0'), 5, '0') AS sort_key
            FROM service sv
           CROSS JOIN LATERAL jsonb_array_elements(
                   CASE WHEN jsonb_typeof(sv.extra->'dropped_stops') = 'array' THEN sv.extra->'dropped_stops' ELSE '[]'::jsonb END) d
           WHERE sv.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM stop_pattern sp
                               JOIN stop_pattern_stop x ON x.pattern_id = sp.id
                               JOIN line_station ls ON ls.id = x.line_station_id
                              WHERE sp.service_id = sv.id AND sp.code = d->>'pattern' AND ls.station_id = d->>'station_id')`,
  },
  {
    // Q120 A: 이관 때 계획에 걸린 운영 중 노선을 기계적으로 upgrades 로 묶었다(Q90 초안). 개량 대상이 아닌 "새 계통이 지나는
    // 기존 노선"이 섞여 있다. 확인하면 역할을 고치거나(지우기 포함) 메모(note)에 근거를 적는다 → 목록에서 빠진다.
    id: 'X-plan-line-role',
    title: '계획 노선 역할 확인 필요(이관 upgrades, 메모 없음)',
    sql: `SELECT 'plan' AS entity_type, pl.plan_id AS entity_id, pl.line_id || ' — ' || l.name_ko AS detail,
                 p.name_ko || pl.plan_id || pl.line_id AS sort_key
            FROM plan_line pl
            JOIN plan p ON p.id = pl.plan_id AND p.deleted_at IS NULL
            JOIN line l ON l.id = pl.line_id AND l.deleted_at IS NULL
           WHERE pl.role = 'upgrades' AND pl.note IS NULL`,
  },
  {
    // 2026-11-25 사용자 지시: 공사 중인데 미래 선형이 없는 것 정리. OSM 공사 중 선형·계획 선형(공식·도면 추출)이 없어
    // 지도에 그릴 수 없는 공사 중 노선과 시공 단계 계획(신설·연장이거나 노선 연결 없음). OSM 에 그려지면 노선 OSM 대응(way_ids 등)에,
    // 공식 도면이 있으면 계획 선형(traced/official)에 넣으면 빠진다. 개략(schematic)만 있는 계획도 포함.
    id: 'X-construction-no-geometry',
    title: '공사 중인데 지도 선형 없음(OSM 공사 선형·계획 선형 필요)',
    sql: `SELECT 'line' AS entity_type, l.id AS entity_id, l.name_ko AS detail, '1' || l.name_ko AS sort_key
            FROM line l
           WHERE l.deleted_at IS NULL AND l.status = 'under_construction'
             AND NOT EXISTS (SELECT 1 FROM osm.v_line_geometry g WHERE g.line_id = l.id)
             AND NOT EXISTS (SELECT 1 FROM v_line_plan_shape s WHERE s.line_id = l.id AND s.quality <> 'schematic')
          UNION ALL
          SELECT 'plan', p.id, p.name_ko || CASE WHEN sh.quality = 'schematic' THEN ' (개략 선형만)' ELSE '' END, '2' || p.name_ko
            FROM plan p
            JOIN v_plan_stage st ON st.plan_id = p.id AND st.stage = 'construction'
            LEFT JOIN v_plan_shape sh ON sh.plan_id = p.id
           WHERE p.deleted_at IS NULL
             AND (sh.plan_id IS NULL OR sh.quality = 'schematic')
             AND (EXISTS (SELECT 1 FROM plan_line pl WHERE pl.plan_id = p.id AND pl.role IN ('new', 'extends'))
                  OR NOT EXISTS (SELECT 1 FROM plan_line pl WHERE pl.plan_id = p.id))
             AND NOT EXISTS (SELECT 1 FROM plan_line pl JOIN osm.v_line_geometry g ON g.line_id = pl.line_id AND g.is_construction
                              WHERE pl.plan_id = p.id AND pl.role IN ('new', 'extends'))`,
  },
  {
    // Q122 B: 150m 안의 이름이 다른 역 쌍(옛 이름 중복·근사 좌표 의심). 별개 역이면 한쪽 editor_note 에 상대 id 를 적는다
    // (예: "별개 역 확인: stn-magok"), 같은 역이면 병합, 좌표가 틀렸으면 좌표를 고친다.
    id: 'X-station-near-other-name',
    title: '이름이 다른 역이 150m 안에 있음(같은 역·근사 좌표 확인)',
    sql: `SELECT 'station' AS entity_type, a.id AS entity_id,
                 b.id || ' ' || b.name_ko || ' 와 ' || round(ST_Distance(a.geom, b.geom)::numeric) || 'm' AS detail,
                 a.name_ko || a.id AS sort_key
            FROM station a JOIN station b ON b.id > a.id AND b.name_ko <> a.name_ko
           WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL AND a.geom IS NOT NULL AND b.geom IS NOT NULL
             AND a.kind = 'station' AND b.kind = 'station'
             AND a.merge_into_id IS NULL AND b.merge_into_id IS NULL
             AND ST_DWithin(a.geom, b.geom, 150)
             AND position(b.id IN coalesce(a.editor_note, '')) = 0
             AND position(a.id IN coalesce(b.editor_note, '')) = 0`,
  },
  {
    // Q123 B: 통합·합병(merged) 운영기관의 승계 사실에 법령·고시·공고 출처가 없다(C-1). M9·M10 조사 과제
    id: 'X-operator-merge-source',
    title: '운영기관 통합(merged)의 1차 출처(법령·고시·공고) 없음',
    sql: `SELECT 'operator' AS entity_type, o.id AS entity_id, '승계 ' || coalesce(o.merged_into_id, '미상') AS detail, o.id AS sort_key
            FROM operator o
           WHERE o.deleted_at IS NULL AND o.status = 'merged'
             AND NOT EXISTS (SELECT 1 FROM record_source rs JOIN source s ON s.id = rs.source_id AND s.deleted_at IS NULL
                              WHERE rs.entity_id = o.id AND rs.field = 'merged_into_id' AND s.type IN ('law', 'notice'))`,
  },
  {
    // Q124: 노선에 속했는데 좌표가 없는 역(시설·폐역·공사 중 포함 — V-S02 는 운영 중 여객역만 본다). 사용자가 관리 앱에서 직접 입력
    id: 'X-station-no-coord',
    title: '노선에 속했는데 좌표 없음(시설·폐역·공사 중 포함)',
    sql: `SELECT 'station' AS entity_type, s.id AS entity_id,
                 st.status || ' · ' || s.kind || ' · ' ||
                 (SELECT string_agg(DISTINCT x.line_id, ', ') FROM line_station x WHERE x.station_id = s.id AND x.deleted_at IS NULL) AS detail,
                 s.name_ko || s.id AS sort_key
            FROM station s JOIN v_station_status st ON st.station_id = s.id
           WHERE s.deleted_at IS NULL AND s.geom IS NULL AND s.coord_same_as_id IS NULL
             AND EXISTS (SELECT 1 FROM line_station x WHERE x.station_id = s.id AND x.deleted_at IS NULL)`,
  },
  {
    // Q73 A(2026-11-26 사용자 지시로 검수 목록화): 공사 중 분리 정거장(merge_into_id) — 기존 역과 같은 역(환승역)인지 확인해
    // 병합하거나, 미확정이면 내부 메모에 "분리 유지(<병합할 역 id>)" 를 적어 목록에서 뺀다(병합할 역이 바뀌면 다시 나온다).
    // action_ref = 병합할 역 id(행의 [병합] 단추)
    id: 'X-station-split',
    title: '공사 중 분리 정거장 — 기존 역과 병합할지 확인',
    actionRef: true,
    sql: `SELECT 'station' AS entity_type, s.id AS entity_id,
                 '→ ' || m.name_ko || '(' || m.id || ') · 이 역: ' ||
                 coalesce((SELECT string_agg(l.name_ko, ', ' ORDER BY l.name_ko) FROM line_station x JOIN line l ON l.id = x.line_id
                            WHERE x.station_id = s.id AND x.deleted_at IS NULL), '노선 없음') ||
                 ' / 기존 역: ' ||
                 coalesce((SELECT string_agg(l.name_ko, ', ' ORDER BY l.name_ko) FROM line_station x JOIN line l ON l.id = x.line_id
                            WHERE x.station_id = m.id AND x.deleted_at IS NULL), '노선 없음') AS detail,
                 s.name_ko || s.id AS sort_key,
                 m.id AS action_ref
            FROM station s JOIN station m ON m.id = s.merge_into_id AND m.deleted_at IS NULL
           WHERE s.deleted_at IS NULL
             AND coalesce(s.editor_note, '') NOT LIKE '%분리 유지(' || m.id || ')%'`,
  },
  {
    // 2026-11-27 사용자 지시: 노선 단위 계획인데 노선 연결(plan_line)이 하나도 없다 — 관리 앱 계획 편집 "노선과 역할"에서
    // 기존 노선을 잇거나 [새 노선 만들기](계획 상태 노선 + 신설 역할)로 만든다. 노선이 아닌 사업이면 내부 메모에 "노선 연결 안 함".
    // 폐기·휴면 계획은 뺀다
    id: 'X-plan-no-line',
    title: '기본계획 이상 노선 계획인데 노선 연결 없음(기존 노선 연결 또는 새 노선 만들기)',
    sql: `SELECT 'plan' AS entity_type, p.id AS entity_id,
                 coalesce(st.stage, '단계 없음') || CASE WHEN sh.plan_id IS NULL THEN '' ELSE ' · 선형 ' || sh.quality END AS detail,
                 p.name_ko || p.id AS sort_key
            FROM plan p
            LEFT JOIN v_plan_stage st ON st.plan_id = p.id
            LEFT JOIN v_plan_shape sh ON sh.plan_id = p.id
           WHERE p.deleted_at IS NULL AND p.scope = 'line'
             -- 2026-11-27 사용자 결정: 노선 개체는 기본계획 이상 계획만 만든다(그 전 단계는 계획 선형으로만)
             AND st.stage IN (${BASIC_PLAN_OR_LATER_UNOPENED}, 'opened')
             AND NOT EXISTS (SELECT 1 FROM plan_line pl JOIN line l ON l.id = pl.line_id AND l.deleted_at IS NULL WHERE pl.plan_id = p.id)
             AND coalesce(p.editor_note, '') NOT LIKE '%노선 연결 안 함%'`,
  },
  {
    // 2026-11-27 운영기관 정리(사용자 지시): 정거장의 현재 운영기관을 정할 수 없다 — 노선 운영기관이 둘 이상(구간 분할·공동 운영)인데
    // 정거장에 운영기관이 없거나, 노선에 운영기관이 없다(v_line_station_operator basis ambiguous·none). 운영 중·휴업 정거장만(공사 중·계획은 운영기관 미정이 정상)
    id: 'X-line-station-operator',
    title: '정거장 운영기관 미정(노선 운영기관이 둘 이상이거나 없음)',
    sql: `SELECT 'line_station' AS entity_type, x.id AS entity_id,
                 l.name_ko || ' ' || coalesce(x.name_ko, s.name_ko) || ' · ' ||
                 CASE vo.basis WHEN 'ambiguous' THEN '노선 운영기관 ' ||
                        (SELECT string_agg(lo.operator_id, ', ' ORDER BY lo.ord) FROM line_operator lo
                          WHERE lo.line_id = x.line_id AND lo.role = 'operator')
                      ELSE '노선 운영기관 없음' END AS detail,
                 l.name_ko || lpad(x.seq::text, 4, '0') AS sort_key
            FROM v_line_station_operator vo
            JOIN line_station x ON x.id = vo.line_station_id
            JOIN line l ON l.id = x.line_id AND l.deleted_at IS NULL
            JOIN station s ON s.id = x.station_id AND s.deleted_at IS NULL
           WHERE vo.basis IN ('ambiguous', 'none') AND x.status IN ('operating', 'suspended')`,
  },
  {
    // 2026-11-27 사용자 지시: 시설(차량기지) 좌표 — 역·시설 편집에서 지도에 찍는다(OSM 좌표는 저장하지 않음). 폐지·계획은 뺀다
    id: 'X-facility-no-coord',
    title: '시설 좌표 없음(역·시설 편집에서 찍기)',
    sql: `SELECT 'facility' AS entity_type, x.id AS entity_id,
                 coalesce(x.address, '주소 미확인') AS detail, x.name_ko || x.id AS sort_key
            FROM facility x
           WHERE x.deleted_at IS NULL AND x.geom IS NULL AND x.status IN ('operating', 'suspended', 'under_construction')`,
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
export async function qualitySummary(db: Queryable): Promise<{
  rules: { id: string; title: string; count: number; note?: string; guide: QualityGuide | null }[];
  guide_common: readonly string[];
}> {
  const rules: { id: string; title: string; count: number; note?: string; guide: QualityGuide | null }[] = [];
  for (const r of QUALITY_RULES) {
    let count = 0;
    if (r.sql) {
      const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${r.sql}) q`);
      count = rows[0]?.n ?? 0;
    }
    rules.push({
      id: r.id,
      title: r.title,
      count,
      ...(r.note ? { note: r.note } : {}),
      guide: QUALITY_GUIDES[r.id] ?? null,
    });
  }
  return { rules, guide_common: QUALITY_GUIDE_COMMON };
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
  const { rows } = await db.query<{
    entity_type: EntityType;
    entity_id: string;
    detail: string | null;
    action_ref?: string | null;
  }>(
    `SELECT entity_type, entity_id, detail${r.actionRef ? ', action_ref' : ''} FROM (${r.sql}) q ORDER BY sort_key, entity_id LIMIT $1 OFFSET $2`,
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
      ...(r.actionRef ? { action_ref: x.action_ref ?? null } : {}),
    })),
    total: total.rows[0]?.n ?? 0,
    limit: opts.limit,
    offset: opts.offset,
  };
}

export interface ReviewIssue {
  rule: string;
  title: string;
  detail: string | null;
}
export interface ReviewListItem {
  id: string;
  name_ko: string;
  /** 역 그룹: 지나는 노선 이름(가나다순) · 노선: 지선이면 본선 이름 하나(v_line_branch) · 계획: 이어진 노선 이름 */
  lines: string[];
  status: string | null;
  /** 역 종류(station·signal 등) · 노선: 노선 분류(category) · 계획: 표시 선형 품질(v_plan_shape.quality, 없으면 null) */
  kind: string | null;
  /** 역: 좌표 있음 · 계획: 표시 선형 있음 · 노선: 비움 */
  has_geom: boolean | null;
  station_count: number | null;
  color: string | null;
  issues: ReviewIssue[];
}

/**
 * 지도 편집·노선 편집의 고르기 목록(FR-ADM-070): 역·노선 전체 + 개체별 품질 규칙 걸림(빨강 = 검수 필요, 초록 = 걸린 규칙 없음).
 * 규칙 SQL 을 그대로 합쳐 쓰므로 품질 대시보드와 항상 같은 결과다.
 */
export type ReviewListType = 'station' | 'line' | 'plan' | 'facility';

/** status 는 역·노선 = 상태, 계획 = 현재 단계(v_plan_stage) */
export async function reviewList(db: Queryable, type: ReviewListType): Promise<{ items: ReviewListItem[] }> {
  const rules = QUALITY_RULES.filter((r) => r.sql);
  const union = rules
    .map(
      (r) =>
        `SELECT '${r.id}'::text AS rule, entity_type, entity_id, detail FROM (${r.sql}) q${r.id.replace(/\W/g, '_')}`,
    )
    .join('\nUNION ALL ');
  // 정거장(line_station) 규칙(V-S04·V-S05 등)은 그 역·그 노선에 붙인다
  const owner = type === 'station' ? 'station_id' : type === 'line' ? 'line_id' : null;
  const ownerExpr = owner
    ? `CASE WHEN u.entity_type = 'line_station' THEN (SELECT x.${owner} FROM line_station x WHERE x.id = u.entity_id) ELSE u.entity_id END`
    : 'u.entity_id';
  const sqlIssues = `SELECT u.rule, ${ownerExpr} AS entity_id,
                            u.detail
                       FROM (${union}) u WHERE u.entity_type IN ($1, ${owner ? `'line_station'` : '$1'})`;
  const { rows: issueRows } = await db.query<{ rule: string; entity_id: string | null; detail: string | null }>(
    sqlIssues,
    [type],
  );
  const titles = new Map(rules.map((r) => [r.id, r.title]));
  const issues = new Map<string, ReviewIssue[]>();
  for (const r of issueRows) {
    if (!r.entity_id) continue;
    const list = issues.get(r.entity_id) ?? [];
    list.push({
      rule: r.rule,
      title: titles.get(r.rule) ?? r.rule,
      detail: r.detail && r.detail.length ? r.detail : null,
    });
    issues.set(r.entity_id, list);
  }
  const sql =
    type === 'station'
      ? `SELECT s.id, s.name_ko, vs.status, s.kind, s.geom IS NOT NULL AS has_geom, NULL::int AS station_count, NULL::text AS color,
                coalesce((SELECT array_agg(DISTINCT l.name_ko ORDER BY l.name_ko) FROM line_station x
                            JOIN line l ON l.id = x.line_id AND l.deleted_at IS NULL
                           WHERE x.station_id = s.id AND x.deleted_at IS NULL), '{}') AS lines
           FROM station s LEFT JOIN v_station_status vs ON vs.station_id = s.id
          WHERE s.deleted_at IS NULL ORDER BY s.name_ko, s.id`
      : type === 'facility'
        ? `SELECT x.id, x.name_ko, x.status, x.kind, x.geom IS NOT NULL AS has_geom, NULL::int AS station_count,
                  (SELECT l.color FROM facility_line fl JOIN line l ON l.id = fl.line_id AND l.deleted_at IS NULL
                    WHERE fl.facility_id = x.id AND fl.role = 'serves' ORDER BY fl.ord, l.id LIMIT 1) AS color,
                  coalesce((SELECT array_agg(l.name_ko ORDER BY fl.ord, l.id) FROM facility_line fl
                              JOIN line l ON l.id = fl.line_id AND l.deleted_at IS NULL
                             WHERE fl.facility_id = x.id AND fl.role = 'serves'), '{}') AS lines
             FROM facility x WHERE x.deleted_at IS NULL ORDER BY x.name_ko, x.id`
        : type === 'plan'
          ? `SELECT p.id, p.name_ko, st.stage AS status, sh.quality AS kind, sh.plan_id IS NOT NULL AS has_geom,
                  NULL::int AS station_count, p.color,
                  coalesce((SELECT array_agg(l.name_ko ORDER BY l.name_ko) FROM plan_line pl
                              JOIN line l ON l.id = pl.line_id AND l.deleted_at IS NULL WHERE pl.plan_id = p.id), '{}') AS lines
             FROM plan p LEFT JOIN v_plan_stage st ON st.plan_id = p.id LEFT JOIN v_plan_shape sh ON sh.plan_id = p.id
            WHERE p.deleted_at IS NULL ORDER BY p.name_ko, p.id`
          : `SELECT l.id, l.name_ko, l.status, l.category AS kind, NULL::boolean AS has_geom, l.color,
                coalesce((SELECT ARRAY[p.name_ko] FROM v_line_branch b JOIN line p ON p.id = b.branch_of_line_id WHERE b.line_id = l.id),
                         '{}'::text[]) AS lines,
                (SELECT count(*)::int FROM line_station x WHERE x.line_id = l.id AND x.deleted_at IS NULL) AS station_count
           FROM line l WHERE l.deleted_at IS NULL ORDER BY l.name_ko, l.id`;
  const { rows } = await db.query<Omit<ReviewListItem, 'issues'>>(sql);
  return { items: rows.map((r) => ({ ...r, issues: issues.get(r.id) ?? [] })) };
}
