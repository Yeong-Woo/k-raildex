# 데이터 규칙 (Phase 0-3)

- 작성일: 2026-10-11
- 스키마 원본: `packages/schema/*.schema.json` (JSON Schema 2020-12). Astro 쪽 zod 스키마(`apps/web/src/content.config.ts`)는 이 파일과 일치해야 한다.

## 1. 파일 배치

| 경로                           | 내용                                                                        | 편집 주체            | 커밋            |
| ------------------------------ | --------------------------------------------------------------------------- | -------------------- | --------------- |
| `data/own/*.yaml`              | 수기 큐레이션(열차 등급, 운행 계통, 수기 물리 노선 lines-manual, 노선도 메타, 출처 레지스트리) | 사람                 | O               |
| `data/own/overrides/*.yaml`    | 자동 생성 결과에 대한 수기 보정(좌표, 역·노선 영문명, 병합 지시, 역 순서, OSM 매핑) | 사람                 | O               |
| `data/public/raw/geocode/`     | VWorld 지오코더 결과(주소→좌표, 키 없음)                                    | `pnpm data:geocode`  | O               |
| `data/public/raw/<source_id>/` | 공공데이터 원본 파일 그대로(인코딩 변환 없음)                               | `pnpm data:download` | O (수 MB 이하)  |
| `data/own/geometry/plan-routes.yaml` | 계획 노선 **개략 선형**(round-4 Q80 A): 계획 자료의 주요 경유역(자체 역 id)을 직선으로 잇는 표. `kind: traced` + `coordinates`([lng, lat] 목록, 2026-10-14 — 변경 묶음으로 넣을 수 있는 유일한 형태) 또는 `file`(QGIS GeoJSON, 저장소 파일이라 D 단계 worker 에는 가지 않음)로 그린 선형을 넣을 수 있다. 좌표는 자체 데이터만(OSM 좌표 금지; 공식 위치도 이미지를 역 좌표로 지오레퍼런싱해 딴 좌표는 허용, 출처·오차를 note 에). build-map 이 `apps/web/public/map/plans.geojson` 으로 만든다 | 사람 | O |
| `data/public/raw/<source_id>/*.txt` | **상위 계획 원문(HWP·PDF)은 바이너리 대신 추출 텍스트만** 둔다(HWP 는 `packages/pipeline/src/ingest/hwp2txt.py`, PDF 는 `pdftotext -layout`). 원본 크기·sha256·URL 은 `manifest.json` | 수동(1회) | O |
| `data/build/*.json`            | 정규화·병합된 최종 데이터. 사이트가 읽는 파일                               | `pnpm data:build`    | O (빌드 재현용) |
| `packages/schema/`                      | JSON Schema                                                                 | 사람                 | O               |

사이트는 `data/own/*.yaml` + `data/build/*.json`만 읽는다. raw는 읽지 않는다.

## 2. 식별자

- 형식: `<접두사>-<슬러그>`. 소문자·숫자·하이픈. 슬러그는 영문 로마자(국어의 로마자 표기법) 또는 공식 영문명 기반.
  - 역 `stn-`, 노선 `line-`, 운행 계통 `svc-`, 운영기관 `op-`, 열차 등급 `tc-`, 출처 `src-`, 노선도 `map-`
  - 예: `stn-seoul`, `stn-seoul-station`? → **역명 "서울역"은 `stn-seoul`**. "역" 접미사는 넣지 않는다. 동명이역은 지역 접미사(`stn-sinchon-seodaemun`, `stn-sinchon-gyeongui`).
- **역 ID** (round-1 Q22): 공식 영문 역명이 있으면 그 슬러그(`stn-pangyo`). 영문명이 없으면 로마자 변환 대신 **공식 역번호**를 쓴다: `stn-<역번호 소문자>`, 역번호는 국토교통부 TAGO 지하철정보의 `subwayStationId` 끝부분(K409, D011, 150 …) → 표준데이터 역번호 순, 복수면 노선번호 정렬상 첫 번째(운정중앙 `stn-101`, 킨텍스 `stn-102`). 역번호도 없으면 그때만 로마자(2026-10-11 기준 가남·감곡장호원·앙성온천 3건). 노선별 공식 역번호(판교: 경강선 K409, 신분당선 D011)는 Station이 아니라 **LineStation.station_code**에 둔다(TAGO 값 우선, 없으면 표준데이터 역번호; 앞의 0 제거). 한 역이 여러 노선에 속하면 역번호가 여러 개이므로 Station.codes 값은 배열을 허용한다.
- **노선 ID**: `overrides/line-names.yaml`의 `slug`(없으면 공식 영문명 `en`의 슬러그)가 ID다. 둘 다 없으면 "N호선"은 `<지역>-N`(번호 기반), 그 밖에는 `line-<노선번호 소문자>`로 두고 리포트에 남긴다. **로마자 변환 ID는 쓰지 않는다.** 영문명 `en`은 운영기관 영문 표기를 확인한 것만 넣고 note에 출처 URL을 적는다.
- ID 변경 이력: round-1 반영(2026-10-11)으로 노선 11건(`line-ebeorain`→`line-everline`, `line-incheongukjegonghang`→`line-arex`, `line-gyeonguijungang`→`line-gyeongui-jungang`, `line-ansangwacheon`→`line-ansan-gwacheon`, `line-sinbundang`→`line-shinbundang`, `line-uijeongbu`→`line-u-line`, `line-uisinseol`→`line-ui-sinseol`, `line-gimpo`→`line-gimpo-goldline`, `line-busangimhae`→`line-busan-gimhae-lrt`, `line-jagibusang`→`line-incheon-airport-maglev`, `line-ktx-gangreung`→`line-ktx-gangneung`)과 역 병합·신규(서울(공항)·공덕(공항)·홍대입구(공항) 병합, `stn-kintekseu`→`stn-102`, `stn-unjeongjungang`→`stn-101`, `stn-yeosuexpo`→`stn-yeosu-expo`, `stn-dongtan-2`→`stn-dongtan`, `stn-singil-oncheon`→`stn-neunggil`, `stn-isu`→`stn-chongshin-univ`, `stn-namtaeryeong-2`→`stn-namtaeryeong`)이 바뀌었다. 공개 전이므로 리다이렉트는 두지 않는다. 자세한 목록은 그 빌드의 `data/build/report.md` 2절.
- round-2 반영(2026-10-11): 역 `stn-101`→`stn-unjeongjungang`(운정중앙), `stn-102`→`stn-kintex`(킨텍스) — 나무위키 영문명으로 교체(Q42). 가남·감곡장호원·앙성온천은 영문명(Ganam·GamgokJanghowon·Angseongoncheon)이 로마자 슬러그와 같아 ID 유지. 노선 `line-ktx-gyeongbu`·`line-ktx-honam`·`line-ktx-jeolla`·`line-ktx-gyeongjeon`·`line-ktx-gangneung`·`line-ktx-jungang`·`line-ktx-jungbunaeryuk` 7개 삭제(운행 계통 `svc-ktx-*`로 이동), 물리 노선 `line-gyeongbu-hsr`·`line-honam-hsr`·`line-suseo-pyeongtaek-hsr`·`line-jungang`·`line-gyeonggang-gangneung`·`line-jungbunaeryuk` 6개 신설(Q52 A).
- 한 번 부여한 ID는 바꾸지 않는다. 이름이 바뀌면 `aliases`에 옛 이름을 넣는다.
- 외부 코드는 `codes{}`에 보관한다. 키는 `data/own/sources.yaml`의 `dataset_key`(TAGO는 `tago_subway`). 값은 문자열, 복수면 배열.

## 3. 역 병합 규칙 (ingest)

전국도시철도역사정보 표준데이터는 노선마다 역이 중복(환승역은 노선 수만큼 행). 병합 기준:

1. 같은 `역사명`(공백·"역" 접미사 제거 후) AND 좌표 거리 ≤ 700m → 같은 역(`transfer_group` 동일, 하나의 Station).
2. 이름이 같아도 거리 > 700m → 별개 역(동명이역). 슬러그에 지역 접미사.
3. 일반철도(RAFIS)와 도시철도 역이 같은 이름이고 좌표가 있으면 1과 같은 기준, 좌표가 없으면 `overrides/station-merges.yaml`의 지시를 따른다. 지시가 없으면 병합하지 않고 리포트에 남긴다.
4. 병합 결과의 대표 좌표는 official > manual > osm > derived 순으로 고른다.
5. **규칙 3b (round-1 Q20에서 채택)**: 좌표가 없는 RAFIS(일반철도) 역이 표준데이터의 같은 이름 클러스터 **하나와만** 대응하고, 그 클러스터에 국가철도 운영기관 행이 있으면 같은 역으로 병합한다. 판정은 표준데이터 `운영기관명` 문자열(정규화 키) 기준 `NATIONAL_RAIL_OPS = [한국철도공사, 공항철도, 네오트랜스(=경기도 신분당선)]` — 운영기관 개체는 없다(Q24). 병합 건은 report.md에 전부 열거하고 지도 탭(Phase 2)에서 육안 검증한다.
6. 같은 노선의 같은 역번호가 두 행이면(표준데이터 중복 행: 총신대입구(이수)/이수, 광운대·중랑·상봉, 주안) 같은 역이다.
7. 수기 병합(`overrides/station-merges.yaml`)은 근거(고시·데이터 간 코드 일치·운영자 지시)를 note에 적는다. 동명이지만 근거가 없는 쌍은 병합하지 않고 리포트에 둔다.

## 4. 이름·영문

- `name.ko`는 "역" 접미사 없이(round-1 Q23 A: 항상 제거, 원문은 `aliases`). 괄호 부역명도 떼고 원문은 `aliases`에.
- `name.en`은 기관 공개 영문명 그대로. 없으면 비워 두고 Phase 5에서 채운다(명칭관리지침 준용). 추정 로마자는 넣지 않는다.
- `name.hanja`는 괄호 부역명·끝 "驛"·공백을 뗀 한자만("龍 山 驛"→"龍山"). 한자가 없는 값("서울(공항)", "한자가없음(…)")은 비운다.
- 국토부·TAGO의 역명에서 한글 사이의 ASCII 점("경성대.부경대")은 가운뎃점(·)으로 정규화한다("4.19민주묘지", "Univ."는 유지).
- 노선 영문명은 공식 데이터가 없으므로 `overrides/line-names.yaml`에서 수기 지정(확인한 것만). 미지정이면 비움.
- **노선 한국어 이름 수기 지정(2026-10-15 사용자 지시)**: 노선정보 원문 노선명이 틀리거나 통칭과 다르면("수도권 광역철도 1호선" → 서울 지하철 1호선, "수도권 전철 8호선" → 별내선, "의정부" → 의정부 경전철) `line-names.yaml` 의 `ko`(+`ko_source`)로 정한다. 원문 이름은 빌드가 `aliases` 에 남긴다. 표기 기준은 docs/TERMINOLOGY.md 1절(서울 지하철 N호선, 부산·대구·인천·광주·대전 도시철도 N호선, 김포골드라인, 용인 에버라인).

## 5. 날짜

- 확정 날짜: `{ value: "2025-06-28", precision: "day" }`
- 월·반기·연: `{ value: "2027-03", precision: "month" }`, `{ value: "2028-H1", precision: "half" }`, `{ value: "2030", precision: "year" }`
- 미정: `{ precision: "unknown" }`
- 모든 개체의 `provenance.checked_at`은 그 레코드를 마지막으로 출처와 대조한 날.

## 5-1. 역 순서 확정 여부
- `LineStation.order_confirmed`: 정거장구성·순번·KP 등 근거가 있으면 true. 근거 없이 노선에 붙인 역은 false 로 두고 노선 끝에 둔다(이전의 `branch: "순서미확인"` 문자열은 쓰지 않는다).

## 5-2. 운영기관
- 운영기관 개체는 두지 않는다(round-1 Q24). 데이터셋의 운영기관명은 `Line.operator_name` 문자열로만 보관한다(노선정보 원문, 복수면 " / "). Station·Service에는 운영기관 필드가 없다.

## 5-3. 철도역 정보(국가철도공단, 215역) 필드
- `Station.grade`(역등급 원문 "0"~"3"), `related_line_names`(관련노선 원문 목록, 예 "경부선(고속)" — Q18 물리 노선을 붙일 때 그대로 사용), `history`(역연혁 원문, 항목마다 한 줄), `intro`(역소개 원문). 모두 선택. 좌표가 0,0인 행도 텍스트는 사용한다.

## 5-4. 날짜 출처
- RAFIS `역신설일자`는 등록일이라 `opened_at`에 쓰지 않는다. `역폐지일자`가 있으면 `status: closed` + `closed_at`(day).
- 노선 `opened_at`: 노선정보 개통일자 셀이 단일 날짜면 그대로, 구간별 복수 날짜면 가장 이른 날(최초 개통)을 쓰고 note에 원문. 2자리 연도 단일값은 생략.

## 5-5. 법적 분류(rail_class)·광역철도 지정(is_wide_area)·운행 계통 종류(Service.kind)·검수 상태(review_status) — round-2 (정정 2026-10-11)
노선(물리·법적 속성)과 운행 계통(열차가 어떻게 다니는가)을 끝까지 구분한다. "광역철도"는 법적 지정(노선 속성), "광역전철"은 운행 계통 종류다. 예: 경의선·용산선·중앙선은 일반철도이면서 광역철도 지정 구간이고, 그 위를 달리는 "수도권 전철 경의·중앙선"은 광역전철 운행 계통이다.
- `Line.rail_class`(법적 분류, 빌드가 채움): `high_speed`(고속철도: 고속선) / `conventional`(일반철도: 코레일 간선·지선, 공항철도·신분당선·GTX 같은 국가철도 민자 포함) / `urban`(도시철도: 도시철도법에 따른 지방공사·경전철 민자 노선). 판정: category high_speed→high_speed; 운영기관이 국가철도 운영기관(한국철도공사·공항철도·네오트랜스·SR·GTX 운영사)→conventional; 그 밖의 category metro/light_rail/tram/monorail/maglev→urban. 애매하면 `overrides/line-names.yaml`(또는 `lines-manual.yaml`)의 `rail_class`로 지정. `metro` 값은 폐기.
- **법적 분류 수기 정정(round-8, 2026-10-14)**: 운영기관으로 정한 분류가 사업용철도 노선번호 고시와 다르면 고시를 따른다 — `line-names.yaml` 의 `rail_class` + `rail_class_source`(변경 묶음 kind `line_override`). 예: 진접선(사업용철도노선 324, 제2021-997호) → conventional(운행 계통은 수도권 전철 4호선, 광역전철). 시흥연결선 10101·평택고속연결선 10301·화성고속연결선 10108 은 고속철도노선의 지선이라 high_speed. 고시상 두 노선을 한 물리 노선으로 두는 경우는 `codes.molit_line_no` 에 번호를 쉼표로 잇는다(동해선 206·311, Q158).
- `Line.is_wide_area`(광역철도 지정): 국가철도공단 "도시광역철도 노선정보"에 있는 코레일·국가철도 민자 노선(경부선·경인선·경원선·경의중앙선·경춘선·안산과천선·분당선·수인선·일산선·경강선·서해선·장항선·동해선·대경선·공항철도·신분당선, GTX-A)은 true, 출처를 provenance에. 확실치 않으면(서울교통공사 1·3·4호선의 I 접두 행, 진접선·별내선) 비우고 리포트.
- `Service.kind`(운행 계통 종류): `wide_area`(광역전철: 코레일 광역·공항철도·신분당선·GTX 등 국가철도 위 전동열차 계통 — 수도권 전철 1·3·4호선, 경의·중앙선, 수인·분당선, 경춘선, 경강선, 서해선, 신분당선, 공항철도, GTX-A, 동해선·대경선 광역전철) / `metro`(도시철도 운영기관의 전동열차: 2·5~9호선, 인천 1·2호선, 경전철, 지방 도시철도) / `high_speed`(KTX·SRT) / `intercity` / `tourist`. 서비스 이름은 운행 계통명("수도권 전철 1호선", "KTX 경부선", "SRT 호남선").
- **일반열차·관광열차 운행 계통(2026-10-15 사용자 지시)**: 단위는 KTX 계통과 같은 **열차 등급 × 코레일 시간표 노선(시트)**(`svc-mugunghwa-gyeongbu` 무궁화호 경부선, `svc-itx-maum-honam` …, 특수 구간은 `svc-itx-maum-pyeongtaek-loop` 홍성 순환, 관광열차는 `svc-tourist-<brand>`). 출처는 한국철도공사 korail.com 열차운임/시간표 자료실의 일반열차·관광열차·ITX-청춘 시간표 xlsx(`src-korail-timetable-*`, 추출 TSV `raw/src-korail-timetable/texts/`; 내려받기 경로는 docs/research/data-sources.md). `stop_patterns` 는 시트 안 전 열차 정차역의 **합집합** 하나(type limited, 열차별 선택 정차·시각 미반영), 관광열차는 운행 구간별 패턴. 역은 이름·별칭 대조 뒤 동명이역을 앞뒤 역의 노선으로 고른다. 열차번호대(`train-number-ranges.yaml` group intercity)의 `service_ids` 는 시간표 열차번호로 잇는다. 시간표가 개정되면(코레일 자료실 새 게시물) 같은 절차로 다시 만든다. 누리로·관광열차는 round-5 Q106 A 에 따라 열차 등급 레코드 없이 둔다.
- `Station.line_classes`: 속한 노선 rail_class 합집합(노선 없는 RAFIS·KTX 기원 역은 `conventional`). `Station.service_kinds`: 정차하는 운행 계통 kind 합집합 — `stop_patterns`가 있으면 그 역만, 없으면 `line_ids`의 모든 역에 정차한다고 가정(리포트에 건수). 사이트의 "고속철도역/일반철도역/광역전철역" 필터는 `service_kinds`(정차 계통)와 `line_classes`(노선 분류)를 함께 쓴다. 이전의 `rail_classes`는 폐기.
- `Line.review_status`: `verified`(운영자 검수) / `auto`(자동 수집, 기본). `overrides/line-names.yaml`·`lines-manual.yaml`의 `review_status`로 지정. 역은 속한 노선 중 하나라도 verified 면 verified. 사이트는 auto 를 "검수 전"으로 표시(D18).
- 보조 출처(type `wiki`: 나무위키, 개인 블로그 등)는 사실 확인용으로만 쓰고 `provenance.sources`에 반드시 남긴다(`src-namuwiki`, `src-blog-deathrock-linecolors`). 본문은 복사하지 않고 값(이름·색·날짜·순서)만 쓴다. 1차 출처가 확인되면 교체한다.

## 5-6. 수기 물리 노선·역 순서·영문명·지오코더 — round-2
- **수기 물리 노선** `data/own/lines-manual.yaml`(Q52 A): 공공데이터로 만들 수 없는 고속선·준고속 간선(경부고속선·호남고속선·수서평택고속선·중앙선·경강선(서원주~강릉)·중부내륙선). 역은 최종 역 ID, `order_confirmed`는 근거(국가철도공단 노선번호 체계·KTX 정차역 순번·나무위키 역 목록)가 있을 때만 true, km는 근거가 있을 때만. KTX 정차역만 수록한 노선(중앙선 등)은 description에 "중간역 생략"을 적는다. KTX·SRT 운행 계통은 Service(`svc-ktx-*`, `svc-srt-*`)의 `stop_patterns`로만 표현하고 Line으로 만들지 않는다(이전 `line-ktx-*` 삭제).
- **공사 중 노선·정거장**(2026-10-13, round-5 Q138~Q140 임시 가정): 신선·연장의 공사 구간은 lines-manual.yaml 에 status `under_construction` 노선으로(연장은 "서울 9호선 (중앙보훈병원~고덕강일)"처럼 구간을 붙이고 개통 때 기존 노선에 합침), 정거장은 stations-manual.yaml 에 status `under_construction`(이름은 고시상 명칭 — 번호뿐이면 "<노선명> <번호>정거장", ID `stn-<노선 슬러그>-<번호>`). 기존 노선 중간·끝의 신설역은 `data/own/overrides/line-station-inserts.yaml`(line_id·station_id·after)로 끼워 넣는다(build.ts 가 역키로정내역 확장 뒤 적용). 환승·같은 이름의 기존 역은 같은 역 id 로 묶는다(Q140 A).
- **round-5 답변 반영(2026-10-14)**: 공사 중 정거장 이름은 "번호 (위치 표기)"(Q138 C, 예: "102정거장 (안양농수산물시장)"; 위치 표기는 고시 가칭·보도 표기, 없으면 고시 위치의 동·읍·면), 공사 중 **신설** 정거장은 기존 역과 같은 이름이어도 별개 역 id `stn-<기존 역 id 꼬리>-<노선 슬러그>`(Q140 C, 개통 때 station-merges 로 병합 — 기존 역을 그대로 쓰거나 개량만 하는 정거장은 기존 id 공유). 시간표 역명 해석은 미개통 역을 후보에서 뺀다.
- **Line 시설·여객 구분**(round-5 Q115·Q130): `line_role`(depot_line 기지선 / connecting_line 연결선 / wye 삼각선, 본선·지선은 비움), `passenger_service: false`(화물·산업 전용 — 노선 목록에서 따로 분류). 정의는 TERMINOLOGY 5절.
- **변경 묶음**(2026-10-14): data/own 을 여러 파일에 걸쳐 바꾸는 추가·정정은 `data/changesets/inbox/` 의 변경 묶음으로 만들고 `pnpm data:apply` 로 반영한다(docs/design/data-pipeline.md). 반영 기록은 `data/changesets/applied/`.
- **역 순서 수기 확정** `overrides/line-order.yaml`(Q36 D): 레일포털 노선정보 키 전까지 수도권 노선의 전체 순서를 적는다. 1차 근거는 국토부 도시철도 전체노선 순번, 보조는 나무위키. 레일포털 raw가 오면 그 역구성순서가 정거장구성을 대체한다(Q37 A, `--no-kric-order`로 끔).
- **역 영문명 수기** `overrides/station-names.yaml`(Q42 B): 공공데이터에 영문명이 없는 역만. 영문명이 생기면 ID가 영문 슬러그로 바뀐다(2절 규칙).
- **지오코더**(Q40 C): 주소는 있고 좌표가 없는 역은 VWorld 지오코더(`pnpm data:geocode` → `data/public/raw/geocode/results.json`, 키 없음)로 받아 `coord_source: derived`. official·manual 좌표는 덮지 않는다. derived 좌표는 주소 기준이라 지도 탭·check-coords로 검증 대상.
- **역번호(Q38 C)**: 서울교통공사(TAGO S1) 노선의 `LineStation.station_code`는 표준데이터 역번호(앞 0 제거, 노선도 표기 133). TAGO 값은 `Station.codes.tago_subway`에 유지. 그 밖은 TAGO 우선(2절).

## 6. 상태값

`operating`(운영중) / `under_construction`(공사중) / `planned`(계획, Phase 3에서 단계 세분) / `abandoned`(폐기된 계획) / `closed`(폐선·폐역)

## 7. 출처 규칙

- 모든 개체는 `provenance.sources[]`에 최소 1개의 `src-` ID를 가진다. 빌드 검증에서 강제한다.
- 자동 생성 레코드의 sources는 원본 데이터셋 ID. 수기 보정이 들어가면 `src-manual-<topic>`을 추가한다.
- 사이트의 모든 상세 페이지는 provenance를 "출처" 섹션으로 표시한다.

## 8. 좌표

- WGS84 십진수. `coord_source` 필수. 좌표가 없는 역은 `lat/lng` 생략(지도 탭에서 제외, 목록에는 "좌표 미확인" 표시).
- **근사 좌표(2026-10-14)**: 공사 중 정거장처럼 역 자체 좌표가 없는 역은 `overrides/station-coords.yaml` 로 대표점을 줄 수 있다. 항목 형태 — `same_as: <기존 역 id>`(개통 때 병합할 기존 역의 좌표, Q140 C 분리 정거장), `geocode: <고시 위치>` + `basis: parcel`(고시 지번 → VWorld 지오코더) 또는 `basis: district`(고시 "○○동 일원" → VWorld 검색 API 법정동 대표점). 결과 역은 `coord_source: derived` + `coord_basis`(parcel | district | existing_station). 지도는 속을 회색으로 칠하고 팝업·역 상세에 "근사 위치"를 표시한다. 리·읍·면 단위로만 알려진 위치는 먼저 고시 지번(실시계획 토지조서·정거장 결정조서 등)을 찾고, 못 찾으면 `basis: township`(읍·면 대표점, VWorld 검색 API — 리 대표점은 API 가 주지 않는다)으로 둔다(round-7 Q154 C). 지오코더 결과는 `pnpm data:geocode` 가 station-coords.yaml 의 geocode 항목도 받아 raw/geocode/results.json 에 둔다. **OSM 좌표는 자체 데이터에 저장하지 않는다.** 대신 지도 산출물(apps/web/public/map/stations.geojson)을 만들 때 근사 좌표 역(parcel·district·township)을 그 역이 속한 노선의 OSM 선형(osm-line-map.yaml 로 배정된 way) 위 가장 가까운 점으로 옮겨 표시한다(`coord_snapped: true`, 최대 이동 거리 parcel 1km · district 3km · township 10km, 넘으면 옮기지 않음; round-7 Q154, 2026-10-14 사용자 지시 "OSM 좌표는 저장이 아니라 참고"). 다른 노선의 선형으로는 옮기지 않는다.

## 5-7. round-3 반영 (2026-10-11, round-4 wave1)
- **노선 색(2026-10-15 사용자 지시)**: `Line.color` 는 공식 노선색을 확인한 노선에만 `line-names.yaml`(`color`+`color_source`)·`lines-manual.yaml` 로 지정한다. 지정이 없는 노선은 사이트·지도가 **상태 대표색**(packages/core/src/map-style.ts `STATUS_COLOR`: 운영 중 파랑, 그 밖(공사 중·검토·계획 중·휴업·폐지)은 회색 계열)을 쓴다(`lineDisplayColor`). 지도는 round-2 Q50 C 대로 수도권 전철로 쓰이는 노선에만 공식 노선색을 쓰고 나머지는 상태 대표색(코레일 간선의 color 는 운행 계통 안내색이라 지도에서는 쓰지 않음).
- **노선 영문명(Q55 B)**: 서울교통공사 노선은 서울교통공사 영문 노선도(`src-seoul-metro-map-english`, map_english.jpg 범례 "line N") 표기 "Line N"(인천·남양주 구간은 "Line N (…section)").
- **개통일 기준(Q56 A)**: `Line.opened_at` = 물리 노선 최초 개통일(코레일 간선은 `overrides/line-names.yaml` 의 `opened_at` + `opened_source: src-namuwiki` 로 노선정보 값을 덮음). 수도권 전철 등 운행 계통의 운행 개시일은 `Service.opened_at`(services.yaml, 출처 src-kric-metro-line-info 또는 나무위키).
- **물리 노선 분리(Q57)**: 노선정보의 "경의·중앙선"(I4108) 행은 운행 계통 단위라 `line-names.yaml` 에 `drop: true` 로 두고, `lines-manual.yaml` 에 경의선(`line-gyeongui`, 서울~도라산)·용산선(`line-yongsan`, 용산~가좌)·중앙선(`line-jungang`, 청량리~아화, 기존 수기 노선과 합침)을 수기 정의한다(`station_code_line_nos: [I4108]` 로 역번호 사용). `line-gyeongui-jungang` ID 는 폐기. 운행 계통 `svc-sudogwon-gyeonguijungang` 이 네 물리 노선(경의·용산·경원·중앙)을 잇는다. 같은 원칙으로 서해선(일산~곡산 = 경의선)·경춘선(광운대 = 망우선, 중랑·상봉 = 중앙선)은 `line-order.yaml` 의 `exclude_station_ids` 로 다른 노선의 역을 뺐다. 안산·과천선(두 물리 노선 합침)·수인선(한대앞~오이도 안산선 공용)은 round-4 Q75 B 로 분리(5-9절).
- **미개통 구간·역(Q58)**: `data/own/stations-manual.yaml` 에 Station(status under_construction/planned, `opened_at` 은 개통 목표 fuzzyDate, 출처 필수)을 두고 `lines-manual.yaml` 의 stations 에 `branch`(예: "2단계(고막원~임성리, 미개통)")로 붙인다. 계획과는 `plans/*.yaml` 의 `station_ids` 로 연결(호남고속철도 2단계 ↔ 무안공항). 개통된 구간(중부내륙선 충주~문경, 중앙선 군위)은 operating 수기 역.
- **휴업(Q59)**: `status: suspended` 는 `line-names.yaml` 의 `status` + `status_source` 로 지정(인천공항 자기부상철도), 운행 계통도 services.yaml 에서 suspended. 휴업·재개 사실은 `events-manual.yaml`.
- **광역철도 지정(Q60 B)**: 지정 근거 출처를 `is_wide_area_source` 에 적는다(진접선·하남선·GTX 2011-12 제2차 광역교통시행계획 보도, 별내선 국토부 보도자료, 1998 건설교통부고시 제1998-202호 등은 위키백과 "광역철도" 지정 연혁 경유). 노선 일부 구간만 지정된 경우(5호선 하남선, 8호선 구리 구간)는 플래그를 비우고 note(round-4 후보).
- **SRT(Q62)**: 코레일·SR 통합(2026-09-01)으로 SR 노선 안내 페이지가 사라져 1차 출처 확보 불가. `svc-srt-*` 5계통(경부·호남·전라·경전·동해)은 `closed` + 정차역(나무위키 보조) + `events-manual.yaml` service_ended.
- **local 패턴(Q63 B)**: 전철 서비스 37건에 `--seed-local-patterns` 로 완행 패턴 시드. 이후 사람이 편집.
- **권역(D20)**: Station/Line/Service/Plan/Event 의 `areas`. 시·도 → 권역 표는 build.ts `AREA_OF_REGION`. Service.areas 는 build 가 services.yaml 에 직접 기록한다.
- **GTX 풀네임(D23)**: `name.full`(line-names.yaml `full`).
- 계획·연표 규칙은 docs/design/plan-model.md. 상위 계획(PlanProgram, `data/own/plan-programs.yaml`)의 id 를 `plan_refs[].program` 이 참조하며 validate.ts 가 검사한다(코드에 차수 enum 없음).

## 5-9. 지방 간선 중간역·영업거리 — 코레일 역키로정내역 (round-4 Q74 B, 2026-10-12)
- 철도거리표 고시는 전문이 없고(관보 목록에 변경 고시 41건만) RAFIS 역 정보에는 노선 열이 없어, 지방 간선의 중간역·km 는 **코레일 「철도운영정보 역키로정내역」**(`src-korail-station-kilo`, 683행, 공공데이터포털 15153841)으로 채운다. `여객키로정` = `<노선코드><영업거리 km×10, 4자리>`(용산 10032 = 코드 1·3.2 km). 코드→물리 노선 대응·기점·별칭은 `data/own/overrides/korail-kilo-lines.yaml`, 구현은 `packages/pipeline/src/ingest/build-kilo-lines.ts`(build.ts 가 line-order 뒤에 호출, `--no-kilo` 로 끔).
- 세 가지 모드: `create`(새 Line — 호남·전라·충북·경북·영동·태백·경전·대구·광주·정선·삼척선, `kind manual`·`review_status auto`·`codes.korail_kilo_line`), `extend`(노선정보 기원 노선에 중간역·km·순서 — 경부·경인·경원·장항·경춘·교외·분당·일산·동해선; 키로정에 없는 기존 역은 직전 역 뒤에 그대로 둔다), `check`(lines-manual 수기 노선과 대조만 — 중앙·경의·용산선). 각 노선의 기점은 소속 노선 코드에만 실리므로 `origin`(km 0)으로, 분기점 뒤의 종점은 `terminus`(km 없음)로 붙인다. 분기점·신호소(…분기/…분/…신호)와 북측 역(판문)은 `skip`.
- 역명 해석 순서: `aliases`(옛 이름·내부 명칭: 가리봉→가산디지털단지, 성북→광운대, 신포항→포항 …) → `creates`(사람이 영업 중으로 확인한 새 역만 생성: 민둥산·아우라지·북창원·북울산·입실·나원·영해~근덕 등 19건, status operating·좌표 없음·`codes.korail_station_kilo`) → RAFIS 역명 → RAFIS 역약어명(유일) → 역 이름·별칭·`codes.rafis`(동명이면 RAFIS 기원 역 우선). 그래도 없는 이름은 **만들지 않고 리포트**(키로정 명부에는 폐역 — 장항선 모산·원죽, 경원선 의정북부, 옛 동해남부선 수영·해운대 — 와 신호장이 섞여 있어 자동 생성하지 않는다). 매칭된 기존 역에는 `codes.korail_station_kilo`(키로정 역명)와 출처를 더한다.
- 키로정이 옛 선형을 실은 구간(동해선 부전~태화강)은 `extend_from_km` 으로 무시한다. 키로정 km 와 수기 km 의 차이(경의선 강매 13.9/14.0, 용산선 효창공원앞 1.5/1.8)는 report.md "역키로정내역 대조(check)" 절에 남기고 수기 값을 유지한다.
- 이 노선·역은 1·2순위 밖이라 전부 `review_status: auto`("검수 전"). 정차 여부(여객 취급)는 키로정에 없으므로 중간역에 신호장·화물역이 섞일 수 있다(노선 description 에 명시).

## 5-8. 열차번호와 차량번호(차호)·편성번호 — D28 보강 (2026-10-12)
- **두 개체를 섞지 않는다.** 열차번호(운행 번호, 1회 운행 단위)는 `data/own/train-number-ranges.yaml`(`tnr-`, `packages/schema/train-number-range.schema.json`), 차량번호(차호, 차량 1량 단위)와 편성번호(호기·편성)는 `data/own/rolling-stock-numbers.yaml`(`rsn-`, `packages/schema/rolling-stock-number-range.schema.json`). 용어는 TERMINOLOGY.md 6절(열차번호 / 차량번호 / 편성번호 / 호대).
- 차량번호대 레코드: `series`(호대 원문 "160000호대"), `number_prefix`(영문 접두 D·A·UL·SL·U, 숫자만이면 생략), `number_from`~`number_to`(호대 안에서 실제 쓰인 최소·최대 번호의 숫자 부분), `digits`(숫자 자릿수), `group`(high_speed/intercity/wide_area/metro/locomotive/coach/freight/other — 코레일 6자리 첫 자리 1·2·3 과 대응), `model`, `train_class_id`/`service_ids`/`line_ids`(확실한 것만; 투입 계통이 불확실하면 비우고 note), `formation{label(호기|편성), from, to, count, cars, code_prefix, note}`(고정편성만; 편성 범위를 모르면 `count` 만), `number_rule`(번호 구성 규칙 문장), `status`(operating/planned/closed), `introduced_at`/`retired_at`(fuzzyDate), `owner_note`(운영자≠소유자), `review_status`(verified = 1차 출처로 범위 확인 / auto = 보조 출처만).
- `formation.count` 는 결번·도입 예정을 뺀 확인 편성 수. 결번·예정은 `formation.note` 에 적는다. 편성 수를 1차 출처(서울시 「서울지하철 현황」 등)와 대조했으면 `provenance.sources` 에 그 출처를 추가한다 — 번호 범위 자체의 1차 출처가 아니면 `review_status` 는 auto 유지.
- 운영기관 `operator` 는 열차번호대보다 세분(korail/sr/seoul_metro/incheon_transit/seoul_metro9/airport_railroad/neotrans/gtx/ui_sinseol/sillim/gimpo_goldline/u_line/other). 코레일·SR 통합(2026-09-01) 후 구 SR 발주 차량(120000·130000·180000호대)은 `korail` + note.
- 사이트: `/trains/` 2부 "차량번호(차호)·편성번호"(행 앵커 `routes.stockRange(id)`), 열차 등급 상세의 "차량번호대" 줄, 번호 찾기(열차번호·차량번호·편성번호 세 체계 동시 검색). 새 참조 필드를 추가하면 `packages/pipeline/src/validate.ts` 의 접두사 매핑(line/train/service)이 그대로 적용되는지 확인한다.

## 5-9. round-4 답변 반영 (2026-10-12, 데이터·모델 1차 묶음)
- **열차 등급 = 종별, 차량 ≠ 등급**(추가 요청): `train-classes.yaml` 은 KTX 한 등급(`tc-ktx`, `aliases` 에 KTX-1·KTX-산천·KTX-청룡)으로 합치고 `tc-ktx-sancheon`·`tc-ktx-cheongryong` 은 폐기(차량 종류는 `rolling-stock-numbers.yaml` 의 `model`). 스키마에 `status`(active/retired, 기본 active)·`retired_at`(fuzzyDate)·`successor_id` 추가. SRT 는 `retired`(2026-09-01, successor `tc-ktx`). 비둘기호 등 과거 등급은 같은 형식으로 추가 가능. 라벨 `TRAIN_CLASS_STATUS_LABEL`(labels.ts).
- **수서발 KTX(Q69 B·Q83 B)**: `svc-ktx-suseo-{gyeongbu,honam,jeolla,gyeongjeon,donghae}` 신설(kind high_speed, `tc-ktx`, line_ids 수서평택고속선+경부/호남고속선, 정차역은 `svc-srt-*` 승계, `opened_at` 2026-09-01, 출처 세계일보 2026-09-01·더나은미래 2026-08-31·MTN 2026-08-04·SR 공지). `tnr-ktx-*-suseo` 의 `service_ids` 를 새 계통으로. `svc-srt-*` 는 closed 보존 + description 에 후속 계통.
- **수인선·안산선·과천선 분리(Q75 B)**: 노선정보 "안산·과천선"(I4103) 행은 `line-names.yaml` `drop: true`, `lines-manual.yaml` 에 과천선(`line-gwacheon`, 남태령~금정 14.4km, 1993-01-15)·안산선(`line-ansan`, 금정~오이도 26.0km, 1988-10-25)을 `station_code_line_nos: [I4103]` 으로 정의(개통일·연장·노선번호 316/317 은 나무위키 인포박스 보조, 역 순서는 국토부 전체노선 순번). 수인선(`line-suin`)은 `line-order.yaml` `exclude_station_ids` 로 안산선 공용 구간 중간 6역(중앙·고잔·초지·안산·신길온천·정왕)을 뺐다(한대앞·오이도는 접속역으로 유지, 수원은 표준데이터상 분당선 행이라 여전히 분당선에만). 운행 계통 4호선 = 진접선+서울 4호선+과천선+안산선, 수인·분당선 = 수인선+분당선+안산선. `line-ansan-gwacheon` ID 폐기(osm-line-map·rolling-stock·train-number-ranges·plans 참조 전부 교체).
- **개통 목표(Q78 B)·착공일(Q73 C)**: plan-model.md 참조. `Station.opened_at`(미개통)은 계획이 없을 때의 폴백.
- **광역철도 지정 고시(Q71)**: 관보 목록(src-kric-gazette)은 2015-08 이후만 수록해 1998·2011 지정 고시는 없다. 진접선·하남선·GTX-A 의 관련 고시(기본계획·실시계획 변경)만 `line-names.yaml` note 에 번호·일자로 적었다. 관보 ezpdf 링크는 JS 뷰어 페이지라 자동 다운로드 불가.
- **자기부상철도(Q91 C)**: 인천국제공항공사 공지 원문(휴업 2022-07-14·운영 종료 2023-09-01)을 airport.kr 검색·공지 게시판 curl 로 찾지 못해 현행 출처(뉴데일리경제 2022-07-12, 나무위키) 유지. 인천투데이 2023-05-18(인천시 도시계획시설 변경 공고, 폐업신고 2022-03)만 참고로 확인.

## 5-10. 역 종류(kind)·RAFIS 표기 해석·시·도 보간 (2026-10-12, "지역 미상 역" 재검토)
- **역 종류** `Station.kind`(schema enum): `station` 여객역(기본, 생략) / `signal_box` 신호장·신호소 / `junction` 분기점·연결선 / `yard` 조차장 / `depot` 차량기지 / `freight` 화물역·철송장·항만역. 정의는 TERMINOLOGY.md 4절 "역 / 정거장 / 신호장". 이전 enum 값 `halt`(간이역)는 등급이지 종류가 아니라 폐기.
- **판정** `data/own/overrides/station-kinds.yaml`: 개별 지정(`key: rafis:…` 또는 `id`, sources·note 필수) > 이름 규칙(`…신호장/신호소/신호[A-Z]` → signal_box, `…분기/연결` → junction, `…조차장` → yard, `…기지/차량` → depot, `…화물/철송장` → freight). 이름 규칙은 표준데이터·TAGO 기원 역에는 적용하지 않는다. 여객 취급을 중지했어도 화물 취급 근거가 없으면 `station` 으로 두고 note 에 중지일·출처만 적는다. 개별 지정은 `status`·`closed_at`(폐역 근거)도 바꾼다. 결과는 report.md "1-1. 역 종류 분류".
- **사이트**: `kind ≠ station` 시설은 역 목록(분류×권역 집계 포함)·역 수·홈 통계·권역/시·도 페이지·지도 역 레이어(build-map.ts)·검색 인덱스에서 뺀다(`Db.passengerStations`, `isFacility`). 상세 페이지는 그대로 있고, 노선 상세 역 순서에는 "시설 · 종류" 배지로 남으며 노선의 역 수는 "+ 시설 N" 으로 따로 보인다.
- **RAFIS 접두·약어 표기**(data-sources.md 1-1 "RAFIS 표기 규칙"): 같은 이름이 이미 있으면 두 번째 등록에 "1"·"S"·"신" 접두를 붙이거나 이름을 자른다. 해석은 RAFIS 행 묶음(노선별로 묶인 행 순서)·기준역간KP·영문·한자·등록일을 표준데이터·역키로정내역과 대조해 **역마다** `station-merges.yaml` 에 근거와 함께 적는다(접두만 보고 자동 병합하지 않는다). 병합 규칙에 `internal: [키]` 를 두면 그 내부 표기는 별칭(aliases)·이름·영문·한자 선택에서 빠지고 `codes.rafis` 에만 남는다. RAFIS 가 행정구역명 등 다른 이름으로 등록한 역(외동 = 입실)은 `station-names.yaml` 의 `ko`(역명 정정; 원래 이름은 별칭, 영문명은 비움)로 고친다.
- **시·도 보간**: 주소가 없는 역은 같은 노선에서 순서 확정(order_confirmed)된 앞뒤의 가장 가까운 시·도 있는 역이 같은 시·도일 때만 그 값을 쓴다(지선 branch 는 따로, 다르거나 노선 끝이면 비움, 노선마다 결과가 엇갈리면 비움). provenance.note 에 "노선 순서 보간" 을 적고 review 는 auto. 위키 주소·좌표로 시·도를 채우지 않는다(round 결정 후보). 남은 역은 report.md 4절 "시·도(region) 미상으로 남은 역".
- **역키로정 동명 오배정 수정**: 키로정 이름 해석이 동명 역에 잘못 붙던 것(영동선 양원 → 중앙선 양원, 태백선 쌍용 → 장항선 쌍용)은 `korail-kilo-lines.yaml` 의 creates·aliases 로 분리했다. creates 는 `status`·`closed_at`·`kind`·`sources` 를 받는다(경북선 양정 2006-06-23 폐역).

## 5-11. 환승센터·복합환승센터(TransferCenter) — 2026-10-13 (사용자 요청 "역 옆 태그 + 노선 계획 수준 상세")

- 파일 `data/own/transfer-centers.yaml`, 스키마 `packages/schema/transfer-center.schema.json` ↔ `apps/web/src/content.config.ts` transferCenters. id `tc-<역·지점 로마자>`. 사업 하나 = 레코드 하나(차수마다 사업명이 바뀌어도 같은 장소·같은 사업이면 하나로 묶고 앞 이름은 `aliases`; 예 용인역 → 구성역 복합환승센터, 송정역 → 북울산역 환승센터).
- 역(Station)이 아니다. 철도 사업 단계(planStage)를 쓰지 않고 `status`(planned 계획 / design 설계 / construction 공사 / completed 준공 / withdrawn 철회·중단 / unknown 미확인) + `status_as_of` + `status_source`(필수)를 쓴다. 근거: 최신 기본계획의 앞 차수 추진현황(4차 p.4~5, 2026-08). 앞 차수에만 있고 후속 계획에 없는 사업은 1차 출처가 없으면 `unknown`.
- `plan_refs[].program` 은 `plan-programs.yaml` 의 `kind: transfer_center`(transfer_center_1~4)만 허용(validate.ts 검사). `class`: pilot(1차 시범사업, 보도 출처) / candidate(2차 구축 가능 거점, 사업비 없음) / new / continued / review. `rail_now`·`rail_future`·`cost_100m_krw`·`page` 는 원문 표 값 그대로.
- `station_ids` = 연계 역(이 사이트의 역 레코드). 개통 전 역이 데이터에 없으면 비우고 description 에 적는다(북정·사송·합덕·남부내륙선 역 등). 동명 역 주의(4차 "거제역" = 남부내륙선 경남 거제역 ≠ 부산 거제역). `plan_ids` = 원문 "장래" 열을 이 사이트의 계획 사업(Plan)과 맞춘 것 — 맞출 계획이 없으면 비운다(원문 표기는 rail_future 에 남음).
- 원문 사업표 전사: `data/public/raw/src-molit-tc-plan3/projects-47.tsv`, `src-molit-tc-plan4/projects-65.tsv`(소계·총계를 원문과 대조). 사이트: `/transfer-centers/`, `/transfer-centers/<id>/`, 역 목록·역 상세·노선 역 순서·시·도 역 목록의 역 이름 옆 태그(`TransferCenterTag.astro`, 클라이언트 행은 `station-table.ts`).

