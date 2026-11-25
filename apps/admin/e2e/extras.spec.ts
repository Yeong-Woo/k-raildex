import { expect, test, toast } from './fixtures';

test('정차 패턴 매트릭스: 셀을 눌러 정차/통과를 바꾸고 저장', async ({ page }) => {
  await page.goto('/data/service/svc-fx-one');
  const m = page.getByTestId('stop-pattern-matrix');
  const cell = m.getByRole('checkbox', { name: '급행: 나' });
  await expect(cell).toHaveAttribute('aria-checked', 'false');
  await cell.click();
  await expect(cell).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: /^저장/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: '저장', exact: true }).click();
  await expect(toast(page, '저장했습니다')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('stop-pattern-matrix').getByRole('checkbox', { name: '급행: 나' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('첨부: 원문 발췌 추가 → 목록 → 삭제', async ({ page }) => {
  const r = await page.request.get(`${process.env.E2E_API_URL}/v1/admin/entities/stn-fx-b/attachments`);
  test.skip(r.status() === 404, '첨부 API 없음');
  await page.goto('/data/station/stn-fx-b?tab=attachments');
  await page.getByRole('button', { name: '첨부 추가' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('제목').fill('E2E 발췌');
  await dlg.getByLabel('발췌문').fill('고시문 일부');
  await dlg.getByRole('button', { name: '저장', exact: true }).click();
  await expect(toast(page, '첨부를 추가했습니다')).toBeVisible();
  const item = page.getByTestId('attachment-item').filter({ hasText: 'E2E 발췌' });
  await expect(item).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await item.getByRole('button', { name: '삭제' }).click();
  await expect(toast(page, '첨부를 지웠습니다')).toBeVisible();
  await expect(item).toHaveCount(0);
});

test('품질 화면과 대시보드 품질 요약', async ({ page }) => {
  const r = await page.request.get(`${process.env.E2E_API_URL}/v1/admin/quality`);
  test.skip(r.status() === 404, '품질 API 없음');
  await page.goto('/');
  await expect(page.getByTestId('quality-summary')).toBeVisible();
  await page.goto('/quality');
  await page.getByTestId('quality-rules').getByRole('button').filter({ hasText: 'V-S10' }).click();
  await expect(page.getByTestId('quality-items')).toBeVisible();
  // 규칙별 검수 매뉴얼(2026-11-26)
  await expect(page.getByTestId('quality-guide')).toContainText('빠지는 조건');
});

test('미래 지도: 연도에 맞는 계획이 나오고 계획 편집으로 갈 수 있다', async ({ page }) => {
  const r = await page.request.get(`${process.env.E2E_API_URL}/v1/admin/map/timeline`);
  test.skip(r.status() === 404, '지도 API 없음');
  await page.goto('/map?tab=future&at=2040');
  const plans = page.getByTestId('future-plans');
  // 연장 계획은 연장되는 노선 이름으로 보인다(0023 map_at — 계획 이름 "시험 1호선 연장" 아님)
  await expect(plans).toContainText('시험 1호선');
  await plans.getByRole('button', { name: /시험 1호선/ }).click();
  await page
    .getByTestId('future-selected')
    .getByRole('link', { name: /계획 편집/ })
    .click();
  await expect(page).toHaveURL(/\/data\/plan\/plan-fx-ext/);
});

test('지도 편집: 역을 고르고 지도에서 찍어 좌표 저장', async ({ page }) => {
  const r = await page.request.get(`${process.env.E2E_API_URL}/v1/admin/map/current-stations`);
  test.skip(r.status() === 404, '지도 API 없음');
  await page.goto('/map?tab=edit&station=stn-fx-c');
  const panel = page.getByTestId('map-selected-station');
  await expect(panel).toContainText('다');
  await panel.getByRole('button', { name: '지도에서 찍기' }).click();
  const map = page.getByTestId('edit-map');
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30);
  await expect(page.getByTestId('pending-coord')).toBeVisible();
  await panel.getByRole('button', { name: '좌표 저장' }).click();
  await expect(toast(page, '좌표를 저장했습니다')).toBeVisible();
  await expect(panel).toContainText('수기 확인');
});

test('위성 비교: 키가 없으면 안내', async ({ page }) => {
  await page.goto('/map?tab=satellite');
  await expect(page.getByTestId('satellite-placeholder')).toBeVisible();
});

test('지도 편집·노선 편집: 목록에서 고르기 — 노선명 병기, 검수 필요/정상 태그 필터', async ({ page }) => {
  await page.goto('/map?tab=edit');
  const list = page.getByTestId('review-list-station');
  const row = list.getByTestId('review-row').filter({ hasText: 'stn-fx-e' });
  await expect(row).toContainText('시험 2호선');
  const picker = page.getByTestId('review-picker-station');
  await picker.getByRole('button', { name: /^검수 필요/ }).click();
  await expect(list.locator('[data-testid="review-tag"][data-state="ok"]')).toHaveCount(0);
  await picker.getByRole('button', { name: /^정상/ }).click();
  await expect(list.locator('[data-testid="review-tag"][data-state="issue"]')).toHaveCount(0);
  await picker.getByRole('button', { name: /^전체/ }).click();
  await picker.getByRole('textbox', { name: '역 검색' }).fill('stn-fx-c');
  await list.getByTestId('review-row').first().click();
  await expect(page).toHaveURL(/station=stn-fx-c/);
  await expect(page.getByTestId('map-selected-station')).toContainText('다');

  await page.goto('/map?tool=line');
  const lines = page.getByTestId('review-list-line');
  await lines.getByTestId('review-row').filter({ hasText: 'line-fx-two' }).click();
  await expect(page.getByTestId('lm-line-summary')).toContainText('시험 2호선');
  await expect(page.getByTestId('lm-line-summary').getByTestId('review-tag')).toBeVisible();
});

test('품질 V-S04: 거리 초과 행을 [거리 맞음]으로 확인하면 목록에서 빠진다', async ({ page }) => {
  const api = process.env.E2E_API_URL;
  const post = async (type: string, data: unknown) => {
    const r = await page.request.post(`${api}/v1/admin/${type}`, { data });
    expect(r.ok(), await r.text()).toBe(true);
  };
  await post('station', {
    id: 'stn-e2e-far',
    name_ko: '먼역',
    region_code: '41',
    geom: { lat: 37.9, lng: 127.0 },
    coord_source: 'official',
    checked_at: '2026-01-01',
    sources: [{ source_id: 'src-fixture-notice' }],
  });
  await post('line-station', {
    id: 'ls-fx-two--e2e-far',
    line_id: 'line-fx-two',
    station_id: 'stn-e2e-far',
    seq: 9,
    status: 'operating',
  });
  await page.goto('/quality?rule=V-S04');
  const row = page.getByTestId('quality-items').locator('tr', { hasText: 'ls-fx-two--e2e-far' });
  await expect(row).toContainText('상한');
  await row.getByRole('button', { name: '거리 맞음' }).click();
  await expect(toast(page, '거리를 확인했습니다')).toBeVisible();
  await expect(page.getByTestId('quality-items').locator('tr', { hasText: 'ls-fx-two--e2e-far' })).toHaveCount(0);
});
