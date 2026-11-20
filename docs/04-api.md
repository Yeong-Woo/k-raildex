# 04. API (NestJS)

> round-01·02 결정 반영(2026-11-20).

## 1. 원칙

| ID | 요구사항 |
| --- | --- |
| FR-API-001 | API 는 DB 의 **유일한 쓰기 관문**이다. 관리 앱·수집기·에이전트·이관 도구 모두 같은 도메인 적용기(`packages/domain/changeset`)를 거친다. |
| FR-API-002 | 요청·응답 형태는 `packages/contracts` 의 zod 스키마가 정의하고 OpenAPI 3.1 을 자동 생성한다(Q10·Q11 A). |
| FR-API-003 | 경로 영역: `/v1/public/*`(공개 사이트 SSR 서버 전용 읽기), `/v1/admin/*`(관리 앱·관리자 CLI), `/v1/agent/*`(제안 전용). |
| FR-API-004 | 외부에 공개하지 않는다(C-11, Q53 A). 127.0.0.1 바인딩. 오픈 데이터는 덤프로(09 문서). |
| FR-API-005 | 목록은 `{ items, total, limit, offset }`(limit ≤ 500). |
| FR-API-006 | 오류: `{ error: { code, message, details?: [{ path, rule, message }] } }`. 400 형식, 401/403, 404, 409 버전 충돌·중복·참조 존재, 422 도메인 검증 실패. |
| FR-API-007 | 소프트 삭제된 개체는 기본 응답에서 제외. 관리 API 는 `include_deleted=true` 로 볼 수 있다. 공개 API 는 볼 수 없다(삭제 id 요청 시 410 Gone, 리다이렉트가 있으면 301 정보). |

## 2. 모듈 구성

| 모듈 | 책임 |
| --- | --- |
| `AuthModule` | Cloudflare Access JWT 검증(관리자), API 토큰(서비스 계정) |
| `EntityModule` | 개체별 CRUD(공통 베이스 + 하위 자원) |
| `ChangesetModule` | 변경 묶음: 제안 대기열·미리 보기·승인·반려·되돌리기·여러 건 입력 |
| `ValidationModule` | 검증 실행, 품질 집계 |
| `PublicModule` | 공개 사이트용 읽기 모델, 검색, 지도(시점별), 시간표, 원문 다운로드 |
| `DocumentModule` | 원문 업로드·다운로드·텍스트 추출·쪽 이미지·그림 잘라 내기 |
| `AttachmentModule` | 첨부 CRUD |
| `ReferenceModule` | 코드값·라벨·권역·시·도·외부 시스템 |
| `JobModule` | 작업 큐(파생 갱신·백업·덤프·수집기·에이전트 실행) |
| `AgentModule` | 에이전트 제안 제출·근거 첨부·조회, 월 예산 확인 |
| `HealthModule` | `/health`, `/v1/meta` |

## 3. 인증 (Q42·Q43 → Q80 A)

| 주체 | 방식 | 권한 |
| --- | --- | --- |
| 관리자(1인) | 관리 앱은 Cloudflare Access 뒤. 브라우저 요청에 Access 가 붙이는 `Cf-Access-Jwt-Assertion` 을 API 가 매 요청 검증(팀 도메인 공개키·audience·허용 이메일 = `ADMIN_EMAIL`). 세션·비밀번호 없음 | 전부 |
| 관리자 CLI | 관리자 API 토큰(범위 `admin:write`), 서버 안에서만 사용 | 전부 |
| web | API 토큰 `public:read` | 공개 API |
| agent | API 토큰 `proposal:write` + `admin:read` | 제안 제출(draft)만 |
| system(worker) | 내부 호출, `system:write` | 기계적 갱신(시간표 교체·파생 갱신·덤프) |

- 로컬 개발: `AUTH_DEV_BYPASS=1` 일 때만 Access 검증을 건너뛰고 관리자로 본다(운영 이미지에서는 무시).
- 역할(editor·viewer) 없음.

## 4. 관리 API — 개체 CRUD

대상: `source, operator, station, line-station, line, train-class, service, plan-program, plan, event, train-number-range, rolling-stock-range, transfer-center, route-map, glossary-term, document, attachment`.

| 메서드·경로 | 내용 |
| --- | --- |
| `GET /v1/admin/{type}` | 목록. 공통 쿼리 `q`, `status`, `review_status`, `region`, `area`, `updated_since`, `include_deleted`, `sort`, `limit`, `offset` + 개체별 필터 |
| `GET /v1/admin/{type}/:id` | 상세(관계 포함) + `version` + `derived`(계산값: 역 상태·계획 현재 단계·개통 목표·권역 등) + `referenced_by` 요약 |
| `POST /v1/admin/{type}` | 생성(즉시 반영). 201 + 변경 묶음 id + Soft 경고 |
| `PATCH /v1/admin/{type}/:id` | 부분 수정. `If-Match: <version>` 필수. 관계 목록은 전체 교체 |
| `DELETE /v1/admin/{type}/:id` | 소프트 삭제(사유). 활성 참조가 있으면 409 + 참조 목록 |
| `POST /v1/admin/{type}/:id/restore` | 휴지통 복구(하위 행 함께) |
| `DELETE /v1/admin/{type}/:id?purge=true` | 영구 삭제(휴지통에 있는 것만) |
| `GET /v1/admin/{type}/:id/history` | 변경 이력 |
| `POST /v1/admin/{type}/:id/revert` | 특정 시점으로 되돌리기(미리 보기 → 적용) |
| `POST /v1/admin/{type}/validate` | 저장 없이 검증만 |
| `GET /v1/admin/trash?type=` | 휴지통 |

공통 쓰기 옵션: `rationale`, `changeset_title`, `dry_run=true`.

### 4-1. 하위 자원

| 경로 | 내용 |
| --- | --- |
| `GET/PUT /v1/admin/lines/:id/stations` | 노선별 역 목록 전체 교체(순서·지선·km·역번호·노선별 상태·개통일·이름·운영기관). 새 행은 `ls-` id 자동 부여 |
| `POST /v1/admin/lines/:id/stations:insert` | 하나 끼워 넣기 |
| `POST /v1/admin/lines/:id/stations:set-status` | 구간(from~to) 상태·개통일 일괄 변경 |
| `POST /v1/admin/lines/:id/regions:recompute` | 시·도 재계산 |
| `GET /v1/admin/stations/:id/line-stations` | 역의 노선별 역 목록 |
| `GET/PUT /v1/admin/services/:id/patterns` | 정차 패턴 전체 교체(정차역 = 노선별 역 id) |
| `GET/PUT /v1/admin/plans/:id/stages` | 단계 이력 교체 → 계산된 현재 단계 |
| `GET/PUT /v1/admin/plans/:id/milestones` | 기대 일정 교체 → 계산된 개통 목표 |
| `GET/PUT /v1/admin/plans/:id/lines` · `/stations` | 역할 포함 연결 교체 |
| `PUT /v1/admin/plans/:id/geometry` | 선형 교체 |
| `GET /v1/admin/plans/:id/preview-map?at=` | 이 계획을 반영한 시점별 지도(미리 보기) |
| `POST /v1/admin/stations/:id/merge` | 역 병합(dry_run 지원) |
| `POST /v1/admin/plans/:id/open` | 개통 처리 마법사(노선 상태·개통일·병합·단계·이벤트 한 묶음) |
| `POST /v1/admin/entities/:id/rename` | ID 변경 → id_redirect |
| `GET /v1/admin/entities/:id/references` | 참조 행 전부 |
| `GET/POST/PATCH/DELETE /v1/admin/entities/:id/attachments` | 첨부 |
| `GET /v1/admin/timetable-sets?station=` | 시간표 조회, 세트 삭제 |

### 4-2. 변경 묶음·여러 건 입력

| 경로 | 내용 |
| --- | --- |
| `GET /v1/admin/changesets?status=&origin=` · `/:id` | 목록·상세(op 전/후·근거·오류) |
| `POST /v1/admin/changesets/:id/preview` | 현재 DB 에 적용했을 때 diff·검증(롤백) |
| `POST /v1/admin/changesets/:id/approve` | 적용(전체 또는 `op_seqs` 일부). base_data_version 이후 같은 개체가 바뀌었으면 409 |
| `POST /v1/admin/changesets/:id/reject` | 반려(사유) |
| `POST /v1/admin/changesets/:id/revert` | 되돌림 묶음 생성 |
| `POST /v1/admin/bulk/parse` | 여러 건 입력: 붙여 넣은 표(TSV)·CSV + 대상 개체 → 열 대응 추정·역 이름 해석 결과 |
| `POST /v1/admin/bulk/submit` | 대응 확정 → draft 변경 묶음 생성(미리 보기 후 승인) |

기존 시스템의 변경 묶음 YAML 형식은 받지 않는다(이관 도구만 읽음, Q82).

### 4-3. 품질·참조·문서·작업

| 경로 | 내용 |
| --- | --- |
| `GET /v1/admin/quality` · `/quality/:rule` | Soft 규칙 집계·목록 |
| `POST /v1/admin/validate-all` | 전체 검증 job |
| `GET /v1/admin/reference` · `/lookup?type=&q=` | 코드값·참조 선택기 |
| `POST /v1/admin/documents` (multipart) | 업로드(sha256 중복 검사, 라이선스 구분) |
| `POST /v1/admin/documents/:id/refetch` | 출처 URL 로 원본 재다운로드(Q76) |
| `POST /v1/admin/documents/:id/pages` | 쪽 이미지 생성 |
| `POST /v1/admin/documents/:id/crop` | 쪽·영역 → 파생 문서(figure_crop) |
| `GET /v1/admin/documents/:id/download` | 서명 URL |
| `GET/POST /v1/admin/jobs` | 작업(refresh-derived, backup, export-dump, regenerate-terminology-md, importer:<name>, agent:<task>) |
| `GET/POST /v1/admin/tokens` | 서비스 토큰 |
| `GET/PUT /v1/admin/settings/agent-budget` | 월 예산(기본 30달러)·이번 달 사용액 |

## 5. 공개 API (공개 사이트 SSR 전용)

| 경로 | 화면 |
| --- | --- |
| `GET /v1/public/home` | 통계·권역별 집계·최근 변경 |
| `GET /v1/public/lines` · `/lines/:id` | 노선(역 순서는 노선별 역: 이름·역번호·상태·개통일) |
| `GET /v1/public/stations` · `/stations/:id` | 역(노선별 절, 환승 노선, 연혁, 시간표 요약, 관련 계획·환승센터, 공개 첨부) |
| `GET /v1/public/services` · `/:id` | 운행 계통 |
| `GET /v1/public/plans` · `/plans/:id` · `/plan-programs` | 계획(단계·기대 일정·역할·공개 첨부·원문 다운로드 링크) |
| `GET /v1/public/transfer-centers` · `/:id` | 환승센터 |
| `GET /v1/public/upcoming` · `/closed` · `/timeline` | 개통 예정·폐선·연표 |
| `GET /v1/public/trains` · `/train-classes` · `/numbers/search?n=` | 번호 체계 |
| `GET /v1/public/timetable/:station_id` | 역 시간표 |
| `GET /v1/public/search?q=` | 통합 검색 |
| `GET /v1/public/map/stations.geojson?at=` · `/map/lines.geojson?at=` · `/map/plans.geojson?at=` | 지도. `at` 없으면 현재, `at=<연도>` 면 시점별 지도(03 문서 6-1절), `at=future` 는 모든 예정 반영, 추가 쿼리 `stage_min`(단계 필터), `include_undated`. 응답 피처에 단계·선 모양·색 출처·선형 품질(개략 여부)·개통 예정·지연 여부 속성. OSM 선형은 ODbL 표기 |
| `GET /v1/public/map/timeline` | 연도 슬라이더용: 연도별 개통 예정 계획 수·목록 |
| `GET /v1/public/documents/:id` | 공개 가능(publishable) 원문 다운로드(Q39·Q75). 아니면 404 |
| `GET /v1/public/sources` · `/route-maps` · `/terms` | 출처·노선도·용어 |
| `GET /v1/public/feed/changes` · `/sitemap-entries` | Atom·사이트맵 |
| `GET /v1/public/redirects/:old_id` | 옛 id → 새 id(`national_rail_4` → `pp-national-rail-4`, `tc-…` → `xc-…`) |

- 응답 헤더 `X-Data-Version`, `ETag`. 지도·검색 응답은 데이터 판 단위 캐시.

## 6. 에이전트 API (후순위, 08 문서)

| 경로 | 내용 |
| --- | --- |
| `GET /v1/agent/lookup`, `/v1/agent/{type}/:id` | 읽기(내부 메모 제외) |
| `POST /v1/agent/documents` | 근거 원문 저장(URL·스냅샷·sha256), 쪽 이미지·잘라 낸 그림 |
| `POST /v1/agent/changesets` | draft 제출. 근거 없는 op 거부. 예산 초과 시 거부 |
| `GET /v1/agent/changesets/:id` | 상태·반려 사유 |
| `POST /v1/agent/usage` | 실행 비용 기록(토큰·금액) |

## 7. 쓰기 처리 순서 (도메인 적용기)

```
1. 인증(Access JWT 또는 토큰 범위)
2. 계약 검증(zod)
3. BEGIN (READ COMMITTED + SELECT … FOR UPDATE)
4. 대상 잠금·version 비교(If-Match)
5. before 스냅샷 → op 적용(행·관계·entity 레지스트리) → after 스냅샷
6. Hard 검증(영향 개체 범위) — 실패 시 ROLLBACK, 422
7. changeset(applied)·change_op·data_version 기록
8. COMMIT → NOTIFY → worker: 물리화 뷰 갱신(디바운스), 용어 변경이면 TERMINOLOGY.md 재생성 job
9. 응답: 새 상태 + version + Soft 경고
```

draft 승인 때도 같은 3~9 를 묶음 단위 한 트랜잭션으로. 단건 쓰기 p95 < 150ms.
