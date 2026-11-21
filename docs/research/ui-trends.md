# UI/UX 트렌드 조사 (WP 6.1, Q50·Q83)

> 작성 2026-11-21. 대상: 공개 사이트(Next.js, 06 문서)와 관리 앱(05 문서). 목적: "최신 UI/UX 트렌드를 찾아서 구현"(Q50)을 **이 사이트의 성격**(자료 밀도가 높은 한국어 철도 참고 사이트, 지도 중심, 출처 표기 필수, 비상업)에 맞게 거른다.
> 조사 방법: 웹 검색(2026-11-21 접근) + 기존 사이트(`future-rail-db` `apps/web/src/styles/global.css`, 기존 설계 `docs/legacy/design/site-structure.md` 16절) 검토. 출처는 각 절 끝에 URL·접근일로 적는다. 검색 요약만으로 확인한 것은 "(요약 확인)"으로 표시했고, 수치·규정은 원문으로 다시 확인할 것.
> 결과물: 시안 `docs/design/mockups/*.html`, 토큰 `docs/design/tokens.md`(구현 `packages/ui/src/tokens.ts`).

## 0. 요약 — 이 프로젝트에 적용할 것

| #   | 권고                                                                                                                                                                      | 적용                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| R1  | **Pretendard Variable(OFL) 자가 호스팅**, 동적 부분 집합(woff2, unicode-range). 실패 시 시스템 한글 글꼴. 본문 16px·줄 높이 1.7, `word-break: keep-all`                   | 토큰 `font-sans`, `base.css`       |
| R2  | **OKLCH 2층 토큰**(원색 → 의미 토큰), 라이트/다크는 의미 토큰만 재정의, hex 는 계산으로(지도·캔버스용). 모든 글자 쌍 4.5:1(본문 7:1)을 **시험으로 강제**                  | `tokens.ts` + `tokens.test.ts`     |
| R3  | 상태·단계는 **색 + 모양 + 글자** 세 겹(배지 아이콘 모양, 선 모양 실선/점선, 단계 띠 번호·이름). 노선 색은 띠·점·칩에만, 글자색으로 쓰지 않음                              | `STATUS_SHAPE`, `STAGE_GROUP_LINE` |
| R4  | 지도: **전체 화면 지도 + 접히는 옆 패널**(넓은 화면 왼쪽 384px, 좁은 화면 아래 시트), 연도 슬라이더는 지도 아래 고정 띠, 지도 밖 **목록 대체**(FR-WEB-026)                | 시안 `future-map.html`             |
| R5  | 상세 페이지 = **헤더 띠 + 핵심 수치 줄 + 2단(본문·옆 패널)**, 출처·검수 상태는 늘 보이게(헤더 배지 + 절 끝 출처), 동호인용 상세는 `<details>` 접힘                        | 시안 `line-detail` 등              |
| R6  | 표: 머리글 고정(sticky), 숫자 오른쪽 정렬 + `tabular-nums`, 행 높이 2단계(관리 앱 촘촘 / 공개 보통), 좁은 화면은 가로 스크롤 대신 **카드형 재배치** 또는 열 숨김          | 시안·관리 앱                       |
| R7  | 움직임 절제: 120~280ms, 상태 변화 설명용만. `prefers-reduced-motion` 이면 0. 페이지 전환은 **교차 문서 View Transitions** 를 점진적 향상으로만(지원 안 하면 그냥 이동)    | 토큰 `duration-*`                  |
| R8  | 접근성 기준을 **WCAG 2.2 AA**(+ KWCAG 2.2)로 올림: 포커스 가림 금지(2.4.11, 고정 헤더 `scroll-padding`), 포인터 대상 24×24px 이상(2.5.8), 끌기 대안(2.5.7: 슬라이더 버튼) | 06·09 문서 갱신 제안(Q-row)        |
| R9  | 성능: LCP ≤ 2.5s · INP ≤ 200ms · CLS ≤ 0.1(75 백분위). 글꼴 `font-display: swap` + 크기 맞춘 대체 글꼴, 지도는 상호작용 시 늦게 불러오기, 첫 화면 정적 SVG 미리보기       | NFR-WEB-001 보강                   |
| R10 | 추적·광고 없음. 다크 모드 선택은 `localStorage` 한 값(쿠키 없음), 통계는 서버 측 집계만(NFR-WEB-005)                                                                      | 그대로                             |
| R11 | **채택 안 함**: 글래스모피즘·네오브루탈리즘·큰 3D·스크롤 연출(패럴랙스)·AI 챗봇 창·무한 스크롤·쿠키 배너. 자료 사이트의 신뢰·밀도와 맞지 않거나 C-원칙에 어긋남           | —                                  |

## 1. 타이포그래피(한국어)

**현황.** 기존 사이트는 `Pretendard, 'Pretendard Variable', system-ui, …` 순서로 지정만 하고 글꼴 파일을 싣지 않아, 실제로는 대부분 시스템 글꼴(맑은 고딕·Apple SD 산돌고딕 Neo)로 보였다. 관리 앱은 `system-ui` 위주.

**트렌드·근거.**

- 국내 웹·앱에서 **Pretendard** 가 사실상 기본 산세리프가 됐다(Inter + Source Han Sans + M PLUS 1p 를 조합해 라틴·한글 조화를 맞춘 글꼴). **SIL Open Font License 1.1** — 상업 이용·수정·재배포 허용, 글꼴 단독 판매만 금지. 가변 글꼴(굵기 축 45~920)과 **동적 부분 집합**(unicode-range 로 쪼갠 woff2, 쓰는 글자 묶음만 받음)을 배포한다.
- 정부 디자인 시스템(KRDS, 2025-01 디지털 정부서비스 UI/UX 가이드라인에서 개명)도 Pretendard GOV 판을 쓴다(요약 확인). 공공 정보 사이트 이용자에게 익숙한 인상.
- CSS `text-wrap: balance`(제목)·`pretty`(본문)가 주요 브라우저에 들어왔다. **한국어는 `word-break: keep-all` 과 함께 써야** 어절 중간에서 끊기지 않는다. 긴 URL·영문은 `overflow-wrap: anywhere` 로 넘침 방지.

**결정 제안.**

- 글꼴: `Pretendard Variable` 동적 부분 집합 woff2 를 **공개 사이트 `public/fonts/` 에 자가 호스팅**(06 문서 4절 "외부 CDN 없음" 유지). `font-display: swap`, 첫 화면 글자 묶음 1~2개만 `preload`. 관리 앱은 글꼴 파일 없이 같은 글꼴 스택(설치돼 있으면 Pretendard, 아니면 시스템). 시안은 미리보기용으로만 CDN 을 쓴다.
- 크기 눈금: 12 / 14 / **16(본문)** / 18 / 20 / 24 / 30 / 표제 clamp(32~44). 한글 본문 줄 높이 1.7, 제목 1.15~1.35, 큰 제목 자간 −0.015~−0.025em. 숫자(연장 km·역 수·날짜)는 `tabular-nums`.
- 이름 표기: 한국어 주 + 아래 줄 작은 회색 영문·한자(기존 "이름은 두 줄" 규칙 승계).

출처: Pretendard GitHub https://github.com/orioncactus/pretendard (2026-11-21), Pretendard README(jsDelivr) https://cdn.jsdelivr.net/npm/pretendard@1.3.9/docs/en/README.md (2026-11-21), cdnjs Pretendard Variable CSS https://cdnjs.cloudflare.com/ajax/libs/pretendard/1.3.8/variable/pretendardvariable.css (2026-11-21), KRDS 개요 https://www.krds.go.kr/html/eng/outline/outline_01.html (2026-11-21), 디자인 나침반 KRDS 소개 https://designcompass.org/2024/04/17/krds/ (2026-11-21), MDN text-wrap https://developer.mozilla.org/docs/Web/CSS/text-wrap (2026-11-21), 한국어 줄바꿈 다듬기(Dale Seo) https://daleseo.com/css-text-wrap/ (2026-11-21), Chrome text-wrap: pretty https://developer.chrome.com/blog/css-text-wrap-pretty?hl=ko (2026-11-21).

## 2. 색 체계

**트렌드.**

- **OKLCH** 가 디자인 토큰의 표준 표기로 자리 잡았다. Tailwind v4 는 기본 팔레트 전체를 OKLCH 로 옮겼고(요약 확인), 지각 밝기(L)가 색상각과 무관하게 일정해 "같은 단계 = 같은 대비"를 맞추기 쉽다. 라이트/다크를 같은 L 축으로 뒤집어 설계할 수 있다.
- 2층 구조(원색 눈금 → 의미 토큰: `bg`·`surface`·`fg`·`border`·`accent`…)에서 **다크 모드는 의미 토큰만 재정의**하는 방식이 일반적이다.
- 대비 계산은 여전히 **WCAG 2.x 비율**이 규범이다. APCA 는 WCAG 3 초안에서 빠졌고(2023-07), 2025-09 초안 기준 WCAG 3 의 대비 방식은 미정이다 → APCA 는 참고만, 판정은 WCAG 2.2.

**이 프로젝트의 조건.** 노선 공식 색(서울 2호선 `#00A23F` 등, DB `line.color` + 출처)이 화면의 주 시각 요소인데, 공식 색은 대부분 흰 바탕 글자색으로 4.5:1 이 안 나온다. 그래서

- 노선 색은 **띠(6px)·세로 선·점·칩 바탕에만**. 칩 글자색은 대비가 더 큰 쪽(흰색/거의 검정)을 계산(`readableOn`). 2호선 초록 위 흰 글자는 3.3:1 이라 어두운 글자가 된다 — 공식 표지와 다르지만 접근성이 우선.
- 강조색(링크·주 버튼)은 노선 색과 겹치지 않는 **남색**(기존 `#0b4fa3` 계열 승계), 포커스 고리는 **주황**(기존 승계, 노선 색 위에서도 보임).
- 상태·단계·검수 색은 "글자(fg) / 바탕(bg) / 표시(mark)" 3종을 따로 둬서 배지 글자는 4.5:1, 점·선은 3:1(SC 1.4.11) 을 맞춘다.

출처: OKLCH, explained for designers https://uxdesign.cc/oklch-explained-for-designers-dc6af4433611 (2026-11-21), Tailwind CSS theme 문서 https://tailwindcss.com/docs/theme (2026-11-21), OKLCH 토큰 사례(ADR) https://specvital.github.io/en/adr/web/19-css-variable-design-token-system (2026-11-21), WCAG 3.0 초안(2025-09-04) https://www.w3.org/TR/2025/WD-wcag-3.0-20250904 (2026-11-21), Adrian Roselli "WCAG3 Contrast as of April 2026" https://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html (2026-11-21).

## 3. 지도 UI

**참고 사례.**

- **OpenRailwayMap-vector**: 래스터(Mapnik)에서 MapLibre 벡터 스타일로 옮긴 철도 지도. 신호·전철화·궤간 등 "주제별 스타일 전환" + 범례. 폐선은 OpenHistoricalMap 의 시점 데이터로 보여 준다 — **시점 지도**라는 점에서 우리 미래 지도와 같은 문제.
- **Mini Tokyo 3D**: 공식 노선도 색을 그대로 쓰고, 확대 수준마다 선 간격을 띄워 겹친 노선을 읽게 한다. 지상/지하 전환. 화려하지만 우리에게는 "공식 색 + 겹침 간격" 규칙만 가져온다.
- **MapLibre 공식 예제 "Create a time slider"**: 범위 입력 + 레이어 필터. `maplibre-gl-time-slider` 같은 접히는 패널·재생 버튼 플러그인도 있다(추가 의존성은 쓰지 않고 패턴만).
- HSL Transitlog UI 같은 운영 도구는 데스크톱 전용 "옆 패널 + 시간 막대" 배치 — 관리 앱에 맞고, 공개 사이트는 모바일에서 **아래 시트**로 바꿔야 한다.

**패턴 정리(공개 사이트 `/map/`).**

1. 지도 전체 화면 + 헤더 1줄. 왼쪽 패널(넓은 화면 384px, 접기 가능) = 현재/미래 전환 → 연도 → 단계 필터 → 범례 → 선택 개체 정보. 좁은 화면은 패널이 아래 시트(접힘 높이 = 연도 막대 + 요약 1줄).
2. **연도 슬라이더**: 눈금(현재 연도 ~ 마지막 개통 예정 연도 + "목표 미정") + 연도별 "새로 생김" 개수 막대(작은 히스토그램)로 어느 해에 변화가 몰렸는지 보여 준다. 끌기 대안으로 이전/다음 버튼과 키보드 ←/→ (SC 2.5.7).
3. 선 모양 = 단계(실선/굵은 점선/가는 점선), 색 = 노선 색 또는 단계 묶음 색, **이름 라벨**을 선 위에 → 색맹·흑백 인쇄에서도 구분. 개략 선형은 더 흐린 가는 점선 + 범례 "선형 미확정(개략)".
4. 지도 아래(넓은 화면은 패널 안) **목록 대체**: 선택 연도에 생기는/사라지는 노선·역. 지도 없이 같은 정보(FR-WEB-026, SC 1.1.1).
5. 배경 지도는 채도를 낮추고(−40% 이상) 철도 선이 주인공이 되게. 다크 모드에서는 배경 지도 밝기를 낮춤(raster-brightness-max). 출처 표기(VWorld·OSM ODbL)는 늘 보이게.

출처: OpenRailwayMap-vector https://github.com/hiddewie/OpenRailwayMap-vector (2026-11-21), OSM 포럼 발표 https://community.openstreetmap.org/t/openrailwaymap-vector-announcement/126995 (2026-11-21), OSM 위키 OpenRailwayMap https://wiki.openstreetmap.org/wiki/OpenRailwayMap (2026-11-21), Mini Tokyo 3D https://github.com/nagix/mini-tokyo-3d (2026-11-21), Mapbox 블로그 Mini Tokyo 3D https://blog.mapbox.com/mini-tokyo-3d-a-real-time-3d-map-of-public-transportation-in-tokyo-1f19fb207632 (2026-11-21), MapLibre time slider 예제 https://maplibre.org/maplibre-gl-js/docs/examples/create-a-time-slider/ (2026-11-21), HSL transitlog-ui https://github.com/HSLdevcom/transitlog-ui (2026-11-21).

## 4. 자료 표·정보 밀도

- 머리글 고정, 정렬 상태 표시는 늘 보이게(호버 때만 X), 빠른 필터는 표 위에 칩으로 + "모두 지우기". 밀도는 사용자 숙련도에 맞추고 선택 가능하게(Dynatrace 디자인 시스템: 기본/촘촘/여유 3단).
- "여백을 늘렸더니 업무 앱이 망가졌다"류 사례 — 전문 이용자에게는 밀도가 기능이다. 관리 앱은 촘촘(행 32px), 공개 사이트 목록은 보통(행 40~44px, 터치 대상).
- 위키백과 Vector 2022: 본문 폭 제한(이전에는 권장 글자 수의 3배 이상), 고정 머리(sticky header), 고정 목차. 폭 제한이 읽기 속도·정확도에 유리했다는 선행 연구를 근거로 들었다. → 상세 페이지 본문 `measure 68ch`, 옆 목차(넓은 화면)·절 앵커 유지(FR-WEB-004).
- 기존 사이트 평가 "나무위키에서 철도 정보만 뽑아낸 페이지 같다"(legacy 16절) → 밀도는 유지하되 **면(surface) 위 정보 + 헤더 띠 + 핵심 수치 줄**로 위계를 만든다.

출처: LogRocket data table design https://blog.logrocket.com/ux-design/data-table-design-best-practices/ (2026-11-21), Dynatrace DataTable https://developer.dynatrace.com/design/components/tables/DataTable/usage/ (2026-11-21), Basis 디자인 시스템 density https://design.basis.com/foundations/density (2026-11-21), "How white space killed an enterprise app" https://uxdesign.cc/how-white-space-killed-an-enterprise-app-and-why-data-density-matters-b3afad6a5f2a (2026-11-21), Smashing Magazine tables/grids https://www.smashingmagazine.com/2023/06/universal-cognitive-friendly-ux-design-tables-grids/ (2026-11-21), MediaWiki Desktop Improvements https://www.mediawiki.org/wiki/Reading/Web/Desktop_Improvements (2026-11-21), Wikipedia:Vector 2022 https://www.wikipedia.org/wiki/Wikipedia:V22 (2026-11-21).

## 5. 움직임

- 2025~2026 의 흐름은 "**의미 있는 짧은 전환**" — 상태 변화(패널 열림, 탭 전환, 지도 연도 바뀜)를 설명하는 120~300ms 정도. 장식용 스크롤 연출은 줄어드는 추세이고 자료 사이트에는 맞지 않는다.
- **View Transitions**: 같은 문서 API 는 2025 Baseline, 교차 문서(MPA) 전환은 Chrome/Edge 126·Safari 18.2 지원, Firefox 미지원. CSS `@view-transition { navigation: auto; }` 두 줄로 점진적 향상 가능 — Next.js 페이지 사이(목록 → 상세 헤더 띠)만 고려. `prefers-reduced-motion: reduce` 이면 끈다.
- 지도 이동(`flyTo`)은 450ms 이하, 줄임 설정이면 `jumpTo`.

출처: WebKit 블로그 교차 문서 View Transitions https://webkit.org/blog/16967/two-lines-of-cross-document-view-transitions-code-you-can-use-on-every-website-today/ (2026-11-21), Chrome "What's new in view transitions (2025)" https://developer.chrome.com/blog/view-transitions-in-2025 (2026-11-21), caniuse https://caniuse.com/cross-document-view-transitions (2026-11-21).

## 6. 접근성(WCAG 2.2 / KWCAG 2.2)

- **WCAG 2.2**(W3C 권고 2023-10-05)는 2.1 에 9개 성공 기준을 더하고 4.1.1(구문 분석)을 뺐다. 이 사이트에 직접 걸리는 것:
  - 2.4.11 포커스 가림 방지(최소, AA) — 고정 헤더·지도 아래 시트가 포커스된 요소를 가리지 않게 `scroll-padding-top`, 시트 높이만큼 여백.
  - 2.5.7 끌기 동작(AA) — 연도 슬라이더·역 순서 끌기(관리 앱)에 버튼/키보드 대안.
  - 2.5.8 대상 크기(최소, AA) — 포인터 대상 24×24 CSS px 이상(예외 있음). 표 안 작은 링크·칩·지도 범례 체크 상자.
  - 3.2.6 일관된 도움말, 3.3.7 중복 입력(관리 앱 폼), 3.3.8 접근 가능한 인증(관리 앱은 Cloudflare Access 라 해당 적음).
- **KWCAG**(한국형 웹 콘텐츠 접근성 지침)는 WCAG 를 인용 표준으로 국내 실정에 맞춘 것으로, 4원칙·14지침·33검사항목 구조(2.2판). 포커스 표시·끌기 동작·일관된 도움말이 강화됐다는 보도가 있다(요약 확인 — 고시 원문으로 검사항목 확인 필요).
- **색만으로 전달 금지(1.4.1)**: W3C 기법 G111(색 + 무늬) — 선 그래프·흐름도에서 실선/점선을 색과 함께 쓰는 예가 바로 미래 지도 선 모양 규칙과 같다.
- 현재 09 문서 NFR-OPS-020 은 "WCAG 2.1 AA". 2.2 는 2.1 의 상위 집합이라 기준을 올려도 기존 요구는 그대로 → **2.2 AA 로 올리기를 제안**(아래 결정 행).

출처: W3C What's New in WCAG 2.2 https://w3.org/WAI/standards-guidelines/wcag/new-in-22/ (2026-11-21), WCAG 2.2 https://www.w3.org/TR/WCAG22/ (2026-11-21), Deque WCAG 2.2 https://dequeuniversity.com/resources/wcag-2.2 (2026-11-21), W3C Understanding 1.4.1 https://w3.org/WAI/WCAG22/Understanding/use-of-color.html (2026-11-21), W3C 기법 G111 https://www.w3.org/WAI/WCAG22/Techniques/general/G111.html (2026-11-21), 요즘IT KWCAG 정리 https://yozm.wishket.com/magazine/detail/1942 (2026-11-21), 스페셜타임스 KWCAG 기사 https://www.specialtimes.co.kr/news/articleView.html?idxno=480448 (2026-11-21).

## 7. 성능(Core Web Vitals)

- 좋음 기준(75 백분위): **LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1**. INP 가 2024-03 에 FID 를 대체했다(web.dev 기준 문서, 2025-05 갱신).
- 이 사이트에서의 함정과 대응:
  - 한글 웹 글꼴(수 MB) → 동적 부분 집합 + `swap` + 대체 글꼴 `size-adjust` 로 CLS 억제.
  - MapLibre(≈ 800KB+ JS) → `/map/` 과 상세 페이지 "지도에서 보기" 클릭 시에만 불러오기. 상세 페이지의 작은 지도는 서버에서 만든 **정적 SVG 노선 약도**로 대체(LCP·JS 0).
  - 긴 역 순서·시간표 표 → 서버 렌더 + `content-visibility: auto`, 필터는 작은 클라이언트 섬(NFR-WEB-002).
  - 미래 지도 연도 전환 < 300ms(NFR-WEB-001) → 연도별 GeoJSON 을 미리 나누지 말고 한 번 받아 `setFilter` 로(INP).

출처: web.dev "How the Core Web Vitals metrics thresholds were defined" https://web.dev/articles/defining-core-web-vitals-thresholds (2026-11-21).

## 8. 참고 사이트 비교

| 사이트                          | 가져올 것                                                     | 가져오지 않을 것               |
| ------------------------------- | ------------------------------------------------------------- | ------------------------------ |
| 위키백과(Vector 2022)           | 본문 폭 제한, 고정 목차, 각주식 출처, 고정 머리               | 긴 정보 상자 일변도            |
| 나무위키(국내 이용자 익숙)      | 접힘 절, 표 중심 정보, 노선 색 띠                             | 광고·과밀 배치(C 비상업)       |
| OpenRailwayMap-vector           | 주제별 지도 스타일 전환, 범례, 시점 데이터                    | 신호 등 전문 레이어(범위 밖)   |
| Mini Tokyo 3D                   | 공식 노선 색, 확대 수준별 선 간격                             | 3D·실시간 열차 애니메이션      |
| KRDS(정부 디자인 시스템)        | 공공 정보 이용자에게 익숙한 위계·Pretendard GOV·접근성 점검표 | 정부 표지·상징(사칭 오해 방지) |
| 기존 k-raildex.com(legacy 16절) | 토큰 체계, 헤더 띠 + 2단, 이름 두 줄, 검수 배지, 포커스 주황  | 지정만 하고 싣지 않은 웹 글꼴  |

## 9. 결론 — 구체 권고(구현 순서)

1. 토큰(`packages/ui/src/tokens.ts` → `tokens.css`, Tailwind 연결 `tailwind.css`, 기본 `base.css`)을 단일 원천으로. 관리 앱은 별칭으로 바로 교체(완료, WP 6.3).
2. 공개 사이트 레이아웃 4종: 홈(검색 중심 + 진입 카드 + 개통 예정·최근 변경), 상세(헤더 띠 + 핵심 수치 + 2단 + 출처 절), 목록(도구 모음 면 + 표/카드), 지도(전체 화면 + 패널/시트 + 연도 띠). 시안 5개 참조.
3. 배지 3종 컴포넌트(`StatusBadge` 모양 아이콘, `StageBadge`, `ReviewBadge` 점선 테두리)와 단계 진행 띠(`StageTrack`: 12칸 번호 + 현재 칸 `aria-current="step"`)를 `packages/ui` 에 추가(WP 6.4 이후).
4. 노선 칩(`LineChip`: 노선 색 바탕 + `readableOn` 글자 + 이름), 노선 약도 SVG(역 순서 → 세로/가로 선).
5. 기준 상향: 접근성 WCAG 2.2 AA, 성능 CWV 3지표(INP 추가). 06·09 문서에 반영(결정 행 제안).
