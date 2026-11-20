# 한국철도도감 (K-Raildex)

한국의 열차·철도 정보를 **현실에 입각해** 제공하는 웹페이지 프로젝트.
서비스 이름은 "한국철도도감", 영문 "K-Raildex". 저장소 디렉터리 이름(future-rail-db)은 변경 예정.

현재 단계: **D 단계 구현(2026-10-14): DB 가 원천(own_record), data/ 는 백업. 변경 묶음 = API 제출 → 관리 앱(apps/admin)·CLI 승인 → worker 반영(빌드·검증·적재, 실패 시 되돌림) → data/ 백업. 공개 사이트는 Next.js SSR(apps/web) — 요청마다 비공개 API 에서 데이터, 승인되면 몇 초 안에 반영(다시 빌드 없음). 구조 docs/design/platform-architecture.md 3-5·4-2절.** 총 구현 사항은 docs/PLAN.md 9절, 진행 기록은 8절.
구현은 "구현 → round-N.md 결정 질문 → 답변 → 구현" 라운드로 진행한다(docs/review/README.md).
조사 결과와 결정 사항은 `docs/` 아래 문서로 축적한다. 작업 순서는 docs/PLAN.md의 Phase를 따른다.

## 프로젝트 컨셉 (요약, 원문은 docs/REFERENCE.md)

1. **용어**: 도시철도·일반철도·광역철도·고속철도 등 철도 용어의 정의 제공
2. **현재 정보**: 열차(차량·등급) 정보, 노선도, 운행 계통 등 현재 존재하는 철도 정보
3. **계획 정보**: 국토종합계획, 국가철도망 구축계획 등 상위 계획에 근거한 노선별
   개발 계획, 현재 사업 단계, 최신 동향
4. **벤치마크**: 미래철도DB (https://frdb2.ivyro.net) — 지역별 / 개통시기별 /
   신설예정역 / 폐기된 계획 분류, "사업상황 신호등"(구상→계획→설계→시공)
   - 사용자 평가: **정보의 질은 상당히 높다. 그러나 UI/UX, 특히 가독성이 매우 나쁘다.**
   - 따라서 이 프로젝트의 차별점은 "같은 수준의 정확한 정보 + 읽기 쉬운 구조·화면"이다.
     정보 깊이는 미래철도DB 수준을 목표로 하되, 분류·탐색·화면 설계는 처음부터 다시 한다.
5. **추가 벤치마크**: noseon.do(미래 지하철 노선도, 지도 기반 연도별 타임라인),
   metro20xx.kr(미래철도20XX, 철도 + 부동산 실거래). 상세 분석은 docs/research/benchmark-sites.md.
6. **범위 밖**: **부동산(실거래가, 역세권 분석 등)은 핵심 관심사가 아니다.**
   미래철도20XX의 부동산 기능은 따라 하지 않는다. 철도 정보 자체가 중심이다.
7. **비상업 원칙**: 코레일 전국 노선도(공공누리 제4유형)를 게시하므로 광고·유료 기능·후원 결제를
   넣지 않는다. 넣어야 한다면 노선도 게시를 먼저 철회한다.
8. **확정 스택**: 공개 사이트 Next.js(React) **SSR**(2026-10-14 사용자 결정 — 데이터가 바뀌어도 다시 빌드하지 않는 프론트엔드, API 는 비공개라 SPA 가 아니라 SSR) + MapLibre + VWorld 타일.
   데이터 원천은 DB(D 단계), git 의 data/ 는 백업. round-6 결정(docs/design/platform-architecture.md 6절):
   C 단계(2026-10-14 구현) 모노레포 + PostgreSQL/PostGIS + NestJS 읽기 API(비공개), D 단계(2026-10-14 구현: 쓰기 API·worker·관리 앱 apps/admin)부터 DB 가 원천·data/ 는 백업,
   승인 = 직접 반영, 서버 한 대 docker-compose, 수집기는 기계적 갱신만 자동, 이용자 제보는 GitHub 이슈 양식.

## 작업 규칙

### 서브 에이전트 (최대 2개)

- 한 작업(턴)에서 호출하는 서브 에이전트는 **최대 2개**. 동시 실행도 2개까지.
- 2개로 부족하면 작업을 쪼개서 순차 진행하거나 직접 수행한다. 3개 이상은 금지.
- 단순 조회, 파일 1~2개 읽기, 웹 페이지 1~2개 확인은 서브 에이전트 없이 직접 한다.
- 서브 에이전트 프롬프트에 "다른 서브 에이전트를 호출하지 말 것"을 명시한다.

### 용어 사전 (docs/TERMINOLOGY.md)

- 문서·코드·데이터에 철도 용어를 새로 쓰게 되면 먼저 `docs/TERMINOLOGY.md`를 확인하고,
  정의가 없으면 **추가한다**. 추가 시 파일 안의 형식(용어 / 정의 / 근거·출처 / 예 / 주의)을 따른다.
- 법령·공식 자료의 정의를 우선하고 출처를 적는다. 통용 속칭과 법적 정의가 다르면 둘 다 적는다.
- 기존 정의와 충돌하는 내용을 발견하면 덮어쓰지 말고 "주의" 항목에 병기한 뒤 REFERENCE.md에 질문으로 남긴다.
- 문서 전체에서 용어 표기는 TERMINOLOGY.md의 표기를 따른다.

### 사용자 의도가 필요한 사항 (REFERENCE.md → round-N.md)

- 범위, 대상 사용자, 기술 스택, 데이터 출처 정책 등 **사용자가 결정해야 할 사항**은
  작업을 멈추고 묻지 않는다. 질문으로 적고 "임시 가정"을 세워 진행한다.
- 어디에 적는가: **구현 전**(조사·계획 단계)은 `docs/REFERENCE.md`의 `# 결정이 필요한 질문`.
  **구현 라운드를 한 번 끝낸 뒤** 생긴 질문은 `docs/review/round-N.md`(docs/review/README.md 참조).
  round-N.md 는 코드 리뷰 문서가 아니다. "이 선택지 중 어떻게 구현할까요?"만 담는다.
- 질문 형식(두 파일 공통):
  ```
  ### Q{n}. 질문 한 줄
  - 배경: 왜 결정이 필요한지
  - 선택지: A / B / C
  - 임시 가정: 답이 없는 동안 따르는 가정
  - 답변: (사용자가 적는 칸)
  ```
- 번호는 REFERENCE.md 부터 이어서 매긴다. 사용자가 `답변:`을 채우면 그대로 구현하고,
  REFERENCE.md 의 것은 `# 결정 사항`으로 옮긴다. round 파일은 기록으로 남기고 수정하지 않는다.
- 이미 결정된 사항을 다시 묻지 않는다. 결정 사항과 어긋나는 작업을 하지 않는다.
- 결정이 아닌 것(검수·정리·버그)은 질문으로 올리지 않고 그냥 한다.

### 정확성 원칙 ("현실에 입각")

- 개통일, 사업 단계, 연장(km), 열차 등급, 운영 기관 등 **사실은 출처와 확인 날짜를 함께** 기록한다.
- 출처 우선순위: 법령·고시 > 국토교통부·국가철도공단·운영기관 공식 자료 > 언론 보도 > 위키·커뮤니티.
- 기억이나 추측만으로 수치를 쓰지 않는다. 확인하지 못한 값은 `미확인`으로 표시한다.
- 계획 노선은 반드시 사업 단계(구상/계획/설계/시공/개통)를 붙여 쓰고, "확정"과 "검토 중"을 구분한다.
- **노선(물리 노선)과 운행 계통을 항상 구분한다.** 노선의 분류는 법적 분류(고속철도/일반철도/도시철도)와 광역철도 지정 여부, 운행 계통의 종류는 고속열차/광역전철/도시철도/일반열차. "광역철도"(노선 지정)와 "광역전철"(운행 계통)을 섞어 쓰지 않는다. 예: 경의선·중앙선은 일반철도(광역철도 지정 구간 포함), 그 위의 "수도권 전철 경의·중앙선"은 광역전철 운행 계통. docs/TERMINOLOGY.md 1·4절.
- 미래철도DB 등 외부 사이트의 **데이터를 그대로 복제하지 않는다**. 구조·분류 방식은 참고하되
  데이터는 1차 출처에서 직접 수집한다.

### 지도·OSM
- OSM 선형은 `data/osm/`(ODbL)에만 두고 자체 데이터(`data/build/`, `data/own/`, DB own_record·개체 테이블)에 섞지 않는다. 역 좌표는 자체 데이터만. 지도 산출물(`map/lines.geojson`, ODbL 표기 포함)은 DB `build_artifact` 에 파일 단위로 따로 저장한다(집합 DB — 자체 레코드와 분리).
- OSM 좌표는 **참고**로 쓸 수 있다(2026-10-14 사용자 지시: "저장하는 것이 아니라 참고"): 지도 산출물(apps/web/public/map) 생성 때 근사 좌표 역을 OSM 선형 위로 옮겨 표시, 좌표 검수·조사 단서. OSM 에서 얻은 좌표를 data/own·data/build 에 저장하지는 않는다.
- 노선 ID 를 바꾸면 `data/own/overrides/osm-line-map.yaml` 의 `line_id` 도 함께 바꾼다(없으면 빌드 실패).
- VWorld 키는 빌드 시 `VWORLD_API_KEY` 로 주입되어 dist 의 타일 URL 에 들어간다(도메인 묶인 공개 키). 저장소에는 넣지 않는다.

### 키·비밀값
- VWorld, 공공데이터포털, 서울 열린데이터광장, 법제처 API 키와 로컬 비밀값(POSTGRES_PASSWORD·API_TOKEN·ADMIN_TOKEN·CLOUDFLARE_TUNNEL_TOKEN)은 **절대 커밋하지 않는다**.
  환경 변수(.env — 변수 목록은 .env.example이 기준: VWorld, 공공데이터포털 공통·서비스별, 레일포털, 서울 열린데이터광장, 법제처)와 GitHub Secrets로만 다룬다.
- 공공데이터포털 API는 서비스별 활용신청이 필요하고, 국가철도공단 시간표 API는 레일포털 별도 키다. 키 조회 로직은 "서비스별 변수 → 공통 변수" 순으로 찾는다.
- `.env*`는 .gitignore에 넣고(.env.example만 예외), `.env.example`에 키 이름만 적는다. 새 키가 필요하면 .env.example과 이 목록, docs/SOURCES.md 1절(키·승인 현황)을 함께 갱신한다.

### 구현 규칙
- **원천은 DB, data/ 는 백업(D 단계, 2026-10-14 사용자 지시)**: 수기 데이터 원천은 PostgreSQL `own_record`(data/own 형태), 빌드 산출물은 개체 테이블·`build_artifact`. `data/own`·`data/build` 는 worker 가 반영마다 내보내는 **백업**이라 **손으로 고치지 않는다**(다음 내보내기에 덮인다). 원본 파일로 남는 것은 `data/public/raw`(공공데이터·고시 원문)와 `data/osm` 뿐.
- **데이터 추가는 변경 묶음으로(유일한 경로)**: 새 노선·역·계획·출처 등을 넣을 때 소스 코드도 data/ 파일도 고치지 않는다. 조사 결과는 `data/changesets/inbox/*.yaml`(packages/schema/changeset.schema.json)로 만들고 `pnpm data:apply`(API 제출 + 승인 + worker 반영 대기, 검증 실패 시 원천 그대로)로 반영하거나 관리 앱(apps/admin)에서 승인한다. 미리 보기 `pnpm cs:submit --dry-run <파일>`. 원본 파일(raw·osm)을 갱신하면 `pnpm db:rebuild`. 규칙 docs/design/data-pipeline.md, 구조 docs/design/platform-architecture.md 4-2절.
- 데이터 규칙은 docs/design/data-conventions.md 가 기준. `packages/schema/*.json` 과 `apps/web/src/content.config.ts` 는 항상 함께 바꾼다.
- 검증(`data:validate`)은 worker 의 반영·재빌드 안에서 항상 돈다(실패하면 반영되지 않는다). 검증을 우회하는 반영 경로를 만들지 않는다.
- 데이터 값을 코드에 하드코딩하지 않는다. 사이트(SSR 서버)·관리 앱은 **API 로만** 데이터를 읽는다(`/export/own/*`, `/artifacts/*`, 읽기 엔드포인트). 사이트는 요청 때 읽으므로 데이터가 바뀌어도 다시 빌드하지 않는다. `pnpm dev`·사이트 실행에는 API 가 떠 있어야 한다.
- 구현 중 "사용자에게 물어야 할 선택"이 보이면 그 자리에서 docs/review/notes.md 에 적어 두고, 라운드가 끝날 때 round-N.md 질문으로 옮긴다.

### 문서 작성

- 언어: 한국어. 날짜는 `YYYY-MM-DD`.
- 조사 결과는 `docs/research/` 아래 주제별 파일로 저장하고, 파일 상단에 조사일과 출처 목록을 둔다.
  REFERENCE.md에는 결과 전문을 넣지 않고 해당 파일로의 링크와 한 줄 요약만 둔다.
- 새 문서를 만들면 아래 디렉터리 목록을 갱신한다.

## 디렉터리

```
.env.example            API 키 변수 목록 (실제 값은 .env, 커밋 금지)
CLAUDE.md               이 파일. 프로젝트 규칙
docs/PLAN.md            Phase별 구축 계획 (아키텍처 결정, 데이터 모델 요약, 일정)
README.md / LICENSE / DATA-LICENSE / NOTICE
pnpm-workspace.yaml     모노레포(C 단계, 2026-10-14): apps/web(공개 사이트) · apps/api(NestJS 읽기 API, 비공개) · packages/core(region·rail-class·map-style 공용) · packages/schema(JSON Schema) · packages/pipeline(수집·빌드·검증·변경 묶음) · packages/db(DDL·마이그레이션·적재). data/ 는 루트
package.json            루트 pnpm 스크립트(각 워크스페이스로 위임, 이름은 그대로): check(모든 워크스페이스 tsc/astro check), db:migrate/db:load(DB 적재), api:build/api:dev/api:smoke, dev, build(validate → build-map → astro build), data:download/build/validate/all, data:apply(변경 묶음 반영), data:fetch-tago-subway/fetch-kric/fetch-kric-stations(레일포털 역사별 정보, 2026-10-12 승인)/fetch-osm/build-map/check-coords/geocode, data:fetch-plans/build-plans/fetch-chronology/fetch-gazette(Phase 3), data:fetch-tago-timetable/build-timetables/fetch-train-timetable/fetch-kric-train-ops(Phase 4 시간표; 레일포털 운행정보 → 토요일·2호선 내외선·열차번호)
apps/web/                공개 사이트 Next.js 16 SSR(2026-10-14): src/app(라우트 — 페이지·route 핸들러), components(TSX), lib(data.ts = API 에서 받은 컬렉션 캐시·데이터 판 확인, schemas.ts = 컬렉션 zod 규격, api.ts·artifact.ts·terminology.ts), client(브라우저 스크립트 init(), PageScript 로 실행). 실행 환경 변수 API_URL·API_TOKEN·VWORLD_API_KEY·SITE_URL·PUBLIC_ISSUES_URL·SYSTEM_SUMMARY(on 이면 /system-summary 시스템 구조도 공개, 기본 꺼짐), 빌드 시 BASE_PATH. 개발 서버(next dev)에 localhost 가 아닌 호스트로 접속하려면 DEV_ALLOWED_ORIGINS(.env, 쉼표 구분) — 없으면 /_next/* 가 403 이라 지도 등 스크립트가 안 뜬다. next dev 는 운영 이미지보다 5~10배 느리다. 포트: web(운영 빌드) 5000, dev 5001 — 둘 다 상시 기동, 코드를 바꾸면 둘 다 다시 띄운다(web 은 --build)
packages/schema/                 JSON Schema (데이터 원본 규격, content.config.ts 와 일치 유지)
packages/pipeline/src/validate.ts     스키마·참조 무결성 검증 / packages/pipeline/src/ingest/  다운로드·정규화 (build-kilo-lines.ts = 코레일 역키로정내역 → 지방 간선 중간역·km, build.ts 가 호출; fetch-kric-train-ops.ts = 레일포털 운행정보 xlsx → 노선번호별 json.gz)
data/own/               수기 큐레이션 YAML (sources, train-classes, services, lines-manual(고속선·경의선·용산선·중앙선 등 수기 물리 노선), stations-manual(미개통·신설·폐역), events-manual(수기 연표), train-number-ranges(열차번호 체계 D28), rolling-stock-numbers(차량번호(차호)·편성번호 체계, 열차번호와 별개), plan-programs(상위 계획: 국토종합계획·국가철도망 1~5차·시도 도시철도망, plan_refs.program 참조 대상), plans/(계획 사업: nrp1-2(1·2차 국가철도망)·nrp3·nrp4-new·nrp4-review·ongoing·metro-seoul·metro-gyeonggi·metro-incheon·metro-ulsan·metro-busan·rail-underground(철도지하화 통합개발 우선추진사업 3곳, 상위 계획 rail_underground)), route-maps, overrides/: line-names, line-order, station-names(영문명·역명 정정 ko), station-merges(병합·RAFIS 내부 표기 internal), station-kinds(역 종류 kind·폐역 보정: 신호장·분기점·조차장·차량기지·화물역), line-station-inserts(공사 중·계획 정거장을 기존 노선 역 순서에 끼워 넣기), station-coords(lat/lng · same_as · geocode+basis parcel·district·township), osm-line-map, molit-line-numbers(사업용철도 노선번호 → 노선 codes.molit_line_no, Q156), tago-route-services, kric-codes(레일포털 운영기관·선코드), korail-kilo-lines(역키로정 노선코드 → 물리 노선·별칭·기점, Q74), kric-train-ops-routes(운행정보 노선번호 → 운행 계통·요일·역명 약어, Q82·Q84))
data/public/raw/        공공데이터 원본 (+ geocode/results.json 지오코더 결과, src-kr-nrp4-*/ 국가철도망 HWPX, src-kric-chronology/ 연표, src-kric-gazette/ 관보 목록 + texts/ 관보 고시 원문 텍스트, src-molit-press/texts/ 국토교통부 보도자료 원문 텍스트, src-moef-press/texts/ 기획재정부 보도자료 원문 텍스트, src-seoul-notice/texts/ 서울특별시 고시·공고 원문 텍스트(공고문·전략환경영향평가 요약문), src-seoul-press/texts/ 서울특별시 보도자료 원문 텍스트(HWP 추출), src-incheon-press/texts/ 인천광역시 보도자료 원문 텍스트(HWP 추출), src-daejeon-press/texts/·src-busan-press/texts/·src-gg-press/texts/ 대전시·부산시(시보)·경기도 보도자료 본문 텍스트(누리집 HTML 추출), src-incheon-plan1/ 인천 도시철도망 구축계획(1차 2018·변경 2022) 요약보고서·고시문 텍스트, src-incheon-plan2/ 제2차 인천 도시철도망 구축계획 요약보고서 텍스트, src-korail-timetable/texts/ 코레일 열차운임/시간표 자료실 시간표 xlsx 추출 TSV(일반열차·관광열차·ITX-청춘, manifest sha256), src-kdi-pfs/texts/ KDI 예타 보고서 요약 텍스트(원본 PDF 는 두지 않음, manifest sha256), src-korail-station-kilo/ 역키로정내역, src-kric-file-train-ops/ 운행정보 정규화 json.gz(원본 xlsx 는 _large/, gitignore)) / data/build/  정규화 결과 JSON (사이트가 읽음: stations·lines·line-stations·plans·events·timetable-summaries) / data/build/report.md, coord-check.md
data/osm/               OpenStreetMap 추출 선형 (ODbL, 자체 데이터와 분리) — packages/pipeline/src/ingest/fetch-osm-rail.ts (rail-ways = 전국 철도 way(2026-10-14 수도권에서 확대), rail-construction-kr = 전국 공사 중 선형)
apps/web/public/map/             지도 탭용 GeoJSON (빌드 시 packages/pipeline/src/ingest/build-map.ts 가 생성, 커밋됨; plans.geojson = 계획 노선 개략 선형)
data/own/geometry/      계획 노선 개략 선형 표(plan-routes.yaml: kind schematic = 경유역 id 직선, kind traced = 공식 노선도 이미지에서 딴 좌표 목록; 2026-10-18 traced 18건)
packages/pipeline/scripts/route-trace/  노선도 이미지 → traced 선형 추출 도구(README: grid/tiles 로 기준역 화소 읽기 → mask → trace(아핀·MLS·유사변환) → split/plot → gen_cs 변경 묶음)
apps/web/public/timetable/       역별 계획 시간표 전체 시각 (build-timetables.ts 생성, 수도권 637역, 커밋됨)
data/own/plans/(nrp1-2·nrp3·nrp4-new·nrp4-review·ongoing·metro-seoul·metro-gyeonggi), lines-manual.yaml, stations-manual.yaml, events-manual.yaml, train-number-ranges.yaml, rolling-stock-numbers.yaml  수기 계획·노선·역·이벤트·열차번호 체계·차량번호(차호)·편성번호 체계
apps/web/public/map/             지도 탭용 GeoJSON (빌드 시 packages/pipeline/src/ingest/build-map.ts 가 생성, 커밋됨)
apps/web/public/timetable/       역별 계획 시간표 전체 시각 (build-timetables.ts 생성, 수도권 660역 — TAGO 평일·휴일 + 운행정보 토요일·2호선 내외선·열차번호, 커밋됨)
data/own/plans/, lines-manual.yaml, stations-manual.yaml, events-manual.yaml, train-number-ranges.yaml, rolling-stock-numbers.yaml  수기 계획·노선·역·이벤트·열차번호 체계·차량번호(차호)·편성번호 체계
packages/schema/plan-program.schema.json  상위 계획(PlanProgram) 스키마 — plan_refs.program 의 참조 대상, 차수 enum 을 코드에 두지 않는다
packages/pipeline/src/ingest/hwp2txt.py  HWP 5.0 본문 텍스트 추출(상위 계획 원문용, 원본 바이너리는 저장소에 두지 않고 추출 텍스트 + manifest sha256)
packages/schema/rolling-stock-number-range.schema.json  차량번호대 스키마 (train-number-range 와 별개 개체; 규칙 docs/design/data-conventions.md 5-8)
docs/design/plan-model.md, timetable-model.md  계획·열차·시간표 모델
apps/web/public/timetable/       역별 계획 시간표 전체 시각 JSON (data:build 의 build-timetables.ts 가 생성, 커밋됨; 수도권 637역)
apps/web/public/route-maps/      공개 노선도 이미지 원본 (코레일 제4유형: 변형 금지)
apps/web/src/scripts/            클라이언트 스크립트 (map-page.ts: MapLibre + VWorld, tab-counts.ts: 분류 탭 ↔ 권역 탭 숫자 동기화)
apps/web/src/pages/plans/programs/  계획 체계 페이지(/plans/programs/: 상위 계획별 기간·고시 이력·철도 부문 요지)
docs/design/            data-conventions.md 등 설계 규칙, data-pipeline.md(변경 묶음 반영 파이프라인), platform-architecture.md(DB·BE·FE·수집기 단계안), plan-model.md(계획·연표 모델, Phase 3), timetable-model.md(열차번호 체계·차량번호(차호)·편성번호 체계·시간표, Phase 4)
docs/review/            구현 라운드별 결정 질문 (README.md 규칙, round-1~8 답변 완료, round-9 질문 대기(2026-10-18, Q159~Q166), notes.md = 임시 메모(2026-10-18 traced 선형 작업의 추가 질문 후보: 분기 노선 MultiLineString·오차 표기))
docs/design/site-structure.md  라우트·컴포넌트·모드 동작
docs/design/deployment-cloudflare.md  도메인 연동(Cloudflare Tunnel, **k-raildex.com** 2026-10-18 적용: 절차·결정 Q-a~e·적용 기록; 공개는 web:5000 만, admin·api·db 비공개)
data/changesets/        변경 묶음(inbox/ = 제출할 파일 → pnpm data:apply(API) → applied/ = 반영 기록 백업)
packages/db/            PostgreSQL+PostGIS: migrations/*.sql(0001 개체 테이블, 0002 원천 own_file·own_record·build_artifact·job, 0003), src/own.ts(data/own 파일 ↔ kind ↔ 키 표, 원문 조각·merge), own-store.ts(import·export·sync), changeset.ts(변경 묶음 → own_record), rebuild.ts(작업 공간 빌드 → 적재), worker.ts(job 처리 + 백업 내보내기), import.ts(백업 → DB, pnpm db:import), export.ts(DB → data/, pnpm db:export), cs-cli.ts(pnpm data:apply·cs:submit), Dockerfile.worker
apps/admin/             관리 앱(Next.js 16 SSR, 비공개, 2026-10-15 Astro → Next.js): 변경 묶음 대기열·미리 보기 diff·승인/반려·제출, 작업(job)·재빌드, **원천 레코드 편집**(/records/<kind>/<key> YAML → merge/upsert/delete 변경 묶음), **역·노선 보정 편집**(/entities/stations·lines → station_name·station_coord·station_kinds·station_region·line_override), **지도 위치 편집**(/map MapLibre 끌기 → station_coord). 토큰은 httpOnly 쿠키, 서버가 API_URL 호출(/api/proxy). docker-compose admin(127.0.0.1:5200), dev 5201. apps/admin/README.md
apps/api/               NestJS 12 API(비공개): 읽기(API_TOKEN, src/catalog 18개) + export(/export/own/*·/artifacts/*, 사이트·관리 앱 데이터) + changesets·jobs·rebuild(ADMIN_TOKEN). test/smoke.mjs·write.mjs, Dockerfile. 목록 apps/api/README.md
apps/web/tests/fixtures/         사이트 개발용 소규모 데이터 픽스처 (data/ 와 같은 구조)
data/build/report.md    ingest 리포트 (자동 생성, 사람 확인 목록)
.github/workflows/      CI (백업 data/ → DB → API·worker → 시험 → 사이트 SSR 빌드·기동 확인). GitHub Pages 배포 없음
Dockerfile / docker-compose.yml   Docker 실행 (db·api·worker·admin·web(Next.js SSR, 5000) 기본, dev 프로필 = next dev(5001); db(postgis, 127.0.0.1:5433) + api(127.0.0.1:5100)); cloudflared(프로필 tunnel, .env COMPOSE_PROFILES=tunnel — k-raildex.com → http://web:5000, 포트 개방 없음)
docs/REFERENCE.md       컨셉 원문, 참고 사이트 목록, 조사 메모, 결정이 필요한 질문, 결정 사항
docs/SOURCES.md         데이터 출처 요약 — 1절 키·승인 현황(손), 2절 sources.yaml·manifest 에서 자동 생성(pnpm docs:sources; 출처를 추가·변경하면 다시 실행)
docs/TERMINOLOGY.md     철도 용어 사전
docs/research/          조사 결과 (주제별)
docs/research/benchmark-sites.md   참고 사이트 분석 (미래철도DB, noseon.do, 미래철도20XX)
docs/research/tech-stack.md        기술 스택 비교, 데이터 모델 초안
docs/research/naming.md            프로젝트 이름 후보
docs/research/data-sources.md      데이터 출처 조사 (공공데이터·계획 문서·라이선스)
docs/research/map-and-geometry.md  노선도·지도·선형 데이터 조사
docs/research/train-numbers-check.md  레일포털 운행정보 열차번호 ↔ 열차번호대 대조 결과 (Q82)
docs/research/wide-area-designation.md  광역철도 지정 고시 조사 (Q71, 관보 원문 다운로드 경로)
docs/research/plan-documents.md    상위 계획 원문 조사(국토종합계획 1~5차, 국가철도망 1·2차, 서울·경기 도시철도망, 다른 시·도 고시 목록)
docs/research/transfer-center-plans.md  환승센터·복합환승센터 기본계획 1~4차 원문 조사(raw/src-molit-tc-plan1~4, 3차 사업표 전사 TSV)
data/own/transfer-centers.yaml  환승센터·복합환승센터 사업 87곳(TransferCenter, packages/schema/transfer-center.schema.json, 규칙 data-conventions 5-11) → /transfer-centers/, 역 옆 태그
docs/design/                       Phase별 세부 설계 (예정)
```
