-- 0016 첫 이관 리허설(2026-11-20, docs/legacy/migration-report-2026-11-20.md) 뒤 고친 것
-- 1) 노선 연장: 기존 값에 소수 셋째 자리 이상이 있다(32.7001 등) — 자릿수 제한을 없앤다
ALTER TABLE line ALTER COLUMN length_km TYPE numeric;

-- 2) 시간표 행 PK: (세트, 분, 열차번호)는 열차번호가 없는 TAGO 원본에서 같은 분·다른 종착 행을 잃는다 → 세트 안 순번
ALTER TABLE timetable_entry ADD COLUMN ord integer;
UPDATE timetable_entry t SET ord = x.rn
  FROM (SELECT ctid, row_number() OVER (PARTITION BY set_id ORDER BY minute, train_no, dest_name NULLS FIRST) AS rn FROM timetable_entry) x
 WHERE t.ctid = x.ctid;
ALTER TABLE timetable_entry ALTER COLUMN ord SET NOT NULL;
ALTER TABLE timetable_entry ADD CONSTRAINT timetable_entry_ord_chk CHECK (ord >= 1);
ALTER TABLE timetable_entry DROP CONSTRAINT timetable_entry_pkey;
ALTER TABLE timetable_entry ADD PRIMARY KEY (set_id, ord);
CREATE INDEX timetable_entry_minute_idx ON timetable_entry (set_id, minute);

-- 3) 역 권역: 시·도가 없는 역은 소속 노선 권역(national 제외)을 그대로 쓴다. 3개 이상이어도 national 을 더하지 않는다(기존 build.ts 규칙)
CREATE OR REPLACE VIEW v_station_area AS
SELECT s.id AS station_id,
       CASE WHEN s.region_code IS NOT NULL THEN ARRAY[(SELECT r.area_code FROM ref_region r WHERE r.code = s.region_code)]
            ELSE coalesce((SELECT array_agg(ra.code ORDER BY ra.ord) FROM ref_area ra
                            WHERE ra.code <> 'national'
                              AND ra.code IN (SELECT a FROM v_station_line v JOIN v_line_area la ON la.line_id = v.line_id,
                                                     unnest(la.areas) a WHERE v.station_id = s.id)), '{}'::text[])
       END AS areas
  FROM station s WHERE s.deleted_at IS NULL;
