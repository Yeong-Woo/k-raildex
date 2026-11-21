-- 0018 현재 단계: 같은 날짜의 폐기·휴면은 진행 단계 뒤에 둔다(docs/03-data-model.md 6절) — round-04 Q101 검토 때 발견
--
-- 0013 은 같은 날짜를 진행도 순으로 정렬해 abandoned·dormant(진행도 -1)가 먼저 오고, 같은 날의 reached(예: 폐기를 담은
-- 변경 고시 자체가 plan_listed 근거)가 계획을 되살렸다 → 인천 계획 4건이 단계 이력에 폐기 항목이 있는데도 plan_listed.
-- 기존 build-plans.ts 의 단계 순서(abandoned 가 맨 뒤)와 같게, 같은 날짜에서는 reached abandoned·dormant 와 kind dormant 를 마지막에.
CREATE OR REPLACE FUNCTION plan_current_stage(pid text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = public, osm, pg_temp AS $$
DECLARE e record; best integer := -1; cur text := NULL; ov text;
BEGIN
  SELECT stage_override INTO ov FROM plan WHERE id = pid;
  IF ov IS NOT NULL THEN RETURN ov; END IF;
  FOR e IN SELECT stage, kind FROM plan_stage_event WHERE plan_id = pid
            ORDER BY date_from NULLS LAST,
                     CASE WHEN kind = 'dormant' OR (kind = 'reached' AND stage IN ('abandoned', 'dormant')) THEN 1 ELSE 0 END,
                     plan_stage_progress(stage), id LOOP
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
