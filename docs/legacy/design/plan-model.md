# 계획 정보 모델 (Phase 3)

- 작성일: 2026-10-11, 필드·파일 위치 확정 2026-10-11(round-4 wave1). 2026-10-12 상위 계획(PlanProgram)·1차/2차 국가철도망·서울/경기 도시철도망 추가(round-5 요청, docs/research/plan-documents.md). 스키마: `packages/schema/plan-program.schema.json`, `packages/schema/plan.schema.json`, `packages/schema/event.schema.json`. 사이트 탭: "계획"(D22) + `/plans/programs/` 계획 체계.

## 파일 위치

| 경로 | 내용 | 편집 |
|---|---|---|
| `data/own/plan-programs.yaml` | **상위 계획(PlanProgram) 27건**: 국토종합계획 1~5차, 국가철도망 구축계획 1~5차(5차는 안), 서울·경기 도시철도망(차수별) + 다른 시·도 도시철도망(고시 이력만), 광역교통, other. 차수·기간·고시 이력(notices)·철도 부문 요지(rail_points)·규모(figures). `plan_refs[].program` 이 이 id 를 참조(validate.ts) | 사람 |
| `data/own/plans/nrp1-2.yaml` | 제1차(2006)·제2차(2011) 국가철도망 구축계획 수록 사업 99건(원문 HWP 표에서 생성, 3·4차·기시행 레코드에 있는 38건은 그 레코드의 plan_refs 로 보강). 2026-10-12 단계 재검토로 개통·공사 중 사업은 출처와 함께 단계를 올림(docs/research/plan-documents.md 8절) | 사람(시드는 scratch 스크립트 1회) |
| `data/own/plans/metro-seoul.yaml` | 서울특별시 도시철도망 구축계획 1차(2008·2015 변경)·2차(2020·2026 변경) 노선 17건 | 사람 |
| `data/own/plans/metro-gyeonggi.yaml` | 경기도 도시철도망 구축계획 1차(2019)·2차(2025) 노선 16건(후보노선 3 포함) | 사람 |
| `data/own/plans/nrp4-new.yaml` | 제4차 국가철도망 구축계획 신규사업 44건(참고1 HWPX 표에서 시드) | 사람(시드는 `pnpm data:build-plans -- --seed-plans` 1회) |
| `data/own/plans/nrp4-review.yaml` | 제4차 추가검토사업 24건(참고2) | 사람 |
| `data/own/plans/ongoing.yaml` | 기시행 사업(국가철도공단 사업현황 수록·개통 완료 광역철도) 27건. 2026-10-12(round-4 Q72) 제3차 본문 확보로 26건의 `other/continued` 를 `national_rail_3`(원문 class·section·content·km·사업비)로 교체, 사업현황 표기는 description 끝에. 3차에 없는 태화강~북울산만 `other/continued` | 사람 |
| `data/own/plans/nrp3.yaml` | 제3차 국가철도망 구축계획(2016~2025) 수록 사업 중 다른 레코드와 연결되지 않은 12건(도봉산포천선·서울 9호선 강일~미사·동탄세교선·경부선 사상~범일·금강산선·위례신사선 연장·수색~서원주 고속화·경원선 백마고지~군사분계선·경의선 문산~도라산·경전선 보성~목포 전철화·대구산업선·대구1호선 안심~하양). 본문 PDF 표 전사(docs/research/plan-documents.md 7절), 전부 plan_listed·auto | 사람(시드는 scratch 스크립트 1회) |
| `data/own/events-manual.yaml` | 자체 데이터 필드로 표현되지 않는 사건(휴업·운행 종료·전환) | 사람 |
| `data/public/raw/src-kr-nrp4-*/`, `src-kric-chronology/`, `src-kric-gazette/` | HWPX 원본, 철도통합연표 목록, 관보 고시·공고 목록 | `pnpm data:fetch-plans`, `data:fetch-chronology`, `data:fetch-gazette` |
| `data/build/plans.json`, `data/build/events.json` | 사이트가 읽는 결과(`pnpm data:build` 끝에 `packages/pipeline/src/ingest/build-plans.ts` 실행) | 자동 |

## PlanProgram(상위 계획)
- `id` = `plan_refs[].program` 값. 규칙: `territorial_N`(국토종합계획), `national_rail_N`(제N차 국가철도망), `metro_<시도>_N`(도시철도망, 차수별 레코드; 변경 고시는 같은 레코드의 `notices[kind=amendment]`), `wide_area_transport`, `other`. 사이트의 차수 탭 순서·라벨(`short`)은 전부 이 파일에서 나온다(`apps/web/src/lib/data.ts` programOrder/programLabel/programShort). 코드에 차수 목록을 두지 않는다.
- `kind`·`round`·`region`·`period`·`issuer`·`legal_basis`·`status`(current/superseded/draft)·`parent`(국가철도망→국토종합계획). `notices[]`는 확정·변경·정정·제출 이력(번호를 못 찾으면 `number` 를 비우고 note). `rail_points[]`는 철도 부문 요지(원문 표현을 짧게), `figures[]`는 문서가 밝힌 규모. 노선 목록이 없는 계획(국토종합계획)은 이 레코드만 둔다.

## Plan(계획 사업)
- 하나의 사업 = 상위 계획의 한 행(노선명·사업구간). 같은 사업이 여러 계획·차수에 걸쳐 실리면 `plan_refs[]`에 계획별로 기록한다(program = PlanProgram id, class new/review/continued). 한 계획 안에서 판이 다르면(2015 변경·2026-02 변경) `edition`, 계획 문서의 시기 구분(전반기 착수·기 시행중·후보노선)은 `timing` 으로 원문 그대로 둔다. 도시철도망의 후보노선·조건부 노선은 `class: review`. 제3차 국가철도망(2026-10-12 본문 확보)은 문서 구분을 `timing` 에 원문대로 둔다 — `신규추진 사업`(class new), `계획중 사업`(2차 기포함·기본계획중, class continued), `기 시행사업`(class continued), `추가검토 사업`(class review); `task_group` 은 참고 표의 ①~⑥. 종전 나무위키 보조 3차 연결 45건은 전부 원문 값으로 교체했고 원문에 없던 2건(전라선 익산~여수, 충청권 광역철도 3단계)은 삭제. 3차 본문에 없는 기시행 사업만 `other/continued`.
- **개통 목표(round-4 Q78 B, Q73 C)**: 미개통 역·노선의 개통 목표는 사이트가 연결된 미개통 계획의 `target_open`(가장 이른 것)을 우선 읽고, 없으면 Station/Line 의 `opened_at`(`apps/web/src/lib/data.ts` `unopenedTargetDate()`). 착공일(`stage_history` construction 날짜)·개통 목표는 뉴스 보도(`src-news-*`, 보도일·URL)로 채우고 종전 사업현황 근거는 note 에 남긴다(2026-10-12: 수도권·고속 14건 — 착공일 10건, 개통 목표 14건).
- 1차·2차 국가철도망 레코드(nrp1-2.yaml)와 다른 차수 레코드의 연결 기준: 노선명+구간이 같거나 후속 차수 구간을 포함·대체(docs/research/plan-documents.md 1절). 새로 만든 102건은 stage plan_listed·review auto — 완공 여부는 `line_ids` 노선의 개통일 참조(round-5 질문: 자동 도출 여부).
- **관련 계획 `related_plans[]`**(2026-10-15, 사용자 요청 "같은 노선인데 추후 다른 노선명으로 개발이 변경되는 건은 해당 계획과 링크"): `{plan_id, relation, note, source}`. relation 은 `succeeded_by`(이 사업을 대신해 다른 이름·구간으로 추진된 후속 사업), `part_of`(이 사업 구간이 후속 사업 구간에 포함), `same_corridor`(같은 축의 다른 구간·대안 노선), `related`. 연결은 한쪽(보통 먼저 실린 쪽)에만 적고 상세 페이지가 역방향("선행 사업")을 함께 보여 준다. `note` 에 연결 근거를 적는다 — 원문에 경유지가 없어 구간 비교로 연결했으면 "(구간 비교)"라고 밝히고, 보도로만 아는 경유지는 "(미확인)". `source` 는 후속 사업이 실린 계획 문서. 검증은 plan_id·source 존재와 자기 참조 금지(validate.ts). 1·2차 국가철도망 휴면 사업 39건의 정리는 docs/research/plan-documents.md 10절.
- **id**: `plan-<노선명 로마자 슬러그>-<사업구간 로마자 슬러그>`(시드가 결정적으로 생성, 중복이면 `-2`). 기시행 사업은 `plan-<영문 슬러그>`(수기). 한 번 부여한 id 는 바꾸지 않는다.
- `stage`는 현재 단계(TERMINOLOGY 3절 12단계 + abandoned; 2026-10-12 `strategic_eia` 전략환경영향평가(기본계획 전)·`eia` 환경영향평가(실시계획 전) 추가), `stage_history[]`는 날짜·출처가 있는 단계 변경 이력. **출처 없는 단계는 적지 않는다.** 최소 이력은 `plan_listed`(계획 고시일 2021-07-05, 출처 src-molit-nrp4-notice). 착공일을 모르면 `date: {precision: unknown}` + 출처(국가철도공단 사업현황 "공사 중" 표)로 둔다. build 는 이력의 최신 단계가 `stage` 보다 높으면 `stage` 를 올리고 리포트한다.
- **관보 자동 보강**: yaml 의 편집용 필드 `gazette_keywords[]`(스키마 밖, build 가 제거)에 고시 제목 키워드를 적으면 build-plans 가 관보 목록(src-kric-gazette)에서 `기본계획` → basic_plan, `실시계획 승인`·`사업계획 승인`(변경·정정·준공·취소·재고시 제외) → detail_design, 관보 공고 `전략환경영향평가서(초안) 공람` → strategic_eia, `환경영향평가서(초안) 공람` → eia 이력을 날짜순 최초 1건씩 추가(관보 색인에 환경영향평가 공고가 적어 EIASS 연동은 round-5 Q124)한다(source src-kric-gazette, note 에 고시 제목). 착공·개통·예타는 고시가 아니므로 yaml 에 직접(보도·연표·나무위키 출처).
- 개통되면 `opened_at`과 `line_ids`(생긴/개량된 물리 노선)를 채우고 stage=opened. 부분 개통은 stage 를 올리지 않고 description·연표(Event)로 둔다. 미개통 구간·역은 Line/Station의 status planned/under_construction 으로 두고 `station_ids` 로 연결(round-3 Q58, 예: 호남고속철도 2단계 ↔ stn-muan-airport).
- `regions`는 사업구간의 시·도(시드에는 비어 있어 사람이 채움, 2026-10-11 68건 전부 채움). `areas`는 regions 에서 도출, 고속철도(plan_refs.category high_speed) 또는 편집용 필드 `national: true` 면 `national` 추가.
- `review_status`: 우선 범위(D18 수도권·고속)에서 관보 목록·사업현황·보도로 조사한 사업은 verified(2026-10-11 기준 51건이 plan_listed 외 이력 또는 verified), 나머지 auto.

## Event(연표)
- 개통·폐지·휴업·역명 변경·환승 개시·운행 계통 개시/종료·단계 변경·계획 반영·기타. 모든 개체(노선·역·운행 계통·계획)에 연결 가능. 날짜는 fuzzyDate.
- **생성 규칙(build-plans.ts, 결정적 id `evt-<type>-<대상 id 접두사 제거>-<날짜>`, 충돌 시 `-2`)**:
  1. Line.opened_at(오늘 이전) → opened, Line.closed_at → closed
  2. Station.opened_at(status operating) → opened, Station.closed_at(closed) → closed
  3. Service.opened_at → service_started
  4. Plan.stage_history 각 항목 → plan_listed / opened / stage_changed
  5. `events-manual.yaml` 그대로(areas 비우면 대상의 권역으로)
  6. 철도통합연표(raw) 2000년 이후 행 중 관련노선·관련역·요약의 운행 계통명·계획명으로 매칭되고 우선 범위(권역 capital 또는 고속)인 것(2026-10-11: 1,246행 중 매칭 715, 이벤트 454, 범위 밖 보류 261, 실패 531). 요약 한 줄을 title 로, 유형은 키워드 규칙(개통/폐지/휴업/역명/환승/고시·착공 → stage_changed, 그 밖 other).
- 출처: 자동 생성 이벤트는 해당 레코드의 provenance 를 따르며 Event.provenance 에는 src-manual-curation(노선·역·운행 계통)·해당 단계의 source(계획)·src-kric-chronology(연표)를 적는다.

## 사이트
- `/plans/` 목록: 계획 탭(plan-programs.yaml 순서: 국가철도망 1차→4차, 서울 1차·2차, 경기 1차·2차, 기타; 기본 4차), 구분(신규/추가검토/기시행), 권역 필터(D20, 기본 수도권), 단계 필터. 행: 노선명, 구분(+edition·timing), 구간, 사업내용, 연장, 사업비, 현재 단계, 개통 목표/개통일. **탭 숫자 규칙(round-5)**: 계획 탭 숫자 = 현재 권역·필터 안의 행 수, 권역 탭 숫자 = 현재 계획 탭·필터 안의 행 수(서버 초기값은 기본 권역×기본 계획 기준, JS 는 `apps/web/src/scripts/tab-counts.ts` 가 같은 규칙으로 다시 셈). 각 계획 구역 머리에 고시 번호·기간·`/plans/programs/#<id>` 링크.
- `/plans/programs/` 계획 체계: PlanProgram 을 종류별(국토종합계획 → 국가철도망 → 도시철도망 → 광역교통 → 기타)로 늘어놓고 기간·고시 이력·철도 부문 요지·규모·실린 사업 수.
- `/plans/[id]/`: 기본 정보, 차수별 반영 내역, **단계 타임라인**(stage_history + 관련 Event), 관련 노선·역 링크, 지도에서 보기(공사중 선형이 OSM 에 있으면 `#plan=`), 출처.
- `/timeline/`(Phase 5): 연도별 Event.
