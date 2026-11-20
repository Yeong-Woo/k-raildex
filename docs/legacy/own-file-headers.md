# 기존 YAML 파일 머리 주석

> 이관 도구(`pnpm -F @k-raildex/migrate-legacy migrate:headers`)가 생성한 파일 — 고치지 않는다(FR-MIG-005, Q41 A).
> 원본: `future-rail-db` 저장소 `data/own/**/*.yaml` 의 첫 주석. 파일 13개(경로순).

## `data/own/events-manual.yaml`

```text
수기 연표 이벤트 (Phase 3, 2026-10-11). schema/event.schema.json. 자체 데이터의 opened_at/closed_at 로 표현되지 않는 사건(휴업·운행 종료·전환)만 적는다.
자동 생성 이벤트(노선·역·운행 계통 개통, 계획 단계, 철도통합연표)는 scripts/ingest/build-plans.ts 가 만든다. id 는 evt-<type>-<대상>-<날짜>.
areas 를 비우면 build 가 line_ids/station_ids/service_ids 의 권역으로 채운다.
```

## `data/own/lines-manual.yaml`

```text
수기 물리 노선 (round-2 Q52 A). schema/line.schema.json 과 같은 필드 + stations(역 순서). scripts/ingest/build.ts 가 읽어 data/build/lines.json·line-stations.json 에 합친다.
공공데이터(노선정보·표준데이터·KTX 노선별 역정보)로 만들 수 없는 고속선·준고속 간선을 여기서 정의한다. 역은 data/build/stations.json 의 id 로 가리킨다
(ID 가 바뀌면 build 가 "lines-manual.yaml 의 역 id 를 찾을 수 없음" 으로 리포트하고 그 역을 건너뛴다).

항목 형식:
  - id: line-xxx                 # Line id (line-names.yaml 을 거치지 않고 그대로 사용)
    name: { ko: 경부고속선, en: ... }
    category: high_speed | conventional
    status: operating
    owner / operator_name / length_km / opened_at / design_speed_kmh / electrification / codes / description  # 선택(Line 스키마와 동일)
    rail_class: high_speed | conventional | urban     # 선택. 없으면 build 가 category 로 판정
    is_wide_area: true/false                            # 선택
    review_status: verified | auto                      # 선택(기본 auto)
    order_confirmed: true | false                       # 역 순서 근거가 있을 때만 true (출처는 provenance.note 에)
    stations: [ { id: stn-xxx, km: 2.8, branch: ... }, ... ]   # 순서대로. km 는 근거가 있을 때만
    provenance: { sources: [...], checked_at: "YYYY-MM-DD", note: 근거 }

2026-10-11 작성. 역 목록·km 의 1차 근거는 국가철도공단 노선번호 체계(고속선 101·102·103, 준고속 201·203·204)와 코레일 KTX 노선별 역정보(정차역 순번),
보조 근거는 나무위키 각 노선 문서의 역 목록(기점거리). 1차 출처(철도거리표 고시)가 확보되면 교체한다.
KTX 정차역만 수록한 노선(경강선 원주~강릉)은 중간역이 빠져 있어 "역 수" 가 실제보다 적다 — description 에 명시.
2026-10-11 round-3 Q57: 노선정보의 "경의·중앙선"(I4108, 운행 계통 단위) 행을 물리 노선 경의선(서울~도라산)·용산선(용산~가좌)·중앙선(청량리~모량)으로 분리. 세 노선은 station_code_line_nos: [I4108] 로 표준데이터 역번호(K3xx/K1xx)를 LineStation.station_code 에 쓴다.
  stations 항목의 order_confirmed: false 는 그 역만 순서 미확정(미개통 구간 등). station status(미개통)는 data/own/stations-manual.yaml 의 Station 에.
2026-10-12 round-4 Q75 B: 노선정보 "안산·과천선"(I4103) 행을 drop 하고 과천선(line-gwacheon, 남태령~금정)·안산선(line-ansan, 금정~오이도)으로 분리(station_code_line_nos [I4103]). 수인선(line-suin)은 line-order.yaml exclude 로 안산선 공용 구간 6역을 뺐다.
```

## `data/own/overrides/tago-route-services.yaml`

```text
TAGO 지하철정보 subwayRouteId → 자체 운행 계통(Service) 매핑 (Phase 4 시간표, 2026-10-11).
scripts/ingest/build-timetables.ts 가 읽는다. subwayRouteId 는 "MTR" + 운영기관 2자 + 선코드(예: MTRS11 서울교통공사 1호선, MTRKRK4 코레일 경의·중앙선).
매칭은 route_id 가 접두사로 일치하는 항목 중 가장 긴 것. 운행 계통이 없으면 service_id 를 비우고 note 에 이유.
fallback_label: TAGO 응답에 종착역명(endSubwayStationNm)이 없는 행(코레일 3·4호선, 인천 7호선, 구리 8호선 등 다른 운영기관 구간 종착)의 방면 표시.
direction: upDownTypeCode U/D 를 어떤 방향 값으로 쓸지 (기본 U→up, D→down). 2호선 순환은 TAGO 의 U/D 가 내선·외선 중 무엇인지 미확인이라 기본값 유지.
출처: subwayRouteId·노선명 조합은 raw/src-tago-subway/stations.json (src-tago-subway).
```

## `data/own/plan-programs.yaml`

```text
상위 계획(PlanProgram): 국토종합계획 → 국가철도망 구축계획 → 도시철도망 구축계획·광역교통 시행계획. schema/plan-program.schema.json.
plan_refs[].program 이 이 id 를 참조한다(validate.ts). 노선 목록은 data/own/plans/*.yaml(Plan) 쪽에 두고, 여기에는 차수·기간·고시·철도 부문 요지만 둔다.
규칙: 고시 번호·일자는 관보 목록(src-kric-gazette)·고시문·공식 보도자료로 확인한 것만. 확인 못 한 번호는 number 를 비우고 note 에 적는다. 조사 메모: docs/research/plan-documents.md (2026-10-12).

---------------------------------------------------------------- 국토종합계획 (국토기본법, 최상위 국가공간계획)
```

## `data/own/plans/metro-gyeonggi.yaml`

```text
계획 사업 — 경기도 도시철도망 구축계획(1차 2019·2021 변경, 2차 2025) 수록 노선. schema/plan.schema.json + 편집용 필드 gazette_keywords.
2026-10-12 작성. 출처: 제2차 계획 공개용 보고서(src-gg-metro-plan-2-report: 25개 분석 노선 표 p.10·p.120, 선정표 p.153), 경기도 언론브리핑(src-gg-press-2025-12-12), 2019 보도자료(src-gg-press-2019-05-12), 관보 목록(src-kric-gazette).
1차(2019) 노선별 연장·사업비는 고시문 미열람으로 비워 둔다(review auto). 2021 변경(고시 제2021-983호)의 내용은 미확인. 기고시 노선의 구간·연장은 제2차 보고서 표 기준.
```

## `data/own/plans/metro-incheon.yaml`

```text
계획 사업 — 인천광역시 도시철도망 구축계획(1차 2018·2022 변경, 2차 2026) 수록 노선과 인천 도시철도 사업. schema/plan.schema.json + 편집용 필드 gazette_keywords.
2026-10-14 round-5 Q99 B 로 적재(변경 묶음 cs-2026-10-14-incheon-metro-plans). 노선별 사업비·사업 방식은 고시에 없어 보도 수치. 1차에만 실린 노선도 단계는 상위 계획 반영(Q128 C — "최근 계획에 없음" 배지).
```

## `data/own/plans/metro-seoul.yaml`

```text
계획 사업 — 서울특별시 도시철도망 구축계획(1차 2008·2015 변경, 2차 2020·2026 변경) 수록 노선. schema/plan.schema.json + 편집용 필드 gazette_keywords.
2026-10-12 작성. 출처: 2020 고시문(src-seoul-metro-plan-2), 2015 변경 보도자료(src-korea-kr-seoul-plan-2015), 서울시 미디어허브 연혁표(src-seoul-mediahub-2018545·2014732), 관보 목록(src-kric-gazette). 2008 노선별 연장은 나무위키 보조(review auto).
규칙: docs/design/plan-model.md. 현재 단계는 출처 있는 것만(신림선 개통 등). 그 밖은 plan_listed + 관보 목록 자동 보강.
```

## `data/own/plans/nrp3.yaml`

```text
제3차 국가철도망 구축계획(2016~2025) 수록 사업 중 다른 레코드와 연결되지 않은 것 (round-4 Q72, 2026-10-12). 원문 PDF(국토교통부 2016-06) 표에서 전사(data/public/raw/src-molit-nrp3-plan/nrp3-plan.txt).
schema/plan.schema.json. 2026-10-12(round-5) 단계 재검토: 안심~하양·문산~도라산·수색~서원주 고속화 opened, 도봉산포천선·대구산업선·백마고지~월정리 construction, 9호선 강일~미사는 강동하남남양주선(nrp4-new)에 통합·삭제(docs/research/plan-documents.md 8절). 기존 레코드에 붙은 3차 반영 내역은 nrp4-new·nrp4-review·ongoing·nrp1-2.yaml 의 plan_refs(program national_rail_3) 참조.
3차 사업 단위 전체 목록·건수(신규 36·계획중 14·기 시행 35·추가검토 20)는 docs/research/plan-documents.md 7절.
```

## `data/own/rolling-stock-numbers.yaml`

```text
차량번호(차호)·편성번호 체계 (D28 보강, 2026-10-12). schema/rolling-stock-number-range.schema.json. 열차번호 체계(train-number-ranges.yaml)와 별개 개체.
값은 나무위키 차량번호 문서군(「한국철도공사/차량번호」·「…/여섯 자리 수」·「한국철도공사/편성번호」·「서울교통공사/차량번호」·운영기관별 「…/차량번호」)에서 번호 범위·편성 번호·량수만 옮겼다(본문 복사 없음).
서울교통공사·우이신설·신림선 편성 수는 서울시 「서울지하철 현황 및 이용안내」(2025-01-31 기준)와 대조했다. 코레일 공식 차적 자료(공공데이터포털 「철도운영정보 공통기준 차량 데이터」)에는 차량번호 열이 없어 범위 대조에 쓰지 못했다(docs/review/notes.md).
number_from/number_to 는 호대 안에서 실제 쓰인 최소·최대 번호(영문 접두는 number_prefix). digits 는 숫자 자릿수. formation 은 편성번호(호기) 체계, count 는 결번·도입 예정을 뺀 확인 편성 수.
status: operating 운행 중 / planned 도입 예정(시운전 포함) / closed 전량 퇴역. review_status 는 전부 auto(1차 출처로 번호 범위를 확인한 것 없음).
생성: 수기(값 확인 후 직접 편집 가능). 사이트 "열차" 탭 "차량번호(차호)·편성번호" 절이 group 별로 묶어 보인다.
```

## `data/own/sources.yaml`

```text
출처 레지스트리. 모든 개체의 provenance.sources 는 여기 id 를 참조한다.
schema/source.schema.json 참조. retrieved_at 은 실제로 내려받은/확인한 날.
```

## `data/own/stations-manual.yaml`

```text
수기 역 (round-3 Q58, 2026-10-11). 공공데이터(표준데이터·RAFIS·KTX 역정보)에 없는 미개통·신설 역. scripts/ingest/build.ts 가 읽어 data/build/stations.json 에 합친다.
필드는 schema/station.schema.json 과 같다(id 는 파일 값 그대로 — 영문명이 있으면 영문 슬러그, 없으면 로마자). 좌표는 manual 만(없으면 생략). opened_at 은 미개통이면 개통 목표(fuzzyDate).
역을 노선에 붙이는 것은 data/own/lines-manual.yaml 의 stations, 계획과의 연결은 data/own/plans/*.yaml 의 station_ids.
```

## `data/own/train-number-ranges.yaml`

```text
열차번호 체계 (D28). schema/train-number-range.schema.json. 2026-10-11 round-4 wave2 작성.
값은 나무위키 열차번호 문서군(「한국철도공사/열차번호」 + 하위 고속열차·일반열차·광역전철·화물열차, 「서울교통공사/열차번호」, 「수도권 전철/열차번호」, 「인천교통공사/열차번호」)에서 번호대·구간만 옮겼다(본문 복사 없음).
코레일 공식 규정(열차운행 관리규정·열차번호 부여 기준)은 공개 자료를 찾지 못해(2026-10-11 검색) 보조 출처만 등록. 공식 자료가 확보되면 provenance.sources 에 추가한다.
홀짝 규칙(parity_rule)은 「열차번호」 문서의 일반 원칙(서울 기점 하행 홀수·상행 짝수)을 코레일 고속·일반열차에 적용. 광역전철·도시철도는 문서에 규칙이 없어 비움(6호선·평택선 순환은 none).
valid_from 이 2026-09-01 인 수서발 KTX 번호대는 통합 전 SRT 체계(operator sr, tnr-srt-*)와 같은 번호 공간을 쓴다. 수서발 KTX 운행 계통은 svc-ktx-suseo-*(round-4 Q69 B·Q83 B, 2026-10-12).
round-5 Q108 A(2026-10-13): 수도권 도시·광역철도 번호대를 레일포털 운행정보(src-kric-file-train-ops, 2026-06-25 기준) 실제 번호로 보정 — 신분당선 B·공항철도·수인분당 6700~6900 대·경의중앙 5300 대·3·4·5·7호선·신정지선·신림선·김포골드라인·에버라인(Y)·의정부(U)·인천 2호선. 근거는 각 항목 note, 대조 결과는 docs/research/train-numbers-check.md. 운행정보에 열차가 없는 번호대는 지우지 않고 note 에 적었다.
생성: 수기(값 확인 후 직접 편집 가능). 사이트 "열차" 탭이 group 별로 묶어 보인다.
```

## `data/own/transfer-centers.yaml`

```text
환승센터·복합환승센터 사업 (TransferCenter). 스키마 schema/transfer-center.schema.json, 규칙 docs/design/data-conventions.md 5-11.
시드: 1차 시범사업(보도), 2차 교통거점 21곳, 3차 47곳(projects-47.tsv), 4차 65곳(projects-65.tsv). 상태는 4차 본문 p.4~5 의 3차 추진현황(2026-08).
```
