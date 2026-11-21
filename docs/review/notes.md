# 판단 메모 (라운드 질문 후보)

> 아래 두 절(M3·M8)의 질문 후보는 round-04(Q97~Q111)로 올려 답을 받았고 2026-11-21 반영을 마쳤다(결정 표 `../decisions.md` round-04). 남은 정리 항목만 다음 라운드 후보로 본다.

## M3 이관(packages/migrate-legacy) — 2026-11-20

임시 가정으로 진행한 것. 대조 리포트: `docs/legacy/migration-report-2026-11-20.md`.

- **변경 묶음 단위**: FR-MIG-004 는 묶음 하나(`cs-<날짜>-legacy-migration`)지만 단계마다 하나씩(`cs-<날짜>-legacy-migration-01-source` … `-11-glossary-term`, 모두 origin legacy_migration)으로 나눔. 실패 때 진단·롤백 단위를 작게 하려는 것. 하나로 합칠지?
- **시간표·id_redirect 쓰기 경로**: 개체가 아니라 기계적 데이터로 보고 적용기 대신 SQL 한 트랜잭션으로 씀(load.ts). 이대로 둘지?
- **시간표 시각 행**: 기존 `public/timetable/*.json` 이 기존 저장소에 없어 TAGO raw 에서 기존 규칙대로 다시 만듦. 레일포털 운행정보 보강 세트 1,323개(토요일·2호선 내외선 등)는 세트만 이관하고 시각 행은 비움(역명 해석 규칙을 다시 구현해야 함). 다음 WP 로 넘길지?
- **시간표 PK(set_id, minute, train_no)**: TAGO 행에 열차번호가 없어 같은 분·다른 종착 행 2,491개를 첫 행만 남기고 버림(182세트). PK 를 바꿀지(예: dest_name 포함), 버리는 게 맞는지?
- **퍼지 날짜 "일 00"**: 철도통합연표 이벤트 28건 `YYYY-MM-00`/`YYYY-00-00` 은 "형식 오류는 중단" 대신 정밀도 낮춤(월·연)으로 보정. 값은 바꾸지 않음.
- **license_class**: "공공누리 제1유형 추정·에 준함·표시(숨김)" 처럼 유보 표현이 붙은 것은 kogl 로 보지 않고 unknown(129건 unknown, 대부분 "이용허락범위 제한 없음" 데이터셋). "이용허락범위 제한 없음"을 open 이나 kogl_1 로 볼지?
- **기대 일정(target_open → milestone)**: 기존 target_open 에 출처가 없어 계획 출처 중 공식(notice·law·official_page·press_release) 우선, 그다음 보도(news), 같으면 published 최신을 자동 선택(69건 모두 official). press_release 를 official 로 봄. 노트에 "자동 선택(검수 필요)" 표시.
- **운영기관 20곳**: id·kind 는 이름에서 판단(`operator-map.ts`). 공사·공단 → local/national_corp, ㈜·주식회사 → private, 불분명(용인경전철·지티엑스에이운영) → other. 상태는 모두 active(SR 통합 2026-09-01 후 SR 의 상태 미확인). 기존 번호대 enum `gtx`("GTX 운영사")는 op-gtx-a-operation(지티엑스에이운영)으로, enum `other` 16건은 id 접두사(tnr-arex → 공항철도 등)로 배정.
- **운영기관 출처**: 그 운영기관을 쓰는 노선·번호대의 레코드 출처 합집합을 운영기관 출처로 둠.
- **parent_line_id**: 기존 데이터에 연장 관계가 없어 비워 둠 → 계획 노선 역할 extends 0, 운영 중 노선은 모두 upgrades 초안(165), 운영 중이 아닌 노선(폐선·휴업)도 upgrades 초안 + 리포트.
- **노선 문맥 코드**: 노선 하나뿐인 역은 그 노선별 역으로, kric_station_std 는 `@노선번호`, tago_subway 는 TAGO 노선 접두사 → 운행 계통 노선으로 풀고, 못 푼 215건(주로 molit_metro_lines 의 다중 노선 역)은 역에 note 와 함께 남김.
- **노선별 역 이름·운영기관(3-2절)**: 표준데이터·TAGO 행 이름과 역 이름이 다를 때 노선별 역 name_ko 를 채우는 규칙, 행 운영기관 → operator_id 는 원본 xlsx 해석이 필요해 이번엔 하지 않음.
- **노선별 역 확인일**: line_station 에 checked_at 열이 없어 기존 line-stations.json 의 provenance.checked_at 은 이관하지 않음(출처는 이관).
- **정차 패턴**: 정차역이 운행 계통 노선에 없으면 빼고(90건), 여러 노선이면 앞뒤 역 노선 → 앞 역 노선 → 뒤 역 노선 순으로 고르고, 못 고르면 뺌. 역의 정차 계통(service_kinds) 27건 차이가 여기서 생김 — 운행 계통 line_ids 보강이 필요.
- **계획 선형 출처 없음 21건**: 경유역 직선 개략 선형(자체 작업)이라 src-manual-curation 으로 둠.
- **용어 id**: 한글 용어를 로마자로 바꾸지 않고 `term-<절>-<순번>`. 출처는 src-manual-curation, 확인일은 파일의 "최종 갱신". 표만 있는 절(3. 사업 단계, 7. 기관)은 절 이름 항목으로 적재.
- **노선도 embed 2건**: 문서 적재(WP 3.7) 전이라 mode link 로 이관, extra 에 원래 mode·file.
- **파일 머리 주석**: Q41 A 의 `docs/legacy/own-file-headers.md` 는 이번 범위 밖이라 만들지 않음(읽기 도구 `LegacyData.headers` 에 모아 둠).
- **DB 쪽 확인 필요(packages/db, 이관 도구 밖)**:
  - `line.length_km numeric(7,2)` 가 기존 값을 자름(15건, 예 32.7001 → 32.7, 22.361 → 22.36) — 열 정밀도를 넓혀야 손실 없음.
  - `v_station_area` 가 시·도 없는 역의 권역(노선에서)에 3개 이상이면 national 을 더함 — 기존 build.ts 는 역에는 더하지 않음(2건).
  - 계산 단계 ≠ 기존 stage 4건(인천 계획 4개: 기존 abandoned, 이력에 폐기 이벤트 없음) — 이력 보정 또는 stage_override 필요.

## M8 기계적 수집기(packages/importers, WP 8.1~8.3) — 2026-11-21

임시 가정으로 진행한 것(round-04 Q98·Q104 는 권장안 A 로 가정).

- **운행정보 원본 xlsx 내려받기**: 기존 fetch-kric-train-ops.ts(레일포털 파일 id 900 xlsx → 노선번호별 json.gz)를 이식하려면 xlsx 해석기 의존성(예: exceljs)이 필요하다. 지금은 기존 저장소의 정규화 json.gz 를 `--from-raw` 로 읽는다. 의존성을 더할지, 정규화 파일을 data 저장소(원본 파일)로 계속 둘지?
- **당고개 → 불암산 수기 역명**: 기존 kric-train-ops-routes.yaml `names.I4103.당고개: stn-danggogae` 의 역 id 가 없다(역 이름이 불암산으로 바뀜). 같은 파일 맨 끝에 들여쓰기가 틀린 `당고개: stn-buramsan` 이 있다(노선번호 밖이라 쓰이지 않음). `ingest.config (kric-train-ops, routes)` 의 I4103 항목을 stn-buramsan 으로 고칠지? (고치면 4호선 불암산 정차 행이 해석된다. 지금은 TAGO 가 그 역을 덮어 세트 수에는 영향 없음)
- **미해석 역명 9종**: 원본 셀 글자 깨짐 7(“��설동” 등)·“센럴파크”(센트럴파크 오기)·“215인천가좌”(역번호 접두). 수기 names 로 넣을지(원본이 바뀌면 사라질 수 있음)?
- **방향 unknown 세트 정리**: 정차역 순서 규칙을 더해 기존 unknown 세트 100개가 없어졌다(TAGO 중복). 시간표 세트 수 4,249 → 4,153.
- **이관 도구의 수집기 참조**: `@k-raildex/importers` 를 migrate-legacy 의존성으로 더하면 pnpm-lock.yaml 이 바뀌어 지금은 상대 경로(`packages/migrate-legacy/src/importers.ts`)로 가져온다. 잠금 파일을 바꿀 수 있을 때 의존성으로 옮긴다(결정 아님 — 정리 항목).
- **예약 실행**: 08 문서 5절은 시간표 재수집 예약을 허용하지만 키가 없어 `JOB_SCHEDULES` 에 넣지 않았다. 주기(예: TAGO 월 1회, 운행정보 분기 1회)를 정할지?
- **day_note 표기**: 운행정보 세트 `day_note` = `운행정보 요일구분 "토요일+공휴일" — 토요일·공휴일 공통 다이아` 식. 공개 사이트 표시 문구로 그대로 쓸지?

## 다음 라운드(round-05) 후보 — 2026-11-21

- **접근성 목표 상향**: 06·09 문서는 WCAG 2.1 AA 기준. M6 조사(`docs/research/ui-trends.md`)는 WCAG 2.2 AA + KWCAG 2.2 를 권고 — 2.4.11 포커스 가림 금지, 2.5.7 끌기 대체 수단(연도 슬라이더 ‹ › ·화살표 키), 2.5.8 누름 대상 24px. FR-WEB-006·NFR-OPS-020 이 바뀌므로 질문으로 올린다. 임시 가정: 시안·토큰은 2.2 AA 기준으로 만들었다.
- **SR 통합 1차 출처**: Q102 로 `merged` 처리했으나 법인 합병의 1차 출처(법령·공고)가 데이터에 없다. 출처 URL 을 받을지, 관리 앱 검수 목록으로 둘지.
- **좌표 없는 역 248개**(기존과 동일): KRIC 역 정보 API 로 좌표 제안(draft)을 만드는 수집기(M8 public-stations)를 전환 전에 할지.
