# 기술 스택 조사

- 조사일: 2026-10-11
- 전제(docs/REFERENCE.md 결정 사항): 전국 범위(D1), 실시간 없음(D6), 단독 운영자·git 파일 편집(D9), 코드·데이터 공개(D12), 수기 + API 혼합 수집(D5), 백엔드가 필요하면 NestJS + PostgreSQL(D8)
- 출처: 각 프레임워크 공식 문서에 대한 일반 지식. 수치(번들 크기 등)는 쓰지 않는다. 선택 전 최신 버전 확인 필요.

## 1. 데이터 규모 추정 (설계 판단용)

| 개체 | 전국 추정 규모 | 근거 |
|---|---|---|
| 역 | 수천 개 (도시철도 약 1천 + 일반·고속철도 수백 + 폐역) | noseon.do 수도권만 808역 |
| 노선(물리) | 수백 개 | 국가철도 간선·지선 + 도시철도 + 계획 노선 |
| 운행 계통 | 수십~백여 개 | 호선·KTX 계통·광역전철 계통 |
| 계획 노선 | 수백 개 | 제4차 국가철도망 신규·추가검토 + 도시철도망 계획 |
| 이벤트(개통·변경 이력) | 수천 건 | 1974~ 누적 |
| 선형(geometry) | 노선당 수백~수천 좌표 | 지도 탭용. 수 MB 수준 |
| 계획 시간표 | 운행 계통당 수백 열차 | 정적 파일로 충분 |

→ 전부 합쳐도 **수십 MB 이하의 정적 데이터**. 사용자 쓰기 없음, 실시간 없음. 서버 상주 프로세스가 반드시 필요한 요구사항은 현재 없다.

## 2. 선택지 비교

### A. 정적 사이트 생성(SSG) + git 안의 구조화 데이터
- 구조: `data/`(YAML/JSON) → 빌드 스크립트가 검증·정규화 → 페이지 생성 → 정적 호스팅(GitHub Pages, Cloudflare Pages, Vercel).
- 장점: 운영비 0에 가까움, 서버 관리 없음, 데이터 변경 이력이 git에 그대로 남음(D9·D12와 정합), 공개 저장소에서 데이터와 코드가 한 곳.
- 단점: 조합 검색·필터는 클라이언트에서 처리(수천 건이면 문제 없음). 데이터가 커지면 빌드 시간 증가. 로그인·편집 UI 없음(필요 없음).
- 후보 프레임워크
  - **Astro**: 콘텐츠 중심 사이트에 적합. Content Collections로 YAML/JSON/Markdown에 스키마(zod) 검증 제공 → "데이터 검증"을 프레임워크가 해 줌. 필요한 페이지에만 React/Svelte 등 섬(island)을 넣어 지도 탭 구현 가능. 기본 출력이 JS 없는 HTML이라 가독성·속도에 유리.
  - **Next.js(SSG/App Router)**: React 생태계 최대. 정적 내보내기(`output: 'export'`) 가능. 지도·인터랙션이 많은 페이지에 유리. 다만 콘텐츠 스키마 검증은 직접 구성.
  - **SvelteKit(adapter-static)**: 가볍고 빠름. 생태계는 React보다 작음.
- SEO: 역·노선 페이지가 서버 렌더링된 HTML로 나오므로 검색 노출에 유리(noseon.do와 같은 장점, 미래철도20XX의 약점 회피).

### B. NestJS + PostgreSQL + 프론트엔드(SPA 또는 SSR)
- 구조: Postgres(+PostGIS)에 데이터 적재 → NestJS REST/GraphQL → 프론트엔드.
- 장점: 복잡한 질의(공간 질의, 조합 필터, 전문 검색)가 쉬움. 데이터가 커져도 빌드 시간 영향 없음. 향후 사용자 기능(제보, 즐겨찾기)·관리 UI 추가가 쉬움.
- 단점: 서버·DB 상시 운영(비용·보안·백업), 1인 운영 부담. "데이터의 원본"이 DB가 되면 git 이력과 이중화됨(또는 git → DB 적재 파이프라인 필요). D6·D9 조건에서는 과잉.
- 적합 시점: (1) 공간 질의가 필요할 때(예: "이 좌표 반경 1km 안의 계획 역"), (2) 데이터가 정적 빌드로 감당 안 될 때, (3) 사용자 쓰기 기능이 생길 때.

### C. 절충: git 데이터 → 빌드 시 SQLite/DuckDB 생성 → 정적 사이트 + 클라이언트 질의
- 빌드 시 구조화 파일을 SQLite로 묶고, 브라우저에서 sql.js/DuckDB-WASM으로 질의. 또는 미리 계산한 JSON 인덱스(지역 × 단계 × 연도)를 내보냄.
- 서버 없이도 조합 필터·검색 가능. 데이터가 커지면 B로 이행할 때 스키마를 그대로 쓸 수 있음.

## 3. 공통 구성 요소 (A/B/C 모두)

| 요소 | 권장 | 이유 |
|---|---|---|
| 데이터 원본 | git 안 YAML(사람이 편집) + JSON(API 적재 결과) | D5·D9. diff 리뷰 가능 |
| 스키마 검증 | JSON Schema 또는 zod. CI에서 검증 | 수기 입력 오류 방지. 출처·확인일 필드 필수화 |
| 식별자 | 자체 안정 ID(예: `stn-seoul-0001`) + 외부 코드 매핑(코레일 역 코드, 서울교통공사 코드) | 기관마다 코드가 다르고 변함 |
| 지도 | 지도 조사 결과(docs/research/map-and-geometry.md)에 따름 | |
| 검색 | 클라이언트 인덱스(Pagefind, FlexSearch, MiniSearch) | 정적 사이트에서 역·노선 검색 |
| 호스팅 | GitHub Pages 또는 Cloudflare Pages | 공개 저장소와 연동, 무료 |
| CI | GitHub Actions: 스키마 검증 → 빌드 → 배포. API 대조 작업은 주간 스케줄 | |
| 국제화 | 데이터 필드 `name_ko`, `name_en`. UI는 한국어 고정, 영문 병기 | D10 |

## 4. 데이터 모델 초안 (스택과 무관)

핵심 개체와 관계. noseon.do의 "일정 / 노선 / 역" 3축을 확장.

```
Operator(운영기관)      id, name_ko, name_en, type(국가/지방공사/민간)
Line(노선, 물리)        id, name_ko, name_en, category(고속/일반/도시/광역지정), operator, status, opened_at, length_km, gauge, electrification, track_count, sources[]
Section(구간)           line, from_station, to_station, status, opened_at, closed_at   ← 부분 개통·폐선 표현
Station(역)             id, name_ko, name_en, aliases[], lat, lng, status(운영/계획/폐역), opened_at, closed_at, codes{korail, seoul, ...}, sources[]
LineStation(노선-역)    line, station, order, km, platform_type, transfer_group
Service(운행 계통)      id, name_ko, name_en, train_class(KTX/ITX/전동열차 ...), operator, sections[] (Line 구간 열), stop_pattern(완행/급행)
Timetable(계획 시간표)  service, direction, day_type, departures[]   ← 정적
Plan(계획 사업)         id, name, lines[] 또는 geometry, stage(구상/반영/사타/예타/기본계획/설계/시공/개통/폐기), plan_refs[](국가철도망 4차 신규 ...), target_open_year, cost_krw, sources[]
PlanStageHistory        plan, stage, date, source
Event(이벤트)           type(개통/폐지/역명변경/환승개시/운행종료/단계변경), date, precision(일/월/반기/연/미정), refs(line/station/plan), source
Source(출처)            id, title, publisher, url, published_at, checked_at, type(고시/보도자료/API/언론)
Geometry(선형)          line 또는 plan, GeoJSON LineString[], source, accuracy(공식/OSM/수기)
```

- 모든 사실 필드에 `sources[]`와 `checked_at`을 붙인다(CLAUDE.md 정확성 원칙).
- 상태값: `operating / planned(stage) / abandoned(폐기) / closed(폐선·폐역)` → D11의 "폐선·폐역" 탭은 `closed` 필터.

## 5. 권장안

1. **1순위: A(정적 사이트) + C의 사전 계산 인덱스**. 프레임워크는 **Astro**(콘텐츠 스키마 검증 내장, 지도 탭만 React 섬). 데이터는 git 안 YAML/JSON, CI에서 검증·빌드·배포.
2. **NestJS + PostgreSQL은 보류**하되, 데이터 모델을 처음부터 관계형으로 설계해 나중에 그대로 적재할 수 있게 한다. 이행 트리거: 공간 질의 필요, 빌드 시간 한계, 사용자 쓰기 기능.
3. 결정 전 확인: Astro Content Collections가 수천 개 항목·GeoJSON 파일을 다루는 빌드 시간(프로토타입으로 검증), 지도 조사 결과의 라이브러리와 Astro 섬 조합.

## 6. 남은 질문 (REFERENCE.md에 올림)
- 프론트엔드 프레임워크 선호(Astro 제안 vs Next.js). 사용자가 NestJS를 언급했으므로 TypeScript·Node 생태계는 확정으로 본다.
