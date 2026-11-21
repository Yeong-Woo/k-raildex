/**
 * 공개 사이트 주요 경로 연기 시험(WP 7.2). 사이트가 떠 있지 않으면 건너뛴다.
 * id 는 고정하지 않고 목록·검색 결과에서 고른다(데이터가 바뀌어도 시험이 깨지지 않게).
 */
import { expect, test } from '@playwright/test';

test.beforeAll(async ({ request }) => {
  const ok = await request
    .get('/', { timeout: 30_000 })
    .then((r) => r.ok())
    .catch(() => false);
  test.skip(!ok, '공개 사이트(WEB_BASE_URL)에 닿지 않음 — 건너뜀');
});

test('홈: 검색·통계·바닥 고지, HTML 캐시 헤더', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('대한민국 철도');
  await expect(page.getByRole('search').first()).toBeVisible();
  await expect(page.locator('footer')).toContainText('비상업');
  const cc = res?.headers()['cache-control'] ?? '';
  // next dev 는 캐시 헤더를 바꾸므로 운영 빌드에서만 확인
  if (!process.env.WEB_DEV) expect(cc).toContain('s-maxage=30');
});

test('노선 목록 → 상세(역 순서·출처)', async ({ page }) => {
  await page.goto('/lines/');
  await expect(page.getByRole('heading', { level: 1, name: '노선' })).toBeVisible();
  const first = page.locator('table.data tbody tr td a[href^="/lines/"]').first();
  const href = await first.getAttribute('href');
  expect(href).toMatch(/^\/lines\/[^/]+\/$/);
  await page.goto(href!);
  await expect(page.locator('#stations-h')).toHaveText('역 순서');
  await expect(page.locator('#sources-h')).toHaveText('출처');
});

test('역 목록 탭은 링크, 역 상세에 노선별 절', async ({ page }) => {
  await page.goto('/stations/?opened=unopened');
  await expect(page.locator('a[aria-current="true"]', { hasText: '미개통' })).toBeVisible();
  await page.goto('/stations/');
  const href = await page.locator('table.data tbody tr td a[href^="/stations/"]').first().getAttribute('href');
  await page.goto(href!);
  await expect(page.locator('#lines-h')).toHaveText('노선별');
  await expect(page.locator('#sources')).toBeVisible();
});

test('운행 계통: 열차/전철 탭과 상세 정차 패턴', async ({ page }) => {
  await page.goto('/services/?group=metro');
  const href = await page.locator('.card h3 a').first().getAttribute('href');
  await page.goto(href!);
  await expect(page.locator('#patterns-h')).toHaveText('정차 패턴 비교');
});

test('검색: 결과 링크, 라이트/다크 전환', async ({ page }) => {
  await page.goto('/search/?q=%EC%84%9C%EC%9A%B8');
  await expect(page.locator('.results li').first()).toBeVisible();
  const before = await page.evaluate(() => document.documentElement.dataset.theme ?? null);
  await page.getByRole('button', { name: '밝은/어두운 화면 전환' }).click();
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(after).not.toBe(before);
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(after);
});
