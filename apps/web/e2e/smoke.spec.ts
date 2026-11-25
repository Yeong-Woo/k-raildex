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

test('계획 목록(차수 탭 링크) → 상세(단계 띠·기대 일정·미래 지도 링크)', async ({ page }) => {
  await page.goto('/plans/');
  await expect(page.getByRole('heading', { level: 1, name: '계획' })).toBeVisible();
  await expect(page.locator('a[aria-current="true"]').first()).toBeVisible();
  const href = await page.locator('table.data tbody tr td a[href^="/plans/plan-"]').first().getAttribute('href');
  expect(href).toMatch(/^\/plans\/[^/]+\/$/);
  await page.goto(href!);
  await expect(page.locator('ol.track > li')).toHaveCount(12);
  await expect(page.locator('#stages-h')).toHaveText('단계 이력');
  await expect(page.locator('#sources-h')).toHaveText('출처');
  const map = await page.getByRole('link', { name: '미래 지도에서 보기' }).getAttribute('href');
  expect(map).toMatch(/^\/map\/\?at=(\d{4}|future)#plan=/);
});

test('상위 계획·P2 목록 페이지', async ({ page }) => {
  for (const [path, h1] of [
    ['/plans/programs/', '상위 계획'],
    ['/upcoming/', '개통 예정'],
    ['/closed/', '폐선·폐역'],
    ['/timeline/', '연표'],
    ['/trains/', '열차번호·차량번호'],
    ['/train-classes/', '열차 등급'],
    ['/transfer-centers/', '환승센터'],
    ['/maps/', '공식 노선도'],
    ['/terms/', '철도 용어'],
    ['/sources/', '출처·라이선스'],
    ['/about/', '소개'],
  ] as const) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(h1);
  }
});

test('미래 지도: 캔버스, 연도 바꾸면 URL ?at= 이 바뀐다', async ({ page }) => {
  await page.goto('/map/?at=2030');
  await expect(page.locator('[data-testid="future-map"] canvas')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { __kraildexMap?: { querySourceFeatures(id: string): unknown[] } }).__kraildexMap;
      return !!m && m.querySourceFeatures('lines').length > 0;
    },
    null,
    { timeout: 60_000 },
  );
  await expect(page.getByTestId('future-at')).toContainText('2030');
  await page.locator('body').press('ArrowRight');
  await expect(page).toHaveURL(/[?&]at=2031/);
  await page.getByRole('button', { name: '이전 연도' }).click();
  await expect(page).toHaveURL(/[?&]at=2030/);
  await page.getByRole('button', { name: /^목표 미정/ }).click();
  await expect(page).toHaveURL(/[?&]at=future/);
  await expect(page.getByText('개략 선형은 실제 위치와 다를 수 있습니다', { exact: false })).toBeVisible();
});

test('운행 계통: 패널에서 고르면 계통 구간 강조(#service=), 노선 정보 창에 지나는 계통', async ({ page }) => {
  await page.goto('/map/#service=svc-sudogwon-1');
  await expect(page.locator('[data-testid="future-map"] canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('future-selected')).toContainText('수도권 전철 1호선', { timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { __kraildexMap?: { querySourceFeatures(id: string): unknown[] } }).__kraildexMap;
      return !!m && m.querySourceFeatures('service').length > 0;
    },
    null,
    { timeout: 60_000 },
  );
  await expect(page.getByLabel('운행 계통')).toHaveValue('svc-sudogwon-1');
  await page.getByLabel('운행 계통').selectOption('');
  await expect(page).not.toHaveURL(/service=/);
  await page.goto('/map/#line=line-gyeongin');
  await expect(page.getByTestId('future-selected')).toContainText('지나는 운행 계통', { timeout: 30_000 });
  await page.getByTestId('future-selected').getByRole('button', { name: '수도권 전철 1호선' }).click();
  await expect(page).toHaveURL(/#service=svc-sudogwon-1/);
});

test('지도에서 노선을 클릭하면 강조만 하고 확대·위치는 그대로, #line= 링크는 그 범위로 이동', async ({ page }) => {
  type M = {
    getZoom(): number;
    getCenter(): { lng: number; lat: number };
    project(c: [number, number]): { x: number; y: number };
    queryRenderedFeatures(o?: unknown): {
      layer: { id: string };
      properties: Record<string, unknown>;
      geometry: { type: string; coordinates: unknown };
    }[];
    loaded(): boolean;
  };
  await page.goto('/map/?at=2030');
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { __kraildexMap?: M }).__kraildexMap;
      return !!m && m.queryRenderedFeatures().some((f) => f.layer.id.startsWith('line-'));
    },
    null,
    { timeout: 60_000 },
  );
  // 화면 안 노선 선의 한 점(역이 없는 곳)을 고른다
  const target = await page.evaluate(() => {
    const m = (window as unknown as { __kraildexMap: M }).__kraildexMap;
    const canvas = document.querySelector('[data-testid="future-map"] canvas') as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    for (const f of m.queryRenderedFeatures()) {
      if (!f.layer.id.startsWith('line-')) continue;
      const coords = (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates) as [
        number,
        number,
      ][][];
      for (const part of coords)
        for (const c of part.slice(1, -1)) {
          const p = m.project(c);
          if (p.x < 80 || p.y < 80 || p.x > r.width - 120 || p.y > r.height - 160) continue;
          const hits = m.queryRenderedFeatures([
            [p.x - 8, p.y - 8],
            [p.x + 8, p.y + 8],
          ] as never);
          if (hits.some((h) => h.layer.id === 'station')) continue;
          return { x: r.left + p.x, y: r.top + p.y, line: String(f.properties.line_id ?? f.properties.plan_id) };
        }
    }
    return null;
  });
  expect(target).not.toBeNull();
  const before = await page.evaluate(() => {
    const m = (window as unknown as { __kraildexMap: M }).__kraildexMap;
    return { z: m.getZoom(), c: m.getCenter() };
  });
  await page.mouse.click(target!.x, target!.y);
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => {
    const m = (window as unknown as { __kraildexMap: M }).__kraildexMap;
    return { z: m.getZoom(), c: m.getCenter() };
  });
  expect(after.z).toBeCloseTo(before.z, 5);
  expect(after.c.lng).toBeCloseTo(before.c.lng, 5);
  expect(after.c.lat).toBeCloseTo(before.c.lat, 5);
  // 링크로 들어오면 그 노선 범위로(전국 노선 — 기본 수도권 보기에서 축소된다)
  await page.goto('/map/#line=line-gyeongbu');
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { __kraildexMap?: M }).__kraildexMap;
      return !!m && m.getZoom() < 8.5;
    },
    null,
    { timeout: 60_000 },
  );
});

test('배경 지도 고르기: 기본 OSM(교통 지도 키 없으면 표준), 고르면 타일 주소가 바뀌고 기억한다', async ({ page }) => {
  await page.goto('/map/?at=2030');
  const pick = page.getByRole('combobox', { name: '배경 지도' });
  const tiles = () =>
    page.evaluate(() => {
      const m = (
        window as unknown as { __kraildexMap?: { getStyle(): { sources: Record<string, { tiles?: string[] }> } } }
      ).__kraildexMap;
      return m?.getStyle().sources.basemap?.tiles?.[0] ?? '';
    });
  await page.waitForFunction(() => !!(window as unknown as { __kraildexMap?: unknown }).__kraildexMap, null, {
    timeout: 60_000,
  });
  expect(await tiles()).toMatch(/openstreetmap\.org|thunderforest\.com/);
  // 키(VWorld·Thunderforest)가 하나도 없으면 고를 것이 OSM 표준뿐이라 선택 상자를 그리지 않는다
  if (!(await pick.isVisible())) return;
  const options = await pick.locator('option').allTextContents();
  expect(options).toContain('OSM 표준');
  if (options.includes('VWorld 일반')) {
    await pick.selectOption({ label: 'VWorld 일반' });
    await expect.poll(tiles).toContain('api.vworld.kr');
    await page.reload();
    await expect(page.getByRole('combobox', { name: '배경 지도' })).toHaveValue('vworld-base', { timeout: 30_000 });
    await page.getByRole('combobox', { name: '배경 지도' }).selectOption({ label: 'OSM 표준' });
  }
});

test('사이트맵·robots·Atom 200, 옛 id 는 301', async ({ request }) => {
  const sm = await request.get('/sitemap.xml');
  expect(sm.status()).toBe(200);
  expect(await sm.text()).toContain('<urlset');
  const rb = await request.get('/robots.txt');
  expect(rb.status()).toBe(200);
  expect(await rb.text()).toContain('Sitemap:');
  const at = await request.get('/changes.xml');
  expect(at.status()).toBe(200);
  expect(at.headers()['content-type']).toContain('application/atom+xml');
  const r = await request.get('/plans/?program=national_rail_4', { maxRedirects: 0 });
  expect(r.status()).toBe(301);
  expect(r.headers()['location']).toContain('program=pp-national-rail-4');
});
