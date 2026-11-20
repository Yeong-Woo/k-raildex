-- 0013 파생 뷰 (docs/03-data-model.md 6절). 저장하지 않는 값. 소프트 삭제된 행과 삭제된 부모의 하위 행은 제외.
-- 규칙은 기존 시스템 build.ts·build-plans.ts 를 이식했다(권역: 3개 권역 이상이면 national 추가 등).

-- 사업 단계 진행도 (contracts PLAN_STAGE_PROGRESS 와 같음)
CREATE OR REPLACE FUNCTION plan_stage_progress(s text) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE s
    WHEN 'concept' THEN 0 WHEN 'plan_listed' THEN 1 WHEN 'prefeasibility' THEN 2 WHEN 'feasibility' THEN 3
    WHEN 'strategic_eia' THEN 4 WHEN 'basic_plan' THEN 5 WHEN 'basic_design' THEN 6 WHEN 'eia' THEN 7
    WHEN 'detail_design' THEN 8 WHEN 'construction' THEN 9 WHEN 'trial_run' THEN 10 WHEN 'opened' THEN 11
    ELSE -1 END
$$;

CREATE OR REPLACE FUNCTION plan_stage_at(p integer) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (ARRAY['concept','plan_listed','prefeasibility','feasibility','strategic_eia','basic_plan',
                'basic_design','eia','detail_design','construction','trial_run','opened'])[p + 1]
$$;

-- 권역 배열 정렬(ref_area.ord) + 3개 이상이면 national
CREATE OR REPLACE FUNCTION areas_normalize(a text[], force_national boolean DEFAULT false) RETURNS text[]
LANGUAGE sql STABLE SET search_path = public, osm, pg_temp AS $$
  WITH x AS (SELECT DISTINCT unnest(a) AS code)
  SELECT CASE WHEN count(*) FILTER (WHERE x.code <> 'national') = 0 AND NOT force_national THEN '{}'::text[]
    ELSE (SELECT array_agg(r.code ORDER BY r.ord) FROM ref_area r
           WHERE (r.code IN (SELECT code FROM x) AND r.code <> 'national')
              OR (r.code = 'national' AND (force_national OR (SELECT count(*) FROM x WHERE code <> 'national') >= 3)))
    END
  FROM x
$$;

-- ------------------------------------------------------------------ 역
-- 역 상태·개통·폐지: 노선별 역에서 계산(Q71 A), 노선별 역이 없으면 own_*
CREATE VIEW v_station_status AS
SELECT s.id AS station_id,
       CASE WHEN ls.n = 0 THEN s.own_status ELSE ls.status END AS status,
       CASE WHEN ls.n = 0 THEN s.own_opened_value ELSE ls.opened_value END AS opened_value,
       CASE WHEN ls.n = 0 THEN s.own_opened_precision ELSE ls.opened_precision END AS opened_precision,
       CASE WHEN ls.n = 0 THEN s.own_closed_value ELSE ls.closed_value END AS closed_value,
       CASE WHEN ls.n = 0 THEN s.own_closed_precision ELSE ls.closed_precision END AS closed_precision,
       ls.n AS line_count
  FROM station s
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS n,
           CASE WHEN bool_or(x.status = 'operating') THEN 'operating'
                WHEN bool_or(x.status = 'suspended') THEN 'suspended'
                WHEN bool_or(x.status = 'under_construction') THEN 'under_construction'
                WHEN bool_or(x.status = 'planned') THEN 'planned'
                WHEN bool_or(x.status = 'closed') THEN 'closed'
                ELSE 'abandoned' END AS status,
           (array_agg(x.opened_value ORDER BY x.opened_from NULLS LAST, x.opened_precision)
              FILTER (WHERE x.opened_precision IS NOT NULL))[1] AS opened_value,
           (array_agg(x.opened_precision ORDER BY x.opened_from NULLS LAST, x.opened_precision)
              FILTER (WHERE x.opened_precision IS NOT NULL))[1] AS opened_precision,
           CASE WHEN bool_and(x.status IN ('closed', 'abandoned')) THEN
             (array_agg(x.closed_value ORDER BY x.closed_to DESC NULLS LAST) FILTER (WHERE x.closed_precision IS NOT NULL))[1] END AS closed_value,
           CASE WHEN bool_and(x.status IN ('closed', 'abandoned')) THEN
             (array_agg(x.closed_precision ORDER BY x.closed_to DESC NULLS LAST) FILTER (WHERE x.closed_precision IS NOT NULL))[1] END AS closed_precision
      FROM line_station x JOIN line l ON l.id = x.line_id AND l.deleted_at IS NULL
     WHERE x.station_id = s.id AND x.deleted_at IS NULL
  ) ls
 WHERE s.deleted_at IS NULL;

-- 역 ↔ 노선(노선별 역 정보 포함)
CREATE VIEW v_station_line AS
SELECT x.station_id, x.line_id, x.id AS line_station_id, x.seq, x.km, x.branch, x.station_code, x.order_confirmed,
       coalesce(x.name_ko, s.name_ko) AS name_ko, coalesce(x.name_en, s.name_en) AS name_en,
       x.status, x.opened_value, x.opened_precision, x.closed_value, x.closed_precision,
       coalesce(x.operator_id, (SELECT lo.operator_id FROM line_operator lo WHERE lo.line_id = x.line_id ORDER BY lo.ord LIMIT 1)) AS operator_id,
       l.rail_class, l.category
  FROM line_station x
  JOIN station s ON s.id = x.station_id AND s.deleted_at IS NULL
  JOIN line l ON l.id = x.line_id AND l.deleted_at IS NULL
 WHERE x.deleted_at IS NULL;

-- 역의 노선 법적 분류 합집합(노선이 없으면 일반철도 — 기존 규칙)
CREATE VIEW v_station_line_class AS
SELECT s.id AS station_id,
       coalesce((SELECT array_agg(DISTINCT v.rail_class ORDER BY v.rail_class) FROM v_station_line v WHERE v.station_id = s.id),
                ARRAY['conventional']) AS line_classes
  FROM station s WHERE s.deleted_at IS NULL;

-- 역에 정차하는 운행 계통: 정차 패턴이 있으면 그 노선별 역만, 없으면 운행 계통 노선의 모든 역(assumed)
CREATE VIEW v_station_service AS
SELECT DISTINCT x.station_id, sv.id AS service_id, sv.kind, false AS assumed
  FROM service sv
  JOIN stop_pattern p ON p.service_id = sv.id
  JOIN stop_pattern_stop ps ON ps.pattern_id = p.id
  JOIN line_station x ON x.id = ps.line_station_id AND x.deleted_at IS NULL
 WHERE sv.deleted_at IS NULL
UNION
SELECT DISTINCT x.station_id, sv.id, sv.kind, true
  FROM service sv
  JOIN service_line sl ON sl.service_id = sv.id
  JOIN line_station x ON x.line_id = sl.line_id AND x.deleted_at IS NULL
 WHERE sv.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM stop_pattern p WHERE p.service_id = sv.id);

-- ------------------------------------------------------------------ 권역
CREATE VIEW v_line_area AS
SELECT l.id AS line_id,
       areas_normalize(coalesce((SELECT array_agg(r.area_code) FROM line_region lr JOIN ref_region r ON r.code = lr.region_code
                                  WHERE lr.line_id = l.id), '{}')) AS areas
  FROM line l WHERE l.deleted_at IS NULL;

CREATE VIEW v_station_area AS
SELECT s.id AS station_id,
       CASE WHEN s.region_code IS NOT NULL THEN ARRAY[(SELECT r.area_code FROM ref_region r WHERE r.code = s.region_code)]
            ELSE areas_normalize(coalesce((SELECT array_agg(a) FROM v_station_line v JOIN v_line_area la ON la.line_id = v.line_id,
                                                  unnest(la.areas) a WHERE v.station_id = s.id AND a <> 'national'), '{}'))
       END AS areas
  FROM station s WHERE s.deleted_at IS NULL;

CREATE VIEW v_service_area AS
SELECT sv.id AS service_id,
       areas_normalize(CASE WHEN EXISTS (SELECT 1 FROM stop_pattern p WHERE p.service_id = sv.id)
         THEN coalesce((SELECT array_agg(a) FROM stop_pattern p JOIN stop_pattern_stop ps ON ps.pattern_id = p.id
                          JOIN line_station x ON x.id = ps.line_station_id JOIN v_station_area sa ON sa.station_id = x.station_id,
                          unnest(sa.areas) a WHERE p.service_id = sv.id AND a <> 'national'), '{}')
         ELSE coalesce((SELECT array_agg(a) FROM service_line sl JOIN v_line_area la ON la.line_id = sl.line_id,
                          unnest(la.areas) a WHERE sl.service_id = sv.id AND a <> 'national'), '{}')
       END) AS areas
  FROM service sv WHERE sv.deleted_at IS NULL;

CREATE VIEW v_plan_area AS
SELECT p.id AS plan_id,
       areas_normalize(coalesce((SELECT array_agg(r.area_code) FROM plan_region pr JOIN ref_region r ON r.code = pr.region_code
                                  WHERE pr.plan_id = p.id), '{}'),
                       p.is_national OR EXISTS (SELECT 1 FROM plan_ref f WHERE f.plan_id = p.id AND f.category = 'high_speed')) AS areas
  FROM plan p WHERE p.deleted_at IS NULL;

-- ------------------------------------------------------------------ 검수 상속
CREATE VIEW v_station_review AS
SELECT s.id AS station_id,
       CASE WHEN s.review_status = 'flagged' THEN 'flagged'
            WHEN s.review_status = 'verified' OR EXISTS (
              SELECT 1 FROM v_station_line v JOIN line l ON l.id = v.line_id
               WHERE v.station_id = s.id AND l.review_status = 'verified') THEN 'verified'
            ELSE 'unverified' END AS review_status
  FROM station s WHERE s.deleted_at IS NULL;

-- ------------------------------------------------------------------ 계획
-- 현재 단계(03 6절 규칙): reached 는 최고 진행도 갱신, withdrawn 은 그 단계 직전으로, dormant 는 휴면 표시(이후 reached 로 해제),
-- abandoned 는 폐기(이후 reached 가 오면 되살림). 날짜순, 날짜 미상은 뒤로(같으면 진행도 순).
CREATE OR REPLACE FUNCTION plan_current_stage(pid text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = public, osm, pg_temp AS $$
DECLARE e record; best integer := -1; cur text := NULL; ov text;
BEGIN
  SELECT stage_override INTO ov FROM plan WHERE id = pid;
  IF ov IS NOT NULL THEN RETURN ov; END IF;
  FOR e IN SELECT stage, kind FROM plan_stage_event WHERE plan_id = pid
            ORDER BY date_from NULLS LAST, plan_stage_progress(stage), id LOOP
    IF e.kind = 'reached' THEN
      IF e.stage = 'abandoned' THEN
        cur := 'abandoned';
      ELSIF e.stage = 'dormant' THEN
        cur := 'dormant';
      ELSE
        best := greatest(best, plan_stage_progress(e.stage));
        cur := plan_stage_at(best);
      END IF;
    ELSIF e.kind = 'withdrawn' THEN
      best := greatest(plan_stage_progress(e.stage) - 1, 0);
      cur := plan_stage_at(best);
    ELSIF e.kind = 'dormant' THEN
      cur := 'dormant';
    END IF;
  END LOOP;
  RETURN cur;
END $$;

CREATE VIEW v_plan_stage AS
SELECT p.id AS plan_id, plan_current_stage(p.id) AS stage
  FROM plan p WHERE p.deleted_at IS NULL;

-- 개통 목표 = 가장 최근에 발표된 opened 기대 일정(Q88·Q94)
CREATE VIEW v_plan_target_open AS
SELECT DISTINCT ON (m.plan_id) m.plan_id, m.expected_value AS value, m.expected_precision AS precision,
       m.expected_from AS date_from, m.expected_to AS date_to, m.basis, m.source_id, m.as_of_value, m.as_of_precision
  FROM plan_milestone m JOIN plan p ON p.id = m.plan_id AND p.deleted_at IS NULL
 WHERE m.stage = 'opened'
 ORDER BY m.plan_id, m.as_of_from DESC NULLS LAST, m.id DESC;

-- 미개통 역·노선의 개통 목표: 연결된 미개통 계획의 개통 예정 중 가장 이른 것, 없으면 개체의 개통일
CREATE VIEW v_unopened_target AS
WITH open_plans AS (
  SELECT t.* FROM v_plan_target_open t JOIN v_plan_stage s ON s.plan_id = t.plan_id
   WHERE s.stage IS DISTINCT FROM 'opened' AND s.stage IS DISTINCT FROM 'abandoned'
)
SELECT 'station'::text AS entity_type, st.station_id AS entity_id,
       coalesce((SELECT o.value FROM plan_station ps JOIN open_plans o ON o.plan_id = ps.plan_id
                  WHERE ps.station_id = st.station_id ORDER BY o.date_from NULLS LAST LIMIT 1), st.opened_value) AS value,
       coalesce((SELECT o.precision FROM plan_station ps JOIN open_plans o ON o.plan_id = ps.plan_id
                  WHERE ps.station_id = st.station_id ORDER BY o.date_from NULLS LAST LIMIT 1), st.opened_precision) AS precision
  FROM v_station_status st WHERE st.status IN ('under_construction', 'planned')
UNION ALL
SELECT 'line', l.id,
       coalesce((SELECT o.value FROM plan_line pl JOIN open_plans o ON o.plan_id = pl.plan_id
                  WHERE pl.line_id = l.id AND pl.role IN ('new', 'extends') ORDER BY o.date_from NULLS LAST LIMIT 1), l.opened_value),
       coalesce((SELECT o.precision FROM plan_line pl JOIN open_plans o ON o.plan_id = pl.plan_id
                  WHERE pl.line_id = l.id AND pl.role IN ('new', 'extends') ORDER BY o.date_from NULLS LAST LIMIT 1), l.opened_precision)
  FROM line l WHERE l.deleted_at IS NULL AND l.status IN ('under_construction', 'planned');

-- ------------------------------------------------------------------ OSM 선형(ODbL)
-- 노선에 배정된 OSM way: relation 구성원 + way 이름(bbox 안). 같은 way 를 여러 노선이 원하면 priority 가 작은 노선이 가져간다.
CREATE VIEW osm.v_line_way AS
WITH cand AS (
  SELECT m.line_id, m.priority, w.id AS way_id, w.is_construction, w.geom, m.include_construction
    FROM line_osm_map m
    JOIN osm.relation_member rm ON rm.relation_id = ANY (m.relation_ids)
    JOIN osm.way w ON w.id = rm.way_id
  UNION
  SELECT m.line_id, m.priority, w.id, w.is_construction, w.geom, m.include_construction
    FROM line_osm_map m
    JOIN osm.way w ON w.tags->>'name' = ANY (m.way_names)
   WHERE m.bbox IS NULL OR ST_Intersects(w.geom, ST_MakeEnvelope(m.bbox[1], m.bbox[2], m.bbox[3], m.bbox[4], 4326))
)
SELECT DISTINCT ON (way_id) line_id, way_id, is_construction, geom
  FROM cand
 WHERE include_construction OR NOT is_construction
 ORDER BY way_id, priority, line_id;

CREATE VIEW osm.v_line_geometry AS
SELECT v.line_id, v.is_construction, ST_Multi(ST_LineMerge(ST_Collect(v.geom)))::geometry(MultiLineString, 4326) AS geom
  FROM osm.v_line_way v JOIN line l ON l.id = v.line_id AND l.deleted_at IS NULL
 GROUP BY v.line_id, v.is_construction;

-- 계획별 표시 선형: OSM 공사 선형(신설·연장 노선) > traced/official > schematic (Q89 A)
CREATE VIEW v_plan_shape AS
WITH osm_c AS (
  SELECT pl.plan_id, ST_Multi(ST_Collect(g.geom)) AS geom
    FROM plan_line pl JOIN osm.v_line_geometry g ON g.line_id = pl.line_id AND g.is_construction
   WHERE pl.role IN ('new', 'extends')
   GROUP BY pl.plan_id
), own AS (
  SELECT DISTINCT ON (pg.plan_id) pg.plan_id, pg.kind, pg.geom, pg.accuracy_m, pg.source_id
    FROM plan_geometry pg WHERE pg.deleted_at IS NULL
   ORDER BY pg.plan_id, CASE pg.kind WHEN 'official' THEN 0 WHEN 'traced' THEN 1 ELSE 2 END, pg.id DESC
)
SELECT p.id AS plan_id,
       CASE WHEN o.plan_id IS NOT NULL THEN 'osm_construction' ELSE own.kind END AS quality,
       coalesce(o.geom, own.geom)::geometry(MultiLineString, 4326) AS geom,
       (o.plan_id IS NOT NULL) AS odbl,
       own.accuracy_m, own.source_id
  FROM plan p
  LEFT JOIN osm_c o ON o.plan_id = p.id
  LEFT JOIN own ON own.plan_id = p.id
 WHERE p.deleted_at IS NULL AND (o.plan_id IS NOT NULL OR own.plan_id IS NOT NULL);

-- ------------------------------------------------------------------ 연표
-- event 테이블 ∪ 개체 필드에서 만든 파생 이벤트. 파생 id 규칙은 기존 build-plans.ts 와 같다:
-- evt-<type>-<대상 id 접두사(line|stn|svc|plan) 제거>-<날짜 값 또는 unknown>, 충돌하면 -2, -3 …
-- 같은 id 의 수기 이벤트가 있으면 수기가 대체한다.
CREATE OR REPLACE FUNCTION event_slug(type text, target text, date_value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(lower('evt-' || type || '-' || regexp_replace(target, '^(line|stn|svc|plan)-', '') || '-' || coalesce(date_value, 'unknown')),
                        '[^a-z0-9-]', '-', 'g')
$$;

CREATE VIEW v_event_derived AS
WITH raw AS (
  -- 1) 노선 개통·폐지
  SELECT 1 AS grp, l.id AS target, 'opened' AS type, l.opened_value AS dv, l.opened_precision AS dp,
         l.name_ko || ' 개통' AS title, NULL::text AS note, ARRAY[l.id] AS targets
    FROM line l WHERE l.deleted_at IS NULL AND l.opened_precision IS NOT NULL AND l.opened_precision <> 'unknown'
     AND fuzzy_from(l.opened_value, l.opened_precision) <= current_date
  UNION ALL
  SELECT 1, l.id, 'closed', l.closed_value, l.closed_precision, l.name_ko || ' 폐지', NULL, ARRAY[l.id]
    FROM line l WHERE l.deleted_at IS NULL AND l.closed_precision IS NOT NULL
  -- 2) 역 개통(운영 중)·폐지(폐역)
  UNION ALL
  SELECT 2, s.id, 'opened', st.opened_value, st.opened_precision, s.name_ko || '역 개통', NULL,
         ARRAY[s.id] || coalesce((SELECT array_agg(v.line_id) FROM v_station_line v WHERE v.station_id = s.id), '{}')
    FROM station s JOIN v_station_status st ON st.station_id = s.id
   WHERE st.status = 'operating' AND st.opened_precision IS NOT NULL AND st.opened_precision <> 'unknown'
     AND fuzzy_from(st.opened_value, st.opened_precision) <= current_date
  UNION ALL
  SELECT 2, s.id, 'closed', st.closed_value, st.closed_precision, s.name_ko || '역 폐지', NULL,
         ARRAY[s.id] || coalesce((SELECT array_agg(v.line_id) FROM v_station_line v WHERE v.station_id = s.id), '{}')
    FROM station s JOIN v_station_status st ON st.station_id = s.id
   WHERE st.status = 'closed' AND st.closed_precision IS NOT NULL
  -- 3) 운행 계통 운행 개시·종료
  UNION ALL
  SELECT 3, sv.id, 'service_started', sv.opened_value, sv.opened_precision, sv.name_ko || ' 운행 개시', NULL,
         ARRAY[sv.id] || coalesce((SELECT array_agg(sl.line_id ORDER BY sl.seq) FROM service_line sl WHERE sl.service_id = sv.id), '{}')
    FROM service sv WHERE sv.deleted_at IS NULL AND sv.opened_precision IS NOT NULL AND sv.opened_precision <> 'unknown'
     AND fuzzy_from(sv.opened_value, sv.opened_precision) <= current_date
  UNION ALL
  SELECT 3, sv.id, 'service_ended', sv.closed_value, sv.closed_precision, sv.name_ko || ' 운행 종료', NULL,
         ARRAY[sv.id] || coalesce((SELECT array_agg(sl.line_id ORDER BY sl.seq) FROM service_line sl WHERE sl.service_id = sv.id), '{}')
    FROM service sv WHERE sv.deleted_at IS NULL AND sv.closed_precision IS NOT NULL
  -- 4) 계획 단계 이력
  UNION ALL
  SELECT 4, p.id,
         CASE e.stage WHEN 'plan_listed' THEN 'plan_listed' WHEN 'opened' THEN 'opened' ELSE 'stage_changed' END,
         e.date_value, e.date_precision,
         p.name_ko || '(' || coalesce((SELECT f.section FROM plan_ref f WHERE f.plan_id = p.id ORDER BY f.seq LIMIT 1), '') || ') ' ||
           CASE e.stage WHEN 'concept' THEN '구상' WHEN 'plan_listed' THEN '상위 계획 반영' WHEN 'prefeasibility' THEN '사전타당성조사'
             WHEN 'feasibility' THEN '예비타당성조사' WHEN 'strategic_eia' THEN '전략환경영향평가' WHEN 'basic_plan' THEN '기본계획'
             WHEN 'basic_design' THEN '기본설계' WHEN 'eia' THEN '환경영향평가' WHEN 'detail_design' THEN '실시설계·실시계획 승인'
             WHEN 'construction' THEN '착공' WHEN 'trial_run' THEN '시운전' WHEN 'opened' THEN '개통' WHEN 'abandoned' THEN '폐기'
             WHEN 'dormant' THEN '휴면' ELSE e.stage END
           || CASE e.kind WHEN 'withdrawn' THEN ' 철회' ELSE '' END,
         e.note,
         ARRAY[p.id] || coalesce((SELECT array_agg(pl.line_id) FROM plan_line pl WHERE pl.plan_id = p.id), '{}')
                     || coalesce((SELECT array_agg(ps.station_id) FROM plan_station ps WHERE ps.plan_id = p.id), '{}')
    FROM plan p JOIN plan_stage_event e ON e.plan_id = p.id
   WHERE p.deleted_at IS NULL
), numbered AS (
  SELECT r.*, event_slug(r.type, r.target, r.dv) AS base,
         row_number() OVER (PARTITION BY event_slug(r.type, r.target, r.dv) ORDER BY r.grp, r.target, fuzzy_from(r.dv, r.dp) NULLS LAST, r.title) AS n
    FROM raw r
)
SELECT CASE WHEN n = 1 THEN base ELSE base || '-' || n END AS id,
       type, dv AS date_value, dp AS date_precision, title, note, targets, target AS subject_id
  FROM numbered;

CREATE VIEW v_event_all AS
SELECT e.id, e.type, e.date_value, e.date_precision, e.title, e.note, e.origin,
       coalesce((SELECT array_agg(t.entity_id ORDER BY t.role DESC, t.entity_id) FROM event_target t WHERE t.event_id = e.id), '{}') AS targets,
       false AS derived
  FROM event e WHERE e.deleted_at IS NULL
UNION ALL
SELECT d.id, d.type, d.date_value, d.date_precision, d.title, d.note, 'derived', d.targets, true
  FROM v_event_derived d
 WHERE NOT EXISTS (SELECT 1 FROM event e WHERE e.id = d.id);

-- ------------------------------------------------------------------ 시간표 요약
CREATE VIEW v_timetable_summary AS
SELECT ts.id AS set_id, ts.station_id, ts.line_station_id, ts.service_id, ts.route_code, ts.day_type, ts.direction,
       ts.direction_label, ts.data_as_of,
       min(te.minute) AS first_minute, max(te.minute) AS last_minute, count(te.*)::int AS count,
       ARRAY(SELECT (SELECT count(*) FROM timetable_entry te2 WHERE te2.set_id = ts.id AND (te2.minute / 60) % 24 = h)::int
               FROM generate_series(0, 23) h ORDER BY h) AS by_hour
  FROM timetable_set ts LEFT JOIN timetable_entry te ON te.set_id = ts.id
 GROUP BY ts.id;
