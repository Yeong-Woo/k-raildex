# 데이터 반영 파이프라인 — 변경 묶음(changeset)

- 작성: 2026-10-14 (round-5 답변 반영 중 사용자 요청: "새 노선이 추가될 때마다 소스 코드를 고치지 않고, 자동화된 과정을 거쳐 API 로 데이터를 넣으면 반영되게")
- 갱신: 2026-10-14 **D 단계** — 원천이 DB(own_record)로 바뀌었다. 변경 묶음은 API(`POST /changesets`) → 승인 → worker 가 DB 에 반영한다. 파일 직접 반영 도구(apply-changeset.ts)는 없앴다.
- 관련: `packages/schema/changeset.schema.json`, `packages/db/src/changeset.ts`(DB 적용)·`worker.ts`(반영 job)·`cs-cli.ts`(`pnpm data:apply`·`cs:submit`), `apps/api` changesets, `apps/admin`(관리 앱), `data/changesets/`(inbox = 제출 대기 파일, applied = 백업 기록), 구조는 [platform-architecture.md](platform-architecture.md) 4-2절

## 1. 원칙

1. **사이트·빌드 코드는 데이터를 모른다.** 새 노선·역·계획·운행 계통·출처를 넣을 때 `apps/web/src/`·`packages/pipeline/src/` 를 고치지 않는다. 바뀌는 것은 원천 데이터(DB own_record = data/own 형태)뿐이다(CLAUDE.md "데이터 값을 코드에 하드코딩하지 않는다").
2. **원천을 바꾸는 단일 경로는 변경 묶음이다(D 단계부터 예외 없음).** 조사 결과(사람·에이전트·수집 스크립트)는 변경 묶음 하나로 만들어 API 에 제출하고, 관리 앱 또는 CLI 로 승인하면 worker 가 반영한다. **data/own 파일을 손으로 고치지 않는다** — data/ 는 DB 의 백업이라 다음 내보내기에 덮인다.
3. **반영은 원자적이다.** worker 가 한 트랜잭션에서 own_record 변경 → 작업 공간 빌드(`data:build`·`data:validate`·`data:build-map`) → 개체 테이블·산출물 적재를 하고, 어디서든 실패하면 전부 되돌린다(changeset = failed, 원천 그대로).
4. **기록이 남는다.** changeset 테이블에 본문·항목별 전/후(diff)·로그·승인자·시각이 남고, 백업 `data/changesets/applied/<id>.yaml` 로도 내보낸다. git 이력과 함께 감사 기록이 된다.
5. **사실 규칙은 그대로다.** 묶음 안의 개체도 출처·확인일·`review_status` 규칙(data-conventions.md)을 따른다. 변경 묶음은 형식일 뿐 검수를 대신하지 않는다.

## 2. 흐름

```
조사(사람·에이전트·수집기) ─▶ 변경 묶음(YAML/JSON, changeset.schema.json)
   ├ CLI:  data/changesets/inbox/*.yaml → pnpm data:apply (제출+승인+결과 대기, 성공하면 inbox 에서 지움)
   │       pnpm cs:submit [--dry-run|--approve] <파일…> (제출만 = draft, 관리 앱에서 검토)
   └ 관리 앱(apps/admin): 붙여넣기 제출 · 대기열 · 미리 보기(diff) · 승인/반려
                                   │ POST /changesets (형식 검증, draft) → POST /changesets/:id/approve (= 바로 반영, Q143 B)
                                   ▼
        job(apply) ─ worker: BEGIN → 첨부(raw 원문 텍스트·manifest) 쓰기 → own_record upsert/merge/delete(원문 조각 단위, 주석·서식 유지)
                    → 작업 공간에 data/own 내보내기 → build·validate·build-map → 개체 테이블·build_artifact 적재 → COMMIT
                                   │ 실패: ROLLBACK·첨부 되돌림, changeset failed(error·log) / 성공: applied
                                   ▼
        백업 내보내기: data/own·data/build·data/changesets/applied (운영자가 git 커밋) → 사이트(SSR)는 다음 요청부터 새 데이터
```

`draft` 는 반영하지 않는다. 같은 id 는 draft·failed·rejected 일 때만 다시 낼 수 있다(반영된 id 는 409). 원본 파일(raw·osm)만 바뀐 기계적 갱신은 `pnpm db:rebuild`(job rebuild, Q147 B).

## 3. 형식

```yaml
id: cs-2026-10-14-freight-facility-lines   # cs-YYYY-MM-DD-<슬러그>
title: 여객 미취급 노선 분류(Q130)·기지선·연결선 분리(Q115)
created_at: "2026-10-14"
author: claude            # operator | claude | api:<client> — 사람 이름 대신 역할
rationale: 왜 바꾸는가(결정 질문 번호·조사 요약)
review: approved          # draft 면 반영 안 함
attachments:              # 선택: 관보 원문 텍스트 등
  - { path: src-kric-gazette/texts/molit-2018-181-….txt, from: /tmp/…/x.txt, pages: "1-2", manifest: { title: …, pdf_sha256: … } }
changes:
  - op: upsert            # 같은 키가 있으면 통째로 교체, 없으면 추가(after: <키> 로 위치)
    kind: station
    data: { id: stn-…, name: { ko: … }, status: under_construction, region: …, provenance: { … } }
  - op: merge             # 필드 병합. 배열은 { $add: [...] } / { $remove: [...] }, null 은 필드 삭제
    kind: plan
    id: plan-…
    data: { station_ids: { $add: [stn-…] } }
  - op: delete
    kind: line_station_insert
    id: "line-gtx-a|stn-samseong"
```

| kind | 대상 파일 | 키 |
|---|---|---|
| source | data/own/sources.yaml | id |
| station | data/own/stations-manual.yaml | id |
| line | data/own/lines-manual.yaml | id |
| line_station_insert | data/own/overrides/line-station-inserts.yaml | `line_id\|station_id` |
| plan | data/own/plans/*.yaml(있는 파일을 찾음, 새 사업은 `file:` 지정) | id |
| event | data/own/events-manual.yaml | id |
| service | data/own/services.yaml | id |
| osm_line_map | data/own/overrides/osm-line-map.yaml | line_id |
| station_merge | data/own/overrides/station-merges.yaml | merge(또는 no_merge)의 첫 키 |
| kilo_line | data/own/overrides/korail-kilo-lines.yaml | code |
| station_region | data/own/overrides/station-regions.yaml | id |
| station_coord | data/own/overrides/station-coords.yaml(lat/lng · same_as · geocode+basis parcel·district·township) | id(또는 key) |
| plan_program | data/own/plan-programs.yaml | id |
| train_number_range | data/own/train-number-ranges.yaml | id |
| molit_line_no | data/own/overrides/molit-line-numbers.yaml(사업용철도 노선번호 → 노선 codes.molit_line_no, round-7 Q156) | line_id |
| line_override | data/own/overrides/line-names.yaml(자동 생성 노선의 이름·영문명·색·법적 분류 덮어쓰기, round-8) | key |
| train_class · rolling_stock_number_range · transfer_center · route_map | train-classes · rolling-stock-numbers · transfer-centers · route-maps(.yaml) | id |
| plan_route | data/own/geometry/plan-routes.yaml(계획 노선 개략 선형) | plan_id |
| line_order · station_name · tago_route_service | overrides/line-order · station-names · tago-route-services(.yaml) | line_id · key · route_id |
| kric_codes · kric_train_ops_routes · station_kinds | overrides/kric-codes · kric-train-ops-routes · station-kinds(.yaml) — **dict 파일**: 최상위 키 하나가 한 항목, `id` 로 그 키를 준다 | 최상위 키 |

D 단계(2026-10-14)부터 data/own 의 **모든 파일**이 kind 하나에 대응한다(27종). 파일 경로는 DB 원천을 내보낼 때의 위치이자 백업 위치다.

새 파일·kind 는 스키마 enum 과 `packages/db/src/own.ts` FILES(파일 ↔ kind ↔ 키)에 한 줄씩 더하면 된다 — 사이트 코드는 바뀌지 않는다.

## 4. 직렬화 규칙(자동 처리)

- 원천은 항목마다 **원문 YAML 조각**(앞 주석·뒤 빈 줄 포함)과 값(JSON)을 함께 저장한다. 바뀌지 않은 항목은 원문 그대로 내보내므로 백업 data/own 은 바이트 단위로 같다(`pnpm db:own-roundtrip` 이 확인).
- merge 는 **바뀌는 최상위 필드의 원문 범위만** 새로 쓰고 나머지(필드 순서·흐름 스타일 `{…}`·`[…]`·주석)는 그대로 둔다. 새 필드는 항목 끝에 붙는다. upsert(통째로 바꾸기)는 항목을 새로 직렬화하되 앞 주석·뒤 빈 줄은 유지한다.
- 날짜처럼 보이는 문자열(`2026`, `2026-10`, `2026-10-14`)은 큰따옴표로 쓴다(YAML 파서가 Date 로 읽지 않게, data-conventions).
- 배열 필드는 `{$add:[…]}`·`{$remove:[…]}` 또는 배열 전체로만 바꾼다(객체 patch 는 오류).

## 5. 예: 공사 중 노선 하나 추가

1. 관보 기본계획·실시계획 고시를 받아 정거장 표를 읽는다(조사 방법은 docs/research/ 와 round-5 기록).
2. 변경 묶음 하나에: `source`(새 보도 출처), `station` × N(공사 중 정거장), `line`(공사 구간 수기 노선), 필요하면 `line_station_insert`(기존 노선 중간역), `plan` merge(line_ids·station_ids `$add`), `osm_line_map`(OSM 공사중 선형 이름), `attachments`(고시 원문 텍스트).
3. `pnpm cs:submit --dry-run <파일>`(미리 보기 diff) 또는 관리 앱에서 확인 → `pnpm data:apply`(inbox) 또는 관리 앱 [승인].
4. 사이트(SSR)는 다시 빌드하지 않아도 다음 요청부터 새 노선·역 페이지·지도·개통 예정 목록을 보여 준다(데이터 판 확인, 최대 5초).

## 6. 개통 때 병합 (round-6 Q151 B)

공사 중 신설 정거장 중 같은 이름의 기존 역과 따로 둔 것(round-5 Q140 C)은 `merge_into: <기존 역 id>` 를 가진다(52곳). **노선(또는 그 정거장)을 개통으로 바꾸는 변경 묶음 하나에 병합까지 넣는다.** `merge_into` 가 남은 채 `status: operating` 이 되면 `data:validate` 가 실패하므로 반쪽 반영은 들어가지 않는다.

한 묶음에 들어갈 변경(정거장 X → 기존 역 Y):
1. `line` merge — 노선 `status: operating`, `opened_at`, 그리고 `stations` 안의 X 를 Y 로 바꾼 배열 전체(배열은 통째로 덮어쓴다).
2. `line_station_insert` — X 를 가리키는 끼워 넣기가 있으면 delete 후 Y 로 upsert.
3. `plan` merge — `station_ids: { $remove: [X], $add: [Y] }`.
4. `station_coord` delete(X 의 근사 좌표), `station` delete(X). Y 의 별칭에 고시 명칭을 더할 필요가 있으면 `station` merge(Y) `aliases: { $add: [...] }`.
5. `event` — 개통 이벤트(연표).

장래 수집기 opening-watch(platform-architecture.md 3-4)가 이 묶음을 draft 로 만든다. 그 전까지는 사람·에이전트가 만든다.

## 7. 반영 기록 (2026-10-14)

- `cs-2026-10-14-construction-station-names-split` — round-5 Q138 C(번호 정거장 이름 "번호 (위치)")·Q140 C(공사 중 신설 정거장 51곳을 기존 역과 분리) 135건
- `cs-2026-10-14-freight-facility-lines` — Q130(여객 미취급 화물 지선 9개, `passenger_service: false`)·Q115(병점기지선·시흥연결선 분리, `line_role`)
- `cs-2026-10-14-line1-facility-lines` — 1호선 운행 계통에 두 시설 노선 연결
- `cs-2026-10-14-station-regions`·`honam-hsr-phase2-target`·`incheon-metro-plans`·`gunwi-region` — round-5 조사 반영(Q134·Q101·Q99·Q135)
- `cs-2026-10-14-construction-station-coords`(+ `-fix`, `seongpo-coord`) — 공사 중 정거장 근사 좌표 127곳(지도 표시)
- `cs-2026-10-14-geomdan-wide-area-improvement` — 상위 계획 "검단신도시 광역교통개선대책"(Q152 B)
- `cs-2026-10-14-construction-station-merge-into` — 분리 정거장 52곳에 `merge_into`(Q151 B)
- `cs-2026-10-14-freight-line-official-names` — 화물 지선 9개 공식 노선명·기점(국토교통부 고시 10건, Q150 B)
- `cs-2026-10-14-osm-construction-line-map` — 공사 중 노선 5개 OSM 선형 매핑(round-7 Q154, 근사 좌표 역을 선형 위로 표시)
- `cs-2026-10-14-molit-line-numbers` — 사업용철도 노선번호(제2019-173호 + 개정 고시) 노선 52개, 출처 12건(Q156 C)
- `cs-2026-10-14-construction-station-parcels`(+ `yangyang-parcel`) — 공사 중 정거장 고시 지번 19곳·읍·면 대표점 6곳(Q154·Q155 C)
- `cs-2026-10-14-jinjeop-conventional` — 진접선 법적 분류 일반철도(Q157 B, kind `line_override` 신설) / `cs-2026-10-14-donghae-two-numbers` — 동해선 한 노선 + 번호 206·311(Q158 A)
