# 공개 API ↔ 기존 사이트 데이터 대조 (2026-11-21)

> `pnpm -F @k-raildex/api public:compare` 가 만든 파일(손으로 고치지 말 것). 데이터 판 11, 기존 빌드 `../future-rail-db/data/build`, 15.9초.
> 새 값 = 공개 API 읽기 모델(packages/domain/src/public), 기존 값 = 기존 사이트 빌드 산출물(data/build/*.json).

## 1. 건수

| 대상 | 기존 | 새 | 차이 |
| --- | ---: | ---: | ---: |
| 노선 | 103 | 103 | 0 |
| 노선별 역 | 1738 | 1738 | 0 |
| 역(시설 포함) | 1548 | 1548 | 0 |
| 계획 | 259 | 259 | 0 |
| 연표 항목 | 2124 | 2124 | 0 |

연표: 기존에만 0건, 새 쪽에만 0건.

## 2. 필드별 요약

| 필드 | 비교 | 차이 | 일치율 |
| --- | ---: | ---: | ---: |
| line.name_ko | 103 | 0 | 100.0% |
| line.status | 103 | 0 | 100.0% |
| line.category | 103 | 0 | 100.0% |
| line.rail_class | 103 | 0 | 100.0% |
| line.is_wide_area | 103 | 0 | 100.0% |
| line.opened | 103 | 0 | 100.0% |
| line.closed | 103 | 0 | 100.0% |
| line.areas | 103 | 0 | 100.0% |
| line.color | 103 | 0 | 100.0% |
| line.length_km | 103 | 0 | 100.0% |
| line.start_station | 103 | 0 | 100.0% |
| line.end_station | 103 | 0 | 100.0% |
| line.station_order | 103 | 0 | 100.0% |
| line.station_count | 103 | 0 | 100.0% |
| line.station_codes | 103 | 0 | 100.0% |
| station.name_ko | 1548 | 0 | 100.0% |
| station.kind | 1548 | 0 | 100.0% |
| station.status | 1548 | 0 | 100.0% |
| station.opened | 1548 | 0 | 100.0% |
| station.closed | 1548 | 0 | 100.0% |
| station.line_ids | 1548 | 0 | 100.0% |
| station.areas | 1548 | 0 | 100.0% |
| station.line_classes | 1548 | 0 | 100.0% |
| station.service_kinds | 1548 | 27 | 98.3% |
| station.has_coord | 1548 | 0 | 100.0% |
| plan.name_ko | 259 | 0 | 100.0% |
| plan.stage | 259 | 0 | 100.0% |
| plan.target_open | 259 | 0 | 100.0% |
| plan.areas | 259 | 0 | 100.0% |
| plan.line_ids | 259 | 0 | 100.0% |
| plan.station_ids | 259 | 0 | 100.0% |
| plan.programs | 259 | 0 | 100.0% |
| plan.stage_history_count | 259 | 0 | 100.0% |

## 3. 차이 상세(필드마다 최대 40건)

### station.service_kinds — 27건

해설: 정차 계통 = 정차 패턴의 노선별 역, 패턴이 없으면 소속 노선 모든 역(v_station_service). 기존은 정차 패턴의 역 id 로 계산해 운행 계통 노선에 없는 역도 정차로 셌다. 새 정차 패턴은 노선별 역을 가리키므로, 운행 계통 노선(service_line)에 그 역의 노선별 역이 없으면 이관 때 정차역에서 뺐다(extra.dropped_stops, reason not_on_service_lines — Soft 목록 X-service-dropped-stops 로 관리 앱에서 보정 대상). 운행 계통 노선을 보태거나 정차역을 다시 넣으면 사라지는 차이(데이터 보정 과제, 코드 차이 아님).

원인 표시: 27/27건

| id | 기존 | 새 | 원인 |
| --- | --- | --- | --- |
| `stn-changwon` | high_speed, intercity | intercity | 이관 때 뺀 정차역: svc-ktx-gyeongjeon(high_speed, not_on_service_lines), svc-ktx-suseo-gyeongjeon(high_speed, not_on_service_lines), svc-srt-gyeongjeon(high_speed, not… |
| `stn-changwonjungang` | high_speed, intercity, tourist | intercity, tourist | 이관 때 뺀 정차역: svc-ktx-gyeongjeon(high_speed, not_on_service_lines), svc-ktx-suseo-gyeongjeon(high_speed, not_on_service_lines), svc-srt-gyeongjeon(high_speed, not… |
| `stn-donghae` | high_speed, intercity, tourist | intercity, tourist | 이관 때 뺀 정차역: svc-ktx-gangneung(high_speed, not_on_service_lines) |
| `stn-gimje` | high_speed, intercity | intercity | 이관 때 뺀 정차역: svc-ktx-honam(high_speed, not_on_service_lines) |
| `stn-gokseong` | high_speed, intercity, tourist | intercity, tourist | 이관 때 뺀 정차역: svc-ktx-jeolla(high_speed, not_on_service_lines), svc-ktx-suseo-jeolla(high_speed, not_on_service_lines), svc-srt-jeolla(high_speed, not_on_service_… |
| `stn-guryegu` | high_speed, intercity, tourist | intercity, tourist | 이관 때 뺀 정차역: svc-ktx-jeolla(high_speed, not_on_service_lines), svc-ktx-suseo-jeolla(high_speed, not_on_service_lines), svc-srt-jeolla(high_speed, not_on_service_… |
| `stn-gyeryong` | high_speed, intercity | intercity | 이관 때 뺀 정차역: svc-ktx-honam(high_speed, not_on_service_lines), svc-ktx-jeolla(high_speed, not_on_service_lines) |
| `stn-haengsin` | high_speed, wide_area | wide_area | 이관 때 뺀 정차역: svc-ktx-gangneung(high_speed, not_on_service_lines), svc-ktx-gyeongbu(high_speed, not_on_service_lines), svc-ktx-gyeongjeon(high_speed, not_on_servi… |
| `stn-incheon-int-l-airport-terminal-1` | metro, wide_area | wide_area | 이관 때 뺀 정차역: svc-sudogwon-jagibusang(metro, not_on_service_lines) |
| `stn-jangseong` | high_speed, intercity | intercity | 이관 때 뺀 정차역: svc-ktx-honam(high_speed, not_on_service_lines) |
| `stn-jeongdongjin` | high_speed, intercity, tourist | intercity, tourist | 이관 때 뺀 정차역: svc-ktx-gangneung(high_speed, not_on_service_lines) |
| `stn-jeonju` | high_speed, intercity, tourist | intercity, tourist | 이관 때 뺀 정차역: svc-ktx-jeolla(high_speed, not_on_service_lines), svc-ktx-suseo-jeolla(high_speed, not_on_service_lines), svc-srt-jeolla(high_speed, not_on_service_… |
| `stn-jinju` | high_speed, intercity, tourist | intercity, tourist | 이관 때 뺀 정차역: svc-ktx-gyeongjeon(high_speed, not_on_service_lines), svc-ktx-suseo-gyeongjeon(high_speed, not_on_service_lines), svc-srt-gyeongjeon(high_speed, not… |
| `stn-jinyeong` | high_speed, intercity | intercity | 이관 때 뺀 정차역: svc-ktx-gyeongjeon(high_speed, not_on_service_lines), svc-ktx-suseo-gyeongjeon(high_speed, not_on_service_lines), svc-srt-gyeongjeon(high_speed, not… |
| `stn-masan-gyeongnam` | high_speed, intercity, tourist | intercity, tourist | 이관 때 뺀 정차역: svc-ktx-gyeongjeon(high_speed, not_on_service_lines), svc-ktx-suseo-gyeongjeon(high_speed, not_on_service_lines), svc-srt-gyeongjeon(high_speed, not… |
| `stn-mokpo` | high_speed, intercity, tourist | intercity, tourist | 이관 때 뺀 정차역: svc-ktx-honam(high_speed, not_on_service_lines), svc-ktx-suseo-honam(high_speed, not_on_service_lines), svc-srt-honam(high_speed, not_on_service_lin… |
| `stn-mukho` | high_speed, intercity, tourist | intercity, tourist | 이관 때 뺀 정차역: svc-ktx-gangneung(high_speed, not_on_service_lines) |
| `stn-naju` | high_speed, intercity | intercity | 이관 때 뺀 정차역: svc-ktx-honam(high_speed, not_on_service_lines), svc-ktx-suseo-honam(high_speed, not_on_service_lines), svc-srt-honam(high_speed, not_on_service_lin… |
| `stn-namwon` | high_speed, intercity, tourist | intercity, tourist | 이관 때 뺀 정차역: svc-ktx-jeolla(high_speed, not_on_service_lines), svc-ktx-suseo-jeolla(high_speed, not_on_service_lines), svc-srt-jeolla(high_speed, not_on_service_… |
| `stn-nonsan` | high_speed, intercity | intercity | 이관 때 뺀 정차역: svc-ktx-honam(high_speed, not_on_service_lines), svc-ktx-jeolla(high_speed, not_on_service_lines) |
| `stn-pangyo` | high_speed, intercity, wide_area | high_speed, wide_area | 이관 때 뺀 정차역: svc-mugunghwa-janghang(intercity, not_on_service_lines) |
| `stn-pohang` | high_speed, intercity | intercity | 이관 때 뺀 정차역: svc-ktx-gyeongbu(high_speed, not_on_service_lines), svc-ktx-suseo-donghae(high_speed, not_on_service_lines), svc-srt-donghae(high_speed, not_on_serv… |
| `stn-seodaejeon` | high_speed, intercity, tourist | intercity, tourist | 이관 때 뺀 정차역: svc-itx-maum-chungbuk(intercity, not_on_service_lines), svc-ktx-honam(high_speed, not_on_service_lines), svc-ktx-jeolla(high_speed, not_on_service_l… |
| `stn-sinchon-seodaemun` | metro, wide_area | wide_area | 이관 때 뺀 정차역: svc-sudogwon-2(metro, not_on_service_lines) |
| `stn-suncheon` | high_speed, intercity, tourist | intercity, tourist | 이관 때 뺀 정차역: svc-ktx-jeolla(high_speed, not_on_service_lines), svc-ktx-suseo-jeolla(high_speed, not_on_service_lines), svc-mugunghwa-gyeongjeon(intercity, not_on… |
| `stn-yeocheon` | high_speed, intercity, tourist | intercity, tourist | 이관 때 뺀 정차역: svc-ktx-jeolla(high_speed, not_on_service_lines), svc-ktx-suseo-jeolla(high_speed, not_on_service_lines), svc-srt-jeolla(high_speed, not_on_service_… |
| `stn-yeosu-expo` | high_speed, intercity, tourist | intercity, tourist | 이관 때 뺀 정차역: svc-ktx-jeolla(high_speed, not_on_service_lines), svc-ktx-suseo-jeolla(high_speed, not_on_service_lines), svc-srt-jeolla(high_speed, not_on_service_… |
