/**
 * 로고(2026-11-26 D1안 "환승점 K"): 파랑 세로 노선과 거기서 갈라지는 초록·노랑 노선이 K 를 이루고,
 * 세 노선이 만나는 자리가 환승역 고리다. 바탕은 면(surface) 색 타일.
 *
 * - 화면 안: <BrandMark /> — 색은 CSS 토큰(--kr-*)이라 라이트·다크를 따른다.
 * - 정적 파일(파비콘 등): brandMarkSvg('light') — tokens.ts 의 hex 로 계산. 만들기: node packages/ui/scripts/gen-brand.ts
 * 모양은 BRAND_GEOMETRY 하나뿐이다(두 벌로 그리지 않는다).
 */
import type { SVGProps } from 'react';
import { colorHex, cssVar, type ColorScheme } from './tokens';

/** 32×32 격자 */
export const BRAND_GEOMETRY = {
  tile: { x: 0.5, y: 0.5, size: 31, r: 7.5 },
  stem: 'M10.5 5.5v21',
  upper: 'M10.5 16 25 5.8',
  lower: 'M10.5 16 25 26.2',
  lineWidth: 3.4,
  ring: { cx: 10.5, cy: 16, r: 4, width: 2.1 },
} as const;

interface BrandColors {
  tile: string;
  border: string;
  stem: string;
  upper: string;
  lower: string;
  ring: string;
}

function svgBody(c: BrandColors): string {
  const g = BRAND_GEOMETRY;
  const line = (d: string, color: string) =>
    `<path d="${d}" stroke="${color}" stroke-width="${g.lineWidth}" stroke-linecap="round" fill="none"/>`;
  return [
    `<rect x="${g.tile.x}" y="${g.tile.y}" width="${g.tile.size}" height="${g.tile.size}" rx="${g.tile.r}" fill="${c.tile}" stroke="${c.border}"/>`,
    line(g.stem, c.stem),
    line(g.upper, c.upper),
    line(g.lower, c.lower),
    `<circle cx="${g.ring.cx}" cy="${g.ring.cy}" r="${g.ring.r}" fill="${c.tile}" stroke="${c.ring}" stroke-width="${g.ring.width}"/>`,
  ].join('');
}

/** 정적 SVG 문자열(파비콘·관리 앱 아이콘). 바탕 타일 테두리 포함 */
export function brandMarkSvg(scheme: ColorScheme = 'light'): string {
  const h = colorHex(scheme);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${svgBody({
    tile: h.surface,
    border: h.border,
    stem: h.accent,
    upper: h['brand-green'],
    lower: h['brand-amber'],
    ring: h.fg,
  })}</svg>`;
}

/** 화면용 로고 기호(장식 — 옆에 사이트 이름 글자를 둔다) */
export function BrandMark({ size = 26, ...props }: { size?: number } & SVGProps<SVGSVGElement>) {
  const g = BRAND_GEOMETRY;
  const lineProps = { strokeWidth: g.lineWidth, strokeLinecap: 'round' as const, fill: 'none' };
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" {...props}>
      <rect
        x={g.tile.x}
        y={g.tile.y}
        width={g.tile.size}
        height={g.tile.size}
        rx={g.tile.r}
        fill={cssVar('surface')}
        stroke={cssVar('border')}
      />
      <path d={g.stem} stroke={cssVar('accent')} {...lineProps} />
      <path d={g.upper} stroke={cssVar('brand-green')} {...lineProps} />
      <path d={g.lower} stroke={cssVar('brand-amber')} {...lineProps} />
      <circle
        cx={g.ring.cx}
        cy={g.ring.cy}
        r={g.ring.r}
        fill={cssVar('surface')}
        stroke={cssVar('fg')}
        strokeWidth={g.ring.width}
      />
    </svg>
  );
}
