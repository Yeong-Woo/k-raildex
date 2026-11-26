/**
 * 로고 정적 파일이 brand.tsx 의 모양·토큰 색과 같은지(두 벌로 그리지 않는다).
 * 다시 만들기: UPDATE_BRAND=1 pnpm -F @k-raildex/ui exec vitest run test/brand.test.ts
 * PNG(애플 아이콘·공유 이미지)는 이 SVG 로 apps/web/scripts/brand-images.mjs 가 만든다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { brandMarkSvg } from '../src/brand';
import { colorHex, contrastRatio } from '../src/tokens';

const FILES = ['../../../apps/web/src/app/icon.svg', '../../../apps/admin/public/favicon.svg'].map((p) =>
  fileURLToPath(new URL(p, import.meta.url)),
);

describe('로고', () => {
  it('정적 SVG 파일 = brandMarkSvg(light)', () => {
    const svg = brandMarkSvg('light') + '\n';
    for (const f of FILES) {
      if (process.env.UPDATE_BRAND) writeFileSync(f, svg);
      expect(readFileSync(f, 'utf8'), f).toBe(svg);
    }
  });

  it('갈래 노선 색이 두 테마의 면 위에서 보인다(3:1 이상 또는 노랑은 2:1 이상 — 장식 그래픽)', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const h = colorHex(scheme);
      expect(contrastRatio(h.accent, h.surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(h['brand-green'], h.surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(h['brand-amber'], h.surface)).toBeGreaterThanOrEqual(2);
      expect(contrastRatio(h.fg, h.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
