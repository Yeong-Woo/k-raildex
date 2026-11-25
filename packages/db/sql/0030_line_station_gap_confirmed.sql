-- 0030 V-S04 거리 확인(2026-11-26 사용자 지시): 앞 역과의 거리가 상한을 넘어도 실제로 맞는 노선일 수 있다.
-- 검수자가 "맞음"으로 확인하면 그때의 앞 노선별 역 id 를 적는다. 순서가 바뀌어 앞 역이 달라지면 다시 V-S04 에 나온다.
-- km 역행은 확인으로 빠지지 않는다(자료 오류)
ALTER TABLE line_station ADD COLUMN gap_confirmed_prev_id text;
