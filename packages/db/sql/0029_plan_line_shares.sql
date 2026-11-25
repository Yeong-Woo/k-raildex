-- 0029 계획 노선 역할 shares(선로 공용, 2026-11-25 사용자 지시): 새 계통 열차가 기존 노선 선로를 함께 쓰기만 하고
-- 그 노선을 고치지는 않는 경우(예: GTX-B 의 망우~마석 경춘선). upgrades(개량)와 같이 지도에 그리지 않는다
ALTER TABLE plan_line DROP CONSTRAINT plan_line_role_chk;
ALTER TABLE plan_line ADD CONSTRAINT plan_line_role_chk CHECK (role IN ('new', 'extends', 'upgrades', 'shares', 'replaces'));
