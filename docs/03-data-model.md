# 03. 데이터 모델 — DB 스키마 전체

> 이 문서가 구현의 기준이다. Drizzle 스키마(`packages/db`)와 zod 계약(`packages/contracts`)은 이 문서와 일치해야 하며, 바꿀 때는 이 문서를 먼저 고친다.
> round-01·02 결정 반영(2026-11-20, [decisions.md](decisions.md)). 아직 열린 질문은 `(→ R-Qn)` 로 표시한다(review/round-03.md).

## 1. 설계 원칙

| ID        | 원칙                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-DM-001 | **정규화 관계형.** 조회·필터·관계에 쓰는 모든 값은 열 또는 관계 테이블로 둔다. `jsonb` 는 부가 정보(`extra`)·외부 원본 스냅샷·감사 전/후 값에만 쓴다. (Q15)                                                                                            |
| FR-DM-002 | **DB 가 무결성을 보장한다.** 참조는 FK, 값 범위는 CHECK, 유일성은 UNIQUE. 앱 검증은 DB 가 표현할 수 없는 규칙(8절)만.                                                                                                                                  |
| FR-DM-003 | **원천 데이터만 저장, 파생 값은 뷰.** 역의 권역·소속 노선·정차 계통 종류·상태·개통일(노선별 역에서 계산), 노선의 권역, 상속 검수 상태, 개체 필드에서 나오는 연표 이벤트, 계획 현재 단계·개통 목표, 시점별 지도는 뷰로 계산한다(6절). (Q26·Q27·Q28·Q71) |
| FR-DM-004 | **보정(override) 계층 없음.** 공공데이터에서 온 값도 이관 후에는 개체 행의 값이다. 외부 데이터셋과의 대응은 `external_ref` 로만. (Q20·Q21)                                                                                                             |
| FR-DM-005 | **모든 큐레이션 개체는 출처 ≥ 1, `checked_at` 필수**(C-1).                                                                                                                                                                                             |
| FR-DM-006 | **전역 ID 레지스트리** `entity` 로 개체 간 다형 참조(출처 연결, 별칭, 외부 코드, 첨부, 이벤트 대상, 감사)에도 FK 를 건다. 삭제된 id 도 레지스트리에 남아 **영구 예약**된다.                                                                            |
| FR-DM-007 | 모든 쓰기 가능한 개체 테이블은 `version`(낙관적 잠금)·생성·수정·**소프트 삭제** 메타를 가진다. (Q37·Q38·Q74)                                                                                                                                           |
| FR-DM-008 | OSM(ODbL) 데이터는 스키마 `osm` 에만 둔다. `public` 스키마의 자체 데이터 테이블은 `osm` 을 FK 로 참조하지 않는다(매핑 표는 OSM id 숫자만 보관)(C-6, Q31).                                                                                              |
| FR-DM-009 | **역은 2단계**: `station` = 역(환승역이면 환승 그룹, 아니어도 반드시 존재, 공개 역 페이지 단위) / `line_station` = 노선별 역(노선마다의 이름·운영기관·상태·개통일·역번호·외부 코드). (Q25 B → Q70~Q72)                                                 |

## 2. 공통 규약

### 2-1. 식별자 (Q16 C → Q69 A)

- 개체 PK 는 `id text`. 형식 `<접두사>-<슬러그>`(소문자·숫자·하이픈). 기존 ID 승계(C-9) — 단 아래 두 종류만 바꾸고 `id_redirect` 에 남긴다.

| 개체       | 접두사  | 예 / 비고                                                                                                                   |
| ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| 출처       | `src-`  | `src-molit-nrp4-notice`                                                                                                     |
| 운영기관   | `op-`   | `op-korail` (신설)                                                                                                          |
| 역         | `stn-`  | `stn-seoul`                                                                                                                 |
| 노선별 역  | `ls-`   | `ls-gyeongbu--seoul` (`ls-<노선 id 꼬리>--<역 id 꼬리>`, 같은 노선에 같은 역이 두 번이면 `-2`). **내부 id — 공개 URL 없음** |
| 노선       | `line-` | `line-gyeongbu`                                                                                                             |
| 열차 등급  | `tc-`   | `tc-ktx`                                                                                                                    |
| 운행 계통  | `svc-`  | `svc-sudogwon-1`                                                                                                            |
| 상위 계획  | `pp-`   | **변경**: `national_rail_4` → `pp-national-rail-4`, `metro_seoul_2` → `pp-metro-seoul-2` (밑줄 → 하이픈 + 접두사)           |
| 계획 사업  | `plan-` | `plan-honam-hsr-gomagwon-imseongri`                                                                                         |
| 이벤트     | `evt-`  | `evt-opened-gtx-a-2024-03-30`                                                                                               |
| 열차번호대 | `tnr-`  |                                                                                                                             |
| 차량번호대 | `rsn-`  |                                                                                                                             |
| 환승센터   | `xc-`   | **변경**: `tc-daegok` → `xc-daegok` (열차 등급 `tc-` 와 구분. 실제 충돌은 0건이었음)                                        |
| 노선도     | `map-`  |                                                                                                                             |
| 용어       | `term-` |                                                                                                                             |

- 관계 테이블(정차 패턴 역, 계획 반영 내역 등)은 `id bigint generated always as identity` 대리키.
- ID 변경은 `id_redirect(old_id, new_id, changed_at, reason)` 에 남기고 공개 사이트는 경로·쿼리 값은 301, 앵커(`#national_rail_4`)는 페이지 스크립트로 새 앵커에 연결한다(06 문서 FR-WEB-004).

### 2-2. 전역 개체 레지스트리

```sql
CREATE TABLE entity (
  id          text PRIMARY KEY,
  type        text NOT NULL,          -- 5절 entity_type
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz              -- 소프트 삭제 시각(개체 테이블과 동기). 행은 지우지 않는다 = id 영구 예약
);
-- 각 개체 테이블: id text PRIMARY KEY REFERENCES entity(id) ...
-- 개체 행 INSERT 전에 entity 행을 같은 트랜잭션에서 만든다(도메인 적용기).
-- 트리거 entity_type_guard: entity.type 과 개체 테이블 일치.
```

### 2-3. 퍼지 날짜 (Q18 A)

`FUZZY(x)` 는 다음 네 열을 뜻한다.

```sql
x_value      text,   -- day: YYYY-MM-DD / month: YYYY-MM / half: YYYY-H1|H2 / year: YYYY / unknown: NULL
x_precision  text,   -- 'day'|'month'|'half'|'year'|'unknown'  (NULL = 값 자체가 없음)
x_from       date GENERATED ALWAYS AS (fuzzy_from(x_value, x_precision)) STORED,
x_to         date GENERATED ALWAYS AS (fuzzy_to(x_value, x_precision)) STORED
CHECK (fuzzy_valid(x_value, x_precision))
```

- `precision='unknown'` = 날짜가 있었으나 모름, 네 열 모두 NULL = 해당 없음. `FUZZY(x) NOT NULL` = `x_precision NOT NULL`.
- 정렬: `x_from` 오름차순, 같으면 정밀도 높은 것 먼저, unknown 은 맨 뒤.

> **DDL 약식 표기**: `FUZZY(x)` 는 위 네 열, `name_ko, name_en, …` 처럼 열 이름만 나열한 줄은 2-4절, `REC` 는 2-5절, `META` 는 2-6절의 열 묶음. 실제 마이그레이션은 Drizzle 공용 헬퍼(`fuzzy('x')`, `names()`, `rec()`, `meta()`)로 펼친다.

### 2-4. 이름

```sql
name_ko     text NOT NULL CHECK (name_ko <> ''),   -- 역은 "역" 접미사 없이
name_en     text,      -- 기관 공개 영문명만. 추정 로마자 금지
name_hanja  text,
name_full   text       -- 정식 명칭 병기(GTX-A → 수도권광역급행철도 A노선)
```

별칭·옛 이름·부역명·내부 표기는 `entity_name`(3-1절).

### 2-5. 큐레이션 메타 `REC`

```sql
checked_at       date NOT NULL,                 -- 출처와 마지막으로 대조한 날 (C-1)
provenance_note  text,                          -- 출처 메모(공개)
review_status    text NOT NULL DEFAULT 'unverified',  -- verified|unverified|flagged (Q35)
reviewed_at      timestamptz,
editor_note      text,                          -- 내부 메모(비공개). 기존 YAML 주석 이관처 (Q41)
extra            jsonb NOT NULL DEFAULT '{}',
META
```

출처 목록은 `record_source`(3-3절). "출처 ≥ 1" 은 지연 제약 트리거로 커밋 시점에 검사한다.

### 2-6. 쓰기 메타 `META` (모든 쓰기 가능 테이블)

```sql
version          integer NOT NULL DEFAULT 1,    -- 낙관적 잠금 (Q38)
created_at       timestamptz NOT NULL DEFAULT now(),
updated_at       timestamptz NOT NULL DEFAULT now(),
created_by       uuid REFERENCES app_user(id),  -- 관리자 / system / agent 서비스 계정
updated_by       uuid REFERENCES app_user(id),
last_changeset_id text REFERENCES changeset(id),
deleted_at       timestamptz,                   -- 소프트 삭제 (Q74)
deleted_by       uuid REFERENCES app_user(id),
delete_reason    text
```

### 2-7. 코드값 (Q19 A)

- DB 는 `text + CHECK (x IN (...))`. 값 목록·한국어 라벨·순서·설명의 단일 정의는 `packages/contracts/src/codes.ts`, CHECK 는 거기서 생성. 값 목록은 5절.

### 2-8. 좌표·선형

- 점 `geography(Point,4326)`(열 `geom`, 위도 33~39·경도 124~132 CHECK), 선 `geometry(MultiLineString,4326)`.

## 3. 공통 테이블

### 3-1. 별칭 `entity_name` (Q24 A)

```sql
CREATE TABLE entity_name (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id  text NOT NULL REFERENCES entity(id),
  name       text NOT NULL,
  kind       text NOT NULL,   -- alias|former|sub|internal|abbr|legal|source_raw
  lang       text NOT NULL DEFAULT 'ko',
  FUZZY(valid_from), FUZZY(valid_to),
  source_id  text REFERENCES source(id),
  note       text,
  ord        integer NOT NULL DEFAULT 0,
  UNIQUE (entity_id, name, kind)
);
CREATE INDEX ON entity_name USING gin (name gin_trgm_ops);
```

- `internal`: RAFIS 내부 표기("S동탄") — 검색만, 화면에 별칭으로 안 보임. `source_raw`: 데이터셋 원문 이름.
- 노선별 역(`ls-`)의 별칭도 여기에(노선별 표기 차이: "총신대입구(이수)").

### 3-2. 외부 코드 `external_ref` (Q21 A)

```sql
CREATE TABLE external_ref (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id  text NOT NULL REFERENCES entity(id),
  system     text NOT NULL REFERENCES ref_external_system(code),
  code       text NOT NULL,
  label      text,           -- 그 데이터셋의 원문 이름
  is_primary boolean NOT NULL DEFAULT false,
  source_id  text REFERENCES source(id),
  note       text,
  UNIQUE (system, code, entity_id)
);
CREATE TABLE ref_external_system (
  code text PRIMARY KEY, name_ko text NOT NULL, source_id text REFERENCES source(id),
  entity_type text NOT NULL,             -- station | line_station | line | ...
  multi_per_entity boolean NOT NULL DEFAULT true,
  multi_entity_per_code boolean NOT NULL DEFAULT false
);
```

- 노선 문맥이 있는 코드(TAGO 역 id `tago_subway`, 표준데이터 행 `kric_std`)는 **노선별 역**에 붙인다. 노선 문맥이 없는 코드(RAFIS 역, 역키로정 역명)는 역에.
- 병합 금지 지시(`no_merge`)는 `ingest.match_rule`(08 문서).

### 3-3. 출처 연결 `record_source` (Q17 A)

```sql
CREATE TABLE record_source (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id  text NOT NULL REFERENCES entity(id),
  source_id  text NOT NULL REFERENCES source(id),
  field      text,     -- NULL = 레코드 전체 / 'color','name_en','opened','rail_class','is_wide_area','status','name_ko' …
  locator    text,     -- 쪽·표·조항
  note       text,
  ord        integer NOT NULL DEFAULT 0,
  UNIQUE (entity_id, source_id, field)
);
```

- 노선별 역은 노선의 출처를 따른다. 노선과 다른 출처가 필요할 때만 노선별 역 id 로 행을 둔다.

### 3-4. 첨부 `entity_attachment` (Q47 B → Q77 A)

근거 원문 발췌·관련 링크·이미지(위치도·조감도·노선도)·문서를 **모든 개체**에 붙인다.

```sql
CREATE TABLE entity_attachment (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id   text NOT NULL REFERENCES entity(id),
  kind        text NOT NULL,       -- quote(원문 발췌) | link | image | document
  title       text,                -- 화면 제목·설명
  quote       text,                -- kind quote 본문
  url         text,                -- kind link 또는 원문 위치
  document_id uuid REFERENCES document(id),   -- image·document·quote 의 원문(쪽·잘라 낸 그림은 파생 문서)
  page        integer,             -- 원문 쪽
  source_id   text REFERENCES source(id),
  is_public   boolean NOT NULL DEFAULT false, -- 공개 사이트 노출. document 가 publishable 이 아니면 true 불가(트리거)
  origin      text NOT NULL DEFAULT 'manual', -- manual | agent
  ord         integer NOT NULL DEFAULT 0,
  META,
  CHECK (kind <> 'quote' OR quote IS NOT NULL),
  CHECK (kind <> 'link' OR url IS NOT NULL),
  CHECK (kind NOT IN ('image','document') OR document_id IS NOT NULL)
);
CREATE INDEX ON entity_attachment (entity_id, ord);
```

- `record_source` 는 "이 값의 근거가 어느 출처인가"(필수·짧음), 첨부는 "화면에 보여 줄 근거 자료"(선택·풍부)다.
- 에이전트가 PDF 에서 잘라 낸 도표·사진 = 파생 문서(4-3절) + 첨부(origin agent). 승인 전에는 변경 묶음 근거(`change_evidence`)에만 있고, 승인 때 첨부로 옮겨진다.

### 3-5. ID 리다이렉트

```sql
CREATE TABLE id_redirect (old_id text PRIMARY KEY, new_id text NOT NULL REFERENCES entity(id), changed_at timestamptz NOT NULL DEFAULT now(), reason text);
```

## 4. 개체 테이블

### 4-1. 참조 테이블 (Q33 A)

```sql
CREATE TABLE ref_area (code text PRIMARY KEY, name_ko text NOT NULL, name_en text, ord integer NOT NULL);
  -- capital, southeast, daegyeong, chungcheong, honam, gangwon, jeju, national
CREATE TABLE ref_region (
  code text PRIMARY KEY,           -- 행정표준코드 2자리
  name_ko text NOT NULL UNIQUE, short_ko text NOT NULL, slug text NOT NULL UNIQUE,
  area_code text NOT NULL REFERENCES ref_area(code), ord integer NOT NULL
);
```

### 4-2. 출처 `source`

```sql
CREATE TABLE source (
  id            text PRIMARY KEY REFERENCES entity(id),   -- src-...
  title         text NOT NULL,
  publisher     text NOT NULL,
  type          text NOT NULL,  -- dataset_file|dataset_api|notice|law|press_release|official_page|news|map_image|manual|wiki
  url           text,
  license       text NOT NULL,
  license_class text NOT NULL,  -- 원문 공개 판정용 (Q75): public_work(저작권법 제7조: 법령·고시·공고·관보) | kogl_1..kogl_4 | open(ODbL·CC 등) | restricted | unknown
  attribution   text,
  FUZZY(published), published_raw text,
  data_as_of    text,
  retrieved_at  date NOT NULL,
  refresh       text,           -- yearly|quarterly|monthly|on_event|once
  notice_number text,
  dataset_key   text,
  download      jsonb,
  note          text,
  REC
);
CREATE TABLE source_document (
  source_id text REFERENCES source(id),
  document_id uuid REFERENCES document(id),
  role text NOT NULL,              -- original|text_extract|snapshot|attachment
  PRIMARY KEY (source_id, document_id)
);
```

`source` 는 `record_source` 를 요구하지 않는다.

### 4-3. 원문 문서 `document` (Q39 A, Q75 A, Q76 A, Q77 A)

```sql
CREATE TABLE document (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key  text NOT NULL UNIQUE,    -- 오브젝트 키
  filename     text NOT NULL,
  mime         text NOT NULL,
  size_bytes   bigint NOT NULL,
  sha256       text NOT NULL,
  origin_url   text,
  retrieved_at timestamptz,
  kind         text NOT NULL,           -- original | text_extract | snapshot | page_image | figure_crop | upload
  parent_document_id uuid REFERENCES document(id),  -- 파생 문서의 원본 (text_extract·page_image·figure_crop)
  page         integer,                 -- 파생: 원본 쪽
  bbox         numeric[4],              -- 파생 figure_crop: 쪽 안의 영역(0~1 비율 x0,y0,x1,y1)
  license_class text NOT NULL,          -- 출처에서 상속(다르면 개별 지정)
  publishable  boolean NOT NULL DEFAULT false,  -- 공개 다운로드·이미지 노출 허용 (아래 규칙)
  text_content text,
  text_tsv     tsvector,
  pages        integer,
  meta         jsonb NOT NULL DEFAULT '{}',     -- manifest(title, published, viewer_url …), 추출 방법·모델
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES app_user(id),
  deleted_at   timestamptz
);
CREATE INDEX ON document (sha256);
```

- **공개 규칙(Q75 A)**: `license_class` 가 `public_work`·`kogl_1~4`·`open` 이면 `publishable` 을 켤 수 있다(kogl_4 는 변경 금지·비상업 문구 표시, 잘라 낸 그림(`figure_crop`)은 변경에 해당하므로 kogl_3·4 원본에서 나온 것은 공개 불가). `restricted`·`unknown` 은 관리 앱에서만 열람하고 공개 사이트에는 원문 링크만.
- 노선도 이미지·첨부 이미지도 `document`(kind upload/original).

### 4-4. 운영기관 `operator` (Q32 A — 공개 페이지 없음)

```sql
CREATE TABLE operator (
  id        text PRIMARY KEY REFERENCES entity(id),  -- op-korail …
  name_ko, name_en, name_full,
  short_ko  text,
  kind      text NOT NULL,     -- national_corp|local_corp|private|government|other
  status    text NOT NULL,     -- active|merged|dissolved
  merged_into_id text REFERENCES operator(id),
  FUZZY(founded), FUZZY(ended),
  homepage  text,
  REC
);
```

### 4-5. 역 `station` (역 = 환승 그룹, Q70 A·Q71 A)

```sql
CREATE TABLE station (
  id              text PRIMARY KEY REFERENCES entity(id),   -- stn-… (공개 역 페이지)
  name_ko, name_en, name_hanja, name_full,                  -- 대표 이름
  kind            text NOT NULL DEFAULT 'station',          -- station|signal_box|junction|yard|depot|freight
  region_code     text REFERENCES ref_region(code),
  region_basis    text,            -- address|interpolated|manual
  address         text,
  geom            geography(Point,4326),   -- 대표 좌표
  coord_source    text,            -- official|manual|derived (osm 금지, C-6)
  coord_basis     text,            -- parcel|district|township|existing_station
  coord_query     text,
  coord_same_as_id text REFERENCES station(id),
  coord_note      text,
  grade           text, history_text text, intro_text text,   -- 철도역 정보 원문
  merge_into_id   text REFERENCES station(id),   -- 공사 중 분리 정거장(환승 미확정) → 개통 때 병합할 역 (Q73 A)
  -- 단독 상태: 노선별 역이 하나도 없는 역(71곳: 폐역·시설 등)에서만 쓴다. 노선별 역이 있으면 NULL(V-H13)
  own_status      text,
  FUZZY(own_opened), FUZZY(own_closed),
  REC,
  CHECK ((geom IS NULL) = (coord_source IS NULL)),
  CHECK (coord_basis IS NULL OR coord_source = 'derived'),
  CHECK (merge_into_id <> id)
);
CREATE INDEX ON station USING gist (geom);
CREATE INDEX ON station USING gin (name_ko gin_trgm_ops);
```

- **모든 역은 station 행을 가진다**(환승역이 아니어도, Q71 답변). 환승역이면 여러 노선별 역을 묶는다.
- **그룹 기준(Q72 A)**: 공식 환승역(운영기관 안내·노선도의 환승 표시). 이름이 달라도 하나의 역, 노선별 표기는 노선별 역 이름·별칭으로 보존. 이름이 같아도 떨어진 역(신촌(2호선)·신촌(경의선))은 별개 역.
- 역의 **상태·개통일·폐지일은 뷰**(`v_station_status`): 노선별 역이 있으면 하나라도 operating → operating, 개통 = 가장 이른 노선별 개통, 폐지 = 모두 closed 일 때 가장 늦은 폐지. 없으면 `own_*`.
- 기존 `line_ids`·`line_classes`·`service_kinds`·`areas`·상속 review·`transfer_group` 은 저장하지 않는다(6절).

### 4-6. 노선별 역 `line_station` (Q70 A·Q71 A·Q22 A)

```sql
CREATE TABLE line_station (
  id              text PRIMARY KEY REFERENCES entity(id),   -- ls-…(내부 id)
  line_id         text NOT NULL REFERENCES line(id),
  station_id      text NOT NULL REFERENCES station(id),
  seq             integer NOT NULL,
  branch          text,
  km              numeric(7,2),
  station_code    text,                      -- 이 노선의 역번호(K409, D011, 133)
  order_confirmed boolean NOT NULL DEFAULT true,
  name_ko         text,                      -- 역 대표 이름과 다를 때만(노선별 표기)
  name_en         text,
  operator_id     text REFERENCES operator(id),   -- 이 노선 구간 운영기관(노선 운영기관과 다를 때 필수 아님 → NULL 이면 노선 운영기관)
  status          text NOT NULL,             -- 이 노선에서의 상태(연장 공사 구간 표현 = Q22 A)
  FUZZY(opened), FUZZY(closed),              -- 이 노선에서의 영업 개시·종료
  geom            geography(Point,4326),     -- 승강장 위치(알 때만, 출처 field='geom')
  note            text,
  META,
  UNIQUE (line_id, seq) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX ON line_station (station_id);
```

- 공개 URL 은 없고 역 페이지의 "노선별" 절·노선 페이지의 역 순서에 보인다.
- 별칭·외부 코드·출처·첨부는 `ls-` id 로 공통 테이블에.

### 4-7. 노선 `line`

```sql
CREATE TABLE line (
  id                 text PRIMARY KEY REFERENCES entity(id),
  name_ko, name_en, name_hanja, name_full,
  category           text NOT NULL,   -- high_speed|conventional|metro|light_rail|tram|monorail|maglev
  rail_class         text NOT NULL,   -- high_speed|conventional|urban (법적 분류)
  is_wide_area       boolean,
  wide_area_note     text,
  passenger_service  boolean NOT NULL DEFAULT true,
  line_role          text,            -- depot_line|connecting_line|wye
  status             text NOT NULL,
  owner              text,
  start_station_id   text REFERENCES station(id),
  end_station_id     text REFERENCES station(id),
  length_km          numeric(7,2) CHECK (length_km >= 0),
  FUZZY(opened), FUZZY(closed),
  track text, electrification text, gauge_mm integer, design_speed_kmh integer,
  color              text CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  description        text,
  parent_line_id     text REFERENCES line(id),  -- 기존 공사 구간 노선 → 합칠 노선 (Q22 A, 점진 통합)
  REC
);
CREATE TABLE line_region   (line_id text REFERENCES line(id), region_code text REFERENCES ref_region(code), PRIMARY KEY (line_id, region_code));
CREATE TABLE line_operator (line_id text REFERENCES line(id), operator_id text REFERENCES operator(id), role text NOT NULL DEFAULT 'operator', ord int NOT NULL DEFAULT 0, note text, PRIMARY KEY (line_id, operator_id, role));
CREATE TABLE line_osm_map (
  line_id text PRIMARY KEY REFERENCES line(id),
  relation_ids bigint[] NOT NULL DEFAULT '{}',
  way_names text[] NOT NULL DEFAULT '{}',
  bbox numeric[4],
  priority integer NOT NULL DEFAULT 0,
  include_construction boolean NOT NULL DEFAULT true,   -- 공사 중 way 포함(미래 지도)
  way_ids bigint[] NOT NULL DEFAULT '{}',                -- 개별 지정 way(relation·이름으로 잡히지 않는 짧은 구간, 0020)
  share_with text[] NOT NULL DEFAULT '{}',              -- 공용 구간: 이 노선 후보 way 를 여기 적힌 노선이 먼저 차지해도 함께 배정(0019)
  note text
);
```

### 4-8. 열차 등급 `train_class`

```sql
CREATE TABLE train_class (
  id text PRIMARY KEY REFERENCES entity(id),
  name_ko, name_en, name_hanja, name_full,
  tier text NOT NULL, status text NOT NULL DEFAULT 'active',
  successor_id text REFERENCES train_class(id),
  max_speed_kmh integer,
  FUZZY(started), FUZZY(ended),
  description text,
  REC
);
```

### 4-9. 운행 계통 `service`

```sql
CREATE TABLE service (
  id text PRIMARY KEY REFERENCES entity(id),
  name_ko, name_en, name_hanja, name_full,
  kind text NOT NULL,             -- high_speed|intercity|wide_area|metro|tourist
  train_class_id text REFERENCES train_class(id),
  status text NOT NULL, color text,
  FUZZY(opened), FUZZY(closed),
  successor_id text REFERENCES service(id),
  description text,
  REC
);
CREATE TABLE service_line (
  service_id text REFERENCES service(id), line_id text REFERENCES line(id),
  seq integer NOT NULL,
  PRIMARY KEY (service_id, line_id), UNIQUE (service_id, seq) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE stop_pattern (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_id text NOT NULL REFERENCES service(id),
  code text NOT NULL, name_ko text NOT NULL, name_en text,
  type text NOT NULL,             -- local|express|rapid|limited
  seq integer NOT NULL, note text,
  UNIQUE (service_id, code)
);
CREATE TABLE stop_pattern_stop (           -- 정차역 = 노선별 역 (Q72 A)
  pattern_id      bigint REFERENCES stop_pattern(id) ON DELETE CASCADE,
  seq             integer NOT NULL,
  line_station_id text NOT NULL REFERENCES line_station(id),
  PRIMARY KEY (pattern_id, seq)
);
```

- 정차 패턴 역 ≥ 2. 정차 패턴이 없으면 소속 노선 모든 역 정차로 가정하는 규칙은 뷰에서 유지.

### 4-10. 상위 계획 `plan_program`

```sql
CREATE TABLE plan_program (
  id text PRIMARY KEY REFERENCES entity(id),      -- pp-national-rail-4
  kind text NOT NULL,   -- territorial|national_rail|metro_network|wide_area_transport|wide_area_improvement|transfer_center|other
  name_ko, name_en, name_full,
  short text NOT NULL, round integer CHECK (round >= 1),
  region_code text REFERENCES ref_region(code),
  period_from integer, period_to integer,
  issuer text, legal_basis text,
  status text NOT NULL,  -- current|superseded|draft
  parent_id text REFERENCES plan_program(id),
  summary text, document_note text,
  ord integer NOT NULL,
  REC
);
CREATE TABLE plan_program_notice (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  program_id text NOT NULL REFERENCES plan_program(id),
  kind text NOT NULL, title text NOT NULL, number text,
  FUZZY(date) NOT NULL, note text,
  source_id text NOT NULL REFERENCES source(id), seq integer NOT NULL
);
CREATE TABLE plan_program_point  (program_id text REFERENCES plan_program(id), seq int, text text NOT NULL, PRIMARY KEY (program_id, seq));
CREATE TABLE plan_program_figure (program_id text REFERENCES plan_program(id), seq int, label text NOT NULL, value text NOT NULL, source_id text REFERENCES source(id), PRIMARY KEY (program_id, seq));
```

### 4-11. 계획 사업 `plan`

```sql
CREATE TABLE plan (
  id text PRIMARY KEY REFERENCES entity(id),
  name_ko, name_en, name_full,
  scope           text NOT NULL DEFAULT 'line',   -- line 노선 | station 역(신설역 추가·역사 개량·이전) | facility 기타 시설 (Q79 A)
  FUZZY(opened),                  -- 실제 개통
  operator_text   text,
  description     text,
  is_national     boolean NOT NULL DEFAULT false,
  stage_override  text,           -- 현재 단계 수동 지정(예외용) (Q28 A)
  color           text CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),   -- 공식 노선색이 있을 때만(출처 field='color') (Q91 A)
  REC
);
CREATE TABLE plan_ref (            -- 상위 계획 반영 내역
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id text NOT NULL REFERENCES plan(id), program_id text NOT NULL REFERENCES plan_program(id),
  edition text, timing text,
  class text NOT NULL,   -- new|review|continued
  category text,         -- high_speed|conventional|wide_area|urban
  section text, content text,
  length_km numeric(8,2), cost_100m_krw numeric(12,1), task_group text,
  source_id text NOT NULL REFERENCES source(id), locator text,
  seq integer NOT NULL
);
CREATE TABLE plan_stage_event (    -- 단계 이력(과거·현재 사실)
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id text NOT NULL REFERENCES plan(id),
  stage text NOT NULL,
  kind  text NOT NULL DEFAULT 'reached',   -- reached | withdrawn(철회·보류) | dormant(후속 계획 미반영) (Q29 A)
  FUZZY(date) NOT NULL,
  note text,
  source_id text NOT NULL REFERENCES source(id),
  origin text NOT NULL DEFAULT 'manual'    -- manual|gazette_auto|agent
);
CREATE TABLE plan_milestone (      -- 기대 일정(앞으로의 예정) (Q88·Q94 A)
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id   text NOT NULL REFERENCES plan(id),
  stage     text NOT NULL,          -- 예정 단계: basic_plan, construction, opened …
  FUZZY(expected) NOT NULL,         -- 예정 시기
  basis     text NOT NULL,          -- official(고시·공식 계획) | press(언론 보도) | estimate(운영자 추정 — Q94 A 로 사용하지 않음, 예약 값)
  FUZZY(as_of),                     -- 이 예정이 발표·확인된 시점(같은 단계의 예정이 여러 번 바뀌면 최신이 유효)
  source_id text REFERENCES source(id),   -- basis official·press 는 필수(CHECK)
  note      text,
  CHECK (basis <> 'estimate' AND source_id IS NOT NULL)   -- Q94 A: 추정 금지, 출처 필수
);
CREATE TABLE plan_line (           -- 계획 ↔ 노선 + 역할 (Q90 A)
  plan_id text REFERENCES plan(id), line_id text REFERENCES line(id),
  role text NOT NULL DEFAULT 'new',  -- new(신설 노선이 됨) | extends(기존 노선 연장) | upgrades(개량, 지도 변화 없음) | replaces(개통 시 대체되어 사라지는 노선·구간)
  from_line_station_id text REFERENCES line_station(id),   -- replaces·extends 의 구간(선택)
  to_line_station_id   text REFERENCES line_station(id),
  note text,
  PRIMARY KEY (plan_id, line_id, role)
);
CREATE TABLE plan_station (        -- 계획 ↔ 역 + 역할 (Q72 A: 역(그룹)을 가리킴, Q90 A)
  plan_id text REFERENCES plan(id), station_id text REFERENCES station(id),
  role text NOT NULL DEFAULT 'new',  -- new(신설) | existing(기존 역, 환승 생김) | closes(폐역 예정) | subject(scope station 사업의 대상 역)
  PRIMARY KEY (plan_id, station_id)
);
CREATE TABLE plan_region (plan_id text REFERENCES plan(id), region_code text REFERENCES ref_region(code), PRIMARY KEY (plan_id, region_code));
CREATE TABLE plan_relation (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id text NOT NULL REFERENCES plan(id), target_plan_id text NOT NULL REFERENCES plan(id),
  relation text NOT NULL,   -- succeeded_by|part_of|same_corridor|related
  note text, source_id text NOT NULL REFERENCES source(id),
  CHECK (plan_id <> target_plan_id), UNIQUE (plan_id, target_plan_id, relation)
);
CREATE TABLE plan_geometry (       -- 계획 노선 선형 (Q89 A)
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id     text NOT NULL REFERENCES plan(id),
  kind        text NOT NULL,       -- schematic(경유역) | traced(공식 도면 추출) | official(공식 좌표)
  via_station_ids text[],          -- schematic: 경유역(역 id) 순서
  geom        geometry(MultiLineString,4326),  -- traced·official 원본 / schematic 은 경유역을 잇는 곡선 보간 결과(캐시, 표시용)
  accuracy_m  integer, method_note text,
  source_id   text NOT NULL REFERENCES source(id),
  note        text,
  META,
  CHECK (kind <> 'schematic' OR via_station_ids IS NOT NULL)
);
CREATE TABLE plan_watch_keyword (plan_id text REFERENCES plan(id), keyword text, PRIMARY KEY (plan_id, keyword));
```

- 기존 `target_open` 은 `plan_milestone(stage=opened)` 로 옮긴다. 개통 목표 = 유효한(가장 최근 `as_of`) opened 예정(뷰 `v_plan_target_open`).
- 선형 우선순위(뷰 `v_plan_shape`): `plan_line(role new/extends)` 노선의 OSM 공사 선형 > traced/official > schematic. schematic 은 지도에서 "개략"(가는 점선 + 범례 "선형 미확정")으로만 그린다.
- scope `station`·`facility` 사업은 상위 계획 반영이 없어도 된다(V-H04 완화).

### 4-12. 연표 이벤트 `event` (Q27 A)

```sql
CREATE TABLE event (
  id text PRIMARY KEY REFERENCES entity(id),
  type text NOT NULL,  -- opened|closed|suspended|resumed|renamed|transfer_opened|service_started|service_ended|stage_changed|plan_listed|other
  FUZZY(date) NOT NULL, title text NOT NULL, note text,
  origin text NOT NULL,  -- manual|chronology|agent
  REC
);
CREATE TABLE event_target (event_id text REFERENCES event(id), entity_id text REFERENCES entity(id), role text NOT NULL DEFAULT 'subject', PRIMARY KEY (event_id, entity_id));
CREATE TABLE event_area (event_id text REFERENCES event(id), area_code text REFERENCES ref_area(code), PRIMARY KEY (event_id, area_code));
```

- 대상은 역(그룹)·노선·운행 계통·계획(Q72 A). 개체 필드에서 나오는 이벤트(노선별 역의 개통 포함)는 `v_event_all` 뷰가 같은 결정적 id 로 만든다.

### 4-13. 열차번호대 `train_number_range`

```sql
CREATE TABLE train_number_range (
  id text PRIMARY KEY REFERENCES entity(id),
  operator_id text NOT NULL REFERENCES operator(id),
  code_prefix text,
  range_from integer NOT NULL, range_to integer NOT NULL CHECK (range_to >= range_from),
  "group" text NOT NULL, train_class_id text REFERENCES train_class(id),
  route_text text, parity_rule text,
  FUZZY(valid_from), FUZZY(valid_to),
  note text,
  REC
);
CREATE TABLE train_number_range_service (range_id text REFERENCES train_number_range(id), service_id text REFERENCES service(id), PRIMARY KEY (range_id, service_id));
CREATE TABLE train_number_range_line    (range_id text REFERENCES train_number_range(id), line_id text REFERENCES line(id), PRIMARY KEY (range_id, line_id));
```

### 4-14. 차량번호대 `rolling_stock_range`

```sql
CREATE TABLE rolling_stock_range (
  id text PRIMARY KEY REFERENCES entity(id),
  operator_id text NOT NULL REFERENCES operator(id),
  series text NOT NULL, number_prefix text,
  number_from integer NOT NULL, number_to integer NOT NULL, digits integer NOT NULL,
  "group" text NOT NULL, model text, train_class_id text REFERENCES train_class(id),
  number_rule text, status text NOT NULL,
  FUZZY(introduced), FUZZY(retired), owner_note text,
  formation_label text, formation_from text, formation_to text, formation_count integer,
  formation_cars integer, formation_code_prefix text, formation_note text,
  note text,
  REC
);
CREATE TABLE rolling_stock_range_service (range_id text REFERENCES rolling_stock_range(id), service_id text REFERENCES service(id), PRIMARY KEY (range_id, service_id));
CREATE TABLE rolling_stock_range_line    (range_id text REFERENCES rolling_stock_range(id), line_id text REFERENCES line(id), PRIMARY KEY (range_id, line_id));
```

### 4-15. 환승센터 `transfer_center` (id `xc-`)

```sql
CREATE TABLE transfer_center (
  id text PRIMARY KEY REFERENCES entity(id),
  name_ko, name_en, name_full,
  kind text NOT NULL, region_code text REFERENCES ref_region(code), area_code text REFERENCES ref_area(code),
  status text NOT NULL, FUZZY(status_as_of), status_source_id text NOT NULL REFERENCES source(id),
  description text,
  REC
);
CREATE TABLE transfer_center_plan_ref (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  center_id text NOT NULL REFERENCES transfer_center(id), program_id text NOT NULL REFERENCES plan_program(id),
  class text NOT NULL, name_raw text NOT NULL,
  cost_100m_krw numeric(12,1), rail_now text, rail_future text, page text, note text,
  source_id text NOT NULL REFERENCES source(id), seq integer NOT NULL
);
CREATE TABLE transfer_center_status_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  center_id text NOT NULL REFERENCES transfer_center(id),
  status text NOT NULL, FUZZY(date) NOT NULL, note text, source_id text NOT NULL REFERENCES source(id)
);
CREATE TABLE transfer_center_station (center_id text REFERENCES transfer_center(id), station_id text REFERENCES station(id), PRIMARY KEY (center_id, station_id));
CREATE TABLE transfer_center_plan    (center_id text REFERENCES transfer_center(id), plan_id text REFERENCES plan(id), PRIMARY KEY (center_id, plan_id));
```

### 4-16. 공개 노선도 `route_map`

```sql
CREATE TABLE route_map (
  id text PRIMARY KEY REFERENCES entity(id),
  title_ko text NOT NULL, title_en text, publisher text NOT NULL, region text,
  mode text NOT NULL,             -- embed|link
  document_id uuid REFERENCES document(id),
  url text NOT NULL, license text NOT NULL, attribution text NOT NULL, as_of text,
  width integer, height integer,
  REC,
  CHECK (mode <> 'embed' OR document_id IS NOT NULL)
);
```

노선도에 붙는 근거 텍스트·링크·이미지는 `entity_attachment`.

### 4-17. 계획 시간표 (Q30 A)

```sql
CREATE TABLE timetable_set (
  id              text PRIMARY KEY,       -- tt-<역>-<route_code>-<day>-<dir>
  station_id      text NOT NULL REFERENCES station(id),
  line_station_id text REFERENCES line_station(id),   -- 노선별 역(Q72 A). 해석 못 하면 NULL + 품질 목록
  service_id      text REFERENCES service(id),
  route_code      text NOT NULL,
  day_type text NOT NULL, direction text NOT NULL, direction_label text, day_note text,
  data_as_of text, source_id text NOT NULL REFERENCES source(id), import_run_id bigint,
  UNIQUE (station_id, route_code, day_type, direction)
);
CREATE TABLE timetable_entry (
  set_id text REFERENCES timetable_set(id) ON DELETE CASCADE,
  minute smallint NOT NULL CHECK (minute BETWEEN 0 AND 1679),
  dest_name text, dest_station_id text REFERENCES station(id),
  train_no text NOT NULL DEFAULT '', note text,
  ord integer NOT NULL CHECK (ord >= 1),   -- 세트 안 순서(0016: 열차번호 없는 TAGO 의 같은 분·다른 종착 행 보존)
  PRIMARY KEY (set_id, ord)
);
CREATE INDEX ON timetable_entry (set_id, minute);
```

시간표는 기계적 갱신(수집기가 세트 통째 교체, 소프트 삭제 대상 아님 — 감사는 수집 실행 단위: `import_run_id` → `ingest.run.id`, 08 문서 3-1-1절).

**기계적 데이터 쓰기 경로(Q98 A)** — "모든 쓰기는 도메인 적용기"의 명시적 예외. 시간표(`timetable_set`·`timetable_entry`)와 이관 때의 id 리다이렉트(`id_redirect`, 상위 계획 `pp-`·환승센터 `xc-` — 관리 앱의 ID 변경·역 병합 리다이렉트는 적용기가 쓴다)는 개체가 아닌 기계적 데이터라 적용기·변경 묶음을 거치지 않고 SQL 한 트랜잭션으로 쓴다(시간표는 `packages/importers` 의 writer 하나 — 수집기와 이관 도구가 같이 쓴다). 감사는 수집 실행 `ingest.run`(params·stats·리포트) 단위이고, 세트의 `import_run_id` 가 그 실행을 가리킨다. 사실(개체) 변경은 이 경로로 쓰지 않는다. `osm` 스키마(참고 데이터, osm-rail)도 같은 성격이다.

`day_note` 표시(Q111 A): 수집기는 `원문 — 해석…`(예 `운행정보 요일구분 "토요일+공휴일" — 토요일·공휴일 공통 다이아`)으로 쓰고, 공개 사이트는 해석 부분만 시간표에 보이고 원문 표기는 출처 절에 둔다(contracts `splitDayNote`).

### 4-18. 용어 `glossary_term` (Q34 B → Q86 A: 처음부터 DB 가 원천)

```sql
CREATE TABLE glossary_term (
  id text PRIMARY KEY REFERENCES entity(id),
  term_ko text NOT NULL, term_en text,
  section text NOT NULL,
  definition text NOT NULL, basis text, example text, caution text,   -- 마크다운
  ord integer NOT NULL,
  REC
);
```

`docs/TERMINOLOGY.md` 는 이관 때 한 번 읽어 적재하고, 이후에는 DB 에서 생성한 **읽기 전용 사본**이다.

### 4-19. OSM 스키마 `osm` (Q31 A)

```sql
CREATE SCHEMA osm;
CREATE TABLE osm.extract (id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, kind text, bbox numeric[4], fetched_at timestamptz, overpass_query text, sha256 text, note text);
CREATE TABLE osm.way (id bigint PRIMARY KEY, extract_id bigint REFERENCES osm.extract(id), tags jsonb NOT NULL, is_construction boolean NOT NULL, geom geometry(LineString,4326) NOT NULL);
CREATE TABLE osm.relation (id bigint PRIMARY KEY, extract_id bigint, tags jsonb NOT NULL);
CREATE TABLE osm.relation_member (relation_id bigint REFERENCES osm.relation(id) ON DELETE CASCADE, way_id bigint, role text, seq int, PRIMARY KEY (relation_id, seq));
CREATE INDEX ON osm.way USING gist (geom);
```

- 노선 선형 = `line_osm_map` 배정 결과(`osm.v_line_geometry`, 공사 중 way 는 `is_construction`). 응답에 ODbL 표기.
- 배정 규칙(`osm.v_line_way`, 기존 build-map 과 같음): 후보 = `relation_ids` 의 member way ∪ 이름(`name` 또는 `name:ko`)이 `way_names` 에 있는 way ∪ `way_ids`. `bbox` 가 있으면 두 후보 모두 way 의 가운데 꼭짓점이 bbox 안인 것만. 같은 way 를 여러 노선이 원하면 `priority` 가 작은 노선(같으면 line_id 순)이 차지하되, 원한 노선의 `share_with` 에 차지한 노선이 있으면 그 way 를 함께 배정한다(공용 구간 — 예: 수서평택고속선 `share_with = {line-gtx-a}`, 수서~동탄). 기존 `claim_first` 는 `priority` 를 앞당겨(−1000) 표현한다. `include_construction = false` 면 공사 중 way 제외.
- 적재는 수집기 `osm-rail`(docs/08 3-1-1): `osm` 스키마 전체를 한 트랜잭션으로 교체, 추출 파일마다 `osm.extract` 1행. `is_construction` = `railway=construction`.
- 근사 좌표 역의 선형 스냅(parcel 1km·district 3km·township 10km)은 지도 API 가 질의 시 계산.

### 4-19-1. 외부 API 카탈로그·호출 기록 (`ingest` 스키마, 2026-11-20 추가)

```sql
CREATE TABLE ingest.api_endpoint (
  id            text PRIMARY KEY,          -- 예: tago-subway-station-list
  provider      text NOT NULL,             -- data_go_kr | kric | tago | vworld | seoul_open | law_go_kr | other
  name_ko       text NOT NULL,
  method        text NOT NULL DEFAULT 'GET',
  base_url      text NOT NULL,             -- 호출 허용 호스트는 이 URL 의 호스트뿐
  params        jsonb NOT NULL,            -- [{name, label, required, default, example, kind(text|int|date|station_ref), ref_system}]
  key_param     text,                      -- 키를 넣을 매개변수 이름(serviceKey 등)
  key_env       text,                      -- 키 환경 변수 이름(서비스별 → 공통 순서로 조회)
  response_format text NOT NULL,           -- xml | json
  rows_path     text,                      -- 반복 항목 경로(자동 감지 실패 시)
  paging        jsonb,                     -- {page_param, size_param, total_path}
  daily_limit   integer,
  external_system text REFERENCES ref_external_system(code),  -- DB 비교용
  source_id     text REFERENCES source(id),
  doc_url       text, note text,
  META
);
CREATE TABLE ingest.api_call (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  endpoint_id   text NOT NULL REFERENCES ingest.api_endpoint(id),
  params        jsonb NOT NULL,            -- 키 제외
  called_at     timestamptz NOT NULL DEFAULT now(),
  origin        text NOT NULL,             -- admin | importer | agent
  status        integer, elapsed_ms integer, result_code text, result_message text,
  response_body bytea,                     -- 7일 보관 후 NULL
  response_sha256 text,
  snapshot_document_id uuid REFERENCES document(id)
);
CREATE INDEX ON ingest.api_call (endpoint_id, called_at);
CREATE TABLE ingest.api_preset (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, endpoint_id text REFERENCES ingest.api_endpoint(id), name text NOT NULL, params jsonb NOT NULL);
```

- 수집기(08 문서)도 같은 카탈로그·호출 기록·한도 계산을 쓴다(한도는 엔드포인트별 오늘 호출 수 합).
- 구현(2026-11-21): `params` 항목은 `{name, label, description, required, default, example, kind(text|int|date|enum|station_ref), ref_system, options, fixed}`. DB 비교 설정 `{code_field, name_field, lat_field, lng_field}` 는 열을 따로 두지 않고 `paging` jsonb 의 `compare` 키에 둔다. `api_call.params` 는 `{query(키 뺀 매개변수), url(키 가림), content_type, size_bytes}`, `response_body` 는 키를 가린 원문(압축 없음), `response_sha256` 은 그 원문의 sha256. "오늘" 은 한국 시간 자정 기준.
- 구현(2026-11-21): `params` 항목은 `{name, label, description, required, default, example, kind(text|int|date|enum|station_ref), ref_system, options, fixed}`. DB 비교 설정 `{code_field, name_field, lat_field, lng_field}` 는 열을 따로 두지 않고 `paging` jsonb 의 `compare` 키에 둔다. `api_call.params` 는 `{query(키 뺀 매개변수), url(키 가림), content_type, size_bytes}`, `response_body` 는 키를 가린 원문(압축 없음), `response_sha256` 은 그 원문의 sha256. "오늘" 은 한국 시간 자정 기준.

### 4-20. 시스템 테이블 (Q42 A·Q43 → Q80 A: 관리자 1인)

```sql
CREATE TABLE app_user (            -- 관리자 1명 + 서비스 계정
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,              -- admin | system | agent | web
  email text UNIQUE,               -- admin: Cloudflare Access 가 확인한 이메일
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz
);
CREATE TABLE api_token (           -- 서비스 계정(web 읽기, agent 제안, CLI)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id),
  name text NOT NULL, token_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL,          -- public:read | admin:read | proposal:write | system:write
  expires_at timestamptz, last_used_at timestamptz, revoked_at timestamptz
);

CREATE TABLE changeset (            -- (Q36 A)
  id            text PRIMARY KEY,
  title         text NOT NULL, rationale text,
  origin        text NOT NULL,      -- admin_edit|bulk_import|importer|agent|legacy_migration|revert
  status        text NOT NULL,      -- draft|applying|applied|failed|rejected|superseded
  author_id     uuid NOT NULL REFERENCES app_user(id),
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at   timestamptz, applied_at timestamptz, review_comment text,
  error         text,
  base_data_version bigint,
  reverts_changeset_id text REFERENCES changeset(id),
  body          json,
  meta          jsonb NOT NULL DEFAULT '{}'   -- 에이전트 실행 id·모델·비용
);
CREATE TABLE change_op (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changeset_id text NOT NULL REFERENCES changeset(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  op text NOT NULL,              -- create|update|delete(소프트)|restore|merge_station|rename_id|replace_children
  entity_type text NOT NULL, entity_id text NOT NULL,
  payload jsonb NOT NULL, before jsonb, after jsonb,
  UNIQUE (changeset_id, seq)
);
CREATE INDEX ON change_op (entity_id);
CREATE TABLE change_evidence (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changeset_id text NOT NULL REFERENCES changeset(id) ON DELETE CASCADE,
  op_seq integer, document_id uuid REFERENCES document(id), url text,
  quote text NOT NULL, locator text, confidence numeric(3,2), note text
);
CREATE TABLE data_version (
  version bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changeset_id text REFERENCES changeset(id),
  committed_at timestamptz NOT NULL DEFAULT now(),
  entity_ids text[] NOT NULL
);
CREATE TABLE app_setting (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
  -- 에이전트 월 예산·누적 비용 등 소수의 운영 값(Q84). 공지·기능 토글은 두지 않음(Q78 A)
```

- 관리자 편집은 검증 통과 시 즉시 반영(changeset status applied). draft 는 수집기·에이전트·대량 가져오기만(Q42 A).
- 작업 큐는 pg-boss(스키마 `pgboss`, Q14 A). 수집 실행 기록은 `ingest` 스키마(08 문서).

## 5. 코드값 목록

| 도메인                                     | 값 (라벨)                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `entity_type`                              | source, operator, station, line_station, line, train_class, service, plan_program, plan, event, train_number_range, rolling_stock_range, transfer_center, route_map, glossary_term                                                                                                                                 |
| `status`(역 단독·노선별 역·노선·운행 계통) | operating 운영 중 / suspended 휴업 / under_construction 공사 중 / planned 계획 / abandoned 계획 폐기 / closed 폐선·폐역·운행 종료                                                                                                                                                                                  |
| `station.kind`                             | station 여객역 / signal_box 신호장·신호소 / junction 분기점·연결선 / yard 조차장 / depot 차량기지 / freight 화물역                                                                                                                                                                                                 |
| `coord_source` / `coord_basis`             | official, manual, derived / parcel, district, township, existing_station                                                                                                                                                                                                                                           |
| `line.category`                            | high_speed, conventional, metro, light_rail, tram, monorail, maglev                                                                                                                                                                                                                                                |
| `rail_class`                               | high_speed 고속철도 / conventional 일반철도 / urban 도시철도                                                                                                                                                                                                                                                       |
| `line_role`                                | depot_line 기지선 / connecting_line 연결선 / wye 삼각선                                                                                                                                                                                                                                                            |
| `track`                                    | single, double, quadruple, sextuple, single_parallel, partial_double                                                                                                                                                                                                                                               |
| `service.kind`                             | high_speed 고속열차 / intercity 일반열차 / wide_area 광역전철 / metro 도시철도 / tourist 관광열차                                                                                                                                                                                                                  |
| `stop_pattern.type`                        | local 완행 / express 급행 / rapid 쾌속 / limited 특정 정차                                                                                                                                                                                                                                                         |
| `train_class.tier`                         | high_speed, semi_high_speed, express, local, commuter                                                                                                                                                                                                                                                              |
| `plan_program.kind` / `status`             | territorial, national_rail, metro_network, wide_area_transport, wide_area_improvement, transfer_center, other / current, superseded, draft                                                                                                                                                                         |
| `notice.kind`                              | approval, amendment, correction, submission, other                                                                                                                                                                                                                                                                 |
| `plan.scope`                               | line 노선 / station 역 / facility 기타 시설                                                                                                                                                                                                                                                                        |
| `plan_ref.class` / `category`              | new, review, continued / high_speed, conventional, wide_area, urban                                                                                                                                                                                                                                                |
| `plan_stage`                               | concept 구상 → plan_listed 상위계획 반영 → prefeasibility 사전타당성 → feasibility 예비타당성 → strategic_eia 전략환경영향평가 → basic_plan 기본계획 → basic_design 기본설계 → eia 환경영향평가 → detail_design 실시설계 → construction 착공·시공 → trial_run 시운전 → opened 개통 ; abandoned 폐기 ; dormant 휴면 |
| `plan_stage_event.kind`                    | reached 도달 / withdrawn 철회·보류 / dormant 휴면                                                                                                                                                                                                                                                                  |
| `plan_milestone.basis`                     | official 공식 / press 보도 / (estimate 는 Q94 A 로 사용하지 않음)                                                                                                                                                                                                                                                  |
| `plan_line.role`                           | new 신설 / extends 연장 / upgrades 개량 / replaces 대체(개통 시 사라짐)                                                                                                                                                                                                                                            |
| `plan_station.role`                        | new 신설 / existing 기존(환승) / closes 폐역 예정 / subject 사업 대상 역                                                                                                                                                                                                                                           |
| `plan_relation.relation`                   | succeeded_by, part_of, same_corridor, related                                                                                                                                                                                                                                                                      |
| `plan_geometry.kind`                       | schematic 개략 / traced 도면 추출 / official 공식 좌표                                                                                                                                                                                                                                                             |
| `event.type`                               | opened, closed, suspended, resumed, renamed, transfer_opened, service_started, service_ended, stage_changed, plan_listed, other                                                                                                                                                                                    |
| `tnr.group` / `parity_rule`                | high_speed, intercity, wide_area, metro, freight, non_revenue, other / odd_down_even_up, odd_up_even_down, none                                                                                                                                                                                                    |
| `rsr.group` / `rsr.status`                 | high_speed, intercity, wide_area, metro, locomotive, coach, freight, other / operating, planned, closed                                                                                                                                                                                                            |
| `transfer_center.kind/status`              | complex, transfer / planned, design, construction, completed, withdrawn, unknown                                                                                                                                                                                                                                   |
| `tc_plan_ref.class`                        | pilot, candidate, new, continued, review                                                                                                                                                                                                                                                                           |
| `source.type`                              | dataset_file, dataset_api, notice, law, press_release, official_page, news, map_image, manual, wiki                                                                                                                                                                                                                |
| `license_class`                            | public_work 저작권법 제7조 / kogl_1~kogl_4 공공누리 / open 공개 라이선스 / restricted 권리 제한 / unknown 미상                                                                                                                                                                                                     |
| `document.kind`                            | original, text_extract, snapshot, page_image, figure_crop, upload                                                                                                                                                                                                                                                  |
| `attachment.kind`                          | quote 원문 발췌 / link 링크 / image 이미지 / document 문서                                                                                                                                                                                                                                                         |
| `route_map.mode`                           | embed, link                                                                                                                                                                                                                                                                                                        |
| `day_type` / `direction`                   | weekday, saturday, holiday / up, down, inner, outer, unknown                                                                                                                                                                                                                                                       |
| `review_status`                            | verified 검수 완료 / unverified 검수 전 / flagged 이의 있음                                                                                                                                                                                                                                                        |
| `entity_name.kind`                         | alias, former, sub, internal, abbr, legal, source_raw                                                                                                                                                                                                                                                              |
| `app_user.kind`                            | admin, system, agent, web                                                                                                                                                                                                                                                                                          |
| `area`                                     | capital 수도권, southeast 동남권, daegyeong 대경권, chungcheong 충청권, honam 호남권, gangwon 강원권, jeju 제주권, national 전국                                                                                                                                                                                   |

## 6. 파생 뷰 (저장하지 않는 값)

모든 뷰는 소프트 삭제된 행(`deleted_at IS NOT NULL`)과 삭제된 부모의 하위 행을 제외한다.

| 뷰                                                                  | 정의                                                                            | 기존 대응                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------- |
| `v_station_status`                                                  | 역 상태·개통·폐지 = 노선별 역에서 계산(4-5절), 없으면 `own_*`                   | `Station.status/opened_at` |
| `v_station_line`                                                    | 역 ↔ 노선(노선별 역의 seq·km·역번호·상태·이름)                                  | `Station.line_ids`         |
| `v_station_line_class`                                              | 소속 노선 rail_class 합집합(없으면 conventional)                                | `line_classes`             |
| `v_station_service`                                                 | 정차 계통: 정차 패턴의 노선별 역 → 역, 패턴 없으면 소속 노선 모든 역(`assumed`) | `service_kinds`            |
| `v_station_area` · `v_line_area` · `v_service_area` · `v_plan_area` | 권역(기존 build.ts 규칙 이식)                                                   | `areas`                    |
| `v_station_review`                                                  | 소속 노선 중 하나라도 verified 면 verified                                      | 상속 review                |
| `v_plan_stage`                                                      | stage_override ?? 단계 이력 규칙(아래)                                          | `Plan.stage`               |
| `v_plan_target_open`                                                | 유효한 `plan_milestone(stage=opened)`(as_of 최신)                               | `Plan.target_open`         |
| `v_unopened_target`                                                 | 미개통 역·노선의 개통 목표 = 연결 계획 개통 예정 중 가장 이른 것 ?? 개체 opened | `unopenedTargetDate()`     |
| `v_plan_shape`                                                      | 계획별 표시 선형과 품질 등급(osm_construction > traced/official > schematic)    | plans.geojson              |
| `v_map_at(year)`                                                    | **시점별 지도**(미래 지도, 6-1절)                                               | (신설)                     |
| `v_event_all`                                                       | event ∪ 파생 이벤트                                                             | events.json                |
| `v_timetable_summary`                                               | 세트별 첫차·막차·편수·by_hour[24]                                               | timetable-summaries.json   |
| `mv_search` (물리화)                                                | 이름·별칭·정식 명칭·역번호·초성·용어                                            | search-index.json          |
| `mv_map_station`, `mv_map_line` (물리화)                            | 현재 지도 재료(시설 제외, 근사 좌표 스냅)                                       | map/*.geojson              |

**현재 단계 규칙**: 단계 이력을 날짜순으로 훑어 `reached` 는 진행도 최댓값 갱신, `withdrawn` 은 그 단계 직전으로 되돌림, `dormant` 는 휴면 표시(이후 reached 가 오면 해제), `abandoned`·`opened` 는 종결. 같은 날짜의 항목은 진행 단계(reached) 먼저, 폐기·휴면(reached abandoned·dormant, kind dormant)을 나중에 둔다 — 같은 날 고시가 반영과 폐기를 함께 담는 경우 폐기(0018, 기존 build-plans 의 단계 순서와 같음).

### 6-1. 시점별 지도 `v_map_at(year)` (Q87 A·Q88·Q90 A·Q92 A)

연도 Y 의 "그 시점 노선도"를 규칙으로 계산한다.

1. **현재 운영 중**인 노선·노선별 역 전부에서 출발.
2. 미개통 계획 P 의 개통 예정 시점 T = `v_plan_target_open`. T 의 시작 연도 ≤ Y 이면 P 를 적용한다(미정은 "목표 미정" 칸에서만, 목표가 지난 미개통은 현재 연도에 "지연" 표시).
   - `plan_line role=new/extends`: 그 노선(공사 중·계획 상태)·노선별 역을 더한다. extends 는 연장 대상 노선의 색·이름으로 이어 그린다. new 도 노선 레코드가 있으면 노선 이름으로(계획 이름은 plan_id 로 정보 패널에, 0022).
   - `role=replaces`: 해당 노선(또는 from~to 구간)을 숨긴다. `plan_station role=closes`: 그 역을 숨긴다.
   - `role=upgrades`: 지도 변화 없음(정보 패널에만).
   - 노선 레코드가 아직 없는 계획(구상·계획 단계)은 `v_plan_shape` 선형과 `plan_station role=new` 역으로 그린다.
3. 공사 중 노선 자체는 연결 계획(new·extends)의 개통 예정으로 같은 규칙. 신설·연장 계획과 묶이지 않은 공사 중 구간(OSM `construction` 선형 — 병점기지선 연장부 등)은 개통 시점을 모르므로 현재 지도처럼 **모든 시점에 공사 중**으로 그린다(전환 때 사라지지 않게, 0022).
4. 표시 속성: 단계별 선 모양(시공 실선 / 설계 굵은 점선 / 그 전 가는 점선), 색 = 연장이면 기존 노선색, 공식색(`plan.color`, 출처 필수) 있으면 그 색, 아니면 단계 대표색(Q91 A). 선형 품질 schematic 은 "개략" 표시.
5. 역 위치는 현재 지도와 같은 점: 근사 좌표 역(`coord_basis` 있음)은 `mv_map_station` 의 노선 선형 스냅 점(저장 안 함, OSM 표기, 0022).
6. 여객 미취급(화물 전용) 운영 노선도 넣는다(`map_at_lines.passenger = false`, 화면은 회색 가는 선 — 현재 → 미래 전환 때 "폐선" 오해 방지, Q115 A, 0021).
7. 포함 범위 필터(Q88): 기본은 **개통 예정(기대 일정)이 있는 계획** + 공사 중 노선. 단계 필터(기본계획 이상 / 예비타당성 이상 / 전체)로 좁히거나 넓힌다. 휴면·폐기 제외.

## 7. 검색

- `mv_search(entity_id, type, name, name_kind, chosung, code, area_codes, url_path, rank_boost)` + GIN trigram.
- 정확 일치 → 앞부분 → 포함 → trigram 유사도. 초성 질의는 `chosung`. 역번호는 노선별 역 `station_code`. 노선별 역 이름·별칭은 역(그룹) 결과로 모은다.

## 8. 검증 규칙 (Q46 A: 일단 구현, 운영하며 조정)

### 8-1. DB 제약

FK 전부, CHECK(코드값·좌표 범위·퍼지 날짜·범위·자기 참조 금지·첨부 형식), UNIQUE(노선 안 seq, 운행 계통 안 노선 seq, 패턴 코드).

### 8-2. Hard (위반 = 적용 거부)

| ID    | 규칙                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------- |
| V-H01 | 큐레이션 개체는 `record_source`(field NULL) ≥ 1 (노선별 역은 노선 출처로 충족)                                            |
| V-H02 | `merge_into_id` 대상은 자신이 `merge_into_id` 를 갖지 않음, 대상 역은 미개통 노선별 역만 가진 역이 아님(운영 중 역이어야) |
| V-H03 | 환승센터 반영 내역의 상위 계획은 kind transfer_center                                                                     |
| V-H04 | scope `line` 계획은 `plan_ref` ≥ 1 (station·facility 는 0 허용)                                                           |
| V-H05 | 정차 패턴 역 ≥ 2, 정차역(노선별 역)의 노선은 그 운행 계통 노선이어야 함(예외 플래그 허용)                                 |
| V-H06 | `line.start/end_station_id` 는 그 노선의 노선별 역에 있어야 함                                                            |
| V-H07 | `plan_geometry.via_station_ids` 역 존재·좌표 보유                                                                         |
| V-H08 | `coord_same_as_id` 대상 좌표 보유, 자기 자신 아님                                                                         |
| V-H09 | `successor_id` 순환 금지                                                                                                  |
| V-H10 | 퍼지 날짜 `closed ≥ opened`                                                                                               |
| V-H11 | operating 이면 `closed` 없음                                                                                              |
| V-H12 | 삭제(소프트) 시 활성 행이 참조하면 거부하고 참조 목록 반환                                                                |
| V-H13 | 노선별 역이 있는 역은 `own_status/own_opened/own_closed` 가 NULL                                                          |
| V-H14 | `merge_into_id` 가 있는 역은 노선별 역이 모두 미개통(under_construction·planned)                                          |
| V-H15 | 공개 첨부(`is_public`)의 문서는 `publishable`                                                                             |
| V-H16 | `plan_milestone` basis official·press 는 출처 필수                                                                        |

### 8-3. Soft (경고, 품질 대시보드)

| ID    | 규칙                                                                        |
| ----- | --------------------------------------------------------------------------- |
| V-S01 | 출처가 `wiki` 뿐                                                            |
| V-S02 | 운영 중 여객역인데 좌표 없음 / 시·도 미상                                   |
| V-S03 | 좌표가 시·도 경계 밖(경계 데이터 확보 시)                                   |
| V-S04 | 같은 노선 인접 역 거리 > 30km 또는 km 역행                                  |
| V-S05 | `order_confirmed=false`                                                     |
| V-S06 | 동명 역 1km 이내 별개 역(병합 후보)                                         |
| V-S07 | `checked_at` 1년 이상                                                       |
| V-S08 | 단계 이력이 plan_listed 뿐인데 verified                                     |
| V-S09 | 열차번호대 범위 겹침                                                        |
| V-S10 | 노선·계획 `color` 에 field 출처 없음                                        |
| V-S11 | 미개통 계획(scope line)인데 기대 일정(개통 예정) 없음 — 미래 지도에 안 나옴 |
| V-S12 | 미래 지도 대상인데 선형이 schematic 뿐                                      |
| V-S13 | 개통 예정이 지났는데 미개통(지연)                                           |
| V-S14 | 시간표 세트의 노선별 역 미해석                                              |

이관 검수 목록(같은 틀, 07 문서): `X-milestone-auto`(기대 일정 출처 자동 선택, Q100 A) · `X-stage-override`(현재 단계 수동 지정) · `X-plan-abandoned-evidence`(stage_override = abandoned 인데 단계 이력에 폐기 항목 없음 — "폐기 근거 필요", Q101 A) · `X-service-dropped-stops`(운행 계통 `extra.dropped_stops` 의 정차역 중 아직 그 패턴에 그 역의 정차역이 없는 것, Q105 A) · `X-source-license-unknown`.

## 9. 삭제·복구·병합 (Q37 B → Q74 A)

1. 삭제 = **소프트 삭제**(`deleted_at`). 개체 행과 `entity` 행에 시각을 기록한다. id 는 영구 예약(다시 쓰지 않음).
2. 활성 행이 참조 중이면 삭제를 거부한다(V-H12).
3. 하위 관계 행(노선별 역·정차 패턴·반영 내역·단계 이력·첨부 등)은 지우지 않고 **부모와 함께 숨긴다**(뷰·API 가 부모의 `deleted_at` 으로 걸러냄). 복구하면 함께 돌아온다. 노선별 역은 독립 개체라 노선 삭제 시 함께 소프트 삭제 표시한다.
4. 공개 사이트·검색·파생 뷰·데이터 덤프에서 제외. 관리 앱 **휴지통**에서 보기·복구(`restore` op).
5. 영구 삭제(purge)는 관리자가 휴지통에서 명시적으로 할 때만(참조·감사 스냅샷은 남김).
6. 실재했던 개체는 삭제가 아니라 상태(`closed`·`abandoned`)로 둔다. 삭제는 잘못 만든 레코드·중복에만.
7. **역 병합**(merge_station): A → B. A 의 노선별 역을 B 아래로 옮기고(같은 노선이 이미 있으면 하나로 합침), A 를 가리키는 행(plan_station, transfer_center_station, event_target, timetable_set, external_ref, entity_name, record_source, entity_attachment)을 B 로, A 의 이름을 B 의 `entity_name(former)` 로, `id_redirect(A→B)`, A 는 소프트 삭제. 한 변경 묶음.

## 10. 기존 스키마 → 새 스키마 대응 요약

상세는 07 문서.

| 기존                                                             | 새                                                                                                                                                                      |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provenance.*`                                                   | `record_source` · `checked_at` · `provenance_note`                                                                                                                      |
| `*_source`                                                       | `record_source.field`                                                                                                                                                   |
| `aliases[]`                                                      | `entity_name`                                                                                                                                                           |
| `codes{}` · 보정 키                                              | `external_ref`(역 또는 노선별 역)                                                                                                                                       |
| `Station`(병합된 역 하나)                                        | `station`(대표 정보) + 노선별 역마다 `line_station`(상태·개통일·역번호·코드)                                                                                            |
| `Station.status/opened_at/closed_at`                             | 노선별 역으로(노선 없는 역은 `own_*`) — 다중 노선 역의 노선별 개통일은 Q95 A                                                                                            |
| `Station.transfer_group`                                         | 폐지(역 = 그룹)                                                                                                                                                         |
| `Line.region[]` · `operator_name`                                | `line_region` · `line_operator`                                                                                                                                         |
| `LineStation`                                                    | `line_station`(id `ls-…`)                                                                                                                                               |
| `Service.stop_patterns[].station_ids`                            | `stop_pattern_stop.line_station_id`                                                                                                                                     |
| `Plan.plan_refs` · `stage_history` · `related_plans` · `regions` | `plan_ref` · `plan_stage_event` · `plan_relation` · `plan_region`                                                                                                       |
| `Plan.line_ids` · `station_ids`                                  | `plan_line(role)` · `plan_station(role)` — 이관 기본 role: 노선 status operating → upgrades/extends 판단 목록, 그 밖 new / 역 operating → existing, 그 밖 new (07 문서) |
| `Plan.target_open`                                               | `plan_milestone(stage=opened)`                                                                                                                                          |
| `Plan.stage` · `areas`                                           | 뷰                                                                                                                                                                      |
| `PlanProgram`(id `national_rail_4`)                              | `plan_program`(id `pp-national-rail-4`)                                                                                                                                 |
| `TransferCenter`(id `tc-…`)                                      | `transfer_center`(id `xc-…`)                                                                                                                                            |
| `Event.*_ids` · `areas`                                          | `event_target` · `event_area`                                                                                                                                           |
| `TrainNumberRange.operator` · `RollingStock.operator`            | `operator_id`                                                                                                                                                           |
| `RouteMap.file`                                                  | `document`                                                                                                                                                              |
| `TimetableSummary` + 상세 JSON                                   | `timetable_set`(+ line_station_id) + `timetable_entry`                                                                                                                  |
| `geometry/plan-routes.yaml`                                      | `plan_geometry`                                                                                                                                                         |
| `overrides/osm-line-map.yaml`                                    | `line_osm_map`                                                                                                                                                          |
| `overrides/*`                                                    | 개체 열에 실체화                                                                                                                                                        |
| 수집기용 보정 파일                                               | `ingest` 설정                                                                                                                                                           |
| `docs/TERMINOLOGY.md`                                            | `glossary_term`                                                                                                                                                         |
| `own_record`·`own_file`·`build_artifact`·`load_meta`             | 폐지                                                                                                                                                                    |
