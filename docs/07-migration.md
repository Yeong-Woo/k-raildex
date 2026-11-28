# 07. 기존 데이터 이관

> round-01·02 결정 반영(2026-11-20). round-04(Q97~Q105) 반영(2026-11-21).

## 1. 원칙

| ID         | 요구사항                                                                                                                                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-MIG-001 | 이관 도구(`packages/migrate-legacy`)는 **반복 실행 가능**: 빈 DB → 전량 적재 → 대조 리포트. 최종 이관 전까지 여러 번 돌린다.                                                                                                                                                                                                          |
| FR-MIG-002 | 입력은 기존 저장소의 백업 파일: `data/build/*.json` + `data/own/**/*.yaml` + `apps/web/public/timetable/*.json` + `data/osm/*` + `data/public/raw/**` + `docs/TERMINOLOGY.md`. 기존 DB 는 대조용으로만.                                                                                                                               |
| FR-MIG-003 | **손실 없음 증명**: 새 DB 에서 기존 형태 JSON 을 다시 만들어(역변환 어댑터 — 대조 전용, 기존 사이트 공급에는 쓰지 않음) `data/build/*.json` 과 필드 단위 비교. 차이는 0 이거나 5절 "의도된 차이"로 설명돼야 한다.                                                                                                                     |
| FR-MIG-004 | 이관은 **단계마다 변경 묶음 하나** `cs-<날짜>-legacy-migration-<nn>-<단계>`(예 `-01-source` ~ `-11-glossary-term`, 모두 origin legacy_migration, 작성자 system "legacy-migration")로 기록한다 — 실패 진단·롤백 단위를 작게(Q97 A). 시간표·id 리다이렉트는 적용기 밖 기계적 데이터 쓰기 경로(수집 실행 `ingest.run` 단위 기록, Q98 A). |
| FR-MIG-005 | YAML 주석은 `editor_note`(비공개)로, 파일 머리 주석은 `docs/legacy/own-file-headers.md` 로(Q41 A).                                                                                                                                                                                                                                    |
| FR-MIG-006 | 기존 문서(TERMINOLOGY·SOURCES·research·design·review)는 `docs/legacy/` 로 복사(Q4 A). TERMINOLOGY.md 는 DB 로 적재 후 사본 생성(Q86 A).                                                                                                                                                                                               |

## 2. 순서

```
0. 스키마 마이그레이션 + 참조 시드(ref_area, ref_region, ref_external_system)
1. 서비스 계정: system, legacy-migration
2. source (625) + license_class 판정(유형·라이선스 문자열 규칙 → 판정 못 한 것은 unknown 목록). "이용허락범위 제한 없음"(유보 표현 없이) → `open`, "추정·준함·숨김" 등 유보 표현이 붙은 것은 unknown(Q99 A)
3. document: data/public/raw/** → 오브젝트 저장소(텍스트·manifest)
   3a. 원본 재다운로드(Q76 A): manifest·출처의 원본 URL 로 PDF·HWP·HWPX 를 받아 sha256·크기 대조 → kind original 로 저장, 텍스트는 parent 연결. 실패 목록 리포트(삭제된 게시물·JS 뷰어 관보 등)
4. operator (노선 운영기관명 23종 + 번호대 enum 에서 생성, 수동 확인 목록). SR(`op-sr`)은 `merged`·`merged_into_id = op-korail`·`ended = 2026-09-01`(Q102 — 사용자 확인, 필드 출처 = SR 누리집 공지·보도·철도통합연표, 법인 합병 1차 출처 보강 필요 메모)
5. station (1,548) — 대표 정보만 (3-2절)
6. line (103) → line_region, line_operator, external_ref, line_osm_map
7. line_station (1,738) — 정거장: id `ls-…`, 상태·개통일·코드 배분 (3-2절)
8. train_class (14) → service (97: service_line, stop_pattern, stop_pattern_stop → 정거장 해석)
9. plan_program (33, id → pp-…)
10. plan (259: plan_ref, plan_stage_event, plan_milestone, plan_line·plan_station(역할), plan_region, plan_relation, plan_geometry(80), plan_watch_keyword)
11. transfer_center (87, id → xc-…), route_map (6)
12. train_number_range (196), rolling_stock_range (61)
13. event: 수기(11) + 철도통합연표 기원만. 파생 이벤트는 뷰와 대조
14. timetable_set/entry (요약 4,249 + 상세 660역) → 정거장 해석. TAGO 세트는 수집기 구현으로 raw 에서 다시 만들고, 운행정보 보강 세트는 수집기 `kric-train-ops` 를 실행해 채운다(Q104 A)
15. glossary_term (TERMINOLOGY.md 파싱: 용어/정의/근거·출처/예/주의)
16. osm 스키마, ingest 설정
17. id_redirect: national_rail_* → pp-*, tc-(환승센터) → xc-*
18. 기존 변경 묶음 170건 → changeset(legacy_migration, body 보관, op 없음) (Q36 A)
19. 물리화 뷰 갱신 → 대조 리포트
```

## 3. 개체별 규칙

### 3-1. 공통

| 기존                   | 새                                             | 규칙                                                                                                                     |
| ---------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`                   | `id`                                           | 그대로. 예외: 상위 계획 `x_y_n` → `pp-x-y-n`, 환승센터 `tc-x` → `xc-x`(참조하는 모든 행·plan_refs.program·URL 쿼리 포함) |
| `name{}` · `aliases[]` | `name_*` · `entity_name`                       | internal 표기는 kind internal                                                                                            |
| `provenance`           | `record_source`·`checked_at`·`provenance_note` |                                                                                                                          |
| `review_status`        | verified/unverified                            | 상속값은 버림                                                                                                            |
| `codes{}`              | `external_ref`                                 | 노선 문맥 코드(tago_subway, kric_std 행 키)는 해당 정거장으로, 나머지는 역                                               |
| 퍼지 날짜              | `x_value`·`x_precision`                        | 형식 오류는 중단                                                                                                         |

### 3-2. 역 → 역 + 정거장 (Q70~Q73)

| 기존                                                           | 새                                                                                                                                                                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 역 대표 정보(이름·좌표·시·도·주소·종류·철도역 원문·merge_into) | `station`                                                                                                                                                                                                                      |
| `line-stations.json` 행 하나                                   | `line_station`(id `ls-<노선 꼬리>--<역 꼬리>`, seq·지선·km·역번호·순서 확정). 행별 `provenance.checked_at` 은 이관하지 않음 — 정거장은 노선의 확인일을 따른다(Q103 A)                                                          |
| 역 `status`                                                    | 노선이 하나뿐인 역: 그 정거장 status. 여러 노선 역(205곳): 각 정거장 status = 노선 status 와 역 status 중 덜 진행된 쪽(예: 노선 공사 중이면 공사 중, 역 폐역이면 폐역). 노선이 없는 역(71곳): `own_status`                     |
| 역 `opened_at`·`closed_at`                                     | 노선 하나: 그 정거장으로. 여러 노선(205곳): **Q95 A**: 노선 개통일과 같은 정거장(또는 유일한 운영 중 노선)에만 넣고 나머지는 비움(미확인) + 품질 목록. 공공데이터 원본의 노선별 행에서 날짜를 찾으면 그 값. 노선 없음: `own_*` |
| `transfer_group`                                               | 버림(역 = 그룹)                                                                                                                                                                                                                |
| 역 이름 ≠ 노선별 원문 이름(표준데이터·TAGO 행 이름)            | 정거장 `name_ko`(다를 때만)                                                                                                                                                                                                    |
| merge_into(56곳)                                               | 그대로 이관(Q73 A). 이후 관리 앱에서 확인된 것만 기존 역 아래로 병합                                                                                                                                                           |
| 운영기관                                                       | 노선 운영기관과 행 운영기관(표준데이터 운영기관명)이 다르면 정거장 `operator_id`                                                                                                                                               |

### 3-3. 노선·운행 계통

| 기존                                  | 새                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rail_class`(빌드값)                  | 그대로 저장                                                                                                                                                                                                                                                                                                                                                                                |
| `region[]` · `operator_name`          | `line_region` · `line_operator`(원문은 `extra.operator_name_raw`)                                                                                                                                                                                                                                                                                                                          |
| line-names.yaml `*_source`            | `record_source(field)`                                                                                                                                                                                                                                                                                                                                                                     |
| 공사 구간 노선(연장)                  | 그대로 + `parent_line_id`(Q22 A, 점진 통합)                                                                                                                                                                                                                                                                                                                                                |
| `Service.stop_patterns[].station_ids` | `stop_pattern_stop.line_station_id`: 그 운행 계통 노선들 중 그 역의 정거장(하나면 확정, 여럿이면 패턴 순서상 앞뒤 역과 같은 노선 우선, 못 풀면 리포트). 뺀 정차역은 운행 계통 `extra.dropped_stops`(`{pattern, seq, station_id, reason, candidates?}`)에 남기고 품질 목록 `X-service-dropped-stops`로 보인다 — 운행 계통 노선 목록을 보강하고 정차역을 다시 넣으면 목록에서 빠진다(Q105 A) |

### 3-4. 계획

| 기존                  | 새                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan_refs[].program` | `pp-…` 로 바꿔 `plan_ref`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `stage_history[]`     | `plan_stage_event(reached)`, 관보 자동분은 origin gazette_auto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `stage`               | 계산값과 비교, 다르면 리포트 → 사람이 `stage_override` 또는 이력 보정. 기존 `abandoned` 인데 이력에 폐기 항목이 없으면 `stage_override = abandoned` 로 임시 유지 + 품질 목록 `X-plan-abandoned-evidence`("폐기 근거 필요") — 근거(날짜·출처)를 이력에 넣으면 override 를 걷어 낸다(Q101 A). 2026-11-21 재이관: 인천 4건은 이력에 폐기 항목(날짜·출처)이 이미 있었고 같은 날짜의 plan_listed 가 뒤에 정렬돼 되살아난 것이 원인 → 현재 단계 규칙을 고쳐(같은 날짜면 폐기·휴면을 뒤로, 마이그레이션 0018) 4건 모두 계산값 abandoned, override 0건 |
| `target_open`         | `plan_milestone(stage=opened, basis=official/press — 출처 유형으로 판정, as_of = 계획의 checked_at)`. 출처는 계획 출처 중 보도·공식 자료(판정 못 하면 리포트). 자동 선택은 메모 "자동 선택(검수 필요)" + 품질 목록 `X-milestone-auto` 로 하나씩 확인(Q100 A)                                                                                                                                                                                                                                                                                   |
| `line_ids`            | `plan_line` 역할 초안: 노선 status 공사 중·계획 → `new`; 운영 중 노선 + `parent_line_id` 관계 → `extends`; 운영 중 노선 → `upgrades`. **replaces 는 자동 판정하지 않음** — 관리 앱 품질 목록 "역할 확인 필요"로                                                                                                                                                                                                                                                                                                                                |
| `station_ids`         | `plan_station` 역할 초안: 미개통 역 → `new`, 운영 중 역 → `existing`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| scope                 | 전부 `line`(역 단위 사업은 이후 관리 앱에서 지정)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `regions`·`national`  | `plan_region`·`is_national`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| plan-routes.yaml      | `plan_geometry`(schematic 은 곡선 보간 캐시 생성)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### 3-5. 그 밖

| 기존                    | 새                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 번호대 `operator` enum  | `operator_id`                                                                                                          |
| `TrainClass.retired_at` | `ended`                                                                                                                |
| `RouteMap.file`         | document(publishable, license_class kogl_4)                                                                            |
| 시간표 요약·상세        | `timetable_set`(+ `line_station_id`: TAGO 노선코드 → 운행 계통 → 노선 → 정거장) + `timetable_entry`(`"2430"` → 1470분) |
| 보정 파일               | 값은 빌드 결과에 반영됨 → 메모·출처만 해당 개체로. 수집기용 파일은 `ingest` 설정                                       |

## 4. 대조 리포트 (완료 기준)

`pnpm migrate:verify` → `docs/legacy/migration-report-<날짜>.md`.

| 항목      | 기준                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| 개체 수   | 개체별 기존 = 새(이벤트는 테이블 + 파생 뷰, 역은 역 수·노선-역 수 각각)                                              |
| 필드 대조 | 역변환 JSON vs 기존 JSON diff = 0(의도된 차이 제외). 역변환은 역 상태·개통일을 정거장에서 다시 계산해 기존 값과 비교 |
| 파생 값   | 권역·노선 분류·정차 계통·상속 검수·현재 단계·개통 목표·자동 이벤트                                                   |
| 참조      | FK 위반 0, Hard 위반 0                                                                                               |
| 파일      | sha256 일치, 원본 재다운로드 성공·실패 목록                                                                          |
| 해석 실패 | 정차 패턴·시간표의 정거장 미해석 목록, 운영기관 미매칭, license_class unknown                                        |
| 계획      | 계산 단계 ≠ 기존 stage 목록, 역할 초안 통계                                                                          |

## 5. 의도된 차이

| #   | 차이                                     | 이유                                    |
| --- | ---------------------------------------- | --------------------------------------- |
| D-1 | `LineStation.id`(`line-x--001`) → `ls-…` | 순서와 무관한 안정 id                   |
| D-2 | 역 `review_status` 원 값 없음            | 상속은 뷰                               |
| D-3 | 파생 이벤트 저장 안 함                   | 뷰가 같은 id 로 생성                    |
| D-4 | `operator_name` → 운영기관 참조          | 원문은 extra 에                         |
| D-5 | 상위 계획·환승센터 id 변경               | Q69 A, 리다이렉트                       |
| D-6 | 다중 노선 역의 개통일 배분               | Q95 A: 확실한 정거장에만, 나머지 미확인 |
| D-7 | `target_open` → 기대 일정                | Q88                                     |

## 6. 전환 (Q5·Q67 A)

1. 리허설: 이관 → 대조 0 차이까지 반복(개발 중).
2. **관리 앱 완성(M5) 시점**: 기존 시스템 데이터 **동결** → 최종 이관 → 이후 편집은 새 관리 앱에서만.
3. 기존 사이트는 동결 데이터로 계속 열어 두고 "데이터 기준일 YYYY-MM-DD" 안내를 띄운다(관리자 1인 사이트라 이용자 영향은 고려하지 않음).
4. 새 공개 사이트(P1+P2) 완성 → Tunnel 대상을 새 web 으로 → **기존 사이트를 닫는다**. 기존 저장소는 읽기 전용 보관.
