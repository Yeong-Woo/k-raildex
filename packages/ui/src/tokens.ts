/**
 * 디자인 토큰의 단일 정의(WP 6.3, docs/design/tokens.md).
 *
 * - 색은 OKLCH 로 정의하고, CSS 색 함수를 못 쓰는 곳(MapLibre 스타일·캔버스·OG 이미지·SVG 내보내기)을 위해
 *   `oklchToHex` 로 sRGB hex 를 계산해 준다(값을 두 벌로 적지 않는다).
 * - CSS 사용자 지정 속성 파일 `tokens.css` 는 이 파일에서 만든다: `node packages/ui/scripts/gen-tokens.ts`.
 *   시험(packages/ui/test/tokens.test.ts)이 두 파일의 일치와 명도 대비(WCAG 2.2 AA)를 확인한다.
 * - 이 파일은 다른 모듈을 가져오지 않는다(node 의 타입 제거 실행으로 바로 읽히도록).
 * - 코드값 라벨(한국어 이름)은 packages/contracts 에 있다. 여기에는 시각 규칙(색·모양)만 둔다.
 */

export type ColorScheme = 'light' | 'dark';

/** 접두사. CSS 속성 이름은 `--kr-<이름>` */
export const TOKEN_PREFIX = 'kr';

const N = 255; // 무채색의 색상각(약간 푸른 회색 — 철도 안내 표지의 차가운 회색)

/** 색 토큰: 이름 → [라이트, 다크] (OKLCH) */
export const colorTokens = {
  // 면
  bg: [`oklch(0.975 0.003 ${N})`, `oklch(0.185 0.009 ${N})`],
  surface: ['oklch(1 0 0)', `oklch(0.22 0.011 ${N})`],
  'surface-muted': [`oklch(0.955 0.005 ${N})`, `oklch(0.26 0.012 ${N})`],
  'surface-sunken': [`oklch(0.935 0.006 ${N})`, `oklch(0.16 0.008 ${N})`],
  overlay: [`oklch(0.2 0.02 ${N} / 0.45)`, 'oklch(0 0 0 / 0.6)'],
  // 글자
  fg: [`oklch(0.22 0.014 ${N})`, `oklch(0.94 0.005 ${N})`],
  'fg-muted': [`oklch(0.44 0.016 ${N})`, `oklch(0.77 0.012 ${N})`],
  'fg-subtle': [`oklch(0.52 0.014 ${N})`, `oklch(0.69 0.012 ${N})`],
  // 경계
  border: [`oklch(0.9 0.006 ${N})`, `oklch(0.33 0.012 ${N})`],
  'border-strong': [`oklch(0.62 0.012 ${N})`, `oklch(0.54 0.014 ${N})`],
  // 강조(링크·주 버튼) — 기존 사이트의 남색 링크를 잇는다
  accent: ['oklch(0.47 0.15 258)', `oklch(0.76 0.12 ${N})`],
  'accent-fg': ['oklch(0.99 0 0)', 'oklch(0.18 0.02 258)'],
  'accent-soft': ['oklch(0.94 0.03 258)', 'oklch(0.31 0.06 258)'],
  'accent-soft-fg': ['oklch(0.38 0.13 258)', `oklch(0.87 0.07 ${N})`],
  link: ['oklch(0.45 0.15 258)', `oklch(0.78 0.11 ${N})`],
  'link-visited': ['oklch(0.44 0.15 300)', 'oklch(0.78 0.11 300)'],
  /** 포커스 고리 — 노선 색과 겹치지 않는 주황(기존 사이트 승계), 면 위 3:1 이상 */
  focus: ['oklch(0.66 0.17 55)', 'oklch(0.8 0.15 75)'],
  // 알림 의미색(글자로 써도 AA)
  danger: ['oklch(0.5 0.18 27)', 'oklch(0.72 0.15 25)'],
  'danger-fg': ['oklch(0.99 0 0)', 'oklch(0.18 0.02 25)'],
  'danger-soft': ['oklch(0.95 0.025 27)', 'oklch(0.31 0.07 25)'],
  warn: ['oklch(0.5 0.11 65)', 'oklch(0.8 0.13 80)'],
  'warn-fg': ['oklch(0.99 0 0)', 'oklch(0.2 0.03 75)'],
  'warn-soft': ['oklch(0.95 0.05 85)', 'oklch(0.32 0.06 75)'],
  good: ['oklch(0.47 0.11 150)', 'oklch(0.78 0.13 150)'],
  'good-fg': ['oklch(0.99 0 0)', 'oklch(0.2 0.03 150)'],
  'good-soft': ['oklch(0.95 0.04 150)', 'oklch(0.3 0.05 150)'],
  info: ['oklch(0.47 0.15 258)', `oklch(0.76 0.12 ${N})`],
  'info-soft': ['oklch(0.94 0.03 258)', 'oklch(0.31 0.06 258)'],
  // 시설 상태(노선·역·노선별 역): fg/bg = 배지 글자·바탕, mark = 점·선(면 위 3:1 이상)
  'status-operating-fg': ['oklch(0.4 0.1 150)', 'oklch(0.86 0.1 150)'],
  'status-operating-bg': ['oklch(0.94 0.05 150)', 'oklch(0.31 0.06 150)'],
  'status-operating-mark': ['oklch(0.58 0.14 150)', 'oklch(0.72 0.15 150)'],
  'status-under_construction-fg': ['oklch(0.42 0.09 70)', 'oklch(0.88 0.11 90)'],
  'status-under_construction-bg': ['oklch(0.95 0.07 90)', 'oklch(0.33 0.06 75)'],
  'status-under_construction-mark': ['oklch(0.64 0.15 58)', 'oklch(0.78 0.15 70)'],
  'status-planned-fg': ['oklch(0.4 0.13 258)', `oklch(0.87 0.07 ${N})`],
  'status-planned-bg': ['oklch(0.94 0.035 258)', 'oklch(0.31 0.06 258)'],
  'status-planned-mark': ['oklch(0.58 0.15 258)', 'oklch(0.7 0.13 258)'],
  'status-suspended-fg': ['oklch(0.43 0.12 45)', 'oklch(0.86 0.08 55)'],
  'status-suspended-bg': ['oklch(0.94 0.04 50)', 'oklch(0.32 0.06 50)'],
  'status-suspended-mark': ['oklch(0.66 0.16 45)', 'oklch(0.74 0.14 50)'],
  'status-closed-fg': ['oklch(0.42 0.13 25)', 'oklch(0.86 0.07 20)'],
  'status-closed-bg': ['oklch(0.94 0.03 20)', 'oklch(0.31 0.07 22)'],
  'status-closed-mark': ['oklch(0.58 0.17 25)', 'oklch(0.7 0.15 25)'],
  'status-abandoned-fg': [`oklch(0.4 0.01 ${N})`, `oklch(0.84 0.008 ${N})`],
  'status-abandoned-bg': [`oklch(0.93 0.004 ${N})`, `oklch(0.29 0.008 ${N})`],
  'status-abandoned-mark': [`oklch(0.62 0.01 ${N})`, `oklch(0.6 0.01 ${N})`],
  // 계획 단계 묶음: base = 띠·선(면 위 3:1 이상), fg = 글자(면 위 4.5:1 이상)
  'stage-early': [`oklch(0.62 0.03 ${N})`, `oklch(0.62 0.03 ${N})`],
  'stage-early-fg': [`oklch(0.4 0.03 ${N})`, `oklch(0.82 0.02 ${N})`],
  'stage-study': ['oklch(0.55 0.15 300)', 'oklch(0.7 0.13 300)'],
  'stage-study-fg': ['oklch(0.42 0.15 300)', 'oklch(0.84 0.09 300)'],
  'stage-design': [`oklch(0.52 0.15 ${N})`, `oklch(0.7 0.13 ${N})`],
  'stage-design-fg': [`oklch(0.42 0.14 ${N})`, `oklch(0.84 0.08 ${N})`],
  'stage-build': ['oklch(0.65 0.15 60)', 'oklch(0.78 0.14 70)'],
  'stage-build-fg': ['oklch(0.43 0.1 65)', 'oklch(0.86 0.11 80)'],
  'stage-open': ['oklch(0.55 0.14 150)', 'oklch(0.72 0.14 150)'],
  'stage-open-fg': ['oklch(0.4 0.1 150)', 'oklch(0.85 0.1 150)'],
  'stage-stopped': [`oklch(0.6 0.01 ${N})`, `oklch(0.56 0.01 ${N})`],
  'stage-stopped-fg': [`oklch(0.42 0.01 ${N})`, `oklch(0.8 0.01 ${N})`],
  // 검수 상태("검수 전" 배지) — 점선 테두리와 함께 쓴다
  'review-fg': ['oklch(0.43 0.09 75)', 'oklch(0.88 0.1 88)'],
  'review-bg': ['oklch(0.96 0.05 90)', 'oklch(0.32 0.06 80)'],
  'review-border': ['oklch(0.72 0.12 80)', 'oklch(0.56 0.09 82)'],
} as const satisfies Record<string, readonly [string, string]>;

export type ColorToken = keyof typeof colorTokens;

/** 그림자(배색에 따라 다름) */
export const shadowTokens = {
  sm: [`0 1px 2px oklch(0.2 0.02 ${N} / 0.06), 0 1px 3px oklch(0.2 0.02 ${N} / 0.08)`, '0 1px 2px oklch(0 0 0 / 0.5)'],
  md: [`0 4px 14px oklch(0.2 0.02 ${N} / 0.1)`, '0 4px 14px oklch(0 0 0 / 0.5)'],
  lg: [`0 14px 36px oklch(0.2 0.02 ${N} / 0.16)`, '0 14px 36px oklch(0 0 0 / 0.6)'],
} as const satisfies Record<string, readonly [string, string]>;

/** 글꼴 — Pretendard(SIL OFL 1.1)는 자가 호스팅(06 문서 4절). 없으면 시스템 한글 글꼴 */
export const fontTokens = {
  sans: "'Pretendard Variable', 'Pretendard Fallback', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif",
  mono: "ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, Consolas, 'Noto Sans Mono CJK KR', monospace",
} as const;

/** 글자 크기: [크기, 줄 높이, 자간]. 한글 본문은 줄 높이를 넉넉히(1.7) */
export const textTokens = {
  xs: ['0.75rem', '1.5', '0'],
  sm: ['0.875rem', '1.55', '0'],
  base: ['1rem', '1.7', '0'],
  lg: ['1.125rem', '1.55', '-0.005em'],
  xl: ['1.25rem', '1.45', '-0.01em'],
  '2xl': ['1.5rem', '1.35', '-0.015em'],
  '3xl': ['1.875rem', '1.25', '-0.02em'],
  display: ['clamp(2rem, 1.4rem + 2.4vw, 2.75rem)', '1.15', '-0.025em'],
} as const satisfies Record<string, readonly [string, string, string]>;

export const weightTokens = { regular: '400', medium: '500', semibold: '600', bold: '700', heavy: '800' } as const;

/** 여백 — 4px 격자(Tailwind 기본 눈금과 같다) */
export const spaceTokens = {
  '0': '0',
  '0.5': '0.125rem',
  '1': '0.25rem',
  '1.5': '0.375rem',
  '2': '0.5rem',
  '2.5': '0.625rem',
  '3': '0.75rem',
  '4': '1rem',
  '5': '1.25rem',
  '6': '1.5rem',
  '8': '2rem',
  '10': '2.5rem',
  '12': '3rem',
  '16': '4rem',
} as const;

export const radiusTokens = {
  xs: '3px',
  sm: '5px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  pill: '999px',
} as const;

/** 움직임 — 짧게, 의미 있을 때만. prefers-reduced-motion 이면 0 */
export const motionTokens = {
  'duration-fast': '120ms',
  'duration-base': '180ms',
  'duration-slow': '280ms',
  'duration-map': '450ms',
  'ease-standard': 'cubic-bezier(0.2, 0, 0, 1)',
  'ease-enter': 'cubic-bezier(0, 0, 0, 1)',
  'ease-exit': 'cubic-bezier(0.3, 0, 1, 1)',
} as const;

/** 쌓임 순서 */
export const zTokens = {
  base: '0',
  raised: '1',
  sticky: '100',
  'map-controls': '200',
  dropdown: '300',
  overlay: '400',
  modal: '500',
  toast: '600',
  tooltip: '700',
  'skip-link': '800',
} as const;

/** 배치 치수 */
export const layoutTokens = {
  'content-max': '75rem', // 1200px
  measure: '68ch', // 본문 한 줄 길이
  'sidebar-w': '20rem',
  'map-panel-w': '24rem',
  'header-h': '3.5rem',
  gutter: '1rem',
  'gutter-lg': '1.5rem',
  'target-min': '24px', // WCAG 2.2 SC 2.5.8
  'target-comfort': '44px',
  'line-band': '6px', // 노선 색 띠 두께
} as const;

/** 반응형 기준 폭(px) — Tailwind 기본과 같다. CSS 변수로는 쓸 수 없어 문서·TS 용 */
export const breakpoints = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;

// ---------------------------------------------------------------- 의미 규칙(색만으로 전달하지 않기)

/** 시설 상태 → 모양(배지·범례·지도 점에 색과 함께 쓴다, NFR-OPS-020) */
export const STATUS_SHAPE = {
  operating: 'disc', // ● 속이 찬 원
  under_construction: 'half', // ◐ 반쯤 찬 원
  planned: 'ring', // ○ 속이 빈 원
  suspended: 'pause', // ‖ 두 막대
  closed: 'cross', // ✕
  abandoned: 'dash', // — 가로 막대
} as const;
export type FacilityStatus = keyof typeof STATUS_SHAPE;
export type StatusShape = (typeof STATUS_SHAPE)[FacilityStatus];

/** 계획 단계(contracts 의 14개 코드) → 단계 묶음 */
export const STAGE_GROUP = {
  concept: 'early',
  plan_listed: 'early',
  prefeasibility: 'study',
  feasibility: 'study',
  strategic_eia: 'study',
  basic_plan: 'design',
  basic_design: 'design',
  eia: 'design',
  detail_design: 'design',
  construction: 'build',
  trial_run: 'build',
  opened: 'open',
  abandoned: 'stopped',
  dormant: 'stopped',
} as const;
export type PlanStage = keyof typeof STAGE_GROUP;
export type StageGroup = (typeof STAGE_GROUP)[PlanStage];

/** 단계 묶음 → 선 모양(FR-WEB-023: 시공 실선 / 설계 굵은 점선 / 그 전 가는 점선) */
export const STAGE_GROUP_LINE: Readonly<Record<StageGroup, 'solid' | 'dashed_bold' | 'dashed_thin'>> = {
  early: 'dashed_thin',
  study: 'dashed_thin',
  design: 'dashed_bold',
  build: 'solid',
  open: 'solid',
  stopped: 'dashed_thin',
};

// ---------------------------------------------------------------- 색 변환

/** OKLCH 문자열(`oklch(L C H)` 또는 `oklch(L C H / a)`)을 sRGB 0..1 로(범위 밖은 자름) */
export function oklchToRgb(value: string): { r: number; g: number; b: number; alpha: number } {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/.exec(value.trim());
  if (!m) throw new Error(`OKLCH 형식이 아닙니다: ${value}`);
  const L = Number(m[1]);
  const C = Number(m[2]);
  const h = (Number(m[3]) * Math.PI) / 180;
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const enc = (x: number) => {
    const c = Math.min(1, Math.max(0, x));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  };
  return {
    r: enc(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    g: enc(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    b: enc(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
    alpha,
  };
}

/** OKLCH → `#RRGGBB`(대문자, 투명도는 버림) */
export function oklchToHex(value: string): string {
  const { r, g, b } = oklchToRgb(value);
  return `#${[r, g, b]
    .map((x) =>
      Math.round(x * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) throw new Error(`hex 형식이 아닙니다: ${hex}`);
  return [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255];
}

/** WCAG 상대 휘도(hex) */
export function relativeLuminance(hex: string): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x 명도 대비(hex 두 개) */
export function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a);
  const y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * 노선 색(DB `line.color`, hex) 위에 올릴 글자색 — 대비가 더 큰 쪽(거의 흰색 / 거의 검정).
 * 노선 번호 칩처럼 노선 색을 바탕으로 쓸 때만. 노선 색을 글자색으로 쓰지 않는다.
 */
export function readableOn(lineHex: string): '#FFFFFF' | '#111418' {
  return contrastRatio(lineHex, '#FFFFFF') >= contrastRatio(lineHex, '#111418') ? '#FFFFFF' : '#111418';
}

/**
 * 노선 색 바탕 칩(작은 글자)의 바탕·글자색. 어느 글자색으로도 4.5:1 이 안 되는 중간 밝기 색(예 #957326 = 4.41:1)은
 * 바탕만 글자 반대쪽(흰 글자면 검정, 어두운 글자면 흰색)으로 2%씩 섞어 4.5:1 을 맞춘다(WCAG 1.4.3, WP 7.6 접근성 점검).
 * 지도 선·띠처럼 글자가 없는 곳은 원래 색을 그대로 쓴다.
 */
export function readableChip(lineHex: string): { background: string; color: '#FFFFFF' | '#111418' } {
  const color = readableOn(lineHex);
  if (contrastRatio(lineHex, color) >= 4.5) return { background: lineHex, color };
  const [r, g, b] = hexToRgb(lineHex);
  const toward = color === '#FFFFFF' ? 0 : 1;
  const hex = (t: number) =>
    `#${[r, g, b]
      .map((c) =>
        Math.round((c + (toward - c) * t) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase()}`;
  for (let t = 0.02; t <= 0.5; t += 0.02) {
    const bg = hex(t);
    if (contrastRatio(bg, color) >= 4.5) return { background: bg, color };
  }
  return { background: hex(0.5), color };
}

/** 배색별 색 토큰 hex(지도·캔버스용) */
export function colorHex(scheme: ColorScheme): Record<ColorToken, string> {
  const i = scheme === 'light' ? 0 : 1;
  const out = {} as Record<ColorToken, string>;
  for (const [k, v] of Object.entries(colorTokens) as [ColorToken, readonly [string, string]][]) {
    out[k] = oklchToHex(v[i]);
  }
  return out;
}

/** CSS 변수 참조 */
export function cssVar(name: string): string {
  return `var(--${TOKEN_PREFIX}-${name})`;
}

// ---------------------------------------------------------------- CSS 만들기

function block(entries: [string, string][], indent: string): string {
  return entries.map(([k, v]) => `${indent}--${TOKEN_PREFIX}-${k}: ${v};`).join('\n');
}

function schemeEntries(i: 0 | 1): [string, string][] {
  return [
    ...Object.entries(colorTokens).map(([k, v]) => [k, v[i]] as [string, string]),
    ...Object.entries(shadowTokens).map(([k, v]) => [`shadow-${k}`, v[i]] as [string, string]),
  ];
}

/** tokens.css 본문(생성기·시험이 함께 쓴다) */
export function renderTokensCss(): string {
  const fixed: [string, string][] = [
    ...Object.entries(fontTokens).map(([k, v]) => [`font-${k}`, v] as [string, string]),
    ...Object.entries(textTokens).flatMap(
      ([k, [size, lh, ls]]) =>
        [
          [`text-${k}`, size],
          [`text-${k}-lh`, lh],
          [`text-${k}-ls`, ls],
        ] as [string, string][],
    ),
    ...Object.entries(weightTokens).map(([k, v]) => [`weight-${k}`, v] as [string, string]),
    ...Object.entries(spaceTokens).map(([k, v]) => [`space-${k.replace('.', '_')}`, v] as [string, string]),
    ...Object.entries(radiusTokens).map(([k, v]) => [`radius-${k}`, v] as [string, string]),
    ...Object.entries(motionTokens).map(([k, v]) => [k, v] as [string, string]),
    ...Object.entries(zTokens).map(([k, v]) => [`z-${k}`, v] as [string, string]),
    ...Object.entries(layoutTokens).map(([k, v]) => [k, v] as [string, string]),
  ];
  const durations = Object.keys(motionTokens).filter((k) => k.startsWith('duration-'));
  return [
    '/* 생성 파일 — 직접 고치지 않는다. 원본: packages/ui/src/tokens.ts, 만들기: node packages/ui/scripts/gen-tokens.ts */',
    '/* 문서: docs/design/tokens.md */',
    '',
    ':root {',
    '  color-scheme: light;',
    block(fixed, '  '),
    block(schemeEntries(0), '  '),
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    "  :root:not([data-theme='light']) {",
    '    color-scheme: dark;',
    block(schemeEntries(1), '    '),
    '  }',
    '}',
    '',
    ":root[data-theme='dark'] {",
    '  color-scheme: dark;',
    block(schemeEntries(1), '  '),
    '}',
    '',
    '@media (prefers-reduced-motion: reduce) {',
    '  :root {',
    durations.map((k) => `    --${TOKEN_PREFIX}-${k}: 0ms;`).join('\n'),
    '  }',
    '}',
    '',
  ].join('\n');
}
