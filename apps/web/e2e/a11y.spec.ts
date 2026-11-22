/**
 * 접근성 점검(WP 7.6, FR-WEB-006 WCAG 2.1 AA). 주요 6쪽을 밝은·어두운 배색에서 axe-core 로 검사해
 * serious·critical 위반이 없어야 한다. 미래 지도는 키보드(←/→ 연도, 패널 단추 Tab 도달)도 본다.
 * 사이트가 떠 있지 않으면 건너뛴다(smoke.spec.ts 와 같음). 실행: pnpm -F @k-raildex/web e2e
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PAGES = ['/', '/lines/', '/lines/line-seoul-2/', '/stations/stn-seoul/', '/plans/', '/map/?at=2030'] as const;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test.beforeAll(async ({ request }) => {
  const ok = await request
    .get('/', { timeout: 30_000 })
    .then((r) => r.ok())
    .catch(() => false);
  test.skip(!ok, '공개 사이트(WEB_BASE_URL)에 닿지 않음 — 건너뜀');
});

/** 계획 상세는 id 를 고정하지 않고 목록 첫 행(단계 이력이 있는 것)을 고른다 */
async function planPath(page: Page): Promise<string> {
  await page.goto('/plans/?program=all');
  const href = await page.locator('table.data tbody tr td a[href^="/plans/plan-"]').first().getAttribute('href');
  return href!;
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}(${v.impact}): ${v.nodes.length}곳 — ${v.nodes[0]?.target.join(' ')}`);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`axe — ${scheme}`, () => {
    test.use({ colorScheme: scheme });
    for (const path of [...PAGES, 'plan-detail']) {
      test(`${path} serious·critical 없음`, async ({ page }) => {
        const url = path === 'plan-detail' ? await planPath(page) : path;
        await page.goto(url);
        if (url.startsWith('/map/')) {
          await expect(page.getByTestId('future-at')).toContainText('2030');
          // 지도 조작 단추·출처 표기까지 그려진 뒤 검사(MapLibre 가 늦게 붙인다)
          await expect(page.locator('.maplibregl-ctrl-attrib a').first()).toBeAttached({ timeout: 30_000 });
        }
        expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(scheme === 'dark');
        expect(await axe(page), url).toEqual([]);
      });
    }
  });
}

test('미래 지도 키보드: ←/→ 연도, 패널 단추에 Tab 으로 닿는다', async ({ page }) => {
  await page.goto('/map/?at=2030');
  await expect(page.getByTestId('future-at')).toContainText('2030');
  await page.locator('body').press('ArrowRight');
  await expect(page).toHaveURL(/[?&]at=2031/);
  await page.locator('body').press('ArrowLeft');
  await expect(page).toHaveURL(/[?&]at=2030/);
  // Tab 으로 '이전 연도' 단추까지(머리 → 패널 순서)
  await page.locator('body').focus();
  const target = page.getByRole('button', { name: '이전 연도' });
  let reached = false;
  for (let i = 0; i < 150 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await target.evaluate((el) => el === document.activeElement);
  }
  expect(reached, 'Tab 150번 안에 "이전 연도" 단추에 닿아야 한다').toBe(true);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/[?&]at=2029/);
  // 초점이 보인다(outline 또는 box-shadow)
  const ring = await target.evaluate((el) => {
    const s = getComputedStyle(el);
    return (s.outlineStyle !== 'none' && s.outlineWidth !== '0px') || s.boxShadow !== 'none';
  });
  expect(ring).toBe(true);
});
