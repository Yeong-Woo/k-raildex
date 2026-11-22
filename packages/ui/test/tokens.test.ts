import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STAGE_COLORS, STAGE_ORDER, STATUS_COLORS } from '../../map/src/index';
import {
  colorHex,
  colorTokens,
  contrastRatio,
  oklchToHex,
  readableChip,
  readableOn,
  renderTokensCss,
  STAGE_GROUP,
  STATUS_SHAPE,
  type ColorScheme,
  type ColorToken,
} from '../src/tokens';

const squash = (s: string) => s.replace(/\s+/g, '');

/** [글자/표시, 바탕, 최소 대비] — 글자 4.5:1(본문 7:1), 표시·경계 3:1 (WCAG 2.2 SC 1.4.3·1.4.11) */
const PAIRS: [ColorToken, ColorToken, number][] = [
  ['fg', 'bg', 7],
  ['fg', 'surface', 7],
  ['fg', 'surface-muted', 7],
  ['fg-muted', 'bg', 4.5],
  ['fg-muted', 'surface-muted', 4.5],
  ['fg-subtle', 'surface', 4.5],
  ['fg-subtle', 'bg', 4.5],
  ['border-strong', 'surface', 3],
  ['accent', 'surface', 4.5],
  ['accent', 'bg', 4.5],
  ['accent-fg', 'accent', 4.5],
  ['accent-soft-fg', 'accent-soft', 4.5],
  ['link', 'bg', 4.5],
  ['link-visited', 'surface', 4.5],
  ['focus', 'surface', 3],
  ['focus', 'bg', 3],
  ['danger', 'surface', 4.5],
  ['danger', 'danger-soft', 4.5],
  ['danger-fg', 'danger', 4.5],
  ['warn', 'surface', 4.5],
  ['warn', 'warn-soft', 4.5],
  ['warn-fg', 'warn', 4.5],
  ['good', 'surface', 4.5],
  ['good', 'good-soft', 4.5],
  ['good-fg', 'good', 4.5],
  ['info', 'info-soft', 4.5],
  ['review-fg', 'review-bg', 4.5],
  ...(Object.keys(STATUS_SHAPE) as (keyof typeof STATUS_SHAPE)[]).flatMap(
    (s) =>
      [
        [`status-${s}-fg`, `status-${s}-bg`, 4.5],
        [`status-${s}-fg`, 'surface', 4.5],
        [`status-${s}-mark`, 'surface', 3],
      ] as [ColorToken, ColorToken, number][],
  ),
  ...(['early', 'study', 'design', 'build', 'open', 'stopped'] as const).flatMap(
    (g) =>
      [
        [`stage-${g}`, 'surface', 3],
        [`stage-${g}-fg`, 'surface', 4.5],
        [`stage-${g}-fg`, 'bg', 4.5],
      ] as [ColorToken, ColorToken, number][],
  ),
];

describe('design tokens', () => {
  it('tokens.css is generated from tokens.ts (run `pnpm -F @k-raildex/ui tokens`)', () => {
    const css = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8');
    expect(squash(css)).toBe(squash(renderTokensCss()));
  });

  it('converts OKLCH to sRGB hex', () => {
    expect(oklchToHex('oklch(1 0 0)')).toBe('#FFFFFF');
    expect(oklchToHex('oklch(0 0 0)')).toBe('#000000');
    // 잘 알려진 값: oklch(0.6279 0.2577 29.23) ≈ #FF0000
    expect(oklchToHex('oklch(0.6279 0.2577 29.23)')).toBe('#FF0000');
    expect(() => oklchToHex('#fff')).toThrow();
  });

  for (const scheme of ['light', 'dark'] as ColorScheme[]) {
    it(`meets WCAG 2.2 AA contrast pairs in ${scheme}`, () => {
      const hex = colorHex(scheme);
      const failures = PAIRS.filter(([a, b, min]) => contrastRatio(hex[a], hex[b]) < min).map(
        ([a, b, min]) => `${a} on ${b}: ${contrastRatio(hex[a], hex[b]).toFixed(2)} < ${min}`,
      );
      expect(failures).toEqual([]);
    });
  }

  it('defines every status and stage group in both schemes', () => {
    for (const s of Object.keys(STATUS_SHAPE)) {
      for (const part of ['fg', 'bg', 'mark']) expect(colorTokens).toHaveProperty(`status-${s}-${part}`);
    }
    for (const g of new Set(Object.values(STAGE_GROUP))) {
      expect(colorTokens).toHaveProperty(`stage-${g}`);
      expect(colorTokens).toHaveProperty(`stage-${g}-fg`);
    }
  });

  it('picks readable text on official line colors', () => {
    expect(readableOn('#004A85')).toBe('#FFFFFF'); // 짙은 남색(1호선 표본)
    expect(readableOn('#00A23F')).toBe('#111418'); // 2호선 초록 — 흰 글자는 3.3:1 이라 어두운 글자
    expect(readableOn('#F4A462')).toBe('#111418'); // 밝은 주황
    for (const c of ['#004A85', '#00A23F', '#009BCE', '#9A6292', '#81BF48', '#F4A462']) {
      expect(contrastRatio(c, readableOn(c))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('line chips reach 4.5:1 even on mid-tone colors (bg nudged, others untouched)', () => {
    for (const c of ['#217DCB', '#D93F5C', '#957326', '#6E7E31', '#004A85', '#00A23F', '#F4A462']) {
      const { background, color } = readableChip(c);
      expect(contrastRatio(background, color)).toBeGreaterThanOrEqual(4.5);
    }
    expect(readableChip('#004A85')).toEqual({ background: '#004A85', color: '#FFFFFF' });
    expect(readableChip('#957326').background).not.toBe('#957326');
  });

  it('map palette (packages/map) follows the stage-group and status tokens', () => {
    const light = colorHex('light');
    for (const stage of [...STAGE_ORDER, 'abandoned', 'dormant'] as (keyof typeof STAGE_GROUP)[]) {
      expect(STAGE_COLORS[stage]).toBe(light[`stage-${STAGE_GROUP[stage]}`]);
    }
    for (const s of Object.keys(STATUS_SHAPE) as (keyof typeof STATUS_SHAPE)[]) {
      expect(STATUS_COLORS[s]).toBe(light[`status-${s}-mark`]);
    }
  });
});
