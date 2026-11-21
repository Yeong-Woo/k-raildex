# 이관 대조 리포트 2026-11-21

> `pnpm migrate:verify` 가 생성(packages/migrate-legacy). 기준: docs/07-migration.md 4절. 같은 이름의 .json 에 전체 목록.

## 요약

- Hard 위반: **0**
- 미설명 차이(필드·누락·추가): **0**
- 계산 단계 ≠ 기존 stage: 0
- 이벤트: 테이블 989 + 파생 뷰 1135, 기존 id 중 새 DB(테이블∪뷰)에 없는 것 0
- 시간표: 세트 4153, 행 605418
- FK 위반: 0 (DB 외래 키가 적재 때 강제)

## 1. 개체 수

| 개체 | 기존 | 새 | 비고 |
| --- | ---: | ---: | --- |
| source | 625 | 625 |  |
| operator | - | 20 | 기존에 없던 개체(노선 operator_name·번호대 enum 에서 생성) |
| station | 1548 | 1548 |  |
| line_station | 1738 | 1738 | D-1 id 변경 |
| line | 103 | 103 |  |
| train_class | 14 | 14 |  |
| service | 97 | 97 |  |
| plan_program | 33 | 33 | D-5 id 변경 |
| plan | 259 | 259 |  |
| event | 2124 | 2124 | 테이블 989 + 파생 뷰 1135 (D-3) |
| transfer_center | 87 | 87 | D-5 id 변경 |
| route_map | 6 | 6 |  |
| train_number_range | 196 | 196 |  |
| rolling_stock_range | 61 | 61 |  |
| glossary_term | 54 | 54 | TERMINOLOGY.md 파싱 항목 수 |
| timetable_set | 4249 | 4153 | TAGO + 운행정보 보강(수집기 kric-train-ops 결과, 5절 설명) |
| timetable_entry | 617209 | 605418 | 기존 = 요약 count 합(운행정보 보강 세트 포함) |

## 2. 의도된 차이(D-1~D-7)

| # | 차이 | 이유 |
| --- | --- | --- |
| D-1 | `LineStation.id`(`line-x--001`) → `ls-…` | 순서와 무관한 안정 id. 대조는 (노선, 역) 키로 |
| D-2 | 역 `review_status` 원 값 없음 | 상속은 뷰(v_station_review) |
| D-3 | 파생 이벤트 저장 안 함 | 뷰(v_event_derived)가 같은 id 로 생성 |
| D-4 | `operator_name` → 운영기관 참조 | 원문은 `extra.operator_name_raw` — 역변환은 원문으로 복원 |
| D-5 | 상위 계획·환승센터 id 변경 | Q69 A, id_redirect. 역변환은 옛 id 로 복원 |
| D-6 | 다중 노선 역의 개통일 배분 | Q95 A: 확실한 노선별 역에만, 나머지 미확인 |
| D-7 | `target_open` → 기대 일정 | Q88·Q94 A: 근거(공식·보도) 출처가 없는 것은 미이관 |

## 3. 필드 대조(역변환 JSON vs data/build/*.json)

### station

기존 1548 / 역변환 1548


| 필드 | 차이 수 | 분류 | 예(id: 기존 → 새) |
| --- | ---: | --- | --- |
| service_kinds [정차역 노선별 역 미해석으로 제외(이관 리포트)] | 27 | 정차역 노선별 역 미해석으로 제외(이관 리포트) | stn-changwon: ["high_speed","intercity"] → ["intercity"]<br>stn-changwonjungang: ["high_speed","intercity","tourist"] → ["intercity","tourist"] |

### line_station

기존 1738 / 역변환 1738


| 필드 | 차이 수 | 분류 | 예(id: 기존 → 새) |
| --- | ---: | --- | --- |
| id [D-1] | 1738 | D-1 | line-ansan|stn-geumjeong: "line-ansan--001" → "ls-ansan--geumjeong"<br>line-ansan|stn-sanbon: "line-ansan--002" → "ls-ansan--sanbon" |

### line

기존 103 / 역변환 103

- 필드 차이 없음

### plan

기존 259 / 역변환 259

- 필드 차이 없음

## 4. 연표

### event(저장분)

기존 989 / 역변환 989


| 필드 | 차이 수 | 분류 | 예(id: 기존 → 새) |
| --- | ---: | --- | --- |
| date ["일 00" 정밀도 보정] | 28 | "일 00" 정밀도 보정 | evt-stage-changed-donghae-2000-03-00: {"precision":"day","value":"2000-03-00"} → {"precision":"month","value":"2000-03"}<br>evt-other-jinhae-2000-09-00: {"precision":"day","value":"2000-09-00"} → {"precision":"month","value":"2000-09"} |

## 5. 시간표 요약

### timetable_summary

기존 4249 / 역변환 4153

- 새 DB 에 없음(설명: 방향 unknown 세트 → 정차역 순서로 상·하행 판정(같은 역·계통·요일 세트가 이미 있어 생략)) 100: tt-ansan-i4103-holiday-unknown, tt-ansan-i4103-weekday-unknown, tt-banwol-i4103-holiday-unknown, tt-banwol-i4103-weekday-unknown, tt-beomgye-i4103-holiday-unknown, tt-beomgye-i4103-weekday-unknown, tt-byeollaebyeolgaram-i4103-holiday-unknown, tt-byeollaebyeolgaram-i4103-weekday-unknown, tt-changdong-i4103-holiday-unknown, tt-changdong-i4103-weekday-unknown …
- 기존에 없음(설명: 기존에 해석하지 못한 운행정보 역명을 새 DB 역명·별칭으로 해석(새 역의 세트)) 4: tt-sinchon-mapo-s1102-holiday-inner, tt-sinchon-mapo-s1102-holiday-outer, tt-sinchon-mapo-s1102-saturday-inner, tt-sinchon-mapo-s1102-saturday-outer
- 필드 차이 없음

## 6. 계획

### 계산 단계 ≠ 기존 stage (0)


### 역할 초안 통계

- plan_line.upgrades: 165
- plan_line.new: 23
- plan_station.new: 159
- plan_station.existing: 190

## 7. Hard 위반

- 없음

## 8. 해석 실패·판정 불가(이관 단계)

### license_class unknown (114)

- src-kric-station-std [dataset_file] 이용허락범위 제한 없음 (공공누리 제1유형에 준해 출처 표시)
- src-kric-route-info [dataset_api] 저작권표시 (레일포털 오픈API 이용약관, 출처 표시)
- src-seoul-metro-route-map [map_image] 공공누리 제3유형 표시(숨김) — 기관 확인 전까지 링크만
- src-incheon-route-map [map_image] ALL RIGHTS RESERVED 표기 — 링크만
- src-seoul-line-colors [official_page] 서울특별시 누리집 게시 자료 (출처 표시)
- src-vworld-geocoder [dataset_api] 브이월드 오픈API 이용약관 (인증키 필요, 일 요청 한도, 출처 표시)
- src-seoul-metro-map-english [map_image] 서울교통공사 누리집 게시 자료 (출처 표시; 이미지 재게시는 하지 않고 표기만 참조)
- src-kr-nrp4-new [official_page] 국가철도공단 누리집 게시 자료 (국토교통부 고시 제2021-936호 부속 계획 내용; 출처 표시)
- src-kr-nrp4-review [official_page] 국가철도공단 누리집 게시 자료 (출처 표시)
- src-kr-project-status-hsr [official_page] 국가철도공단 누리집 게시 자료 (출처 표시)
- src-kr-project-status-conventional [official_page] 국가철도공단 누리집 게시 자료 (출처 표시)
- src-kr-project-status-wide [official_page] 국가철도공단 누리집 게시 자료 (출처 표시)
- src-kric-gazette [official_page] 고시·공고 제목·번호·발행일 색인 (고시 자체는 저작권 보호 대상 아님; 사이트 표기 Copyright © 철도산업정보센터)
- src-kric-chronology [official_page] 사이트 표기 "Copyright © 철도산업정보센터 All rights reserved"(공공누리 미표기) — 날짜·요약 한 줄만 사실 정보로 사용하고 출처 표시, 본문 전문은 수집·게시하지 않음
- src-molit-press-byeollae-open [press_release] 국토교통부 보도자료 (공공누리 제1유형에 준함; 전재본 링크)
- src-sr-integration-notice [official_page] SR 누리집 공지 (사실 확인용, 출처 표시)
- src-seoul-mediahub-gyeongchun-2010 [official_page] 서울시 미디어허브 (사실 확인용, 출처 표시)
- src-molit-nrp-policy [official_page] 공공저작물 (출처 표시)
- src-molit-ctp-1to4 [official_page] 공공저작물 (출처 표시)
- src-molit-ctp5-action [official_page] 공공저작물 (출처 표시)
- src-seoul-press-wirye-2026 [press_release] 공공저작물 (서울시 보도자료, 출처 표시)
- src-seoul-mediahub-2018545 [official_page] 서울시 미디어허브 (사실 확인용, 출처 표시)
- src-seoul-mediahub-2014732 [official_page] 서울시 미디어허브 (사실 확인용, 출처 표시)
- src-korea-kr-seoul-plan-2015 [press_release] 공공저작물 (출처 표시)
- src-gg-metro-plan-2-report [official_page] 경기도 누리집 게시 자료 (출처 표시)
- src-gg-press-2025-12-12 [press_release] 공공저작물 (경기도 보도자료, 출처 표시)
- src-gg-press-2019-05-12 [press_release] 공공저작물 (경기도 보도자료, 출처 표시)
- src-seoul-traffic-subway-status [official_page] 서울특별시 누리집 공개 자료 (이용허락 유형 표기 미확인 — 노선별 편성수·량수 수치만 인용)
- src-kric-api-station-info [dataset_api] 저작권표시 (레일포털 오픈API 이용약관, 출처 표시)
- src-kric-file-station-all [dataset_file] 저작권표시 (레일포털 이용약관, 출처 표시)
- src-kric-file-seoul-line-names [dataset_file] 저작권표시 (레일포털 이용약관, 출처 표시)
- src-kric-file-train-ops [dataset_file] 저작권표시 (레일포털 이용약관, 출처 표시)
- src-kr-major-projects-conventional [official_page] 공공저작물 (출처 표시)
- src-kr-major-projects-hsr [official_page] 공공저작물 (출처 표시)
- src-daejeon-okcheon-page [official_page] 공공저작물 (출처 표시)
- src-busan-bujeon-masan-2026 [official_page] 공공기관 게시물 (사실 확인용, 출처 표시)
- src-seoul-mediahub-wirye-2024 [official_page] 공공기관 게시물 (사실 확인용, 출처 표시)
- src-seoul-mediahub-9-phase4-2023 [official_page] 공공기관 게시물 (사실 확인용, 출처 표시)
- src-molit-press-sbd-homaesil-2021 [press_release] 공공누리 (보도자료, 출처 표시)
- src-molit-press-gtxc-2023 [press_release] 공공누리 (보도자료, 출처 표시)
- … 외 74건(JSON 참고)

### OSM 배정 옵션(share_with·claim_first·ways)은 계약에 열이 없어 note 로 보관 (4)

- line-hwaseong-hsr-connecting
- line-pyeongtaek-hsr-connecting
- line-siheung-connecting
- line-suseo-pyeongtaek-hsr

### 노선 문맥 코드 노선별 역 미해석(역에 보관) (215)

- stn-ansan kric_station_std=1759@I28K1 (노선 line-ansan, line-suin-narrow)
- stn-ansan molit_metro_lines=안산 (노선 line-ansan, line-suin-narrow)
- stn-banwoldang molit_metro_lines=반월당 (노선 line-daegu-1, line-daegu-2)
- stn-bexco molit_metro_lines=벡스코 (노선 line-busan-2, line-donghae)
- stn-bexco molit_metro_lines=벡스코(시립미술관) (노선 line-busan-2, line-donghae)
- stn-bokjeong molit_metro_lines=복정 (노선 line-bundang, line-seoul-8)
- stn-bokjeong molit_metro_lines=복정(동서울대학) (노선 line-bundang, line-seoul-8)
- stn-bomun molit_metro_lines=보문 (노선 line-seoul-6, line-ui-sinseol)
- stn-boramae molit_metro_lines=보라매 (노선 line-seoul-7, line-sillim)
- stn-bubal molit_metro_lines=부발 (노선 line-gyeonggang, line-jungbunaeryuk)
- stn-bucheon-stadium molit_metro_lines=부천종합운동장 (노선 line-incheon-7, line-seohae)
- stn-bucheon-stadium molit_metro_lines=부천종합운동장역 (노선 line-incheon-7, line-seohae)
- stn-bujeon molit_metro_lines=부전 (노선 line-bujeon-masan, line-busan-1, line-donghae)
- stn-bujeon molit_metro_lines=부전(부산시민공원·송상현광장) (노선 line-bujeon-masan, line-busan-1, line-donghae)
- stn-bulgwang molit_metro_lines=불광 (노선 line-seoul-3, line-seoul-6)
- stn-bupyeong molit_metro_lines=부평 (노선 line-gyeongin, line-incheon-1)
- stn-bupyeong-gu-office molit_metro_lines=부평구청 (노선 line-incheon-1, line-incheon-7)
- stn-buramsan molit_metro_lines=불암산(당고개) (노선 line-jinjeop, line-seoul-4)
- stn-buramsan tago_subway=MTRS14409 (노선 line-jinjeop, line-seoul-4)
- stn-busan molit_metro_lines=부산 (노선 line-busan-1, line-gyeongbu, line-gyeongbu-hsr)
- stn-busan-nat-l-univ-of-edu molit_metro_lines=교대 (노선 line-busan-1, line-donghae)
- stn-byeollae molit_metro_lines=별내 (노선 line-gyeongchun, line-namyangju-8)
- stn-byeollae molit_metro_lines=별내(삼육대학교) (노선 line-gyeongchun, line-namyangju-8)
- stn-byeongjeom molit_metro_lines=병점 (노선 line-byeongjeom-depot, line-gyeongbu)
- stn-byeongjeom tago_subway=MTRKR1P157 (노선 line-byeongjeom-depot, line-gyeongbu)
- stn-changdong molit_metro_lines=창동 (노선 line-gyeongwon, line-seoul-4)
- stn-cheonan kric_station_std=1728@I4401 (노선 line-gyeongbu, line-janghang)
- stn-cheonan molit_metro_lines=천안 (노선 line-gyeongbu, line-janghang)
- stn-cheonan tago_subway=MTRKR1P169 (노선 line-gyeongbu, line-janghang)
- stn-cheonggu molit_metro_lines=청구 (노선 line-seoul-5, line-seoul-6)
- stn-cheongna-hill molit_metro_lines=청라언덕 (노선 line-daegu-2, line-daegu-3)
- stn-cheongnyangni molit_metro_lines=청량리 (노선 line-gyeongwon, line-jungang, line-seoul-1)
- stn-cheongnyangni molit_metro_lines=청량리(서울시립대입구) (노선 line-gyeongwon, line-jungang, line-seoul-1)
- stn-cheongnyangni tago_subway=MTRKRK1K209 (노선 line-gyeongwon, line-jungang, line-seoul-1)
- stn-cheongnyangni tago_subway=MTRKRK2K117 (노선 line-gyeongwon, line-jungang, line-seoul-1)
- stn-cheongnyangni tago_subway=MTRKRK4K209 (노선 line-gyeongwon, line-jungang, line-seoul-1)
- stn-cheongnyangni tago_subway=MTRS11158 (노선 line-gyeongwon, line-jungang, line-seoul-1)
- stn-cheonho molit_metro_lines=천호(풍납토성) (노선 line-seoul-5, line-seoul-8)
- stn-choji kric_station_std=1758@I28K1 (노선 line-ansan, line-seohae)
- stn-choji molit_metro_lines=초지 (노선 line-ansan, line-seohae)
- … 외 175건(JSON 참고)

### 노선도 embed → link(문서 적재 WP 3.7 이후 embed 로) (2)

- map-korail-national file korail-national-20250101.jpg
- map-seoul-city file seoul-subway-202603.jpg

### 시간표 노선별 역 미해석 (90)

- tt-incheon-int-l-airport-terminal-1-mtriam1-saturday-down (svc-sudogwon-jagibusang)
- tt-incheon-int-l-airport-terminal-1-mtriam1-saturday-up (svc-sudogwon-jagibusang)
- tt-yongsan-seoul-mtrkr1-weekday-down (svc-sudogwon-1)
- tt-yongsan-seoul-mtrkr1-weekday-up (svc-sudogwon-1)
- tt-yongsan-seoul-mtrkr1-holiday-down (svc-sudogwon-1)
- tt-yongsan-seoul-mtrkr1-holiday-up (svc-sudogwon-1)
- tt-guro-mtrkr1-weekday-down (svc-sudogwon-1)
- tt-guro-mtrkr1-weekday-up (svc-sudogwon-1)
- tt-guro-mtrkr1-holiday-down (svc-sudogwon-1)
- tt-guro-mtrkr1-holiday-up (svc-sudogwon-1)
- tt-geumcheon-gu-office-mtrkr1-weekday-down (svc-sudogwon-1)
- tt-geumcheon-gu-office-mtrkr1-weekday-up (svc-sudogwon-1)
- tt-geumcheon-gu-office-mtrkr1-holiday-down (svc-sudogwon-1)
- tt-geumcheon-gu-office-mtrkr1-holiday-up (svc-sudogwon-1)
- tt-byeongjeom-mtrkr1-weekday-down (svc-sudogwon-1)
- tt-byeongjeom-mtrkr1-weekday-up (svc-sudogwon-1)
- tt-byeongjeom-mtrkr1-holiday-down (svc-sudogwon-1)
- tt-byeongjeom-mtrkr1-holiday-up (svc-sudogwon-1)
- tt-geumjeong-mtrkr4-weekday-down (svc-sudogwon-4)
- tt-geumjeong-mtrkr4-weekday-up (svc-sudogwon-4)
- tt-geumjeong-mtrkr4-holiday-down (svc-sudogwon-4)
- tt-geumjeong-mtrkr4-holiday-up (svc-sudogwon-4)
- tt-cheongnyangni-mtrkrk1-weekday-down (svc-sudogwon-suinbundang)
- tt-cheongnyangni-mtrkrk1-weekday-up (svc-sudogwon-suinbundang)
- tt-cheongnyangni-mtrkrk1-holiday-down (svc-sudogwon-suinbundang)
- tt-cheongnyangni-mtrkrk1-holiday-up (svc-sudogwon-suinbundang)
- tt-hangyang-univ-at-ansan-mtrkrk1-weekday-down (svc-sudogwon-suinbundang)
- tt-hangyang-univ-at-ansan-mtrkrk1-weekday-up (svc-sudogwon-suinbundang)
- tt-hangyang-univ-at-ansan-mtrkrk1-holiday-down (svc-sudogwon-suinbundang)
- tt-hangyang-univ-at-ansan-mtrkrk1-holiday-up (svc-sudogwon-suinbundang)
- tt-oido-mtrkrk1-weekday-down (svc-sudogwon-suinbundang)
- tt-oido-mtrkrk1-weekday-up (svc-sudogwon-suinbundang)
- tt-oido-mtrkrk1-holiday-down (svc-sudogwon-suinbundang)
- tt-oido-mtrkrk1-holiday-up (svc-sudogwon-suinbundang)
- tt-cheongnyangni-mtrkrk2-weekday-down (svc-sudogwon-gyeongchun)
- tt-cheongnyangni-mtrkrk2-weekday-up (svc-sudogwon-gyeongchun)
- tt-cheongnyangni-mtrkrk2-holiday-down (svc-sudogwon-gyeongchun)
- tt-cheongnyangni-mtrkrk2-holiday-up (svc-sudogwon-gyeongchun)
- tt-hoegi-mtrkrk2-weekday-down (svc-sudogwon-gyeongchun)
- tt-hoegi-mtrkrk2-weekday-up (svc-sudogwon-gyeongchun)
- … 외 50건(JSON 참고)

### 용어 사전 절 머리 본문 → 절 이름 항목으로 적재 (2)

- 3. 사업 단계 (구상에서 개통까지)
- 7. 기관

### 정차 패턴 정차역 노선 모호(정차역 제외) (2)

- svc-sudogwon-gyeongchun/local: stn-cheongnyangni 후보 line-gyeongwon, line-jungang
- svc-sudogwon-gyeongchun/cheongryangri-chuncheon: stn-cheongnyangni 후보 line-gyeongwon, line-jungang

### 정차 패턴 정차역 노선별 역 미해석(정차역 제외) (90)

- svc-ktx-gangneung/ktx-gangneung-all: stn-haengsin
- svc-ktx-gangneung/ktx-gangneung-all: stn-jeongdongjin
- svc-ktx-gangneung/ktx-gangneung-all: stn-mukho
- svc-ktx-gangneung/ktx-gangneung-all: stn-donghae
- svc-ktx-gyeongbu/ktx-gyeongbu-all: stn-haengsin
- svc-ktx-gyeongbu/ktx-gyeongbu-all: stn-pohang
- svc-ktx-gyeongjeon/ktx-gyeongjeon-all: stn-haengsin
- svc-ktx-gyeongjeon/ktx-gyeongjeon-all: stn-jinyeong
- svc-ktx-gyeongjeon/ktx-gyeongjeon-all: stn-changwonjungang
- svc-ktx-gyeongjeon/ktx-gyeongjeon-all: stn-changwon
- svc-ktx-gyeongjeon/ktx-gyeongjeon-all: stn-masan-gyeongnam
- svc-ktx-gyeongjeon/ktx-gyeongjeon-all: stn-jinju
- svc-ktx-honam/ktx-honam-all: stn-haengsin
- svc-ktx-honam/ktx-honam-all: stn-seodaejeon
- svc-ktx-honam/ktx-honam-all: stn-gyeryong
- svc-ktx-honam/ktx-honam-all: stn-nonsan
- svc-ktx-honam/ktx-honam-all: stn-gimje
- svc-ktx-honam/ktx-honam-all: stn-jangseong
- svc-ktx-honam/ktx-honam-all: stn-naju
- svc-ktx-honam/ktx-honam-all: stn-mokpo
- svc-ktx-jeolla/ktx-jeolla-all: stn-haengsin
- svc-ktx-jeolla/ktx-jeolla-all: stn-seodaejeon
- svc-ktx-jeolla/ktx-jeolla-all: stn-gyeryong
- svc-ktx-jeolla/ktx-jeolla-all: stn-nonsan
- svc-ktx-jeolla/ktx-jeolla-all: stn-jeonju
- svc-ktx-jeolla/ktx-jeolla-all: stn-namwon
- svc-ktx-jeolla/ktx-jeolla-all: stn-gokseong
- svc-ktx-jeolla/ktx-jeolla-all: stn-guryegu
- svc-ktx-jeolla/ktx-jeolla-all: stn-suncheon
- svc-ktx-jeolla/ktx-jeolla-all: stn-yeocheon
- svc-ktx-jeolla/ktx-jeolla-all: stn-yeosu-expo
- svc-ktx-jungang/ktx-jungang-all: stn-seoul
- svc-ktx-suseo-gyeongbu/ktx-suseo-gyeongbu-main: stn-seodaegu
- svc-ktx-suseo-gyeongbu/ktx-suseo-gyeongbu-main: stn-gyeongsan
- svc-ktx-suseo-gyeongbu/ktx-suseo-gyeongbu-main: stn-miryang
- svc-ktx-suseo-gyeongbu/ktx-suseo-gyeongbu-main: stn-mulgeum
- svc-ktx-suseo-gyeongbu/ktx-suseo-gyeongbu-main: stn-gupo
- svc-ktx-suseo-honam/ktx-suseo-honam-main: stn-naju
- svc-ktx-suseo-honam/ktx-suseo-honam-main: stn-mokpo
- svc-ktx-suseo-jeolla/ktx-suseo-jeolla-main: stn-jeonju
- … 외 50건(JSON 참고)

### 퍼지 날짜 "일·월 00" 정밀도 보정 (28)

- event evt-stage-changed-donghae-2000-03-00.date: 2000-03-00 → 2000-03(month)
- event evt-other-jinhae-2000-09-00.date: 2000-09-00 → 2000-09(month)
- event evt-other-gaya-2001-00-00.date: 2001-00-00 → 2001(year)
- event evt-other-gyeongbu-2001-00-00.date: 2001-00-00 → 2001(year)
- event evt-other-daegu-2001-09-00.date: 2001-09-00 → 2001-09(month)
- event evt-other-gyeongbu-2001-12-00.date: 2001-12-00 → 2001-12(month)
- event evt-other-honam-2001-12-00.date: 2001-12-00 → 2001-12(month)
- event evt-other-gyeongbu-2002-00-00.date: 2002-00-00 → 2002(year)
- event evt-other-bundang-2002-07-00.date: 2002-07-00 → 2002-07(month)
- event evt-other-donghae-2002-08-00.date: 2002-08-00 → 2002-08(month)
- event evt-other-gyeongbu-2003-02-00.date: 2003-02-00 → 2003-02(month)
- event evt-other-gyeongbu-2003-08-00.date: 2003-08-00 → 2003-08(month)
- event evt-other-donghae-2003-12-00.date: 2003-12-00 → 2003-12(month)
- event evt-other-honam-2003-12-00.date: 2003-12-00 → 2003-12(month)
- event evt-other-gyeongjeon-2004-00-00.date: 2004-00-00 → 2004(year)
- event evt-other-everline-2004-04-00.date: 2004-04-00 → 2004-04(month)
- event evt-other-donghae-2004-06-00.date: 2004-06-00 → 2004-06(month)
- event evt-other-yeongdong-2004-07-00.date: 2004-07-00 → 2004-07(month)
- event evt-other-gyeongui-2004-12-00.date: 2004-12-00 → 2004-12(month)
- event evt-other-gyeongbu-2005-00-00.date: 2005-00-00 → 2005(year)
- event evt-other-gyeongbu-2005-01-00.date: 2005-01-00 → 2005-01(month)
- event evt-other-bundang-2006-00-00.date: 2006-00-00 → 2006(year)
- event evt-other-jungang-2006-00-00.date: 2006-00-00 → 2006(year)
- event evt-other-yeongdong-2007-00-00.date: 2007-00-00 → 2007(year)
- event evt-other-donghae-2007-05-00.date: 2007-05-00 → 2007-05(month)
- event evt-other-gyeongui-2007-05-00.date: 2007-05-00 → 2007-05(month)
- event evt-other-gyeongui-2008-00-00.date: 2008-00-00 → 2008(year)
- event evt-stage-changed-daegu-3-2009-05-00.date: 2009-05-00 → 2009-05(month)

## 9. 이관 통계

- license_class.kogl_1: 71
- license_class.kogl_3: 3
- license_class.kogl_4: 2
- license_class.open: 20
- license_class.public_work: 61
- license_class.restricted: 354
- license_class.unknown: 114
- 계획 노선 역할.new: 23
- 계획 노선 역할.upgrades: 165
- 계획 선형.출처 없음 → src-manual-curation: 21
- 계획 역 역할.existing: 190
- 계획 역 역할.new: 159
- 기대 일정.official: 69
- 노선 parent_line_id(기존 데이터에 없음 → 연장 extends 판정 0): 0
- 노선 문맥 코드.노선별 역으로.kric_station_std: 1082
- 노선 문맥 코드.노선별 역으로.molit_metro_lines: 772
- 노선 문맥 코드.노선별 역으로.tago_subway: 1084
- 노선별 역.상태가 역 상태와 다름(배분): 32
- 단계 이력.gazette_auto: 70
- 번호대.operator other → id 접두사로 운영기관: 16
- 시간표.노선별 역 해석(TAGO): 2836
- 역.노선 없음(own_*): 71
- 역.다중 노선: 205
- 용어.정의 글머리 없음(본문 전체를 정의로): 15
- 이벤트.파생(저장 안 함, D-3): 1135
- 정차 패턴.뺀 정차역(extra.dropped_stops): 92
- 정차 패턴.일부 정차역 제외: 31
- 정차역.앞뒤 역 노선으로 해석: 87

## 10. 이 리포트에 없는 항목

- 파일 sha256·원본 재다운로드(WP 3.7·3.8) — 문서 저장소 적재 단계에서.
- osm 스키마·ingest 설정 이관 — 이후 WP.
