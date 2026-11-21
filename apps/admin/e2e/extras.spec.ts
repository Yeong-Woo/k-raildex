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
});

test('미래 지도: 연도에 맞는 계획이 나오고 계획 편집으로 갈 수 있다', async ({ page }) => {
  const r = await page.request.get(`${process.env.E2E_API_URL}/v1/admin/map/timeline`);
  test.skip(r.status() === 404, '지도 API 없음');
  await page.goto('/map?tab=future&at=2040');
  const plans = page.getByTestId('future-plans');
  await expect(plans).toContainText('시험 1호선 연장');
  await plans.getByRole('button', { name: /시험 1호선 연장/ }).click();
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
