# 한국철도도감 (K-Raildex) — 에이전트 규칙

대한민국 철도의 현재 정보(노선·역·운행 계통·열차·시간표)와 계획 정보(상위 계획·계획 사업·단계·근거 고시)를 **출처와 함께** 제공하는 비상업 공개 사이트의 재구축 저장소. 기존 시스템 `/home/kimyw/Git/future-rail-db`(YAML + 빌드)를 **DB 원천** 시스템(TypeScript · NestJS · PostgreSQL/PostGIS · React)으로 대체한다.

## 1. 문서가 기준이다

| 문서 | 역할 |
| --- | --- |
| `docs/01~10-*.md` | 확정 설계(개요·구조·**데이터 모델**·API·관리 앱·공개 사이트·이관·수집·비기능·로드맵) |
| `docs/11-implementation-plan.md` | 작업 패키지(WP) 단위 구현 계획과 완료 기준 |
| `docs/decisions.md` | 확정 결정 표(Q1~). 결정과 어긋나는 구현을 하지 않는다 |
| `docs/03-data-model.md` | DB 스키마의 기준. Drizzle 스키마·zod 계약·SQL 은 이 문서와 일치해야 한다 |
| `docs/review/` | 결정 질문 라운드(README.md 규칙) |
| `docs/legacy/` | 기존 시스템 문서 사본(읽기 전용 참고) |

- 설계와 다르게 구현해야 하면 **문서를 먼저 고친다**. 사용자 판단이 필요한 선택이면 멈추지 말고 `docs/review/notes.md` 에 적고 임시 가정으로 진행한 뒤 라운드가 끝날 때 `docs/review/round-NN.md` 질문으로 올린다(형식은 docs/review/README.md). 결정이 아닌 것(버그·정리·검수)은 질문하지 않고 처리한다.
- 이미 결정된 사항을 다시 묻지 않는다.

## 2. 서브 에이전트 규칙

- 한 작업(턴)에서 호출하는 서브 에이전트는 **최대 2개**. 동시 실행도 2개까지. 3개 이상 금지.
- **서브 에이전트는 다른 서브 에이전트를 호출할 수 없다.** 서브 에이전트 프롬프트에 반드시 "다른 서브 에이전트(Agent 도구)를 호출하지 말 것"을 명시한다.
- 2개로 부족하면 작업을 쪼개 순차 진행하거나 직접 한다. 파일 1~2개 읽기, 단순 검색·수정은 서브 에이전트 없이 직접 한다.
- 서브 에이전트에게 맡길 때는 대상 파일·설계 문서 절·완료 기준을 프롬프트에 적고, 결과는 직접 검토(타입 검사·시험 실행)한 뒤 받아들인다. 같은 파일을 두 서브 에이전트가 동시에 고치지 않게 나눈다.

## 3. 불변 원칙 (docs/01-overview.md 4절 C-1~C-13 요약)

1. **모든 사실에 출처와 확인일.** 확인 못 한 값은 비우고 "미확인". 추측·기억으로 값을 채우지 않는다(기대 일정도 공식·보도 근거만, Q94).
2. 출처 우선순위: 법령·고시 > 국토교통부·국가철도공단·운영기관 > 언론 > 위키(보조, 값만).
3. **물리 노선(line)과 운행 계통(service)을 구분.** "광역철도"(노선 지정) ≠ "광역전철"(운행 계통). 열차번호 ≠ 차량번호·편성번호. 열차 등급 ≠ 차량 형식.
4. 계획 사업은 항상 사업 단계와 함께. 단계 이력은 날짜·출처가 있는 것만.
5. **OSM(ODbL) 데이터는 `osm` 스키마에만.** OSM 좌표를 자체 데이터에 저장하지 않는다. 구글 지도 좌표도 저장하지 않는다(Q68).
6. 비상업(광고·유료 기능·추적 없음). 외부 사이트(미래철도DB 등) 데이터 복제 금지.
7. 식별자는 바꾸지 않는다(삭제된 id 도 재사용 금지). 예외는 decisions.md 에 기록된 것만(상위 계획 `pp-`, 환승센터 `xc-`).
8. 사실 변경의 자동 반영 금지 — 수집기·에이전트는 draft 제안만. 자동 반영은 기계적 갱신(시간표 재수집·파생 재계산)뿐.
9. 관리 앱·API·DB 는 인터넷에 노출하지 않는다(관리 앱은 Cloudflare Access 뒤).

## 4. 구현 규칙

- **DB 가 유일한 원천.** 데이터 값을 코드에 하드코딩하지 않는다(코드값 목록·라벨은 `packages/contracts` 에만).
- **모든 쓰기는 도메인 적용기**(`packages/domain` 의 변경 묶음 적용기)를 거친다 — API·worker·이관 도구 모두. 검증을 우회하는 쓰기 경로를 만들지 않는다.
- 파생 값(권역·역 상태·현재 단계·개통 목표·자동 연표·시점별 지도)은 DB 뷰로 계산하고 저장하지 않는다. 같은 규칙을 TS 로도 구현하면 교차 시험으로 일치를 보장한다.
- 개체 규격의 단일 정의는 `packages/contracts`(zod). 스키마를 바꾸면 contracts·Drizzle 스키마·SQL·03 문서를 함께 바꾼다.
- 소프트 삭제(`deleted_at`) — 모든 조회·뷰는 삭제된 행과 삭제된 부모의 하위 행을 제외한다.
- TypeScript strict, ESM. 코드 식별자는 영어, 문서·주석·UI 문구는 한국어.
- 새 철도 용어를 쓰면 용어 사전(이관 전에는 `docs/legacy/TERMINOLOGY.md`)의 표기를 따른다.

## 5. 작업 절차

- 브랜치: `main` 에 직접 커밋하지 않는다. WP 단위 `feat/<m>-<wp>-<slug>` 또는 단계 단위 `feat/m1-foundation`. 원격 푸시·병합은 사용자가 요청할 때만.
- 완료 정의(DoD): `pnpm check`(타입) · `pnpm lint` · `pnpm test` 통과, 관련 문서 갱신, 시험 추가.
- 커밋 메시지: 영어 Conventional Commits(`feat(db): …`). 끝에 `Co-Authored-By` 줄.
- 시험: 단위 = Vitest, DB 통합 = Testcontainers(PostGIS) — Docker 가 필요하다. 픽스처는 `packages/db/fixtures`.

## 6. 비밀값

- API 키(VWorld·공공데이터포털·레일포털·서울 열린데이터·법제처·Google Maps·Anthropic)·DB 비밀번호·토큰·Cloudflare 값은 **절대 커밋하지 않는다.** `.env`(gitignore)와 GitHub Secrets 만. 변수 이름은 `.env.example` 에 추가한다.

## 7. 명령

```bash
pnpm install
pnpm dev:infra          # 로컬 PostgreSQL(PostGIS, 127.0.0.1:5433) + MinIO(127.0.0.1:9000)
pnpm dev:infra:down
pnpm check              # 전체 타입 검사
pnpm lint               # ESLint
pnpm test               # Vitest(단위 + 통합)
pnpm format             # Prettier
```

## 8. 저장소 구조

```
apps/       web(공개 사이트, Next.js) · admin(관리 앱, Vite React) · api(NestJS) · worker(pg-boss)
packages/   contracts(zod·코드값) · db(Drizzle·SQL·시드·픽스처) · domain(적용기·검증·계산)
            api-client · ui · map · importers · migrate-legacy · mcp
docker/     compose 파일
docs/       설계·계획·결정·리뷰·legacy
```
