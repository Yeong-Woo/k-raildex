# 열차·시간표 모델 (Phase 4, D28)

- 작성일: 2026-10-11. round-4 wave2(2026-10-11)에서 열차번호 체계 데이터·수도권 전철 시간표 적재 규칙 확정. 스키마: `packages/schema/train-number-range.schema.json`, `packages/schema/timetable-summary.schema.json`.

## 열차(열차번호 체계) — "열차" 탭
- `data/own/train-number-ranges.yaml`(2026-10-11: 185건): 번호대(range_from~range_to) → 운영자(`operator` korail/sr/seoul_metro/gtx/other)·약호(`code_prefix`: A·K·S·SMRT·X·ICN·ULRT·EVER·UI·GMP·SL·C/E, 회송 H/D/P/J/L/M/Y/R, 전동 F/G/Q/W/E/U/Z)·묶음(`group` high_speed/intercity/wide_area/metro/freight/non_revenue)·열차 등급(`train_class_id`)·운행 계통(`service_ids`)·노선(`line_ids`)·구간(`route_text`)·홀짝 규칙(`parity_rule`)·`valid_from`.
- 출처: 나무위키 「한국철도공사/열차번호」와 하위 고속열차·일반열차·광역전철·화물열차, 「서울교통공사/열차번호」, 「수도권 전철/열차번호」, 「인천교통공사/열차번호」(보조, `src-namuwiki`). 번호대·구간 값만 옮기고 본문은 복사하지 않는다. 코레일 공식 규정(열차번호 부여 기준)은 공개 자료를 찾지 못했다(2026-10-11) — 확보되면 `provenance.sources` 에 추가하고 값을 대조한다.
- **홀짝 규칙**: 코레일 고속·일반열차는 서울 기점 하행 홀수·상행 짝수(`odd_down_even_up`, 「열차번호」 문서의 일반 원칙; 복수 노선 경유 시 주된 노선 기준). 광역전철·도시철도는 문서에 규칙이 없어 비움. 순환 계통(6호선 응암순환, ITX-마음 평택선 순환)은 `none` + note(내선·외선).
- **SRT 통합(2026-09-01)**: 통합 전 SRT 번호대(300·380·390·600·650·680·690번대)는 `operator: sr`, `tnr-srt-*`, `valid_from` 2016-12-09/2023-09-01 로 두고 note 에 종료일을 적는다. 같은 번호 공간을 통합 후 수서발 KTX(`tnr-ktx-*-suseo`, `valid_from` 2026-09-01)가 쓴다. round-4 Q69 B·Q83 B(2026-10-12): 수서발 KTX 운행 계통 `svc-ktx-suseo-gyeongbu/honam/jeolla/gyeongjeon/donghae`("KTX 경부선(수서발)" 등, 정차역은 SRT 계통 승계, `opened_at` 2026-09-01)를 신설하고 `tnr-ktx-*-suseo` 의 `service_ids` 를 그쪽으로 옮겼다(301~380 경부, 381~388 경전, 390~398 동해, 601~654 호남, 661~672 전라). 근거는 세계일보 2026-09-01(수서 17:30 발 부산행 SRT-355 → KTX-산천 347). `svc-srt-*` 는 closed 로 보존. 열차 등급은 `tc-ktx` 하나(KTX-1·산천·청룡은 차량, TERMINOLOGY 6절), `tc-srt` 는 retired.
- 운행 계통과 연결이 애매한 번호대(동해선 포항 KTX, 부전~강릉 KTX-이음, ITX-청춘, 새마을호·누리로·관광열차 등 services.yaml/train-classes.yaml 에 없는 것)는 `service_ids`/`train_class_id` 를 비우고 note 에 이유를 적는다.
- `/trains/` 탭: 묶음별 번호대 표(번호 범위·등급·운행 계통 링크·구간), 번호 검색("1234번 열차는?") → 번호대 매칭(같은 번호가 고속·일반·광역에 겹칠 수 있으므로 약호/묶음 함께 표시). 운행 계통 상세에 "열차번호대" 절.
- 개별 열차(열차번호 인스턴스)는 시간표 API(TAGO 열차정보·코레일 열차운행정보, 키 승인 후)에서 가져오며 Phase 4 후반(`packages/pipeline/src/ingest/fetch-train-timetable.ts`, 승인 대기).

## 차량번호(차호)·편성번호 체계 — "열차" 탭 2부 (D28 보강, 2026-10-12)
- 사용자 요청(2026-10-12): "'노선번호'(KTX 101호)와 '열차번호'(KTX 청룡은 16만호대)는 별개의 개념 — 둘 다 반영". 공식 용어로 옮기면 전자는 **열차번호**(운행 번호, 위 절·`train-number-ranges.yaml`), 후자는 **차량번호(차호)·편성번호**(차량 1량 단위·고정편성 단위)다. 두 통용 표현은 TERMINOLOGY.md 6절 "주의"에 병기했다.
- `data/own/rolling-stock-numbers.yaml`(2026-10-12: 61건, 전부 `review_status: auto`): 호대(`series`)·차량번호 범위(`number_prefix` + `number_from`~`number_to`, `digits`)·묶음(`group` high_speed/intercity/wide_area/metro/locomotive/coach/freight)·형식(`model`)·열차 등급(`train_class_id`)·운행 계통·노선·편성(`formation{label, from, to, count, cars, code_prefix, note}`)·번호 규칙(`number_rule`)·상태(`status`)·소유(`owner_note`). 스키마 `packages/schema/rolling-stock-number-range.schema.json`, 규칙 data-conventions.md 5-8.
- 적재 범위(운영기관별): 코레일 42(고속 100000~180000호대 8, 간선 200000~230000호대 4, 광역 311000~393000호대 + 3000·1000호대 15, 기관차 11, 객차·발전차 2, 화차 2), 서울교통공사 8(1000~8000호대), 서울시메트로9호선 1, 인천교통공사 2, 공항철도 2, 네오트랜스(D000) 1, GTX-A(A000) 1, 우이신설(UL000) 1, 신림(SL000) 1, 김포골드라인(1000) 1, 의정부(U100) 1. 용인 에버라인(Y100호대)·지방 도시철도(부산·대구·대전·광주)는 미적재(round-5 후보, notes.md).
- 출처: 번호 범위·편성 번호는 나무위키 「한국철도공사/차량번호」·「…/여섯 자리 수」·「한국철도공사/편성번호」·「서울교통공사/차량번호」·운영기관별 「…/차량번호」(2026-06~10 수정판, `src-namuwiki`, 레코드 note 에 문서명). 서울교통공사·우이신설·신림의 편성 수는 서울시 「서울지하철 현황 및 이용안내」(2025-01-31 기준, `src-seoul-traffic-subway-status`)와 전부 일치. 용어 정의는 「철도안전법」 제2조(열차 = 열차번호를 부여한 철도차량)·「철도산업발전기본법」 제3조 4호(철도차량)·「철도차량운전규칙」 제2조 6호(차량)·제1조(열차의 편성) — `src-law-*`(국가법령정보센터 DRF API 로 2026-10-12 확인).
- **1차 출처 확인 결과**: 공공데이터포털 「한국철도공사_철도운영정보_공통기준_차량 데이터」(15153836, 2,929행)에는 차량번호 열이 없고 `운행차종`이 2016년 기준 분류(인버터제어TC차·DHC 등)라 번호 범위 대조에 쓰지 못했다. 국토교통부 철도차량 등록(철도안전법 제38조의5 이력관리 → 「철도차량 이력관리 기술기준」 고시 2021-1390)은 차량번호 목록을 공개하지 않는다. 코레일 경영공시 차종별 보유현황 표는 검색으로 찾지 못했다(2026-10-12). 따라서 번호 범위는 전부 보조 출처 → `review_status: auto`, 사이트에 "검수 전" 표시.
- 번호 규칙 요약(출처 문서 기준): 코레일 6자리 = 차종(1 고속 / 2 간선·유개화차 / 3 광역 / 4~5 화차 / 6 예비 / 7 코레일 화차 / 8~9 사유 화차) + 형식 + 편성 + 호차. 고속·간선은 편성 2자리·호차 2자리(5번째 자리 5 = 동력차, 고속 51·52 = 동력차 PC1·PC2), 광역은 호차 1자리(0 = 첫 제어차, n량 편성 마지막 칸 9) + 편성 2자리. 편성번호는 고속·간선 "N호기"(내부 1C1~1C9, 2B1·2C1·2D1·2E1), 광역 "호대 3자리 + 약호(B 10량 / C 8량 / F 6량 / G 4량 / I 2량) + 2자리". 서울교통공사 4자리 = 호선·호차 위치·편성 끝 2자리(1~4호선 제어차 0·9, 5~8호선 1·0).
- `/trains/` 2부: 묶음별 표(차량번호 범위·호대·운영자·차종·열차 등급·운행 계통·노선·편성·상태·규칙·소유·출처), 행 `id = rsn-…`(`routes.stockRange`), `data-vprefix/vfrom/vto`(차량번호)·`data-fprefix/ffrom/fto`(편성번호, 접두가 같은 숫자 범위일 때만). 번호 찾기는 열차번호·차량번호·편성번호를 동시에 찾아 맞는 쪽을 전부 보여 준다(7001 → 열차번호 + 7000호대 기관차, 101 → KTX 열차번호 + KTX-산천 101호기 + 서울 1호선 101편성, 311B01 → 1호선 편성). 열차 등급 상세에 "차량번호대" 줄.
- 다음 단계: 열차번호 ↔ 차량번호(편성) 연결은 운행 실적(어느 편성이 어느 열차번호로 다니는지)이 필요해 시간표 API 로는 불가. 코레일 「편성 열차 정보」(편성번호·열차종·차량연결순서, 공공데이터포털)가 승인되면 편성 구성(호차별 차량번호) 검증에 쓴다.

## 계획 시간표
### 원천
- TAGO 지하철정보 `GetSubwaySttnAcctoSchdulList`(역·요일·상하행). `packages/pipeline/src/ingest/fetch-tago-timetable.ts`(`pnpm data:fetch-tago-timetable [--area capital|all]`)가 `Station.codes.tago_subway` 의 TAGO 역 ID 마다 dailyTypeCode 01/02/03 × upDownTypeCode U/D(numOfRows 500, 페이지네이션)를 호출한다. 우선 범위는 수도권 전철(D18, TAGO ID 788개, 2026-10-11 수집 완료). 일일 한도 10,000건은 `timetable/_calls.json` 에 날짜별 누적 호출 수를 기록해 `--max-calls`(기본 9,000)에서 멈추고, 이미 있는 파일은 건너뛰어 다음 실행에서 이어받는다. 429(초당 제한)는 4초×n 지연 재시도.
- KTX·일반열차: TAGO 열차정보·코레일 열차운행정보(키 승인 후). 서울교통공사 열차시간표 API·레일포털 역사별 운행시각표는 열차번호가 있어 2차 보강 후보.

### 저장 형식
- **raw**: `data/public/raw/src-tago-subway/timetable/<tago_id>.json.gz`(gzip, API 응답 행 그대로; 같은 행 중복 제거 후 dailyTypeCode → upDownTypeCode → 시각 → 종착역 ID 순 결정적 정렬. `empty_combos` 에 자료 없는 요일/방향 조합). 2026-10-11: 788 파일(수도권 전부), 4.9MB.
- **요약** `data/build/timetable-summaries.json`(컬렉션 `timetableSummaries`, `packages/pipeline/src/ingest/build-timetables.ts`, `pnpm data:build` 끝에 실행 — 네트워크 없음): (역, TAGO 노선코드, 요일, 방향)마다 1건.
  - `id` = `tt-<station_id 의 stn- 제거>-<route_code 소문자>-<day_type>-<direction>`.
  - `service_id` 는 `data/own/overrides/tago-route-services.yaml`(subwayRouteId 접두 → 운행 계통, 가장 긴 접두 일치)로. 매핑이 없으면 비우고 리포트.
  - `day_type`: 01 → weekday, 02 → saturday, 03 → holiday. TAGO 는 대부분 평일·공휴일(토요일 02 는 자기부상철도만 응답, 2026-10-11).
  - `direction`: U → up, D → down(매핑 파일 `direction` 으로 노선별 재정의 가능; 2호선 순환의 내선·외선 대응은 미확인이라 up/down 유지).
  - `direction_label`: 종착역명(endSubwayStationNm, 괄호 부역명 제거) 빈도순 최대 3개를 "A·B 방면"으로. 종착역명이 없는 행(코레일 3·4호선, 인천 7호선, 구리·남양주 8호선 등 다른 운영기관 구간 종착)은 매핑 파일의 `fallback_label`(예: "서울(사당·불암산) 방면")을 덧붙인다.
  - `first`/`last` 는 "HH:MM"(24시 이후는 "24:30" 처럼 24~27시), `count` 는 중복 제거 후 편수, `by_hour[24]` 는 인덱스 = 시각의 시(hour) mod 24(즉 24~27시 편수는 0~3 인덱스에 더해진다).
  - `detail_file` = `apps/web/public/timetable/<station_id>.json` 안의 `sets` 키(`<route_code>-<day_type>-<direction>`).
  - `data_as_of` = raw 의 `retrieved_at`(TAGO 응답에는 시간표 기준일이 없어 수집일로 둔다).
- **상세** `apps/web/public/timetable/<station_id>.json`(빌드 산출물, 커밋; 클라이언트가 역 시간표 페이지에서 fetch): `{ "station_id", "data_as_of", "source": "src-tago-subway" | ["src-kric-file-train-ops", "src-tago-subway"], "sets": { "<detail_key>": [{ "hhmm": "0530", "to": "종착역명", "no"?: "열차번호", "note"?: "급행" }, …] } }`. `to` 는 종착역명이 없으면 생략. 환승역은 TAGO ID 가 여럿이라 한 파일에 노선코드별 세트가 모인다. 2026-10-11: 수도권 ~690역, 약 13MB(파일당 수십 KB). 운행정보 세트(`<노선번호>-<day>-<dir>` 키, `no`·`note` 포함)는 아래 "운행정보 보강" 절.

### 시각 표기 규칙
- TAGO 원본은 `depTime`/`arrTime` 이 "HHMMSS"(앞 0 생략, 없으면 "0"). 출발 시각이 있으면 출발, 없으면(종착역 도착 행) 도착 시각을 쓴다.
- **04시 이전(00~03시)은 전날 다이아의 연장으로 보아 24~27시로 표기**한다: "003030" → `"2430"`, "012000" → `"2520"`. 요약의 `first`/`last` 는 "24:30" 식. 이렇게 하면 막차(24:xx)가 첫차(05:xx)보다 앞에 정렬되지 않는다. 초(秒)는 버린다.
- 같은 (시각, 종착역) 행이 여러 번 오면(API 가 같은 행을 반복 반환) 하나만 남긴다.

### 운행정보 보강 — 토요일 다이아·2호선 내선/외선·열차번호 (round-4 Q82·Q84, 2026-10-12)
- **원천**: 레일포털 파일데이터 「표준데이터 운행정보」(`src-kric-file-train-ops`; 전체 기관 id=900 17.9 MB·223,425행, 코레일 id=6, 서울교통공사 id=14; 키·로그인 불필요). `packages/pipeline/src/ingest/fetch-kric-train-ops.ts`(`pnpm data:fetch-kric-train-ops [--only all|korail|seoul] [--force] [--write-dup]`)가 원본 xlsx 를 `data/public/raw/_large/src-kric-file-train-ops/`(gitignore)에 받고 스트리밍으로 읽어 **노선번호별 json.gz**(`data/public/raw/src-kric-file-train-ops/all-<노선번호>.json.gz`, 38개 3.6 MB; 열차 단위 `{ no, day, kind, from, to, stops: [[역명 원문, 도착, 출발]] }`)로 정규화한다. 원본 sha256·크기·행 수·건너뛴 노선번호(김포골드라인 L41G2~59 는 셀 깨짐 1행짜리)는 같은 디렉터리 `manifest.json`. 코레일·서울교통공사 파일은 전체 기관 파일의 부분집합이라 검증 기록만 남기고 산출물은 겹쳐 두지 않는다.
- **원본 구조**(2026-10-12 확인): 코레일 파일은 1행 "※ 필수입력항목", 2행 헤더, 역마다 1행(시각은 엑셀 시간값 → HH:MM:SS 만 사용). 서울교통공사·경전철·인천·부산 등은 1행 헤더, 열차 1편이 1행이고 역·시각이 `+`(서울교통공사) 또는 `,`(인천·7호선 인천 구간)로 이어지며 항목 앞에 순번·역번호(`001-`, `D12-`, `4107-`)가 붙는다 — 정규화에서 뗀다. 역명은 운영기관 약어 원문(신판교·1종로·지하서·4이촌 …).
- **요일구분은 기관마다 다르다**: 코레일 평일/휴일(토요일 단독 다이아 없음), 서울교통공사 평일/"토요일+공휴일", 신분당선·부산·대구·광주 평일/토요일/공휴일(휴일), 신림선 "주말+공휴일", 의정부 "토+공휴일", 김포골드라인 "토요일+일요일+공휴일", 부산김해 "평일+토요일+공휴일", 광주 "명절"(미사용). 원문 → `day_type` 목록은 `data/own/overrides/kric-train-ops-routes.yaml` `day_types`(한 행이 두 요일에 적용되면 둘 다). 따라서 **사이트의 "토요일" 탭은 서울교통공사 구간에서는 공휴일과 같은 다이아**이고(요약 note 에 "토요일·공휴일 공통 다이아"), 코레일 구간에는 토요일 탭이 없다.
- **적재 규칙**(`build-timetables.ts`, `--no-train-ops` 로 끔): 노선번호 → 운행 계통은 `kric-train-ops-routes.yaml` `routes`. 한 파일에 다른 운행 계통의 열차가 섞여 있으면(코레일 경부선 I4101 에 대경선 K1700~K1803 구미~경산 열차) `splits`(약호·번호 범위 → service_id)로 나눠 따로 집계·적재한다. 역명은 `names`(수기 약어표) → 운행 계통 노선·정차 패턴의 역 이름·별칭 → RAFIS 역약어명 → 앞 글자(숫자·"지하"·"신" 제거) 접두 일치 → 전역 유일 이름 순으로 풀고, 못 푼 것은 report.md 에 남긴다. 요약·상세는 **TAGO 에 없는 (역, 운행 계통, 요일, 방향) 조합만** 만들어(토요일 세트, 2호선 공휴일·내선/외선, TAGO 가 비운 역) 같은 다이아가 두 번 보이지 않게 한다. 수도권 권역(`Service.areas` 에 capital)이 아닌 운행 계통(부산·대구·광주·대전)은 열차번호 집계만 하고 시간표는 만들지 않는다(Q85 A). 요약 `id` 는 `tt-<역>-<노선번호 소문자>-<day>-<dir>`, `route_code` 는 노선번호(S1102·I41K5), `provenance.sources` 는 `src-kric-file-train-ops`, `data_as_of` 는 파일의 데이터기준일자.
- **방향**: 운행 계통 안에서 종착역이 같으면 TAGO 요약의 방향(up/down)을 따르고, TAGO 에 그 종착역이 없으면 정차 패턴 순서(앞→뒤 = down), 그래도 없으면 unknown. **2호선 순환**(`direction_rule: loop`)은 열차의 정차 순서에서 역번호(201 시청 → 243 충정로)가 커지는 방향을 `inner`(내선순환 = 시계방향, 위키백과 "서울 지하철 2호선" 보조 출처), 작아지는 방향을 `outer` 로 둔다. 이 판정을 TAGO 와 같은 역·같은 시각으로 대조한 결과 TAGO `U` ↔ 내선 100%(10,299/10,299), `D` ↔ 외선 100% 라서 `tago-route-services.yaml` 의 MTRS12 에 `direction: { U: inner, D: outer }` 를 적었다(report.md 6절 "2호선 순환 방향 대조"). 성수지선·신정지선 열차는 역번호가 순환선 밖이라 종착역 규칙으로 up/down(또는 TAGO 투표 결과)이 붙는다. TAGO 2호선은 평일(01)만 있어 공휴일·토요일 내선/외선은 전부 운행정보에서 온다.
- **상세 행**: `{ hhmm, to, no, note? }` — `no` 는 열차번호 원문(K7501, 1501, B002), `note` 는 운행유형이 일반이 아닐 때(`급행`, `직통`). 시각은 기점은 출발, 종점은 도착, 중간역은 출발(없으면 도착). `00:00`(기점 도착·종점 출발 없음)은 버린다. 사이트의 `parseDetail` 은 `no` 를 무시하므로 화면 표시는 사이트 쪽 후속(열차번호 → `/trains/` 번호대 링크 후보).
- **열차번호 대조(Q82)**: 노선번호별 열차번호 집합을 `train-number-ranges.yaml` 과 대조해 report.md 8절에 표(일치 / 다른 계통 / 번호대 없음 + 번호대 없는 번호 압축)와 "열차가 하나도 없는 번호대"를 쓴다. 정리·제안은 docs/research/train-numbers-check.md, 번호대 파일 수정은 데이터 담당(docs/review/notes.md). 서울교통공사·경전철 파일의 열차번호에는 약호가 없고(1501, 602), 코레일 파일에는 K/S 약호가 있다.
- 2026-10-12 빌드: 운행정보 요약 1,223건(토요일 세트 포함) 추가 → 요약 4,149건, `apps/web/public/timetable/` 660역 21 MB(TAGO 13.9 MB + 토요일·2호선 세트·열차번호).

### 화면
- 역 상세의 "시간표" 절(요일·방면 탭, 첫차·막차·시간대별 편수 막대, 전체 시각 펼치기 = `apps/web/public/timetable/<station_id>.json` fetch), 운행 계통 상세의 "운행 시간·배차" 요약(그 계통 `service_id` 의 요약 집계).
- 휴업 중인 운행 계통(자기부상철도, status suspended)의 시간표는 휴업 전 다이아일 수 있으므로 상태와 함께 표시한다.

## KTX·일반열차 시간표 준비 (승인 대기)
- `packages/pipeline/src/ingest/fetch-train-timetable.ts`(`pnpm data:fetch-train-timetable [--only tago|korail] [--od dep,arr,YYYYMMDD]`). 2026-10-11 실행 결과: TAGO 열차정보(`apis.data.go.kr/1613000/TrainInfo`·`TrainInfoService` 둘 다)와 코레일 열차운행정보(`apis.data.go.kr/B551457/run/v2`, 후보 경로) 모두 returnReasonCode 12(서비스 없음) → 미승인 키로 취급, "승인 대기"로 종료. 코레일 API 오퍼레이션 경로는 포털 swagger(로그인 필요)에서 승인 후 확인.
- 승인 뒤 매핑 설계(packages/pipeline/src/ingest/README.md "KTX·일반열차 시간표 매핑" 참조): TAGO `nodeid`(NAT010000 서울 등) ↔ Station 은 `Station.codes.tago_train` 신설(역명 + 시·도 매칭 후 수기 확정), 코레일 `stn_cd` ↔ Station 은 `Station.codes.korail_stn_cd`(코드정보 API 로 표 확보). 열차번호 ↔ 열차번호대는 `train-number-ranges.yaml` 의 (operator, range) 포함 검색으로 등급·운행 계통을 붙이고, TAGO `traingradename`(차량종류)으로 교차 검증.
