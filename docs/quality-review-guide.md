# 품질 목록 검수 안내 (관리 앱)

규칙별 검수 매뉴얼은 **관리 앱 → 품질**(`/quality`)에서 규칙을 고르면 목록 위 "검수 방법"으로 보인다(2026-11-26).
원문은 `packages/domain/src/quality-guide.ts` 한 곳 — 규칙 SQL(`quality.ts`)을 바꾸면 같은 커밋에서 매뉴얼의 "빠지는 조건"도 고친다(모든 규칙에 매뉴얼이 있는지 시험이 확인한다).

좌표·선형 규칙(V-S02·V-S12·X-station-no-coord·X-station-near-other-name·X-construction-no-geometry)은 행마다 지도 도구(지도에서 찍기·계획 선형 편집·OSM 매핑 점검)로 바로 가는 단추가 있다.
