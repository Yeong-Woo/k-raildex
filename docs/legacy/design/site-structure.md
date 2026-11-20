# 사이트 구조 (Phase 1-9 ~ 1-11)

> 2026-10-14: 공개 사이트를 Astro 정적 사이트에서 **Next.js SSR**(apps/web/src/app)로 옮겼다. 라우트·화면·컴포넌트 구성은 이 문서와 같고, 파일 대응은 `pages/x/index.astro` → `app/x/page.tsx`, 컴포넌트는 `components/*.tsx`, 페이지 스크립트는 `client/*.ts`(init) 이다. 데이터는 빌드가 아니라 요청 때 API 에서(platform-architecture.md 3-5절).

- 작성일: 2026-10-11 (round-1 답변 반영: 2026-10-11)
- 범위: Astro 정적 사이트의 라우트, 공통 컴포넌트, 기본/상세 모드(D2), 검색, base 경로 처리
- 데이터 모델: `apps/web/src/content.config.ts`(zod) = `packages/schema/*.schema.json`. 사이트는 컬렉션만 읽고 값을 하드코딩하지 않는다.
- round-1 에서 바뀐 것: 운영기관 개체·페이지 제거(Q24), 역 목록을 시·도별 페이지로 분할(Q29), 참조 누락은 빌드 실패(Q30), 역번호·순서 미확인 표시(Q22/Q26), 열차 등급 10종·별칭(Q25), 코레일 노선도 embed(Q34), 용어 앵커를 제목 앞부분으로 찾기(Q31).
- round-2 에서 바뀐 것(2026-10-11): 헤더는 탭 우선(D19), 분류 두 축 분리(12절: 노선 법적 분류 + 광역철도 지정 / 운행 계통 종류 / 역은 정차 열차 기준), 권역 페이지(Q45 B), 역번호 배지(Q46 B), 운영기관명은 접힘 상세로(Q47 C), 검수 상태 표시(Q43 B), 지도 미분류 선형은 이름 있는 것만 기본(Q48 C), bbox 남쪽 36.6(Q49 A), 수도권 전철 노선색(Q50 C).
- round-4 2차(Phase 4·5·6 화면, 2026-10-11, 14절): **열차 탭**(D28 `/trains/` 열차번호 체계 + 열차번호 찾기, 열차 등급은 하위 절), **역 시간표 절·운행 계통 운행 시간·배차 절**(Phase 4, `timetableSummaries` + `apps/web/public/timetable/<station_id>.json`), **연표**(`/timeline/`), **폐선·폐역**(`/closed/`), 상세 "연혁" 을 events 기반으로 통일, **Atom 변경 로그**(`/changes.xml`)·`/sitemap.xml`·`/robots.txt`, 헤더 10탭(모바일 두 줄), 기본 권역 JSON 생성 제외.
- round-5 시각 디자인 개편(2026-10-12, 16절): 디자인 토큰·상세 헤더 밴드 + 2단·보조 탭(계획 5개/열차 2개)·영문명 아래 줄(`NameText` 블록)·열차 탭 묶음 접기·열차 등급 추적 체인·연표 10년 분할(`/timeline/<decade>/`)·첨두/비첨두 배차·Atom published/updated·개발용 설명문 제거(`Help` 접힘).
- round-3 반영·round-4 wave1 에서 바뀐 것(2026-10-11, 13절): **권역 필터**(D20: 노선·역·운행 계통·계획 목록, 기본 수도권, `?area=`), **운행 계통 탭 열차/전철**(D21), **정식 명칭 병기**(D23 `name.full`), **개통 예정 페이지**(Q58 `/upcoming/`)·미개통 배지·휴업(suspended) 상태(Q59), **계획 탭**(D22 `/plans/`, `/plans/[id]/`), 지도 권역 버튼·`#plan=`·휴업 점선, 권역 슬러그를 스키마 area enum 과 일치(`gangwon-area`→`gangwon`, `jeju-area`→`jeju`).

## 1. 라우트

모든 경로는 정적(`getStaticPaths`). 빌드 형식 `directory`(끝에 `/`).

| 경로                        | 파일                                      | 내용                                                                                                                                                                                                                 | 데이터 비어 있을 때           |
| --------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `/`                         | `apps/web/src/pages/index.astro`                   | 소개 한 단락, 검색 폼, 노선·역·운행 계통 수, 최근 확인일(provenance.checked_at 최댓값), 지역별 노선·역 수 표(지역 이름 → 지역 역 목록 링크, 지역 없음은 "지역 미상"), 노선도·용어·출처·소개 카드                      | "아직 데이터가 없습니다" 안내 |
| `/lines/`                   | `apps/web/src/pages/lines/index.astro`             | **법적 분류 탭**(전체 / 고속철도 / 일반철도 / 도시철도, `?class=`) + **권역 필터**(D20, `?area=`, 기본 수도권, 13절) + "광역철도 지정만" 토글(`is_wide_area`) + 범주·시·도·상태 필터. 표는 분류별 구역(`#class-<값>`)으로 나뉘어 JS 없이도 탭 링크가 구역으로 이동. 노선명은 정식 명칭 병기(D23). 미개통 노선은 상태 칸에 "미개통 · 공사 중/계획 + 목표일". 자동 수집(검수 전) 노선은 이름 옆 "검수 전" 배지. 운영 열 없음(Q47 C) | 안내문                        |
| `/lines/[id]/`              | `apps/web/src/pages/lines/[id].astro`              | 기본 정보(분류: "일반철도 · 광역철도 지정" 식, 검수 전 배지) → 역 순서(본선 → 지선 → **순서 미확인**; 역번호 `station_code` 를 이름 앞에 작게, 환승 노선, 좌표 미확인 배지) → 지나는 운행 계통 → 상세(접힘: **운영기관명 원문**·검수 상태·사양·외부 코드·KP 표·출처) | 페이지 미생성                 |
| `/stations/`                | `apps/web/src/pages/stations/index.astro`          | **필터형 역 목록**(D20): 정차 열차 기준 탭(`?class=`) + **권역 필터**(`?area=`, 기본 수도권) + 이름·구분(시설)·시·도·**개통 필터**(`?status=`: 기본 `open` = 개통 역만, `unopened` = 공사 중·계획, 2026-10-14 사용자 지시 — 미개통 역은 따로; 탭·권역 숫자도 개통 필터에 따라 바뀜) + 초성 칩. **기본 권역(수도권) 행만 서버 렌더**하고 다른 권역·전체 보기는 `/stations/by-area/<slug>.json` 을 받아 같은 표에 행을 추가(`apps/web/src/scripts/station-table.ts`). 권역·시·도 페이지는 필터 아래 작은 링크(딥링크 유지). 전부 auto 면 상단 검수 안내. 헤더 검색의 JS 없는 폴백(`?q=`) 결과(역번호·정식 명칭 포함) | 안내문                        |
| `/stations/by-area/[slug].json` | `apps/web/src/pages/stations/by-area/[slug].json.ts` | 권역별 역 행 JSON(`apps/web/src/lib/station-rows.ts` 모양: 이름·정식 명칭·분류·역번호·상태·시·도·노선·좌표·개통 목표). slug = 권역(capital…) 또는 `unknown`(지역 미상). **기본 권역(서버 렌더, `defaultAreaOf`)은 생성하지 않는다**(round-4 2차) | 생성 안 됨                    |
| `/stations/region/[slug]/`  | `apps/web/src/pages/stations/region/[slug].astro`  | 시·도 **또는 권역**(`capital`·`southeast`·`daegyeong`·`chungcheong`·`honam`; 시·도 하나짜리 권역은 그 시·도 페이지로)의 역 표(분류 배지·역번호·권역이면 시·도 열). 정차 열차 기준 탭(`?class=`), 이름·초성·역번호 검색, 초성 칩, 상태·(권역) 시·도 필터. 지역 노선이 모두 auto 면 상단 "자동 수집 데이터(검수 전)" 안내. slug 는 `apps/web/src/lib/region.ts` | 페이지 미생성                 |
| `/stations/[id]/`           | `apps/web/src/pages/stations/[id].astro`           | 이름(한/영/한자), 상태·분류(정차 열차 기준; 노선 기준 폴백이면 "노선 기준")·검수 전 배지, **노선별 역번호 배지**(노선 색 점 + 역번호 + 노선명, Q46 B), 지역·주소·좌표, 속한 노선 표, 환승 묶음, **연혁**(events 기반 `EventTimeline`; 철도역 정보 `history` 텍스트는 "기관 연혁(원문)" 접힘), 정차 운행 계통, **시간표**(`StationTimetable`, 14-2절) → 상세(접힘: 노선 분류·정차 운행 계통 종류·검수 상태·코드·출처) | 페이지 미생성                 |
| `/services/`                | `apps/web/src/pages/services/index.astro`          | **열차 / 전철 두 탭**(D21, `?group=train|metro`, 기본 열차; 열차 = 고속열차·일반열차·관광열차, 전철 = 광역전철·도시철도, 판정 `serviceGroupOf`) + **권역 필터**(`?area=`) + 종류·상태 select. 카드마다 종류 배지. 구역 `#group-<값>`                            | 안내문                        |
| `/plans/`                   | `apps/web/src/pages/plans/index.astro`             | **계획 탭 "국가철도망 구축계획"**(D22): 차수 탭(`?program=`, 기본 `national_rail_4`; 3차·5차·도시철도망·광역교통은 데이터에 있을 때) + 권역 필터 + 구분(신규/추가검토/기시행)·단계(10단계 `PLAN_STAGE_LABEL`)·이름 select. 한 사업이 여러 차수에 실리면 차수 구역마다 한 행(그 차수의 plan_refs 값). 행: 노선명(정식 명칭)·구분·구간·사업내용·연장·사업비·현재 단계(배지, 신호등 색)·개통 목표/개통일 | "계획 데이터 준비 중" 안내    |
| `/plans/[id]/`              | `apps/web/src/pages/plans/[id].astro`              | 기본 정보(단계 배지·구간·현재 단계 + 10단계 진행 띠·개통 목표·지역/권역·운영 예정) → 차수별 반영 내역 표(출처 링크) → **단계 타임라인**(`stage_history` + `plan_ids` 로 연결된 Event 를 날짜순 세로, 출처 링크) → 관련 노선·**관련 계획**(`related_plans` 정방향 + 이 사업을 가리키는 역방향 "선행 사업", 관계 라벨·단계 배지·근거 note·출처, 2026-10-15)·역 링크 → 출처(접힘). "지도에서 보기" = `/map/#plan=<id>` | 페이지 미생성                 |
| `/transfer-centers/`        | `apps/web/src/pages/transfer-centers/index.astro`  | **환승센터·복합환승센터**(계획 탭 보조 탭, 2026-10-13): 상태별 요약 + 권역 필터 + 상태·기본계획(차수)·이름 필터. 행: 사업명(종류·옛 이름)·상태 배지(신호등 색 재사용)·시·도·연계 역·연계 계획 노선·차수별 반영(1차 시범 → 2차 거점 → 3차 → 4차)·최신 총사업비 | — |
| `/transfer-centers/[id]/`   | `apps/web/src/pages/transfer-centers/[id].astro`   | 기본 정보(상태·지역·연계 역·총사업비·반영 차수) → **현재 상황**(상태·기준일·출처 + status_history) → **개발 계획**(차수별 반영 표: 구분·원문 사업명·철도 현황/장래·총사업비·출처 쪽) → **연계 노선**(연계 역의 운행 노선 + 연계 계획 사업 단계·개통 목표) / 사이드: 지도(연계 역)·연계 역·같은 역의 다른 환승센터·출처. 역 이름 옆 태그(`TransferCenterTag`)는 역 목록·역 상세·노선 역 순서·시·도 역 목록에, 계획 상세 사이드에는 "연계 환승센터" | 페이지 미생성 |
| `/upcoming/`                | `apps/web/src/pages/upcoming/index.astro`          | **개통 예정**(round-3 Q58): status `planned`·`under_construction` 인 노선·역 + 미개통 계획(개통·폐기 아닌 단계)을 개통 목표(fuzzyDate, `fuzzyDateKey`)순으로. 관련 계획 링크·단계 배지. 미정은 맨 뒤                                                          | 안내문                        |
| `/services/[id]/`           | `apps/web/src/pages/services/[id].astro`           | 종류·열차 등급·지나는 노선, 정차 패턴 비교표(● 정차 / — 통과; 노선을 둘 이상 지나면 정차역이 놓인 물리 노선 열 추가), 정차 패턴 용어 링크, **운행 시간·배차**(이 운행 계통의 역별 요약을 요일·방면으로 묶어 첫차 최솟값·막차 최댓값·편수 범위·평균 배차 추정; 없으면 준비 중 안내), **열차번호대**(이 운행 계통을 참조하는 range), **연혁**(events) → 상세(접힘) | 페이지 미생성                 |
| `/trains/`                  | `apps/web/src/pages/trains/index.astro`            | **열차 탭(D28)**: 두 부로 나뉜다. 상단에 열차번호 / 차량번호 / 편성번호 개념 설명(용어 링크) + 두 부로 가는 `.concept-switch`. **1부 열차번호(운행 번호)** `#train-numbers`: `trainNumberRanges` 를 묶음(고속열차/일반열차/광역전철/도시철도/화물/비영업/기타)별 표(번호대·약호·운영자·열차 등급 링크·운행 계통 링크·구간·홀짝 규칙·비고·출처)로. **2부 차량번호(차호)·편성번호** `#vehicle-numbers`(2026-10-12): `rollingStockNumberRanges` 를 묶음(고속철도차량/간선 전기동차/광역철도차량/도시철도 전동차/기관차/객차·발전차/화차)별 `.rsn-table`(차량번호 범위·호대·운영자·차종·열차 등급·운행 계통·노선·편성·상태·규칙·소유·출처, auto 는 "검수 전")로. 상단 "번호로 찾기"(`apps/web/src/scripts/train-number-search.ts`: 두 표의 `data-*` 만 읽어 열차번호·차량번호·편성번호 세 체계를 동시에 찾고 맞는 쪽을 전부 표시, `?n=`). 보조 탭으로 열차 등급. 출처 안내 `TRAIN_NUMBER_NOTICE`·`ROLLING_STOCK_NOTICE` | 부마다 `TRAIN_NUMBER_EMPTY_NOTICE` / `ROLLING_STOCK_EMPTY_NOTICE` |
| `/train-classes/`           | `apps/web/src/pages/train-classes/index.astro`     | 등급 10종을 tier 순(고속 → 준고속 → 특급 → 일반 → 통근)으로. 상단에 tier별 목차, 각 항목에 `aliases`("다른 이름": KTX-1 등), `#tc-...` 앵커. round-4 2차: 열차 탭의 하위 절(보조 탭) + 등급별 "열차번호대" 링크 | 안내문                        |
| `/timeline/<decade>/`       | `apps/web/src/pages/timeline/[decade].astro`       | **연표 10년 단위 페이지**(round-4 Q87 B): `2010s`·`2000s`…·`unknown`(연도 미상). 최신 10년은 `/timeline/` 이 맡는다. 본문은 `TimelineDecade` 공용, 상단에 연대 목차(연대별 건수). 항목 링크는 `apps/web/src/lib/timeline.ts eventHref` 로 그 연대 페이지를 가리킨다 | 생성 안 됨 |
| `/timeline/`                | `apps/web/src/pages/timeline/index.astro`          | **연표(Phase 5, round-5: 최신 10년만)**: `events` 를 연도별(최신 연도 먼저, 연도 안 날짜순) 세로 타임라인(`EventTimeline`). 유형 배지, 권역 필터(D20, `areas` 없으면 `eventAreas` 로 연결 개체에서 도출), 유형 select·검색, 연도 점프 목차. 항목 id = event id(상세 "연표에서 보기"·Atom 링크 앵커). `#evt-…` 로 들어왔는데 가려져 있으면 전체 보기로 전환 | 안내문                        |
| `/closed/`                  | `apps/web/src/pages/closed/index.astro`            | **폐선·폐역(Phase 5)**: status `closed`·`suspended`·`abandoned` 노선·역·운행 계통 + stage `abandoned` 계획을 묶음별 표(이름·분류·폐지일/휴업일·사유 = 연결된 폐지/휴업 이벤트 메모·관련 이벤트 앵커·출처). **헤더의 별도 탭**(2026-10-13 사용자 요청; 그 전에는 계획 보조 탭). 상단 보조 탭 = 묶음(노선/역/운행 계통/폐기된 계획) 앵커 | 안내문                        |
| `/changes.xml`              | `apps/web/src/pages/changes.xml.ts`                | **Atom 변경 로그(Phase 6)**: events 최근 100건(날짜 = `fuzzyDateIso` 시작일) + 빌드 날짜 "데이터 갱신" 항목. 절대 URL = `site` + base. `<link rel="alternate">` 를 모든 페이지 head 에 | 갱신 항목 1건                 |
| `/sitemap.xml`, `/robots.txt` | `apps/web/src/pages/sitemap.xml.ts`, `robots.txt.ts` | 직접 생성(통합·CDN 없음). 정적 라우트 + 노선·역·운행 계통·계획·시·도·권역 페이지, lastmod = `provenance.checked_at`. robots 는 전부 허용 + Sitemap | —                             |
| `/map/`                     | `apps/web/src/pages/map/index.astro`               | **지도 탭(Phase 2)**. MapLibre GL JS + VWorld WMTS 배경(Base/white/midnight, 대체 OSM) 위에 `apps/web/public/map/lines.geojson`(OSM 선형, ODbL)·`apps/web/public/map/stations.geojson`(자체 역 좌표)을 그린다. 필터(상태·범주·미분류·계획 노선(개략) — 기본 꺼짐, 2026-10-18 사용자 결정), 배경 선택, 수도권/전국 보기, 노선 이동 select, 클릭 팝업, URL 해시 `#line=<id>`/`#station=<id>`. 클릭은 누른 점 주변 상자(손가락 입력 18px, 마우스 7px)에서 역 → 노선 → 계획 노선 순으로 찾고, 여럿이면 고르는 목록 팝업(2026-10-14 모바일 편의); 손가락 입력이면 역 원을 1.6배로. JS 는 이 페이지에서만 로드. 상세는 11절 | 키 없으면 안내 + 빈 배경 위 노선·역 |
| `/maps/`                    | `apps/web/src/pages/maps/index.astro`              | routeMaps 를 지역별로. 상단에서 `/map/` 로 링크. `embed`: `apps/web/public/route-maps/<file>` 원본 그대로(CSS 폭 100%만; `width/height` 는 빌드 시 파일 헤더에서 읽음, `loading="lazy"`, 클릭·링크로 원본 파일 새 탭) + attribution 그대로 figcaption. `link`: 외부 링크 카드 | 안내문                        |
| `/terms/`                   | `apps/web/src/pages/terms/index.astro`             | `docs/TERMINOLOGY.md` 를 빌드 시 import(복사 없음). h2/h3 목차 자동 생성. 앵커는 Astro 기본 슬러그                                                                                                                   | —                             |
| `/sources/`                 | `apps/web/src/pages/sources/index.astro`           | 공공누리 출처표시 문구, 코레일 노선도·OSM 조건, sources 전체 표(행 id = source id → `#src-...` 앵커)                                                                                                                  | 안내문                        |
| `/about/`                   | `apps/web/src/pages/about/index.astro`             | 소개, 비상업 고지, 라이선스(코드 MIT·자체 데이터 CC BY 4.0), 참고 사이트(데이터 복제 없음 명시)                                                                                                                      | —                             |
| `/system-summary/`          | `apps/web/src/app/system-summary/page.tsx`         | **시스템 구조도(2026-11-18)**: 정보 출처 → 수집·편집 → 원천·처리 → 사이트 → 호스팅(Cloudflare Tunnel) 노드와 연결선, 노드 클릭 = `<dialog>` 팝업(요약·구성·연결·문서). 실행 환경 변수 `SYSTEM_SUMMARY=on` 일 때만 열림(그 밖 404), noindex·사이트맵 제외. 구조 소개만 — 키·토큰 값, 환경 변수 이름, 실행 명령, 파일·API 경로, 포트·내부 주소는 표시하지 않음(2026-11-18 사용자 지시) | 404(꺼짐)                     |
| `/404`                      | `apps/web/src/pages/404.astro`                     | 안내 + 주요 링크                                                                                                                                                                                                     | —                             |
| `/search-index.json`        | `apps/web/src/pages/search-index.json.ts`          | 역·노선·운행 계통·**계획**의 id/이름(한·영·**정식 명칭 full**·별칭)/초성/종류/지역/url. 역은 `code`(노선별 역번호를 공백으로 이어 붙임)도 포함. 계획은 구간 원문을 aliases 에                                          | `[]`                          |

삭제된 라우트(round-1 Q24): `/operators/`, `/operators/[id]/`.

## 2. 공통 모듈·컴포넌트

| 파일                                                 | 역할                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/url.ts`                                     | `BASE`(끝에 `/` 보장), `url()`, `routes.*`(`stationRegion(slug)` 포함), `osmUrl()`. 모든 내부 링크는 여기를 거친다                                                                                                                                                       |
| `apps/web/src/lib/data.ts`                                    | `loadDb()`: 컬렉션 7개를 한 번에 읽어 Map 캐시. **참조 조인 `getStation/getLine/getService/getTrainClass/getSource` 는 대상이 없으면 `Error('참조 없음: …')` 로 빌드를 멈춘다**(Q30). `lineStops`(지선 + 순서 미확인), `stationNeighbors`(역번호·confirmed), `stationLines`, `stationCodes`, `transferSiblings`, `servicesOfLine`, `servicesAtStation`, `sourcesOf`, `regionSummary`, `latestCheckedAt`, `codeText`(codes 배열 → 쉼표) |
| `apps/web/src/lib/region.ts`                                  | 시·도 이름 ↔ 슬러그 표(`REGIONS`, 행정 코드 순), `UNKNOWN_REGION`(지역 미상, `unknown`), `regionOf(name)`(표에 없는 이름은 빌드 실패), `regionBySlug`, `regionMatches`. **권역** `MACRO_REGIONS` — 슬러그는 **스키마 area enum 과 같다**(capital 수도권=서울·경기·인천, southeast 동남권=부산·울산·경남, daegyeong 대경권=대구·경북, chungcheong 충청권=대전·세종·충북·충남, honam 호남권=광주·전북·전남, gangwon 강원권=강원, jeju 제주권=제주; 시·도 하나짜리 권역은 그 시·도와 같은 슬러그·같은 페이지), `NATIONAL_AREA`('national' 전국), `AREA_ORDER`, `Area` 타입, `macroRegionOf`, `macroHasOwnPage`, `macroTargetSlug`, **`areasOfRegions(names)`**(시·도 → 권역 폴백), `areaMatches(areas, filter)`(national 은 모든 권역), `defaultAreaOf(counts)`(수도권 → 항목 있는 첫 권역 → all). 슬러그 충돌은 모듈 로드 시 실패 |
| `apps/web/src/lib/station-rows.ts`                            | `stationRow(db, station)`: 역 목록 행 하나의 JSON 모양(`StationRow`). `/stations/` 서버 렌더와 `/stations/by-area/<slug>.json` 이 같은 모양을 쓴다 |
| `apps/web/src/scripts/area-filter.ts`                         | 권역 필터 클라이언트(D20): `initAreaFilter({ onChange })` → `current()`, `matches(row)`(`data-areas` 에 현재 권역 또는 national), `set()`. 내부는 `initSectionTabs`(param `area`, 기본 `data-default`, `all` 허용). 초기화 때 서버가 붙인 `.area-hidden` 을 뗀다 |
| `apps/web/src/scripts/station-table.ts`                       | `renderStationRow(row, { showReviewBadge })`: `StationRow` → `<tr>`(DOM API, textContent 만). 열 순서·클래스는 `/stations/` 서버 렌더 행과 같아야 한다 |
| `apps/web/src/components/AreaFilter.astro`                    | 권역 탭 마크업(`<nav class="tabs tabs--area" data-area-filter data-default=…>`): 항목 있는 권역만 + "전체 보기"(`?area=all#area-all`). props `counts`(countByArea)·`total`·`baseHref` |
| `apps/web/src/components/StageBadge.astro`                    | 계획 단계 배지: 라벨 `PLAN_STAGE_LABEL`(10단계+폐기), 색 `PLAN_STAGE_PHASE`(신호등 구상/계획/설계/시공/개통/폐기) |
| `apps/web/src/components/UnopenedBadge.astro`                 | "미개통 · 공사 중/계획" 배지 + "목표 <fuzzyDate>". status 가 미개통이 아니면 아무것도 내지 않는다 |
| `apps/web/src/lib/rail-class.ts`                              | **분류 두 축**(12절)의 폴백 규칙. 노선 법적 분류 `lineRailClass`(rail_class 없으면 category 로: high_speed→고속철도, conventional→일반철도, 그 밖→도시철도; 구 값 `metro` 는 urban 으로 읽음), 역의 `stationLineClasses`(line_classes/구 rail_classes 없으면 노선에서, 노선 없으면 conventional), `stationStopClasses`(service_kinds → 고속열차 정차역/광역전철·도시철도역/일반열차 정차역, 없으면 line_classes 폴백 + `fromLines`), `lineReviewStatus`/`stationReviewStatus`(없으면 auto, 역은 노선에서 상속). Astro import 없음(build-map.ts 도 사용) |
| `apps/web/src/scripts/tab-counts.ts`                          | 탭 숫자 동기화(round-5): 분류 탭(차수·법적 분류·열차/전철) 숫자 = 현재 권역·필터 안의 행 수, 권역 탭 숫자 = 현재 분류 탭·필터 안의 행 수. `initTabCounts({tabs, sections, areaTabs, currentTab, currentArea, passes})` → `update()`; 각 목록 페이지가 `onCount` 끝에서 부른다. 서버 초기 숫자도 같은 규칙(기본 권역 × 기본 탭) |
| `apps/web/src/scripts/section-tabs.ts`                        | 목록 페이지 공용 탭(`?param=` 링크 + 구역 `data-tab`). JS 없으면 앵커 이동, 있으면 pushState + 구역/행 숨김. `rowTabs`(표 하나에 분류가 섞인 역 표용), `rowFilter`(검색어·상태 등), `onCount`. round-4: `defaultTab`(파라미터 없을 때 값 — 권역 capital, 운행 계통 train, 계획 national_rail_4), `onChange`, 반환 `set()`. 행은 `apply()` 때마다 다시 질의하므로 나중에 추가한 행(권역 JSON)도 걸러진다 |
| `apps/web/src/lib/terms.ts`                                   | `termsLink(prefix)`: `docs/TERMINOLOGY.md` 의 `getHeadings()` 에서 제목이 prefix 로 시작하는 h2/h3 의 슬러그를 찾는다(없으면 빌드 실패). `TERMS.legalCategories/linesAndServices/stopPatterns/trainClasses`                                                            |
| `apps/web/src/lib/image-size.ts`                              | `publicImageSize('route-maps/x.jpg')`: JPEG SOF·PNG IHDR 에서 픽셀 크기. 노선도 `<img width height>` 용. 파일이 없으면 빌드 실패                                                                                                                                           |
| `apps/web/src/lib/labels.ts`                                  | enum → 한국어 라벨. `TIER_LABEL`(고속 / 준고속 / 특급(ITX) / 일반(무궁화호) / 통근(전동열차)), `TIER_ORDER`, `statusLabel(status, kind)`: closed 를 폐선/폐역/운행 종료로 구분. round-2: `RAIL_CLASS_LABEL`(고속철도/일반철도/도시철도)·`RAIL_CLASS_DESC`, `WIDE_AREA_LABEL/HINT`(광역철도 지정), `CLASS_AXIS_NOTE`("광역철도 = 법적 지정, 광역전철 = 운행 계통"), `STOP_CLASS_LABEL/SHORT/DESC`(역 필터), `REVIEW_STATUS_LABEL`·`REVIEW_AUTO_HINT`, 출처 유형 `wiki`. round-4: `STATUS_LABEL.suspended`(휴업; 운행 계통은 "운행 중단"), `UNOPENED_*`·`isUnopened`, `AREA_LABEL`(region.ts 의 MACRO_REGIONS 이름 + national=전국)·`AREA_FILTER_NOTE`, `SERVICE_GROUP_LABEL/DESC`(열차/전철), 계획 `PLAN_STAGE_LABEL/ORDER/PHASE`(TERMINOLOGY 3절 10단계 + 폐기, 신호등 4단계), `PLAN_PROGRAM_LABEL/SHORT/ORDER/DEFAULT`, `PLAN_CLASS_LABEL`, `PLAN_CATEGORY_LABEL`, `EVENT_TYPE_LABEL`, `PLAN_EMPTY_NOTICE`. region.ts 를 import 한다(Astro 의존 없음) |
| `apps/web/src/lib/map-style.ts`                               | 지도 묶음 = 노선 법적 분류(`MapGroup` = RailClass, `GROUP_COLOR` 고속 빨강 / 일반 파랑 / 도시철도 보라), 역 묶음 `MAP_STOP_LABEL`, `lineColor(line, usedByMetroService)`: 도시철도·광역철도 지정·광역전철/도시철도 운행 계통이 지나는 노선은 `Line.color` 우선(Q50 C), `WIDE_AREA_HALO_COLOR`                                   |
| `apps/web/src/layouts/Base.astro`                             | 스킵 링크, 헤더(브랜드 → **내비 탭 10개**(홈·노선·역·운행 계통·열차·계획·폐선·폐역·지도·노선도·용어·출처; round-4 2차에 "열차", 2026-10-13 "폐선·폐역" 추가 → 11개, 900px 미만은 두 줄로 접힘·탭 줄 아래 검색 줄, D19) → 검색), `<main id="main">`, 푸터(비상업 고지·출처 안내·연표·폐선폐역·Atom 링크), head 에 Atom·sitemap `<link>`, 상세 접기 기억 스크립트. 탭의 `keys[]`: 첫 키는 `aria-current="page"`, 나머지 하위 구역(열차 › train-classes, 계획 › upcoming·timeline·transfer-centers)은 `aria-current="true"` 로 가볍게 강조 |
| `apps/web/src/lib/date.ts`                                    | `formatFuzzyDate`: day `2025-06-28` / month `2027년 3월` / half `2028년 상반기` / year `2030년` / unknown `미정`. `fuzzyDateKey`(정렬), `fuzzyDateIso`(시작일, Atom 피드용), `maxIsoDate`                                                                                   |
| `apps/web/src/lib/timetable.ts`                               | 시간표 공용 계산(Astro 의존 없음): `toMinutes/fromMinutes/formatHHMM`, `estimateHeadway`(운행 시간 ÷ (편수−1)), `minTime/maxTime`, `parseDetail`(전체 시각 JSON 안전 파싱 — 14-2절 가정 형식 + 대체 모양), `normalizeByHour`(24칸 아니면 무시), round-5 `PEAK_HOURS`·`isPeakHour`·`peakHeadways(by_hour)`(첨두 = 60분×4시간÷첨두 편수, 비첨두 = 편수>0 인 나머지 시간대 기준) |
| `apps/web/src/components/EventTimeline.astro`                 | 연표 항목 목록(날짜·유형 배지·제목·메모·연결 노선/역/운행 계통/계획 링크(자기 자신 제외)·출처·확인일). `/timeline/`(filterable: `id`·`data-type`·`data-areas`)과 노선·역·운행 계통 상세 "연혁"(linkTimeline) 공용 |
| `apps/web/src/pages/plans/programs/index.astro`             | 계획 체계(round-5): `data/own/plan-programs.yaml` 을 종류별로 — 국토종합계획(1~5차 철도 부문 요지), 국가철도망(1~4차·5차 안), 도시철도망(서울·경기 사업 목록 + 다른 시·도 고시 이력), 광역교통, 기타. 앵커 `#<program id>` = `routes.planProgram(id)` |
| `apps/web/src/components/NameText.astro`(round-5)             | 한국어 위·영문/한자/정식 명칭 아래 줄(`.name > .name__ko + .name__sub`). 인라인 문맥(링크 나열·문장 안)은 `inline` → 한 줄 병기(`.name--inline`). `LineLink`·`StationLink` 도 `inline` 을 전달. 클라이언트 행 렌더(`station-table.ts`)도 같은 구조 |
| `apps/web/src/components/DetailHead.astro`, `KeyFact.astro`   | 상세 헤더 밴드: 위쪽 색 띠(`--line-color`), slots `crumbs`/기본(제목)/`badges`/`desc`/`facts`(`KeyFact` = dt/dd 칸). 아래 본문은 `.detail-grid` = `.detail-main` + `.detail-side`(패널·출처 접힘, ≥960px 2단·sticky) |
| `apps/web/src/components/PlanSubTabs.astro`, `TrainSubTabs.astro` | 보조 탭(`.sub-tabs` 알약형, `aria-current="page"`): 계획 사업/환승센터/개통 예정/연표/계획 체계(Q92 C; 폐선·폐역은 2026-10-13 헤더 탭으로 분리), 번호 체계/열차 등급. 숫자는 db 에서 계산 |
| `apps/web/src/components/Help.astro`, `ReviewBadge.astro`, `OperatorName.astro` | `Help` = 접힌 도움말(`details.help`; 본문의 긴 안내문·개발 설명 대체), `ReviewBadge` = auto 면 "검수 전" + 툴팁, `OperatorName` = 운영자 약칭 `<abbr title=정식명>`(`TNR_OPERATOR_SHORT`/`RSN_OPERATOR_SHORT`) |
| `apps/web/src/components/TimelineDecade.astro`                | 연표 한 연대의 본문(연대 목차·권역 필터·유형/검색·연도 점프·연도별 `EventTimeline`). `/timeline/` 과 `/timeline/[decade]/` 공용 |
| `apps/web/src/lib/timeline.ts`                                | `eventDecades(db)`(최신 먼저, unknown 맨 뒤)·`latestDecade`·`decadeHref`·`eventHref(db, e)`(이벤트가 실린 연대 페이지 + `#id`). EventTimeline "연표에서 보기"·폐선·폐역·홈 최근 연표·Atom 링크가 쓴다 |
| `apps/web/src/components/StationTimetable.astro`              | 역 상세 시간표 절(round-4 Q86 B: `peakHeadways` 로 첨두 07~09·18~20시 / 비첨두 평균 배차를 `.headway` 칸 3개로, 막대의 첨두 칸은 주황): 요일 탭(section-tabs `?day=`) × 방면 article(첫차·막차·편수·평균 배차·`hour-bars` 24칸 CSS 막대·"전체 시각 보기" 버튼). 버튼은 JS 가 켜질 때만 보임(`apps/web/src/scripts/timetable-detail.ts`) |
| `apps/web/src/scripts/timetable-detail.ts`                    | `apps/web/public/timetable/<station_id>.json` fetch → `parseDetail(json, detail_file)` → 시각 표(DOM API). 파일 하나는 한 번만 받고 요약마다 키로 꺼낸다. 실패·빈 결과는 안내문 |
| `apps/web/src/scripts/train-number-search.ts`                 | `/trains/` 열차번호 찾기: `tr[data-from]` 범위 매칭, `.is-hit` 강조, 홀짝 규칙(`data-parity`) 안내, `?n=` 지원. round-5: 맞는 행이 든 `details[data-group]` 묶음을 자동으로 펴고(`reveal`), `#rsn-…` 앵커로 들어오면 그 묶음을 먼저 편다 |
| `apps/web/src/lib/hangul.ts`                                  | 초성 변환(`toChosung`, `firstChosung`, `isChosungQuery`). 빌드·클라이언트 공용                                                                                                                                                                                            |
| `apps/web/src/components/StatusBadge.astro`                   | 상태 배지(색 + 라벨, title 에 영문)                                                                                                                                                                                                                                       |
| `apps/web/src/components/NameText.astro`                      | 한/영(/한자) 병기. `lang` 속성 부여                                                                                                                                                                                                                                       |
| `apps/web/src/components/FuzzyDateText.astro`                 | fuzzyDate 표시(day 는 `<time>`)                                                                                                                                                                                                                                           |
| `apps/web/src/components/ProvenanceList.astro`                | provenance → sources 조인(없는 출처는 빌드 실패), 원문 링크, 확인일·메모                                                                                                                                                                                                 |
| `apps/web/src/components/Advanced.astro`                      | `<details class="advanced" data-remember>` 동호인용 상세                                                                                                                                                                                                                  |
| `apps/web/src/components/LineLink.astro`, `StationLink.astro` | 노선 색 점/폐역 배지 포함 링크. `line`/`station` 은 필수(조인 단계에서 이미 검증됨). id 폴백 `<code>` 표시는 제거                                                                                                                                                        |
| `apps/web/src/components/SearchBox.astro`                     | 헤더 검색 + MiniSearch 클라이언트 스크립트(필드 ko/en/aliases/cho/code)                                                                                                                                                                                                  |
| `apps/web/src/styles/global.css`                              | 전역 CSS(토큰·라이트/다크·레이아웃·표·카드·배지·역 순서 목록·역번호 `.stop__code`·순서 미확인 `.stops--unconfirmed`·지역 카드)                                                                                                                                             |

## 3. 기본/상세 모드 (D2)

- 각 상세 페이지의 윗부분은 일반 시민용 기본 정보(이름·영문·상태·속한 노선·역번호·환승·주소·좌표).
- 동호인용 상세(외부 코드, 선로·전철화·궤간·설계속도, KP 표, 자체 ID, 출처 목록·확인일)는 `Advanced` 컴포넌트(`<details>`)로 접어 둔다. 기본은 접힘.
- `Base.astro` 의 스크립트가 `localStorage['kraildex:advanced-open']` 에 열림/닫힘을 기억해 모든 페이지에 적용한다. localStorage 가 없거나 막혀 있으면 try/catch 로 무시하고 기본(접힘)으로 동작. JS 가 없어도 `<details>` 자체는 동작.
- 별도 "모드 전환" 버튼은 두지 않는다(round-1 Q28: A).

## 4. 검색 (1-11)

- 빌드 시 `search-index.json` 생성. 문서 필드: `id, kind, kindLabel, ko, en, aliases, cho(초성), code(역번호, 역만), region, url`.
- 클라이언트(`SearchBox.astro`): 입력칸 첫 포커스 때 인덱스를 받아 MiniSearch 7 로 색인. `prefix: true, fuzzy: 0.2`, 가중치 ko 3 / en 2 / code 2 / aliases 1.5. 질의가 초성(ㄱ~ㅎ)만이면 `cho` 필드에 prefix 검색. "K409" 같은 역번호로도 찾는다.
- UI: `role="combobox"` + `listbox`, 화살표/Enter/Escape, `aria-activedescendant`. 결과 12개, 종류·지역 표시.
- JS 없음: 폼이 `/stations/?q=` 로 제출된다. `/stations/` 는 JS 가 있으면 같은 인덱스로 전체 검색 결과(최대 50개)를 지역 카드 위에 보여 주고, JS 가 전혀 없으면 지역 카드만 보인다(각 지역 페이지에서 이름 필터 가능).
- 지역 페이지의 이름 검색은 그 페이지 표 안에서만 동작(초성·영문·별칭·역번호 포함). 전체 검색은 헤더 검색이 담당.

## 5. 스타일 원칙

- 외부 CSS·폰트·스크립트 CDN 없음. 폰트: Pretendard 가 설치되어 있으면 우선, 아니면 system-ui / Apple SD Gothic Neo / Noto Sans KR / Malgun Gothic.
- 본문 16px, 줄 간격 1.6, 문서형 페이지(`prose`)는 최대 72ch, 표·목록 페이지는 1100px. `word-break: keep-all`.
- 색은 CSS 변수로만. 라이트/다크 `prefers-color-scheme`. 본문 대비 ≥ 7:1, 보조 텍스트·배지 글자 ≥ 4.5:1 로 선택(수동 계산; 자동 측정은 Phase 1 공개 직전 1회, round-1 Q33).
- 모바일 우선: 16px 측면 여백, 표는 `.table-wrap` 가로 스크롤(페이지 자체는 가로 스크롤 없음), 내비는 좁은 화면에서 가로 스크롤 줄.
- 포커스 링 3px(`:focus-visible`), 스킵 링크, 시맨틱 heading/table/dl, 이미지 alt, `aria-current` 내비.
- 노선도 이미지는 변형·크롭·필터 없이 원본 그대로(CSS `width:100%; height:auto` 만). 코레일 전국 노선도(2757×3938px, 1.9MB)는 `loading="lazy"` 로 스크롤 전에는 받지 않는다.

## 6. base 경로

- `apps/web/astro.config.mjs` 의 `base` 는 `BASE_PATH` 환경 변수. `apps/web/src/lib/url.ts` 가 `import.meta.env.BASE_URL` 을 정규화(`/` 보장)해 `routes.*` 로 제공.
- 검증: `BASE_PATH=/k-raildex pnpm build` 후 모든 `href`, 검색 인덱스 `url`, `data-index`, 노선도 `src`, 지역 페이지 링크가 `/k-raildex/` 로 시작함을 확인했다(2026-10-11).
- `Base.astro` 의 현재 메뉴 표시는 `Astro.url.pathname` 에서 base 를 떼고 첫 세그먼트로 판정한다.

## 7. 빌드 실패 조건 (round-1 Q30)

사이트는 데이터 불일치를 화면에 숨기지 않고 **빌드를 멈춘다**. `packages/pipeline/src/validate.ts` 가 먼저 막고, 사이트 코드가 이중으로 막는다.

| 조건                                                            | 위치                                              | 메시지                                         |
| --------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| 노선-역·운행 계통·구간·열차 등급·출처가 가리키는 id 가 없음     | `apps/web/src/lib/data.ts` `get*()`                        | `참조 없음: <컬렉션> '<id>' (<어디서>)`        |
| 역·노선의 `region` 이 `apps/web/src/lib/region.ts` 표에 없는 이름        | `regionOf()`                                      | `알 수 없는 지역 이름 '…'`                     |
| 용어 페이지에 코드가 링크하는 제목 앞부분이 없음                | `apps/web/src/lib/terms.ts`                                | `용어 페이지에 '…' 로 시작하는 제목이 없습니다` |
| `route-maps.yaml` 의 embed 파일이 `apps/web/public/route-maps/` 에 없음  | `apps/web/src/lib/image-size.ts`                           | `이미지 파일 없음: public/…`                   |

## 8. 역 순서·역번호 표시 (round-1 Q22/Q26)

- `LineStation.station_code`(노선별 공식 역번호)는 노선 상세의 역 순서 목록에서 역 이름 앞에 작은 상자로, 역 상세의 "속한 노선" 표에서 "역번호" 열로, 지역별 역 표에서 "역번호" 열로 표시한다. 값이 하나도 없으면 열 자체를 생략한다.
- `order_confirmed === false` 인 노선-역은 본선·지선 목록에서 빼고 노선 끝에 "순서 미확인" 소제목 아래 모은다(점선 스타일). 역 상세에서는 이전/다음 역 대신 "순서 미확인". `branch: "순서미확인"` 문자열에는 더 이상 의존하지 않는다(데이터가 아직 그 문자열을 쓰면 "순서미확인"이라는 이름의 지선으로 보일 뿐이다).
- `codes{}` 값이 배열이면 쉼표로 나열(`codeText`).

## 9. 픽스처

- `apps/web/tests/fixtures/build/*.json`, `apps/web/tests/fixtures/own/services.yaml`: 역 36, 노선 5(고속·일반·도시·경전철·계획), 노선-역 40(성수지선, 역번호, 순서 미확인 2건), 운행 계통 3. 환승역, 좌표 없는 역, 영문명 없는 역, 폐역, 계획 역, 지역 미상 역, 복수 역번호 배열, 별도 id 환승 묶음(`stn-seoul` / `stn-seoul-metro`) 포함. 값은 사실 확인을 거치지 않았다(모든 provenance.note 에 명시).
- round-2 추가 값: 노선 `rail_class`(경부고속선 high_speed·경부선 conventional+`is_wide_area`·2호선 `metro`(구 값, 사이트가 urban 으로 읽음)·우이신설선은 없음 → 폴백)·`review_status`(경부고속선·경부선 verified, 2호선 auto, 나머지 없음 → auto). 역 `rail_classes`(서울 `[high_speed, conventional]`, 신설동 `[metro]`)·`review_status`(서울 verified, 시청 auto). 데이터 담당이 스키마를 `urban`·`line_classes`·`service_kinds` 로 바꾸면 픽스처 값도 그 이름으로 바꾼다.
- round-4 추가 값: 노선 `areas`(경부고속선 national 포함·2호선·GTX-A; 경부선·우이신설선·휴업선은 없음 → region 폴백), `line-gtx-a-sample`(`name.full` 수도권광역급행철도 A노선, under_construction, 목표 2028-12), `line-sample-suspended`(suspended), 역 `stn-gtx-sample-kintex`(공사 중)·`stn-sample-suspended`(휴업), 운행 계통 5(GTX-A `name.full`·`opened_at`, 휴업 1), **계획 5**(`plans.json`: 3·4차 GTX-A 단계 이력 4건, 4차 추가검토 목표 미정, 5차 신규 regions 폴백, 개통, 폐기), **연표 3**(`events.json`). 상세는 `apps/web/tests/fixtures/README.md`.
- 사용: `apps/web/tests/fixtures/README.md` 참조. 빈 데이터 상태를 시험할 때는 Astro 콘텐츠 캐시(`node_modules/.astro`, `.astro`)를 지워야 한다 — 파일 로더가 파일이 없으면 이전 캐시를 그대로 쓴다. 픽스처 노선 id 는 `osm-line-map.yaml` 에 없으므로 `pnpm build`(build-map 포함) 대신 `pnpm data:validate && pnpm exec astro build` 로 확인한다.

## 10. 데이터 담당 합류 후 연결할 것 (TODO)

- `apps/web/src/pages/stations/[id].astro` 상단 주석: stations 스키마에 `grade`·`related_line_names`·`history`·`intro` 가 들어오면 역 상세에 표시(라벨은 `apps/web/src/lib/labels.ts` 에 추가). zod 에 없는 필드를 `as any` 로 읽지 않는다.
- `docs/TERMINOLOGY.md` "급행 / 완행 / 직통" 제목이 "… / 쾌속 / 특급" 으로 바뀌어도 `apps/web/src/lib/terms.ts` 는 앞부분으로 찾으므로 링크가 유지된다. 제목 **앞부분**이 바뀌면 `TERMS` 의 prefix 를 고친다.
- round-2 분류(12절): `content.config.ts` 의 `lines.rail_class` enum 이 `urban` 으로 바뀌고 `stations.line_classes`·`service_kinds` 가 들어오면 `apps/web/src/lib/rail-class.ts` 는 그대로 동작한다(구 값 `metro`·`rail_classes` 도 읽음). `apps/web/src/lib/data.ts` `stationServiceKinds` 의 `(station as { service_kinds?: string[] })` 캐스트는 zod 에 필드가 생기면 제거한다. 픽스처 값(9절)도 새 이름으로 바꾼다.
- 데이터에 `is_wide_area` 가 채워지면 `/lines/` 의 "광역철도 지정만" 토글과 지도의 "광역철도 지정 노선 강조"가 자동으로 나타난다(지금 실데이터에는 값이 없어 토글이 숨겨짐). `review_status: verified` 가 들어오면 검수 전 배지·지역 안내가 사라진다(지금은 전부 auto 라 모든 지역 페이지에 안내가 뜬다).
- 일반열차(intercity)·관광열차 운행 계통과 KTX `stop_patterns` 가 들어오면 역의 "정차 열차 기준" 묶음이 노선 기준 폴백에서 정차 패턴 기준으로 바뀐다(`/services/[id]/` 정차 패턴 표에는 정차역이 놓인 물리 노선 열이 생긴다).
- 노선 ID 변경(line-ktx-* 삭제, 고속선 물리 노선 신설): 사이트 코드에 노선 ID 하드코딩 없음(2026-10-11 확인). `data/own/overrides/osm-line-map.yaml` 의 `line_id` 만 함께 바꾸면 된다.
- round-4(2026-10-11): `areas` 가 데이터에 들어오면 권역 폴백(`areasOfRegions` + 고속철도·고속열차 national)이 그 값으로 대체된다. 폴백과 다르게 쓰고 싶은 곳(예: 경춘선을 강원권에도)은 데이터 `areas` 에 적으면 된다. `plans.json`·`events.json` 이 채워지면 `/plans/`·`/plans/[id]/`·`/upcoming/`(계획 구간)·노선/역 상세의 "관련 계획"·지도 `#plan=`·검색 인덱스(kind plan)가 자동으로 나타난다. `status: suspended` 가 들어오면 라벨·회색 배지·지도 회색 점선(`lines-suspended`)·안내문이 자동. `name.full` 이 들어오면 제목·목록·검색에 병기. 경의중앙선 분리로 노선 ID 가 바뀌어도 사이트 코드에는 ID 가 없다(픽스처만 갱신).
- `packages/pipeline/src/ingest/build.ts:628` 의 타입 오류(`l.kind === 'ktx'` — `kind` 가 `manual|molit|kric` 뿐)가 `pnpm check` 를 1 error 로 만든다(데이터 담당 영역, 사이트 코드는 0 error).

## 11. 지도 탭 (Phase 2, `/map/`) — 2026-10-11

### 11-1. 파일과 데이터 흐름

```
Overpass API ──(pnpm data:fetch-osm, packages/pipeline/src/ingest/fetch-osm-rail.ts)──▶ data/osm/rail-ways.geojson   (way LineString, ODbL)
                                                                       data/osm/rail-routes.json   (relation 메타 + member way id)
                                                                       data/osm/manifest.json, README.md
data/osm/* + data/own/overrides/osm-line-map.yaml + data/build/lines.json
      ──(pnpm data:build-map, packages/pipeline/src/ingest/build-map.ts)──▶ apps/web/public/map/lines.geojson     (노선별 MultiLineString + 미분류, attribution=ODbL)
data/build/stations.json + line-stations.json ──(같은 스크립트)──▶ apps/web/public/map/stations.geojson  (좌표 있는 역, OSM 좌표 사용 안 함)
apps/web/public/map/*.geojson(D 단계: DB build_artifact → API /artifacts → 사이트 route /map/[file], lib/artifact.ts 가 gzip 압축·`?v=<데이터 판 태그>` 면 immutable, 2026-10-18) ──(클라이언트 fetch, BASE_URL 적용, `?v=` 는 PageScript arg 로 받음)──▶ apps/web/src/scripts/map-page.ts (MapLibre) ◀── apps/web/src/lib/map-sources.ts (타일 소스), apps/web/src/lib/map-style.ts (색·묶음)
```

- `pnpm build` = `data:validate` → `data:build-map` → `astro build`. `data:fetch-osm` 은 분기마다 수동 실행(Overpass 부하, 네트워크).
- `apps/web/src/lib/map-style.ts` 는 빌드 스크립트와 클라이언트가 함께 쓰므로 Astro 전용 import 를 넣지 않는다.
- 라이선스 분리: OSM 유래 좌표는 `data/osm/` 과 `apps/web/public/map/lines.geojson` 에만 있다. `data/build/`·`data/own/` 에 OSM 좌표를 넣지 않는다(ODbL share-alike 전염 방지). `osm-line-map.yaml` 은 id 대응표라 좌표가 없다.

### 11-2. 매핑 규칙 (`data/own/overrides/osm-line-map.yaml`)
- 항목: `line_id`, `relations[]`(OSM relation id), `way_names[]`(way name/name:ko 정확 일치), `ways[]`, `bbox`(way 중점이 안에 있을 때만), `note`.
- **위에서 아래로 처리하며 way 는 먼저 적힌 노선이 차지한다.** 국가철도 물리 노선(route=tracks)을 먼저, 그 위를 지나는 도시철도 route relation(3·4호선 등)을 나중에 둔다. 한 relation 을 두 자체 노선으로 나눌 때(7호선 인천 구간, 8호선 별내선)는 `bbox` 로 자른다.
- `railway=construction` way 는 어느 노선에 속하든 `status: under_construction` 인 별도 feature. 매핑 안 된 way 는 `line_id: null` 미분류 feature((railway, name) 단위 MultiLineString).
- 알 수 없는 `line_id` 는 **빌드 실패**(노선 ID 변경 시 이 파일을 함께 고친다). relation id 가 `rail-routes.json` 에 없으면 리포트만.
- 초안 생성: `pnpm data:build-map -- --suggest [--force]` (이름 일치 후보).

### 11-3. 클라이언트 (`apps/web/src/scripts/map-page.ts`)
- 배경: `basemapSources(key)` → VWorld Base/white/midnight(키 있을 때) + OSM 대체. 소스 교체는 raster source/layer 를 갈아 끼우는 방식(노선 레이어 유지). 키는 `apps/web/astro.config.mjs` 의 `vite.envPrefix: ['PUBLIC_','VWORLD_']` 로 `import.meta.env.VWORLD_API_KEY` 가 클라이언트 번들에 들어간다(타일 URL 에 노출되는 값, 커밋 금지). 키가 없으면 서버 렌더 안내문 + 배경 없음.
- 레이어 순서: `basemap` → `lines-unclassified`(회색 얇게) → `lines-highlight`(선택 노선 넓은 반투명) → `lines-wide-area`(광역철도 지정 노선 노란 띠, 옵션 켤 때만) → `lines-construction`(점선) → `lines-main`(노선 색) → `stations-highlight` → `stations`(원, 환승역 테두리 굵게, minzoom 8) → `station-labels`(symbol, minzoom 13, 글리프 서버 없이 브라우저 폰트로 렌더).
- 색: feature 의 `color` 속성(빌드 시 `lineColor()` 로 결정, round-2 Q50 C → 2026-10-15 개정): 지정 색이 없으면 **상태 대표색**(`STATUS_COLOR`: 운영 중 파랑 `#1d5fc4`, 공사 중 회색 `#737b87`, 검토·계획 중 밝은 회색 `#a3abb6`, 휴업 진한 회색 `#6b7280`, 폐지 `#c3c9d1` — 2026-10-15 사용자 지시로 운영 중 외에는 모두 회색 계열). 법적 분류 색은 더 쓰지 않는다. 도시철도·광역철도 지정·광역전철/도시철도 운행 계통이 지나는 노선(= 수도권 전철)은 `Line.color` 가 있으면 그 색. 공사중 회색 `#737b87`(CONSTRUCTION_COLOR), 미분류 회색 `#8a8f98`, 광역철도 띠 `#f59e0b`.
- feature 속성(round-2): 노선 `rail_class`(= `group`), `is_wide_area`, `review_status`; 역 `line_classes`·`service_kinds`·`stop_classes`(공백 구분)·`stop_from_lines`·`review_status`. 팝업에 분류·광역철도 지정·검수 전 배지.
- 필터: 상태(운영/공사중)·노선 법적 분류(3)·광역철도 지정 강조·역 정차 열차 기준(3)·미분류(이름 있는 것 기본, "이름 없는 선형도" 토글 — Q48 C) → `setFilter`. 역은 `stop_classes` 에 선택 묶음이 하나라도 있으면 표시, 묶음 없는 역은 항상 표시. "아무것도 안 보임" 필터는 표현식 `['==', ['get','line_id'], '__none__']`(구식 `['==', 1, 0]` 은 addLayer 검증에서 거부됨).
- 해시: `#line=<id>` → 해당 노선 feature 들의 bounds 로 fitBounds + 강조. `#station=<id>` → flyTo(줌 ≥14) + 강조 + 팝업. 클릭 시 `history.replaceState` 로 해시 갱신. 노선·역 상세의 "지도에서 보기" 링크가 이 형식(`url('map/#line=…')`).
- 팝업은 DOM API 로 조립(데이터 문자열을 innerHTML 로 넣지 않음). 역: 이름 한/영, 상태, 환승, 역번호, 속한 노선(링크 + "지도에서 강조"), 상세 링크. 노선: 이름, 상태, 묶음, 상세 링크, "전체 구간 보기". 미분류: OSM 태그.
- 타일 오류: `map.on('error')` 에서 `sourceId === 'basemap'` 오류가 15초 안에 3회 이상이면 상단 안내 + 대체 소스 전환 버튼(2-6). 그 밖의 오류는 `console.error('[map]', …)`.
- 모바일: 760px 이하에서 필터 `<details>` 접힘, 지도 높이 65vh. 출처 표시는 MapLibre AttributionControl(좌하단, 항상 펼침) + 지도 아래 텍스트 + 본문 "출처와 이용 조건" 단락.
- 진단: `window.__kraildexMap` 에 Map 인스턴스(헤드리스 점검용).

### 11-4. 검증 (2026-10-11)
- `pnpm data:fetch-osm`: way 7,911(rail 7,308 / subway 401 / light_rail 75 / monorail 23 / construction 104), relation 403, `rail-ways.geojson` 3.33MB(단순화 없음).
- `pnpm data:build-map`: 노선 54 중 선형 있음 39, 미분류 way 21.1%, `lines.geojson` 1.28MB, `stations.geojson` 423KB(좌표 있는 역 1,099).
- `pnpm build`·`pnpm check` 통과. `BASE_PATH=/k-raildex` 빌드에서 geojson fetch 경로·상세 링크가 `/k-raildex/` 로 시작함을 확인.
- 헤드리스 Chrome(CDP)으로 `/map/` 열어 콘솔 오류 없음, 레이어 8개, 역·노선 렌더, 필터·팝업·해시 동작 확인. VWorld Base/white/midnight 타일 curl 200(image/png).

### 11-5. round-2 재추출·재생성 (2026-10-11)
- `fetch-osm-rail.ts`: bbox 남쪽 36.9 → **36.6**(Q49 A). Overpass 과부하(504/500) 대비 재시도 6회·5xx 도 재시도. 결과 way 8,458(rail 7,850 / subway 401 / light_rail 75 / monorail 23 / construction 109), relation 404, `rail-ways.geojson` 3.75MB(단순화 없음). 경부선·장항선 선형이 36.59N(천안·신창 포함)까지 내려온다.
- `pnpm data:build-map`: 노선 54 중 선형 있음 40(+1), 미분류 way 22.5%(82묶음, 이름 있는 묶음 78), `lines.geojson` 1.40MB, `stations.geojson` 532KB(좌표 있는 역 1,098).
- 헤드리스 Chrome(CDP, 2026-10-11): `/lines/?class=high_speed`(탭 current·구역 1개·탭 클릭 시 `?class=urban` pushState), `/stations/?class=high_speed`(카드 수·링크 갱신, 해당 없는 권역 카드 숨김), `/stations/region/capital/?class=high_speed`(행 필터·시·도 셀렉트·검수 안내), `/map/`(레이어 9개, 미분류 이름 필터, 역 stop_classes 필터, 광역철도 띠 필터, 해시·팝업) 콘솔 오류 0.

## 12. 분류 두 축 (round-2, D19 정정판)

- 운영자 지적: "광역철도"는 **법적 지정**(노선 속성)이고 "광역전철"은 **운행 계통 종류**라 섞으면 안 된다. 예: 경의선·용산선·중앙선(물리 노선)은 일반철도이면서 광역철도 지정 구간이고, 그 위를 달리는 "수도권 전철 경의·중앙선"은 광역전철 운행 계통.
- 노선(`/lines/`): 법적 분류 `rail_class` = 고속철도 / 일반철도 / 도시철도(폴백: category high_speed→고속, conventional→일반, 그 밖→도시철도; 구 값 `metro` 는 도시철도로 읽음) + `is_wide_area`(광역철도 지정) 토글·배지. 상세에 "분류: 일반철도 · 광역철도 지정".
- 운행 계통(`/services/`): 종류 `kind` = 고속열차 / 광역전철 / 도시철도 / 일반열차 / 관광열차 탭.
- 역(`/stations/`, 지역·권역 페이지, 상세, 지도): **정차 열차 기준** 묶음 = 고속열차 정차역(high_speed) / 광역전철·도시철도역(wide_area·metro) / 일반열차 정차역(intercity·tourist). 근거는 `service_kinds`(데이터 → 정차 패턴 → 노선을 지나는 운행 계통 순으로 도출). 그것도 없으면 속한 노선의 법적 분류로 폴백하고 **"노선 기준"** 을 작게 표시. 노선 없는 역은 일반철도(RAFIS)로 본다.
- 라벨: `RAIL_CLASS_LABEL`(노선), `SERVICE_KIND_LABEL`(운행 계통, wide_area=광역전철 유지), `STOP_CLASS_LABEL`(역). 안내문 `CLASS_AXIS_NOTE` = "광역철도 = 노선의 법적 지정, 광역전철 = 운행 계통의 종류".
- 검수 상태(Q43 B): `review_status` 없으면 auto. auto 인 노선·역 상세 상단에 "자동 수집 데이터(검수 전)" 배지, 목록 행에 "검수 전", 지역·권역 페이지는 그 지역 노선이 모두 auto(노선이 없으면 역이 모두 auto)일 때 상단 안내. verified 는 표시 없음.

## 13. round-4 wave1 (2026-10-11): 권역 필터·운행 계통 탭·정식 명칭·개통 예정·계획 탭·지도

### 13-1. 권역 필터 (D20)
- 대상: `/lines/`, `/stations/`, `/services/`, `/plans/`. 공용 컴포넌트 `AreaFilter.astro` + 클라이언트 `area-filter.ts`. 값 `?area=capital|southeast|daegyeong|chungcheong|honam|gangwon|jeju|all`(제주처럼 항목 0 인 권역은 탭 숨김). **기본값 수도권**(`defaultAreaOf`: 수도권에 항목이 없으면 항목 있는 첫 권역, 그것도 없으면 전체).
- 항목의 권역: 데이터 `areas` 가 있으면 그 값, 없으면 폴백 — 노선은 `region`(시·도) → 권역 + 고속철도면 `national`; 역은 `region` 하나; 운행 계통은 지나는 노선의 시·도 합집합 + 고속열차면 `national`; 계획은 `areas` → `regions` → `line_ids` 순. `national` 항목은 어느 권역 탭에서도 보인다(`areaMatches`). 권역별 수(`countByArea`)는 직접 항목이 있는 권역에만 national 을 더한다(제주 0 유지).
- 다른 탭(법적 분류·열차/전철·차수)과 **조합**된다: 권역 탭 클릭 → `onChange` → 주 탭의 `apply()` 가 `rowFilter` 에서 `area.matches(row)` 를 함께 본다. URL 은 두 파라미터를 모두 유지(`?area=southeast&class=high_speed`).
- JS 없음: 서버가 기본 권역 밖 행에 `.area-hidden`(display:none)을 붙이고, "전체 보기" 링크는 `?area=all#area-all` 이라 `.area-scope:target .area-hidden { display: revert }` 로 전부 펼쳐진다. JS 가 있으면 초기화 때 클래스를 떼고 `hidden` 속성으로만 거른다.
- `/stations/` 만 예외: 1,362역을 다 넣지 않고 기본 권역 행만 서버 렌더(실데이터 수도권 ~690KB HTML). 다른 권역을 고르면 `/stations/by-area/<slug>.json`(권역별 35~350KB)을 받아 `renderStationRow` 로 행을 추가하고 `loaded` 집합에 기록한다. "전체 보기"는 남은 권역 + `unknown`(지역 미상) 전부. 로드 중·실패는 `#area-status` 에 안내(실패해도 권역 페이지 링크로 갈 수 있다). JS 없으면 수도권 표 + `<noscript>` 안내 + 권역·시·도 페이지 링크.

### 13-2. 운행 계통 탭 (D21)
- `/services/` 는 **열차 / 전철** 두 탭(`?group=`, 기본 `train`). `serviceGroupOf(kind)`: high_speed·intercity·tourist → train, wide_area·metro → metro. 탭 안에서는 종류 배지(`SERVICE_KIND_LABEL`) + 종류 select. 역 상세 "정차하는 운행 계통"도 열차/전철 두 소제목. 운행 계통 상세의 현재 위치는 "운행 계통 › 열차/전철 › 종류".

### 13-3. 정식 명칭 (D23)
- 2026-10-15 사용자 지시(목록 탭 숫자): 분류 탭(차수·법적 분류·열차/전철·역 구분)의 숫자는 **권역과 무관한 전체 합계**(예: 계획 → 국가철도망 1차 97), 권역 탭의 숫자는 현재 분류 탭 기준. 권역 탭은 전체 행에 있는 권역을 모두 그린다(`AreaFilter present`; 전에는 기본 탭에 있는 권역만 그려 "전철 36 ≠ 수도권 24+충청 2+강원 1"처럼 영남권 등이 빠졌다). 한 항목이 여러 권역(예: 경춘선 수도권·강원권)이나 전국(national)에 속하면 권역 숫자의 합이 분류 숫자보다 클 수 있다. 검색 결과(`search-box.ts`)는 두 줄: 윗줄 한국어 이름(+역번호), 아랫줄 정식 명칭·영문을 한 줄 말줄임(위례과천선처럼 긴 정식 명칭 대응).
- 2026-10-15 사용자 지시(노선 상세): 연혁 절은 `details.section-fold` 로 접고 기본 접힘. 요약의 구간은 본선 역 순서에서 **운영 중인 여객역**의 첫·끝 역(시설·미개통·폐역 제외; 둘 미만이면 역 순서 전체, 없으면 노선정보 기·종점), 연장은 역키로정 최대 km 를 노선정보 값보다 우선하고 소수점 첫째 자리까지 표기한다(목록도 같음)(노선정보 연장이 광역 구간만 담는 경부선 122.9km ↔ 역 순서 441.7km 같은 경우 '역 순서 기준' 표시).
- 2026-10-15 사용자 지시(검수 전 배지 폐지): 노선·역·계획·환승센터의 "검수 전"(review_status auto) 배지와 상단 안내, 상세의 "검수 상태" 줄, 지도 팝업의 "자동 수집(검수 전)" 을 모두 표시하지 않는다(`ReviewBadge` 는 null). 데이터 필드 `review_status` 와 관리 앱의 검수 상태 보정은 그대로 둔다.
- 2026-10-15 사용자 지시(권역 기본값): 모든 목록(노선·역·운행 계통·계획·연표)의 권역 필터 기본값은 **전체**(`defaultAreaOf` 가 항상 `all`; D20 의 '기본 수도권' 은 폐기). 역 목록은 전 권역 행을 서버 렌더하고 `/stations/by-area/*.json` 은 쓰지 않는다(경로는 남아 있음).
- 2026-10-15 사용자 지시(역 탭 필터): 역 구분 탭 순서는 전체 → 고속열차 정차역 → 일반열차 정차역 → 광역전철·도시철도역(`STOP_CLASS_ORDER`, 배지·지도 범례 순서도 같이 바뀜). 권역 필터는 모든 목록에서 '전체'(총계)를 맨 앞에 두고 수도권·동남권·대경권·충청권·호남권·강원권 순(이전에는 맨 뒤 '전체 보기').
- `NameText` 에 `full` prop: `name.full` 이 있고 `name.ko` 와 다르면 "GTX-A (수도권광역급행철도 A노선)" 처럼 병기. 켜는 곳: 노선·역·운행 계통·계획 상세 제목(`<title>` 포함), 목록 주 열(`LineLink full`), 운행 계통 카드, 관련 계획 목록, 검색 결과(헤더·폴백). 끄는 곳: 환승 노선 나열·지도 팝업(짧게). 검색 인덱스 필드 `full`(가중치 2) + 초성에도 포함.

### 13-4. 개통 예정·미개통·휴업 (round-3 Q58·Q59)
- `/upcoming/`: `upcoming(db)` — status `planned`/`under_construction` 노선·역 + 개통·폐기 아닌 단계의 계획을 `fuzzyDateKey`(day 그대로, month/year/half 는 기간 끝, 미정 '9999')로 정렬. 관련 계획은 `Plan.line_ids`/`station_ids` 역참조(`plansOfLine/plansOfStation`).
- 노선·역 상세: 미개통이면 상태 자리에 `UnopenedBadge`("미개통 · 공사 중" + 목표) + 상단 안내(관련 계획·개통 예정 링크). 노선의 역 순서에서 미개통 역은 점선 마커 + 배지. 운영 중 노선에 미개통 역이 있으면 "미개통 역 N개" 안내. 목록(노선·역·권역 페이지)도 상태 칸에 같은 배지.
- `suspended`(휴업): `STATUS_LABEL`·`STATUS_ORDER` 에 추가, 라벨 휴업(운행 계통은 "운행 중단"), 회색 배지 `.badge--suspended`, 노선·역·운행 계통 상세에 안내문(폐선·폐역 안내도 노선에 추가). 상태 필터 select 는 `STATUS_ORDER` + `statusLabel` 로 통일(권역 페이지의 하드코딩 표 제거).

### 13-5. 계획 탭 (D22, Phase 3)
- 데이터: `plans`·`events` 컬렉션(`apps/web/src/lib/data.ts` 의 `plan` Map, `plansByLine/Station`, `eventsByPlan/Line/Station/Service`(날짜순)). 비어 있으면 `/plans/` 에 `PLAN_EMPTY_NOTICE`, 상세 페이지 없음, 홈 카드도 같은 문구.
- 목록 행의 구간·사업내용·연장·사업비는 **그 차수의 plan_refs** 값(한 사업이 3차·4차에 실리면 각 차수 구역에 한 행). 개통 목표/개통일은 `planTargetDate`(개통이면 `opened_at`, 아니면 `target_open`). 검색 인덱스·개통 예정의 대표 반영 내역은 `primaryPlanRef`(5차 → 4차 → 3차 → 첫 항목).
- 상세: 단계 진행 띠(`.stage-track`, 10단계, 지난 단계 채움·현재 강조, 폐기는 띠 생략), 타임라인은 `stage_history`(단계 배지, 신호등 색) + `plan_ids` 로 연결된 Event(종류 배지 + 제목)를 `fuzzyDateKey` 로 합쳐 정렬, 항목마다 출처(`getSource`, 없는 출처는 빌드 실패) 링크·원문 링크. 출처 목록은 `Advanced`(접힘).
- 헤더 탭 "계획"(`routes.plans()`), 홈에 "계획과 개통 예정" 카드 3개(계획·개통 예정·지도).

### 13-6. 지도
- 권역 버튼: `stations.geojson` 상단 `area_bounds`(build-map 이 좌표 있는 역의 시·도 → 권역으로 묶어 양 끝 2% 를 잘라 낸 백분위 범위로 계산; 상수 하드코딩 없음). 역이 없는 권역의 버튼은 `hidden` 유지. 클릭 시 `#area=<slug>` 로 바꾸고 fitBounds. "수도권/전국 보기" 버튼은 권역 버튼 + "전국 보기"로 대체.
- `#plan=<id>`: `plans.geojson` 에 그 계획의 개략 선형(schematic·traced)이 있으면 **그 선형만** halo 로 강조하고 그 범위로 이동한다(2026-10-17 A안 — 종전에는 `line_ids` 의 간선 전체에도 초록 띠를 씌우고 범위를 넓혀 경부선·경부고속선 전체가 강조되던 문제). 선형이 없으면 `lines.geojson` 상단 `plans`(build-map 이 `data/build/plans.json` 의 id → name·stage·line_ids 를 적음; 파일이 없거나 비면 `{}`) 에서 `line_ids` 를 찾아 `lines-plan` 레이어(초록 띠, `PLAN_HALO_COLOR`)로 강조하고 범위로 이동. 그것도 없으면 상태 줄에 안내. 계획 상세의 "지도에서 보기" = `routes.mapPlan(id)`.
- 휴업: build-map 이 `status: suspended` 노선 feature 의 색을 `SUSPENDED_COLOR` 로, 클라이언트는 `lines-suspended` 레이어(회색 점선) + 상태 체크박스 "휴업". 역은 `suspended` 상태도 "휴업" 체크에 따라 표시.
- 공사중 선형 팝업(매핑된 노선의 construction feature·미분류 construction 묶음 모두): "OSM 공사중 태그(비공식) … 공식 단계는 계획 탭" 안내 + 링크. 팝업 상태 라벨은 `labels.ts` 의 `STATUS_LABEL` 을 쓴다(휴업 포함).
- 레이어 순서: `basemap` → `lines-unclassified` → `lines-highlight` → `lines-wide-area` → `lines-plan` → `lines-suspended` → `lines-construction` → `lines-main` → `stations-highlight` → `stations` → `station-labels`.

### 13-7. 검증 (2026-10-11)
- 실데이터 `pnpm build` 1,496 페이지, `BASE_PATH=/k-raildex` 빌드에서 새 라우트·`data-area-files`·JSON 안 `url`·지도 링크가 `/k-raildex/` 로 시작. 픽스처(`data:validate` + `astro build`) 82 페이지. 빈 데이터(`data/build/*.json` + `services.yaml` 제거) 13 페이지, 모든 목록에 안내문. `pnpm check`: 사이트 코드 0 error(남은 1 error 는 `packages/pipeline/src/ingest/build.ts`).
- 헤드리스 Chrome(CDP, 픽스처 dist): `/stations/?area=southeast` → southeast.json 로드 후 부산 1행 표시, "전체 보기" → 38행·`?area=all`, 정차 열차 탭 조합 `?area=all&class=high_speed`; `/lines/?area=southeast` → 경부고속선(national)·경부선(region 폴백) 2행; `/services/` 기본 열차 탭 → 전철 탭 4카드(GTX-A 정식 명칭 병기); `/plans/` 기본 4차 → 동남권 필터 → 3차+전체+단계 '개통' 필터; `/plans/plan-gtx-a-sample/` 타임라인 6항목·현재 단계 "8 착공·시공"; `/upcoming/` 7행 목표일순(미정 맨 뒤); `/map/` 레이어 11개, 권역 버튼 6개(제주 숨김), `#area=southeast` 이동, 시험용 plans 를 넣은 dist 로 `#plan=` 강조(1/2 노선)·선형 없는 계획 안내·휴업 체크 해제 시 필터 none. 콘솔 오류 0.

## 14. round-4 2차 (2026-10-11): 열차 탭·시간표·연표·폐선·폐역·Phase 6

### 14-1. 열차 탭 (D28, `/trains/`)
- 데이터: `trainNumberRanges`(`data/own/train-number-ranges.yaml`). `apps/web/src/lib/data.ts` 에 `trainNumberRanges[]`, `rangesByService/Line/TrainClass`, `rangesOfService/TrainClass`, `rangesContaining(n)`, 정렬 `byRange`(묶음 순 → 시작 번호).
- 라벨(`labels.ts`): `TNR_GROUP_ORDER/LABEL`(고속열차/일반열차/광역전철/도시철도/화물열차/비영업/기타), `TNR_OPERATOR_LABEL`, `PARITY_RULE_LABEL`, `TRAIN_NUMBER_NOTICE`(공식 규정 공개본 없음 → 보조 출처 기반, 출처 표기), `TRAIN_NUMBER_EMPTY_NOTICE`.
- 화면: 묶음별 표 + 묶음 목차. 행 `id = range id`(`routes.trainRange(id)` = `/trains/#tnr-…`), `data-from/to/parity/label/range/route`. 열차번호 찾기는 표의 data-* 만 읽으므로 데이터가 코드에 없다. 홀짝 안내: odd_down_even_up → "홀수 → 하행 / 짝수 → 상행".
- 열차 등급(`/train-classes/`)은 유지하되 헤더 탭은 "열차" 하나(`keys: ['trains','train-classes']`). 두 페이지 상단에 보조 탭(열차번호·차량번호 체계 / 열차 등급). 등급 항목에 "열차번호대"·"차량번호대" 링크, 운행 계통 상세에 "열차번호대" 절.
- **2부 차량번호(차호)·편성번호(2026-10-12)**: 데이터 `rollingStockNumberRanges`(`data/own/rolling-stock-numbers.yaml`, `rsn-`). `apps/web/src/lib/data.ts` 에 `rollingStockNumberRanges[]`, `stockByTrainClass/Service/Line`, `stockOfTrainClass/Service`, 정렬 `byStockRange`(묶음 → 접두 → 번호), 표기 `stockRangeText`(접두 + 자릿수 0 채움 범위)·`formationText`("601~616호기", 범위 없으면 "34편성"). 라벨 `RSN_GROUP_ORDER/LABEL`, `RSN_OPERATOR_LABEL`(운영기관 13종), `RSN_STATUS_LABEL`, `ROLLING_STOCK_NOTICE/EMPTY_NOTICE`. 용어 링크 `TERMS.trainNumbers/vehicleNumbers/formationNumbers`(TERMINOLOGY.md 6절 "열차번호"·"차량번호"·"편성번호" 제목 앞부분). 행 `id = rsn-…`(`routes.stockRange(id)` = `/trains/#rsn-…`), `data-vprefix/vfrom/vto/label/desc/formation` + 편성 번호가 "접두가 같은 숫자 범위"일 때만 `data-fprefix/ffrom/fto`(311B01~312B56 → `311B` 1~56, 601~616 → `` 601~616; 311G01~319F10 처럼 접두가 다르면 생략).
- 번호 찾기: 입력에서 영문·숫자만 남기고 `([A-Z0-9]*?[A-Z])?(\d+)` 로 접두·숫자를 나눔. 접두가 없으면 열차번호(`tr[data-from]`)·차량번호(`tr[data-vfrom]`, 접두 '')·편성번호(`data-ffrom`, 접두 '') 셋 다 찾고, 접두가 있으면 차량·편성만 찾는다(접두가 KTX 처럼 순수 영문인데 맞는 행이 없으면 숫자만으로 다시 찾고 안내). 결과는 "열차번호로 보면 / 차량번호로 보면 / 편성번호로 보면" 묶음으로 전부 표시하고, 둘 이상이면 "서로 다른 개념" 안내. 1부 표 마크업·CSS(`.tnr-table`)는 바꾸지 않았고(묶음 제목만 h2 → h3), 2부는 `.rsn-table`·`.concept-switch`·`.number-part` 를 global.css 끝에 새 블록으로 추가.

### 14-2. 계획 시간표 (Phase 4)
- 데이터: `timetableSummaries`(`data/build/timetable-summaries.json`, station_id 기준). `timetableByStation/Service`, `timetableOfStation/Service`, `timetableAsOf`(data_as_of 최댓값), 정렬 `byTimetableOrder`(요일 → 방면 → 운행 계통).
- 역 상세 `StationTimetable`: 요일 탭(평일/토요일/휴일, 데이터에 있는 것만; `?day=` section-tabs, JS 없으면 전부 세로로) × 방면 묶음(`direction_label` ?? `DIRECTION_LABEL`, 운행 계통 링크, route_code). 첫차·막차(`formatHHMM`)·편수·평균 배차 추정(`estimateHeadway` = (막차−첫차)/(편수−1), 자정 넘김 보정)·시간대별 편수 막대(`.hour-bars`, `--v`/`--max` CSS 변수, 24칸 = 0시~23시; **by_hour 는 0시 인덱스 기준, 24시 이후는 0~3시 칸에 더한 값으로 가정**). 기준일 `data_as_of`·확인일·출처 표시. 비어 있으면 `TIMETABLE_EMPTY_NOTICE`("계획 시간표 준비 중(출처 API 승인 대기)").
- 전체 시각: 버튼 `data-timetable-file = routes.timetableFile(station_id)`(= `apps/web/public/timetable/<station_id>.json`), `data-timetable-key = detail_file`. **파일 형식 가정**: `{ "<detail_file>": [ { "hhmm": "0530", "to": "종착역명" }, … ] }`. `parseDetail` 은 최상위 배열·`entries`/`times` 키·`time`/`depart` 필드·"HH:MM" 표기·문자열 항목도 받아들이고 모르는 항목은 버린다. 파일이 없으면(404) 안내문 + 요약 유지. 파일은 커밋 대상(빌드 산출물)이며 이번 라운드에서는 검증 후 삭제했다(apps/web/public/timetable/ 없음).
- 운행 계통 상세 "운행 시간·배차": 이 운행 계통의 역별 요약을 요일·방면(`direction|direction_label`)으로 묶어 첫차 최솟값(`minTime`)·막차 최댓값(`maxTime`)·편수 범위·평균 배차(편수가 가장 많은 역 기준)·역 수. 역별 시간표 링크(`#timetable`).

### 14-3. 연표 (Phase 5, `/timeline/`)
- `eventsByYear(db)`: 연도(fuzzyDate 값 앞 4자리) 내림차순, 연도 안은 `fuzzyDateKey` 오름차순, 연도 모르는 것은 "연도 미상" 묶음 맨 뒤. `eventAreas(db, e)`: `areas` → 연결 노선(`lineAreas`)·역·운행 계통·계획 권역 합집합(AREA_ORDER 순). `recentEvents(db, n)`(피드).
- 권역 필터는 `AreaFilter` + `area-filter.ts`(다른 목록과 같은 `?area=`), 유형 select(`EVENT_TYPE_LABEL` 중 데이터에 있는 것)·검색. JS 없음: 기본 권역에 보이는 항목이 하나도 없는 연도 구역에 `area-hidden`(항목 단위가 아니라 연도 단위 — 항목은 `data-areas` 만 가짐), "전체 보기"(#area-all)로 전부. JS 있음: 항목 `hidden` + 빈 연도 구역·목차 링크 숨김 + 건수.
- 상세 "연혁": 노선·역·운행 계통은 `EventTimeline`(self 제외, "연표에서 보기" 앵커). 계획은 기존 단계 타임라인(stage_history + events 합침)을 유지하고 제목을 "연혁 · 단계 타임라인"으로. 역 상세의 철도역 정보 `history` 텍스트는 `<details class="advanced">` "기관 연혁(원문)"으로 그 아래 유지(이벤트가 없으면 안내 한 줄 + 원문).
- 유형 배지 색(`.badge--event-*`): 개통·운행 계통 개시·환승 개시 초록 / 폐지·운행 계통 종료 빨강 / 휴업 회색 / 역명 변경 파랑 / 단계 변경·계획 반영 주황.

### 14-4. 폐선·폐역 (Phase 5, `/closed/`)
- `closedEntities(db)`: `CLOSED_STATUSES = ['closed','suspended','abandoned']` 노선·역·운행 계통(폐지일 내림차순) + `stage: abandoned` 계획. 사유 = 연결된 이벤트 중 상태에 맞는 유형(closed/service_ended, suspended, 계획은 stage_changed/other; 없으면 전체) 제목·메모 + 노선/운행 계통 `description`, 계획은 단계 이력 "폐기" 메모. 관련 이벤트는 `/timeline/#<event id>` 앵커.
- 링크: 홈 카드, `/lines/`·`/stations/` 안내문, `/upcoming/` 안내문, 연표 안내문, 노선·역 상세의 폐지/휴업일 옆, 푸터. 헤더 탭에는 없음(계획 탭이 `aria-current="true"` 로 가볍게 표시).

### 14-5. Phase 6 선택 과제
- 구현: `/changes.xml`(Atom; events 최근 100건 + "데이터 갱신" 항목, 날짜 = `fuzzyDateIso` 시작일 `T00:00:00Z`), `/sitemap.xml`·`/robots.txt`(직접 생성, `site` + base). head 에 `rel="alternate"`·`rel="sitemap"`.
- 결정(`/about/` "Phase 6 선택 과제 결정" 절): NestJS+PostgreSQL 이행 보류(정적 사이트로 충분; 트리거 = 공간 질의·빌드 시간 CI 한도 초과·사용자 쓰기 기능), 도식 노선도 후순위(공식 노선도 이미지 + 지도 탭으로 대체).

### 14-6. 정리
- `/stations/by-area/<기본 권역>.json` 생성 제외(`defaultAreaOf(countByArea(...))` 와 같은 규칙; `/stations/` 의 `data-area-files` 에서도 뺌). 전체 보기는 나머지 권역 + unknown 만 받는다.
- 헤더 10탭: 900px 미만에서 `.site-nav ul { flex-wrap: wrap }` 두 줄(가로 스크롤·"더보기" 없음).
- 홈 "열차와 연혁" 카드 3개(열차·연표·폐선·폐역; 데이터 수 또는 준비 중 문구).

### 14-7. 검증 (2026-10-11)
- 실데이터 `pnpm build`(validate → build-map → astro build) 1,499 페이지(by-area JSON 은 capital 제외 6개). `pnpm check` 0 errors(`packages/pipeline/src/ingest/build.ts` 오류도 사라짐). 픽스처(`data:validate` + `astro build`) 85 페이지, `BASE_PATH=/k-raildex` 85 페이지(시간표 fetch 경로·Atom/sitemap/robots 절대 URL·연표 앵커가 `/k-raildex/` 로 시작). 빈 데이터(`data/build/*.json` + `services.yaml` 제거) 16 페이지, `/trains/`·`/timeline/`·`/closed/`·홈에 안내문, 피드는 "데이터 갱신" 1건.
- 헤드리스 Chrome(CDP, 픽스처 dist, `/`·`/k-raildex/` 둘 다): `/trains/` 7행, 102 → KTX 번호대 강조 + "짝수 → 상행", 1001 → GTX 번호대 "홀수 → 상행", 77777 → 없음 안내, `?n=2500` → 2호선 번호대; 헤더 "열차" `aria-current=page`. 시청역 시간표: 요일 탭 평일(2)/토(1)/휴일(1), 토요일 클릭 → `?day=saturday` 구역 전환, 임시 `apps/web/public/timetable/stn-city-hall.json` 으로 "전체 시각 보기" → 5행(시각·행선지·비고) / 대체 모양(`entries` + 문자열 + `time`/`dest`) 3행 / 빈 배열 안내, 강남역(파일 없음) → 404 안내 + 요약 유지, 막대 72칸(`--max:22`, 최댓값 64px). 폐역 상세 연혁 1건. `/timeline/` 기본 수도권 6건(2022·2008 연도 숨김) → 전체 8건 → 유형 개통 2건(목차 5개 숨김) → 대경권+개통 1건, `#evt-…` 앵커로 가려진 항목 진입 시 전체 보기 전환. `/closed/` 노선 1·역 2·운행 계통 1·계획 1, 연표 앵커 4개. `changes.xml` 9 entry, `sitemap.xml` 84 url, `robots.txt`. `/stations/?area=all` 38행(파일 4개, capital 없음). 콘솔 오류는 의도된 404(강남역 시간표 파일)뿐.

## 15. 표 반응형 규칙 (2026-10-12)

좁은 화면(≤760px)에서 열이 많은 표가 "한 글자씩 세로 읽기"가 되지 않게 한다. 데스크톱(≥900px)은 그대로. 구현은 `apps/web/src/styles/global.css` 끝의 "표 반응형" 절, 선택은 표마다 wrapper 클래스로 정한다.

| 패턴 | wrapper | 좁은 화면 동작 | 선택 기준 |
|---|---|---|---|
| (a) 스크롤형 | `.table-wrap` (기본) | 셀 `white-space: nowrap`, 가로 스크롤, 첫 열(`tr > :first-child`) `position: sticky; left: 0`, 우측 그라데이션 힌트(배경 `local`/`scroll` 두 겹, 스크롤 끝에서 사라짐), 캡션은 `max-width: calc(100vw - 2rem)` + sticky | 열 4개 이하이거나 시각·●/— 격자처럼 행을 가로로 비교해야 하는 표 |
| (b) 카드형 | `.table-wrap.table-wrap--cards` | `tr` → 카드(flex column), `thead` 시각적 숨김(접근성 유지), `td[data-label]::before { content: attr(data-label) }` 로 "라벨: 값"(라벨 7rem 고정 폭 inline-block + `text-indent` 내어쓰기), 제목 = `th[scope=row]` 또는 `td.cell-title`(`order: -1`) | 열 5개 이상인 목록 표(이름 1개 + 속성 여러 개) |

- 적용: (a) 홈 지역별 집계(3열), 역 상세 "노선별 이전·다음 역"(colspan 셀 있음), 운행 계통 정차 패턴 격자, 시간표 `.timetable-detail`(StationTimetable, 스크롤 + 첫 열 고정만). (b) 노선 목록, 역 목록(전체·지역), 계획 사업 목록, 열차번호대(`/trains/`), 개통 예정 3표, 폐선·폐역 4표, 출처, 노선 상세 역별 거리(역 열이 `td.cell-title`), 운행 계통 상세의 시간표 요약·번호대, 계획 상세 plan_refs.
- `data-label` 문자열은 그 표의 `<th scope="col">` 과 같게 쓴다. 클라이언트가 행을 만드는 역 목록(`apps/web/src/scripts/station-table.ts` `td()`)도 같은 라벨을 넣는다.
- 카드 모드는 `tr` 의 display 를 덮어쓰므로 숨김 규칙을 다시 명시한다: `[hidden]`(section-tabs, `!important`)은 그대로 이기고, `.area-hidden`(권역 필터)은 `.table-wrap--cards tr.area-hidden { display:none }` / `.area-scope:target … { display:flex }` 로 재선언. 열차번호 검색 강조(`tr.is-hit`)·앵커(`tr:target`)는 셀 대신 카드 전체에.
- 셀 텍스트: 카드 모드에서 `word-break: keep-all; overflow-wrap: anywhere`(단어 단위 줄바꿈, 긴 영문·URL 은 강제 분리). 숫자 열(`.num`)은 항상 `white-space: nowrap; font-variant-numeric: tabular-nums`.
- 스크립트 호환: `section-tabs.ts`(`tbody tr` + `hidden`), `area-filter.ts`(`.area-hidden` 클래스), `train-number-search.ts`(`tr[data-from]`, `.is-hit`), `station-table.ts`(행 생성)는 모두 `tr` 단위로만 동작하고 `thead`/열 위치에 의존하지 않는다.

## 16. 시각 디자인 원칙 (round-5, 2026-10-12)

사용자 평가 "나무위키에서 철도 정보만 뽑아낸 페이지 같다"에 대한 답. 정보 밀도는 유지하고 **위계·여백·색·타이포·탐색**을 다시 설계해 "참고 사이트"가 아니라 "도감"처럼 보이게 한다. 구현은 `apps/web/src/styles/global.css`(토큰 → 기본 → 컴포넌트 순) 한 파일.

1. **토큰으로만 쓴다.** 글자 크기 4단계(`--fs-xs/sm/md/lg/xl/2xl`: 캡션·본문·소제목·제목), 여백 7단계(`--sp-1~7`), 반경 3단계, 그림자 2단계(`--shadow-1` 카드, `--shadow-2` 떠 있는 것). 색은 바탕(`--bg` 연회색)·면(`--bg-raised` 흰색)·경계·강조(`--accent`) + 상태색(운영/공사/계획/폐지/폐기·휴업) + 단계 신호등 + 분류색 + 검수색. 라이트/다크는 같은 변수 이름으로 재정의. 노선 색(`Line.color`)은 상세 헤더 띠·역 순서 세로선·칩 왼쪽 띠·점(`.line-dot`)에만 쓰고 글자색으로는 쓰지 않는다(대비).
2. **면 위에 정보.** 페이지 바탕은 연회색, 표·카드·도구 모음·헤더 밴드는 흰 면(`.surface`)에 둔다. 표는 면 안에 테두리·둥근 모서리, 헤더 행은 작은 글자(`--fs-xs`)·회색, 행 호버.
3. **이름은 두 줄.** 한국어가 주, 영문·한자·정식 명칭은 아래 줄 작은 회색(`NameText` 블록). 가로로 흐르는 곳(환승 노선 나열·인라인 리스트·문장)만 `inline`.
4. **상세 페이지 = 헤더 밴드 + 2단.** 밴드: 색 띠 → 현재 위치 → 이름 → 배지 줄(상태·분류·검수) → 키 팩트 3~6칸. 본문(`.detail-main`)에 핵심 절, 사이드(`.detail-side`)에 지도 버튼·관련 항목 패널·식별자/출처 접힘(`details.advanced`). 좁은 화면은 한 단.
5. **목록 페이지 = 제목 + 한 줄 lede + 접힌 도움말 + 도구 모음.** 탭(분류)·권역 탭·필터 폼·초성 칩을 `.toolbar` 한 면에 묶는다. 상태·분류는 배지, 숫자는 우측 정렬 + `tabular-nums` + nowrap. 빈 상태는 한 줄. 긴 안내문·규칙 설명은 `Help`(접힘)로.
6. **설명충 금지.** 본문에 파일명·`code` 경로·스키마 이름·"docs/… 참조"·구현 설명("JS 가 없으면 …")·라운드 번호를 쓰지 않는다. 사용자 문장만 남기고, 출처·검수 상태·기준일은 작은 배지(`ReviewBadge`)나 접힘(`details.advanced`·`details.cell-more`·`Help`)으로 옮긴다. 데이터가 없을 때는 "아직 데이터가 없습니다" 한 줄.
7. **탐색.** 헤더 탭 10개는 글자만(아이콘 없음), 현재 탭 굵게 + 밑줄, 하위 구역은 밑줄만(`aria-current="true"`), 좁은 화면 두 줄. 하위 묶음은 보조 탭(`.sub-tabs` 알약: 계획 5개, 열차 2개). 접힘 묶음(`details.group`)은 기본 열림 여부를 데이터 중요도로 정하고(열차 탭: 고속·일반 열림) 검색·앵커가 자동으로 편다.
8. **홈.** 검색 박스가 첫 화면 중심(`.hero`), 그 아래 진입 카드 6개(`.entry-cards`, 숫자 한 줄), 권역별 카드(역·노선 수), 개통 예정(가까운 순 5건, 일 단위 날짜는 D-day 배지)·최근 연표(5건) 2단, 통계 한 줄. 긴 설명문 없음.
9. **접근성.** 명도 대비 AA(본문 ≥ 7:1, 보조·배지 ≥ 4.5:1), 포커스 링 3px, 탭 `aria-current`, 표 `caption`, 접힘은 `<details>`(JS 없이 동작). 표 반응형(15절)은 그대로.

## 폐지·휴업 개체 분리 (2026-10-13 사용자 요청)
- 폐지·휴업·폐기 상태(`isClosedStatus` = `CLOSED_STATUSES`)인 노선·역·운행 계통은 `/lines/`·`/stations/`(by-area JSON 포함)·`/stations/region/*`·`/services/` 목록에서 뺀다. 상세 페이지는 그대로 생성되고 `/closed/`·검색·연표에서 들어간다.
- 노선 상세 "이 노선을 지나는 운행 계통"과 사이드 패널, 역 상세 "정차하는 운행 계통"에서 운행 종료·중단 계통을 뺀다. 노선 상세는 숨긴 계통이 있으면 `/closed/` 링크 한 줄.
- 노선 상세 역 순서의 폐역은 노선 이력의 일부라 그대로 둔다(`is-closed` 표시).
