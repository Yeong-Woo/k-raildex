# 다음 단계 구조 — DB·BE·FE 와 자동 수집

- 작성: 2026-10-14 (사용자 요청: "다음 단계로 DB, FE, BE 를 추가할 준비", "노선·열차·역·계획을 찾아 추가하는 과정을 자동화")
- 갱신: 2026-10-14 round-6 답변(Q142~Q149) 반영 — 이 문서는 이제 **결정된 설계**다. 결정 표는 6절.
- 현재(round-6 까지): Astro 정적 사이트 + git 안 YAML(data/own) + 공공데이터 원본(data/public/raw) → 빌드 스크립트 → data/build JSON → 정적 페이지. DB·서버 없음. 데이터 변경은 변경 묶음(`pnpm data:apply`, [data-pipeline.md](data-pipeline.md)).

## 1. 목표

1. **데이터 추가 = 데이터 입력.** 새 노선·역·계획·열차 정보를 넣을 때 코드 수정이 아니라 정해진 형식의 입력(변경 묶음)을 넣으면 검증·반영·배포가 이어진다. → [data-pipeline.md](data-pipeline.md) 로 1단계 완료.
2. **찾는 과정의 자동화.** 지금까지 사람·에이전트가 한 일(관보 목록 확인 → 고시 원문 받기 → 정거장 표 읽기 → 기존 역과 대응 → 변경 묶음 작성)을 수집기(collector)가 후보를 만들고 사람이 관리 앱에서 승인하는 흐름으로 옮긴다.
3. **API.** 관리 앱이 데이터를 읽고, 승인된 변경 묶음을 반영한다. 외부 공개 API 는 두지 않는다(Q146 A).
4. **원칙 유지.** 출처·확인일 필수, 1차 출처 우선, OSM(ODbL) 분리, 비상업, 키는 환경 변수.

## 2. 단계안

| 단계 | 내용 | 진실 원천(source of truth) | 상태 |
|---|---|---|---|
| A. 파이프라인 | 변경 묶음 형식·`pnpm data:apply`·반영 기록 | git YAML | **완료(2026-10-14)** |
| B. 수집기 | 관보 목록·레일포털·TAGO·공공데이터 갱신을 주기적으로 받아 후보 변경 묶음(draft)을 만든다. 기계적 갱신은 자동 반영(Q147 B) | git YAML | 설계 |
| C. 읽기 API + DB | 모노레포 이동(Q149 A) → data/build 를 PostgreSQL(+PostGIS)에 적재, NestJS 읽기 API(비공개). 공개 사이트는 그대로 정적 | git YAML(DB 는 투영) | **완료(2026-10-14)** — apps/api·packages/db, 4절 |
| D. 쓰기 API + 관리 앱 | 변경 묶음 제출(draft) → 관리 앱에서 승인 → **DB 에 바로 반영**(Q143 B). 이때 원천을 DB 로 전환(Q142 B), YAML 은 내보내기(백업·이력·CI 빌드 입력) | **PostgreSQL** | **구현(2026-10-14)** — 4-2절 |

C 까지는 git YAML 이 원천이고, D(쓰기 API)를 여는 순간 PostgreSQL 이 원천이 된다(round-6 Q142 B). 전환 뒤에도 변경 묶음 형식·검증 규칙은 그대로이고 반영 대상만 바뀐다.

## 3. 구성 요소

### 3-1. 저장소 구조(모노레포, C 단계 착수 때 이동 — Q149 A)

```
apps/web        공개 사이트 Next.js SSR(2026-10-14, Astro 정적 사이트에서 바꿈 — 3-5절)
apps/api        NestJS: catalog(읽기), changesets(제출·승인·반영), collectors(예약 작업), auth
apps/admin      관리 앱(검수 대기열·변경 묶음 diff·승인 + 원천 레코드·역·노선·지도 위치 편집 → 변경 묶음 제출) — Next.js 16 SSR(2026-10-15 사용자 지시로 Astro 에서 교체; 토큰은 httpOnly 쿠키, 서버가 API 호출), 비공개 배포(Q144 A)
packages/schema JSON Schema(*.schema.json) — web(zod content.config)·api·pipeline 이 같은 정의를 쓴다. 생성 타입(TS)은 필요해질 때
packages/core   도메인 공용 코드(region·rail-class·map-style) — web·pipeline·api
packages/pipeline  src/ingest(수집·빌드·apply-changeset)·src/validate.ts — CLI 와 API 작업이 같은 코드를 호출
packages/db      PostgreSQL DDL(migrations/*.sql)·마이그레이션(db:migrate)·적재(db:load)
data/           지금과 같음(own·public·build·changesets·osm)
```

경로 변경은 CI·Docker·문서·import 경로를 한 번에 바꾼다.

### 3-2. DB (PostgreSQL + PostGIS)

- `packages/db/migrations/0001_init.sql`(C 단계에서 확정, 4-1절). 초안 설명: Station·Line·LineStation·Service(+정차 패턴)·Plan(+plan_refs·stage_history)·PlanProgram·Event·Source·TrainClass·TrainNumberRange·RollingStockNumberRange·TransferCenter 와 `changeset`(제출·검수·반영 기록) 테이블. 열 이름은 JSON Schema 필드와 같다.
- 좌표는 `geography(Point,4326)`. **OSM 선형은 DB 에 넣지 않는다**(ODbL 분리 — 지도는 지금처럼 정적 GeoJSON).
- C 단계: `data/build/*.json` → upsert(`pnpm db:load`). DB 는 빌드 산출물의 투영이라 언제든 다시 만들 수 있다.
- D 단계(원천 전환): 변경 묶음은 DB 트랜잭션으로 반영하고 `changeset` 테이블에 기록(무엇을·왜·누가·언제, 반영 전후 값). 이력·되돌리기는 이 테이블이 맡는다. 공개 사이트 빌드는 **DB → JSON 내보내기**(`pnpm db:export`)를 입력으로 쓰고, 내보낸 YAML·JSON 을 git 에 남겨 오프라인 재현성을 지킨다.

### 3-3. BE (NestJS, 비공개)

| 모듈 | 하는 일 |
|---|---|
| catalog | 읽기 API: `GET /stations?region=&line=`, `/lines/:id`, `/plans?stage=&program=`, `/search?q=` — 관리 앱용(외부 공개 안 함, Q146 A) |
| changesets | `POST /changesets`(draft 저장, 형식 검증 = changeset.schema.json), `GET /changesets?review=draft`, `POST /changesets/:id/approve` → 반영 |
| apply | 승인 = 바로 반영(Q143 B). C 단계(YAML 원천)에서는 작업 디렉터리에서 `data:apply` → 기본 브랜치 커밋 → CI 실패 시 자동 되돌림(revert 커밋). D 단계부터는 DB 트랜잭션 + 검증 실패 시 롤백 |
| collectors | 예약 작업(cron): 아래 3-4 |
| auth | 관리자 토큰(초기). 공개 쓰기 없음 — 이용자 제보는 GitHub 이슈 양식(Q148 C) |

API 키(공공데이터·레일포털·VWorld)는 지금처럼 환경 변수·비밀 저장소에만.

### 3-4. 수집기(자동 "찾기")

지금까지의 조사 절차를 자동화 단위로 나눈다. **사실 변경은 후보(review: draft)만 만들고 사람이 관리 앱에서 승인한다. 원본 재수집·재계산 같은 기계적 갱신은 자동 반영한다**(Q147 B).

| 수집기 | 근거 자료 | 만드는 것 | 반영 |
|---|---|---|---|
| gazette-watch | 철도산업정보센터 관보 목록(`data:fetch-gazette`) | 관보 목록 색인 갱신 / 추적 사업(gazette_keywords)의 새 기본계획·실시계획·준공 고시 → `plan` merge(stage_history) + 원문 attachment | 색인 자동 / 단계 이력 승인 |
| gazette-stations | 새 기본계획 고시 원문(PDF → 텍스트) | 정거장 표 → 공사 중 `station`·`line` 후보 + `station_coord`(geocode) | 승인 |
| kric-route / tago | 레일포털 노선정보·TAGO 지하철역 | 원본 재수집(자동) / 새 역·역명 변경·순서 차이 → `station` merge 후보 | 재수집 자동 / 사실 승인 |
| opening-watch | 철도통합연표·운영기관 공지 | 개통 → 노선·역 operating + `merge_into` 병합(data-pipeline.md 6절, Q151 B) 한 묶음 | 승인 |
| timetable | TAGO·레일포털 운행정보 | 시간표 요약 재생성(build-timetables) | 자동 |
| geocode | VWorld | 좌표 재계산(`data:geocode`) | 자동 |

후보마다 "근거 문장(원문 발췌)·원문 URL·확인일"을 rationale·provenance 에 넣어 검수자가 원문을 다시 열지 않고도 판단할 수 있게 한다.

### 3-5. FE

- 공개 사이트는 **Next.js SSR**(2026-10-14 사용자 결정: "데이터가 업데이트될 때마다 빌드해야 하는 프론트엔드가 아니다", "SPA 는 API 가 공개돼야 하므로 SSR 위주"). 요청마다 사이트 서버가 비공개 API 에서 데이터를 받아 HTML 을 만든다 — 브라우저는 API 에 닿지 않고, 읽기 API 는 그대로 비공개(Q146 A). 이전의 Astro 정적 사이트·GitHub Pages 배포는 없앴다.
  - 데이터 캐시: 사이트 서버는 전체 컬렉션을 메모리에 두고, 요청 때 API `/meta` 의 적재 시각·커밋(데이터 판)을 최대 5초에 한 번 확인해 바뀌었으면 다시 받는다 → 변경 묶음이 반영되면 다음 요청부터 새 데이터(다시 빌드 없음, worker 와의 연결 없음).
  - 정적 파일 성격의 산출물(지도 GeoJSON·역별 시간표)은 사이트 라우트(`/map/<file>`, `/timetable/<file>`)가 API `/artifacts/*` 를 그대로 내준다(sha256 ETag).
  - 실행 환경 변수: `API_URL`·`API_TOKEN`(서버에만), `VWORLD_API_KEY`(지도 타일, 페이지에 넣어 브라우저가 씀), `SITE_URL`, `PUBLIC_ISSUES_URL` — 바꿀 때 다시 빌드하지 않는다. 빌드 시 값은 `BASE_PATH` 뿐.
- 실시간성이 필요한 정보(열차 위치 등)는 범위 밖.
- 관리 앱(apps/admin): 검수 대기열, 변경 묶음 diff(개체별 전/후), 원문 발췌 보기, 승인·반려. 비공개 배포(Q144 A).
- 이용자 제보: 사이트 푸터 "오류 제보" → GitHub 이슈 양식(.github/ISSUE_TEMPLATE, 근거 URL 필수). 링크 주소는 실행 환경 변수 `PUBLIC_ISSUES_URL`(Q148 C).

### 3-6. 호스팅 (Q145 A)

운영자 서버 한 대에서 docker-compose 로 돌린다. 지금의 `web`(nginx 정적)·`dev` 에 C·D 단계에서 서비스를 더한다.

| 서비스 | 단계 | 비고 |
|---|---|---|
| db | C | postgis 이미지, 볼륨, 127.0.0.1:5433 만(외부 공개 안 함) — 구현 |
| api | C | NestJS, 127.0.0.1:5100 만 + Bearer 토큰(운영은 리버스 프록시 인증) — 구현 |
| admin | D | 정적 빌드 + api 프록시, 비공개(접근 제한) |
| collector | B | api 컨테이너의 예약 작업 또는 별도 cron 컨테이너 |

도메인 연동(Cloudflare 도메인 → 서버)은 [deployment-cloudflare.md](deployment-cloudflare.md)(2026-10-15 계획: Cloudflare Tunnel 권장, 포트 개방 없음, admin 은 Access 뒤).

공개 사이트는 SSR 서버(`web`, Next.js)라 GitHub Pages 는 쓰지 않는다. 포트 5000 은 사용자 개발 포트(dev)이자 web 의 포트다(둘 중 하나만 띄운다).

## 4. 지금 해 둔 준비(2026-10-14)

- 변경 묶음 형식·반영 도구·기록(data-pipeline.md). kind 16종(source·station·line·line_station_insert·plan·event·service·osm_line_map·station_merge·kilo_line·station_region·station_coord·plan_program·train_number_range·molit_line_no·line_override). 이번 라운드 데이터 변경은 모두 이 경로로 반영했다.
- PostgreSQL DDL(C 단계에서 `packages/db/migrations/0001_init.sql` 로 확정·적재 구현).
- 사이트 코드의 데이터 독립성: 노선 분류·시설·여객 미취급·근사 좌표·병합 대상 등 새 구분은 모두 데이터 필드(`passenger_service`, `line_role`, `kind`, `coord_basis`, `merge_into`)로 표현하고 화면은 그 필드만 읽는다.

## 4-1. C 단계 구현(2026-10-14)

- **모노레포**: `apps/web`(사이트), `apps/api`(읽기 API), `packages/core`(region·rail-class·map-style), `packages/schema`(JSON Schema), `packages/pipeline`(수집·빌드·검증·변경 묶음), `packages/db`(DDL·마이그레이션·적재). `data/` 는 루트 그대로. 루트 `pnpm` 스크립트 이름은 그대로(각 워크스페이스로 위임).
- **DB**(`packages/db/migrations/0001_init.sql`): 개체 테이블마다 조회 열 + 원 레코드 `data jsonb`. 좌표 `geography(Point,4326)`(GiST), 이름 검색 `pg_trgm`(GIN), 관계 테이블(service_line·service_stop·plan_line·plan_station·plan_program_ref), `load_meta`(적재 시각·커밋·개수), `changeset`(D 단계용, 비어 있음). `pnpm db:load` 는 한 트랜잭션에서 TRUNCATE 후 재적재(0.5초).
- **API**(`apps/api`, NestJS 12 ESM, `pg`): catalog 읽기 엔드포인트 18개(목록은 apps/api/README.md), Bearer 토큰 가드(`/health` 제외), 응답 `no-store`. 스모크 테스트 9건(`pnpm api:smoke`), CI `api` 잡이 PostGIS 서비스에 적재 후 실행.
- **docker-compose**: `db`(postgis/postgis:17-3.5)·`api` 는 profile `api`, 127.0.0.1 에만(DB 5433, API 5100). 사이트 `web`·`dev`(5000)는 그대로. dev 컨테이너는 워크스페이스별 node_modules 볼륨(호스트와 musl/glibc·root 소유 섞임 방지).
- 남은 것(D 단계 전): DB 를 자동으로 다시 채우는 시점(데이터 변경 커밋 뒤 `db:load` — 지금은 수동), 운영 서버 배포(리버스 프록시 인증).

## 4-2. D 단계(2026-10-14 구현, 사용자 지시 "data 디렉터리는 백업용으로 두고 모든 데이터는 API를 통해 DB에서")

```
변경 묶음 ─ POST /changesets(관리 토큰) ─→ changeset(draft) ─ 승인(관리 앱·CLI) ─→ job(apply)
                                                                                    │ worker
  own_record(DB, 원천) ←─ 변경 적용(한 트랜잭션) ──────────────────────────────────────┤
        │ 작업 공간으로 내보내기(data/own 형태) + data/public/raw·data/osm(파일, 읽기 전용)   │
        └→ pipeline build·validate ─ 성공 → 개체 테이블·build_artifact 재적재 → COMMIT ──┘ 실패 → ROLLBACK(failed)
                                        └→ 백업 내보내기: data/own·data/build·data/changesets/applied(파일)
사이트(apps/web) 빌드·관리 앱 ─ GET /export/*, /artifacts/* (API) ─ DB
```

- **원천**: `own_record`(data/own 의 모든 항목 = 수기 데이터, 파일·순서·키·원문 YAML 조각(주석 보존)·JSON) + `own_file`(파일 머리 주석·형태). 빌드 산출물(개체 테이블)은 원천에서 다시 만든다.
- **반영**: 승인 = 바로 반영(Q143 B). worker 가 한 트랜잭션에서 own_record 변경 → 빌드 → 검증 → 적재. 검증 실패면 전부 되돌리고 changeset 은 failed.
- **data/ 는 백업**: 반영이 끝날 때마다 DB → data/own·data/build 로 내보낸다(`pnpm db:export`). 사람이 data/own 을 직접 고치지 않는다(다음 내보내기에 덮인다). git 커밋은 운영자가.
- **원본 파일로 남는 것**: `data/public/raw`(공공데이터·고시 원문 248MB, 빌드 입력·출처 증빙)와 `data/osm`(ODbL 추출). 수집기(fetch-*)가 이 파일을 갱신하면 `job(rebuild)` 로 다시 빌드한다(기계적 갱신, Q147 B).
- **소비자**: 사이트(SSR 서버)는 요청 때 API 의 `/export/own/*` 과 `/artifacts/<경로>`(빌드 JSON·지도 GeoJSON·역별 시간표)만 읽는다. 관리 앱도 API 만.
- **권한**: 읽기 `API_TOKEN`, 쓰기(제출·승인·재빌드) `ADMIN_TOKEN`.
- **CI**: data/(백업)을 DB 로 들여온 뒤(`db:import`) 재빌드 → API → 시험 → 사이트 SSR 기동·페이지 확인. 즉 백업만으로 전체를 재현한다.

### 4-3. D 단계 구현 요약(2026-10-14)

- 원천: `own_file`·`own_record`(migration 0002) — data/own 34파일·1,750항목, 파일 ↔ kind ↔ 키 표 `packages/db/src/own.ts`(27 kind, dict 파일 3개 포함). 항목마다 원문 YAML 조각을 보관해 백업이 바이트 단위로 같다(`pnpm db:own-roundtrip`).
- 반영: `packages/db/src/changeset.ts`(원문 조각 단위 merge — 바뀐 필드만 다시 씀) + `worker.ts`(job 큐, LISTEN/NOTIFY, advisory lock, 한 트랜잭션 반영·재빌드·검증·적재, 실패 시 ROLLBACK·첨부 되돌림) + `rebuild.ts`(작업 공간 = DB 에서 내보낸 data/own + 저장소 raw·osm 링크, `RAILDEX_ROOT` 로 pipeline 실행, 빌드가 스스로 고친 own 항목은 DB 로 되돌려 넣음).
- API: `/export/own/*`, `/artifacts/*`(build/·map/·timetable/·report), `/changesets`(제출·미리 보기·승인·반려), `/rebuild`, `/jobs`. 관리 토큰 `ADMIN_TOKEN`.
- 사이트: (첫 구현은 Astro 빌드 시 API 를 읽는 정적 사이트였으나 같은 날 사용자 결정으로) **Next.js SSR** 로 바꿨다 — 3-5절.
- CLI: `pnpm data:apply`(inbox 제출+승인+대기), `pnpm cs:submit [--dry-run|--approve]`, `pnpm db:import`(백업 → DB), `pnpm db:export`(DB → 백업), `pnpm db:rebuild [--direct]`, `pnpm worker [--once]`.
- docker-compose(profile api): db · api · worker(data/ 마운트, 호스트 사용자 소유로 백업) · admin(관리 앱, 127.0.0.1:5200).
- 시험: 읽기 스모크 9건, 쓰기 흐름 5건(제출·미리 보기·승인·반영·검증 실패 되돌림). CI 는 백업 data/ → db:import → API·worker → 시험 → 사이트 빌드.
- OSM: 지도 산출물(lines.geojson, ODbL)은 build_artifact 에 파일 단위로 따로 둔다(자체 레코드와 섞지 않음).

## 5. 다음에 할 일

- B 단계 수집기: 관보 목록·레일포털·TAGO 갱신 → 변경 묶음 초안(draft) 자동 제출, 기계적 갱신은 `/rebuild`(Q147 B). worker 옆 cron 컨테이너.
- 운영 서버 배포: 리버스 프록시(TLS·접근 제한) 뒤에 admin·api, 공개 사이트는 web 컨테이너(SSR) 앞 리버스 프록시·캐시, 백업 data/ 의 git 커밋 자동화 여부.

## 6. 결정 (round-6, 2026-10-14)

| 질문 | 결정 |
|---|---|
| Q142 진실 원천 | B. 쓰기 API(D) 도입과 함께 DB 원천으로 전환 |
| Q143 승인 반영 방식 | B. 승인 = 직접 반영(기본 브랜치 커밋 또는 DB), CI 실패 시 자동 되돌림 |
| Q144 관리 화면 | A. 별도 앱 apps/admin, 비공개 배포 |
| Q145 호스팅 | A. 운영자 서버 한 대 docker-compose |
| Q146 읽기 API 공개 | A. 비공개 |
| Q147 자동 반영 범위 | B. 기계적 갱신만 자동, 사실 변경은 승인 |
| Q148 이용자 제보 | C. GitHub 이슈 양식 안내 |
| Q149 모노레포 | A. API(C 단계) 착수 때 |
