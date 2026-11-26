// 로고 PNG 만들기(2026-11-26 D1안): 애플 홈 화면 아이콘(180)·링크 공유 이미지(1200×630).
// 공유 이미지는 public/opengraph-image.png(페이지 메타데이터가 직접 가리킨다 — lib/site.ts OG_IMAGE). 원본 = src/app/icon.svg(packages/ui brand.tsx 에서 생성 — packages/ui/test/brand.test.ts). 실행: node apps/web/scripts/brand-images.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const svg = readFileSync(here('../src/app/icon.svg'), 'utf8');
const font = (w) => here(`../node_modules/pretendard/dist/web/static/woff2/Pretendard-${w}.woff2`);

const browser = await chromium.launch();
try {
  // 애플 아이콘: 기기가 모서리를 깎으므로 타일 테두리 없이 꽉 채운다
  const icon = await browser.newPage({ viewport: { width: 180, height: 180 } });
  await icon.setContent(
    `<style>html,body{margin:0;background:#fff}svg{display:block;width:180px;height:180px}svg rect{stroke:none}</style>${svg}`,
  );
  await icon.screenshot({ path: here('../src/app/apple-icon.png') });

  const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await og.setContent(`<!doctype html><style>
    @font-face{font-family:P;src:url("file://${font('Bold')}") format("woff2");font-weight:700}
    @font-face{font-family:P;src:url("file://${font('Medium')}") format("woff2");font-weight:500}
    html,body{margin:0}
    body{width:1200px;height:630px;box-sizing:border-box;padding:0 96px;display:flex;align-items:center;gap:56px;
      background:#F7F8FA;font-family:P,sans-serif;color:#161B21}
    .mark svg{display:block;width:240px;height:240px}.mark svg rect{stroke-width:.3}
    .ko{font-weight:700;font-size:104px;letter-spacing:-0.035em;line-height:1}
    .en{font-weight:500;font-size:26px;letter-spacing:0.32em;color:#5B6470;margin-top:22px}
    .tag{font-weight:500;font-size:34px;letter-spacing:-0.01em;color:#2E3540;margin-top:40px}
  </style><div class="mark">${svg}</div><div><div class="ko">한국철도도감</div><div class="en">K-RAILDEX</div><div class="tag">대한민국 철도의 지금과 앞으로</div></div>`);
  await og.evaluate(() => globalThis.document.fonts.ready);
  await og.screenshot({ path: here('../public/opengraph-image.png') });
} finally {
  await browser.close();
}
console.log('apple-icon.png · opengraph-image.png 를 썼습니다');
