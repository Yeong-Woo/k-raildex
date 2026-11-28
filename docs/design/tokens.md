# 디자인 토큰 (WP 6.3)

> 확정 2026-11-21(Q83 A의 "토큰 확정" 단계). 근거: 트렌드 조사 [`docs/research/ui-trends.md`](../research/ui-trends.md), 시안 [`docs/design/mockups/`](mockups/).
> **단일 원천은 `packages/ui/src/tokens.ts`** 이다. CSS 는 거기서 만든다 — 값을 바꾸면 `pnpm -F @k-raildex/ui tokens`(= `node packages/ui/scripts/gen-tokens.ts`)로 `tokens.css` 를 다시 만들고, 시험(`packages/ui/test/tokens.test.ts`)이 ① 두 파일 일치 ② 명도 대비(WCAG 2.2 AA) ③ 지도 팔레트(`packages/map`)와의 일치를 확인한다.

## 1. 파일과 쓰는 법

| 파일                           | 내용                                                                                               | 쓰는 곳                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `packages/ui/src/tokens.ts`    | 토큰 정의(OKLCH 색 [라이트, 다크]·글자·여백·반경·그림자·움직임·쌓임·배치), 의미 규칙, 색 변환 함수 | 원천. TS 에서 `@k-raildex/ui` 로 가져온다 |
| `packages/ui/src/tokens.css`   | 생성 파일. `:root` 에 `--kr-*` 사용자 지정 속성, 다크는 `prefers-color-scheme` + `data-theme`      | `@import '@k-raildex/ui/tokens.css'`      |
| `packages/ui/src/tailwind.css` | Tailwind v4 `@theme inline` 연결(`bg-surface`, `text-fg-muted`, `bg-good-soft` …)                  | Tailwind 쓰는 앱(관리 앱·공개 사이트)     |
| `packages/ui/src/base.css`     | 공통 기본: 글꼴, `keep-all` 줄바꿈, 제목 `balance`, 포커스 고리 3px, 움직임 줄이기                 | 모든 앱                                   |

- 배색 전환: 기본은 OS 설정(`prefers-color-scheme`). 사용자가 고르면 `<html data-theme="light|dark">` (값은 `localStorage` 한 칸 — 쿠키·추적 없음).
- CSS 색 함수를 못 쓰는 곳(MapLibre 스타일, 캔버스, OG 이미지, SVG 내보내기)은 `colorHex('light'|'dark')` 로 hex 를 받는다. hex 는 OKLCH 에서 계산하며 따로 적지 않는다(지도 패키지의 상수는 시험으로 맞춘다).
- 노선 색(DB `line.color`)은 토큰이 아니라 데이터다. 바탕으로 쓸 때 글자색은 `readableOn(hex)`(대비 큰 쪽 흰색/거의 검정).

## 2. 색

명명: `bg`(페이지 바탕) · `surface`(면: 카드·표·패널) · `surface-muted`(머리글·호버) · `surface-sunken`(지도·우물) · `fg`/`fg-muted`/`fg-subtle`(글자 3단) · `border`/`border-strong` · `accent`(링크·주 버튼, 남색) · `focus`(주황 포커스 고리) · 알림 `danger`/`warn`/`good`/`info`(+ `-fg` 그 위 글자, `-soft` 옅은 바탕).

대비 보장(시험으로 강제): 본문 `fg` 7:1 이상, 모든 글자 토큰 4.5:1 이상(자기 `-soft`·`-bg` 바탕 위 포함), 표시용(`*-mark`, 단계 띠 색, `border-strong`, `focus`) 3:1 이상(SC 1.4.11).

| 토큰                             | 라이트 (OKLCH · hex)                                          | 다크 (OKLCH · hex)               |
| -------------------------------- | ------------------------------------------------------------- | -------------------------------- |
| `bg`                             | `oklch(0.975 0.003 255)` #F5F7F9                              | `oklch(0.185 0.009 255)` #101317 |
| `surface`                        | `oklch(1 0 0)` #FFFFFF                                        | `oklch(0.22 0.011 255)` #171B20  |
| `surface-muted`                  | `oklch(0.955 0.005 255)` #EEF0F3                              | `oklch(0.26 0.012 255)` #20242A  |
| `surface-sunken`                 | `oklch(0.935 0.006 255)` #E7EAED                              | `oklch(0.16 0.008 255)` #0B0D11  |
| `overlay`                        | `oklch(0.2 0.02 255 / 0.45)` #10171F                          | `oklch(0 0 0 / 0.6)` #000000     |
| `fg`                             | `oklch(0.22 0.014 255)` #161B21                               | `oklch(0.94 0.005 255)` #E9EBEE  |
| `fg-muted`                       | `oklch(0.44 0.016 255)` #4D535B                               | `oklch(0.77 0.012 255)` #AFB5BC  |
| `fg-subtle`                      | `oklch(0.52 0.014 255)` #646971                               | `oklch(0.69 0.012 255)` #969CA3  |
| `border`                         | `oklch(0.9 0.006 255)` #DBDEE2                                | `oklch(0.33 0.012 255)` #31363C  |
| `border-strong`                  | `oklch(0.62 0.012 255)` #81878D                               | `oklch(0.54 0.014 255)` #696F77  |
| `accent`                         | `oklch(0.47 0.15 258)` #1A57AD                                | `oklch(0.76 0.12 255)` #7CB4FC   |
| `accent-fg`                      | `oklch(0.99 0 0)` #FCFCFC                                     | `oklch(0.18 0.02 258)` #0C121A   |
| `accent-soft`                    | `oklch(0.94 0.03 258)` #DFECFF                                | `oklch(0.31 0.06 258)` #1C314E   |
| `accent-soft-fg`                 | `oklch(0.38 0.13 258)` #0A3F86                                | `oklch(0.87 0.07 255)` #B6D7FF   |
| `brand-green` · `brand-amber`    | `oklch(0.6 0.14 150)` #319751 · `oklch(0.74 0.15 65)` #EA942F | 같음                             |
| `link`                           | `oklch(0.45 0.15 258)` #1351A6                                | `oklch(0.78 0.11 255)` #87BAFD   |
| `link-visited`                   | `oklch(0.44 0.15 300)` #613897                                | `oklch(0.78 0.11 300)` #C2A7F4   |
| `focus`                          | `oklch(0.66 0.17 55)` #DE6F00                                 | `oklch(0.8 0.15 75)` #F5AE39     |
| `danger`                         | `oklch(0.5 0.18 27)` #B32322                                  | `oklch(0.72 0.15 25)` #F47B74    |
| `danger-fg`                      | `oklch(0.99 0 0)` #FCFCFC                                     | `oklch(0.18 0.02 25)` #1A0E0D    |
| `danger-soft`                    | `oklch(0.95 0.025 27)` #FFE9E6                                | `oklch(0.31 0.07 25)` #4E201E    |
| `warn`                           | `oklch(0.5 0.11 65)` #8D5406                                  | `oklch(0.8 0.13 80)` #E9B452     |
| `warn-fg`                        | `oklch(0.99 0 0)` #FCFCFC                                     | `oklch(0.2 0.03 75)` #1E1406     |
| `warn-soft`                      | `oklch(0.95 0.05 85)` #FEEDC9                                 | `oklch(0.32 0.06 75)` #442E09    |
| `good`                           | `oklch(0.47 0.11 150)` #206B38                                | `oklch(0.78 0.13 150)` #76CF8A   |
| `good-fg`                        | `oklch(0.99 0 0)` #FCFCFC                                     | `oklch(0.2 0.03 150)` #0C1A0F    |
| `good-soft`                      | `oklch(0.95 0.04 150)` #DCF7E1                                | `oklch(0.3 0.05 150)` #1A3520    |
| `info`                           | `oklch(0.47 0.15 258)` #1A57AD                                | `oklch(0.76 0.12 255)` #7CB4FC   |
| `info-soft`                      | `oklch(0.94 0.03 258)` #DFECFF                                | `oklch(0.31 0.06 258)` #1C314E   |
| `status-operating-fg`            | `oklch(0.4 0.1 150)` #115629                                  | `oklch(0.86 0.1 150)` #A1E4AE    |
| `status-operating-bg`            | `oklch(0.94 0.05 150)` #D5F5DA                                | `oklch(0.31 0.06 150)` #17391F   |
| `status-operating-mark`          | `oklch(0.58 0.14 150)` #2A904B                                | `oklch(0.72 0.15 150)` #53BE70   |
| `status-under_construction-fg`   | `oklch(0.42 0.09 70)` #6C4302                                 | `oklch(0.88 0.11 90)` #F4D580    |
| `status-under_construction-bg`   | `oklch(0.95 0.07 90)` #FFEDB9                                 | `oklch(0.33 0.06 75)` #47300C    |
| `status-under_construction-mark` | `oklch(0.64 0.15 58)` #CE710C                                 | `oklch(0.78 0.15 70)` #F4A437    |
| `status-planned-fg`              | `oklch(0.4 0.13 258)` #11458C                                 | `oklch(0.87 0.07 255)` #B6D7FF   |
| `status-planned-bg`              | `oklch(0.94 0.035 258)` #DDECFF                               | `oklch(0.31 0.06 258)` #1C314E   |
| `status-planned-mark`            | `oklch(0.58 0.15 258)` #3C79D1                                | `oklch(0.7 0.13 258)` #6A9FEE    |
| `status-suspended-fg`            | `oklch(0.43 0.12 45)` #833404                                 | `oklch(0.86 0.08 55)` #FBC49F    |
| `status-suspended-bg`            | `oklch(0.94 0.04 50)` #FFE4D4                                 | `oklch(0.32 0.06 50)` #4B2915    |
| `status-suspended-mark`          | `oklch(0.66 0.16 45)` #DF6C32                                 | `oklch(0.74 0.14 50)` #F08E54    |
| `status-closed-fg`               | `oklch(0.42 0.13 25)` #862726                                 | `oklch(0.86 0.07 20)` #FCBFBE    |
| `status-closed-bg`               | `oklch(0.94 0.03 20)` #FFE4E3                                 | `oklch(0.31 0.07 22)` #4E2020    |
| `status-closed-mark`             | `oklch(0.58 0.17 25)` #CB4644                                 | `oklch(0.7 0.15 25)` #ED756E     |
| `status-abandoned-fg`            | `oklch(0.4 0.01 255)` #44484D                                 | `oklch(0.84 0.008 255)` #C7CBD0  |
| `status-abandoned-bg`            | `oklch(0.93 0.004 255)` #E6E8EA                               | `oklch(0.29 0.008 255)` #292C2F  |
| `status-abandoned-mark`          | `oklch(0.62 0.01 255)` #82878C                                | `oklch(0.6 0.01 255)` #7C8186    |
| `stage-early`                    | `oklch(0.62 0.03 255)` #7A8798                                | `oklch(0.62 0.03 255)` #7A8798   |
| `stage-early-fg`                 | `oklch(0.4 0.03 255)` #3D4958                                 | `oklch(0.82 0.02 255)` #BCC5D1   |
| `stage-study`                    | `oklch(0.55 0.15 300)` #8059BB                                | `oklch(0.7 0.13 300)` #AB8BE3    |
| `stage-study-fg`                 | `oklch(0.42 0.15 300)` #5B3291                                | `oklch(0.84 0.09 300)` #D3BEFD   |
| `stage-design`                   | `oklch(0.52 0.15 255)` #1F68BC                                | `oklch(0.7 0.13 255)` #64A1EE    |
| `stage-design-fg`                | `oklch(0.42 0.14 255)` #004B97                                | `oklch(0.84 0.08 255)` #A8CEFF   |
| `stage-build`                    | `oklch(0.65 0.15 60)` #D0750A                                 | `oklch(0.78 0.14 70)` #F0A646    |
| `stage-build-fg`                 | `oklch(0.43 0.1 65)` #744200                                  | `oklch(0.86 0.11 80)` #F7C97B    |
| `stage-open`                     | `oklch(0.55 0.14 150)` #1C8742                                | `oklch(0.72 0.14 150)` #5BBD74   |
| `stage-open-fg`                  | `oklch(0.4 0.1 150)` #115629                                  | `oklch(0.85 0.1 150)` #9EE1AB    |
| `stage-stopped`                  | `oklch(0.6 0.01 255)` #7C8186                                 | `oklch(0.56 0.01 255)` #71757A   |
| `stage-stopped-fg`               | `oklch(0.42 0.01 255)` #494D53                                | `oklch(0.8 0.01 255)` #B9BEC4    |
| `review-fg`                      | `oklch(0.43 0.09 75)` #6C4701                                 | `oklch(0.88 0.1 88)` #F3D489     |
| `review-bg`                      | `oklch(0.96 0.05 90)` #FFF1CC                                 | `oklch(0.32 0.06 80)` #432F07    |
| `review-border`                  | `oklch(0.72 0.12 80)` #CC9C42                                 | `oklch(0.56 0.09 82)` #8F6F30    |

그림자 `shadow-sm/md/lg` 도 배색별로 다르다(다크는 검정 투명도를 키움).

## 3. 의미 색 규칙 — 색만으로 전달하지 않는다 (NFR-OPS-020, SC 1.4.1)

| 대상           | 색                                                      | 색 말고 함께 쓰는 단서                                                                                                |
| -------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 시설 상태      | `status-<code>-fg/bg/mark`                              | **모양**(`STATUS_SHAPE`): 운영 ● / 공사 ◐ / 계획 ○ / 중단 ‖ / 폐지 ✕ / 폐기 — + 라벨(contracts)                       |
| 계획 단계      | 단계 묶음 `stage-early/study/design/build/open/stopped` | **선 모양**(`STAGE_GROUP_LINE`: 시공·개통 실선 / 설계 굵은 점선 / 그 전 가는 점선) + 단계 이름 + 진행 띠의 번호(1~12) |
| 검수 상태      | `review-fg/bg/border`                                   | **점선 테두리** + "검수 전" 글자(검수됨은 실선 테두리 + ●)                                                            |
| 노선           | 노선 공식 색(데이터)                                    | 노선 이름·번호 칩 늘 병기. 공식 색이 없으면 **점선 칩**. 노선 색을 글자색으로 쓰지 않는다                             |
| 미래 지도 계획 | 연장 = 기존 노선색, 공식색, 아니면 단계 묶음 색         | 선 모양 + 이름 라벨 + 지도 밖 목록(FR-WEB-023·026). 개략 선형은 흐린 가는 점선 + 범례                                 |

단계 묶음(`STAGE_GROUP`): 구상·계획 반영 = early, 예비타당성·타당성·전략환경 = study, 기본계획·기본설계·환경영향·실시설계 = design, 공사·시운전 = build, 개통 = open, 폐기·휴면 = stopped. 지도 패키지의 `STAGE_COLORS`·`STATUS_COLORS` 는 이 묶음 색(라이트 hex)이다.

## 4. 글자·여백·모양·움직임

| 묶음   | 토큰                                                                                                                                                                                                                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 글꼴   | `font-sans` = Pretendard Variable(SIL OFL 1.1, **공개 사이트는 자가 호스팅** 동적 부분 집합) → `Pretendard Fallback`(공개 사이트 `globals.css` 가 정의: 시스템 글꼴을 글자 폭·높이를 맞춰 줄인 것, 글꼴 교체 CLS 방지 — WP 7.6) → 시스템 한글 글꼴. `font-mono` = ui-monospace 계열 |
| 크기   | `text-xs` 12 / `sm` 14 / `base` 16 / `lg` 18 / `xl` 20 / `2xl` 24 / `3xl` 30 / `display` clamp(32~44). 각각 `-lh`(줄 높이: 본문 1.7) · `-ls`(자간: 큰 제목 음수)                                                                                                                    |
| 굵기   | `weight-regular` 400 · `medium` 500 · `semibold` 600 · `bold` 700 · `heavy` 800                                                                                                                                                                                                     |
| 여백   | `space-0~16` 4px 격자(0.5=2px, 1=4px, 2=8px, 2_5=10px, 3=12px, 4=16px, 6=24px, 8=32px, 12=48px, 16=64px) — Tailwind 기본 눈금과 같다                                                                                                                                                |
| 반경   | `radius-xs` 3 · `sm` 5 · `md` 8 · `lg` 12 · `xl` 16 · `pill`                                                                                                                                                                                                                        |
| 움직임 | `duration-fast` 120ms · `base` 180ms · `slow` 280ms · `map` 450ms, `ease-standard/enter/exit`. `prefers-reduced-motion: reduce` 이면 모두 0                                                                                                                                         |
| 쌓임   | `z-sticky` 100 · `map-controls` 200 · `dropdown` 300 · `overlay` 400 · `modal` 500 · `toast` 600 · `tooltip` 700 · `skip-link` 800                                                                                                                                                  |
| 배치   | `content-max` 1200px · `measure` 68ch · `sidebar-w` 320px · `map-panel-w` 384px · `header-h` 56px · `gutter` 16px(`-lg` 24px) · `target-min` 24px · `line-band` 6px                                                                                                                 |

반응형 기준 폭(TS `breakpoints`): sm 640 · md 768 · lg 1024 · xl 1280(Tailwind 기본).

## 5. 관리 앱 적용(완료)

- `apps/admin/src/styles.css` 는 `tokens.css` → `tailwind.css` → `base.css` 를 가져오기만 한다(임시 토큰 삭제).
- 기존 Tailwind 색 이름은 별칭으로 유지: `bg`→`--kr-bg`, `bg-elevated`→`surface`, `muted`→`surface-muted`, `primary`/`primary-fg`→`accent`/`accent-fg`, `ring`→`focus`. 새 코드는 `surface`·`accent`·`*-soft` 이름을 쓴다.
- 바뀐 것: 포커스 고리가 파랑 → **주황 3px**(기존 공개 사이트와 같음), `warn` 글자색이 AA 를 넘도록 어두워짐, 위험 버튼 글자 `text-danger-fg`(다크에서 흰 글자 대비 부족 해결), `Badge` 색조가 `*-soft` 바탕.
- 확인: `pnpm -F @k-raildex/admin build`·`e2e`(20건) 통과, 대시보드·노선 목록·계획·역 편집 화면을 라이트/다크로 찍어 대비 확인(2026-11-21).

## 6. 시안

`docs/design/mockups/` — 자체 포함 HTML 5개(인라인 CSS = 이 토큰 + 시안 컴포넌트, 외부 스크립트 없음, 글꼴만 미리보기용 CDN). 표본 데이터는 개발 DB(2026-11-21)에서 뽑았고 화면에 "시안·표본" 띠를 둔다. 스크린숏은 `mockups/screenshots/`(1440px 라이트/다크 + 390px 모바일 1장).

| 파일                  | 화면                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `home.html`           | 검색 중심 머리, 수록 현황, 진입 카드, 미래 지도 소개, 개통 예정·최근 변경, 권역별              |
| `line-detail.html`    | 서울 지하철 2호선: 노선 색 띠·번호 표지·핵심 수치(출처 각주)·절 탐색·정거장 순서(환승 칩)·약도 |
| `station-detail.html` | 서울역: 노선별 색 띠, 노선별 카드(역번호·이웃 역·운영기관), 시간대별 열차 수 막대, 관련 계획   |
| `plan-detail.html`    | 부전~마산 복선전철: 12단계 진행 띠, 기대 일정(근거·발표 시점), 단계 이력 타임라인, 반영 내역   |
| `future-map.html`     | 미래 지도 2034: 옆 패널(현재/미래·연도·단계 필터·범례·새 노선 목록), 연도 띠, 계획 정보 창     |

## 로고(2026-11-26 D1안 "환승점 K")

- 파랑 세로 노선(`accent`)과 거기서 갈라지는 초록(`brand-green`)·노랑(`brand-amber`) 노선이 K 를 이루고, 세 노선이 만나는 자리가 환승역 고리(`fg`)다. 바탕은 `surface` 타일 + `border` 테두리.
- 모양의 단일 정의: `packages/ui/src/brand.tsx`(`BRAND_GEOMETRY`). 화면은 `<BrandMark />`(토큰 색 — 라이트·다크를 따른다), 공개 사이트 머리·관리 앱 사이드바에 쓴다.
- 정적 파일: `apps/web/src/app/icon.svg`(파비콘)·`apps/admin/public/favicon.svg` = `brandMarkSvg('light')`. 시험 `packages/ui/test/brand.test.ts` 가 일치를 확인하고, `UPDATE_BRAND=1` 로 다시 만든다.
- PNG: `apps/web/src/app/apple-icon.png`(180, 테두리 없이 꽉 채움)·`apps/web/public/opengraph-image.png`(1200×630, 기호 + 한국철도도감 · K-RAILDEX · 부제) — `node apps/web/scripts/brand-images.mjs`. 공유 이미지는 `lib/site.ts` 의 `OG_IMAGE` 로 모든 페이지 메타데이터에 넣는다.
- 노선 색은 특정 운영기관의 노선 색이 아닌 일반 노선도 색이다.
