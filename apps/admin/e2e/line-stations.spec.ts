import { expect, removeEntity, test, toast } from './fixtures';

test('노선 정거장 순서를 바꿔 저장하면 유지된다', async ({ page }) => {
  await page.goto('/data/line/line-fx-one?tab=stations');
  await page.getByTestId('stops-mode-edit').click();
  const names = page.getByTestId('ls-station-name');
  await expect(names).toHaveText(['가', '나', '다', '라']);

  const first = page.getByTestId('ls-row').first();
  await first.getByRole('button', { name: '아래로' }).click();
  await expect(names).toHaveText(['나', '가', '다', '라']);

  // km 역행 경고(V-S04 미리 보기)
  const rows = page.getByTestId('ls-row');
  await rows.nth(0).getByLabel('km').fill('5');
  await rows.nth(1).getByLabel('km').fill('3');
  await rows.nth(2).getByLabel('km').fill('8');
  await expect(page.getByText(/km 역행 1곳/)).toBeVisible();
  await rows.nth(1).getByLabel('km').fill('6');
  await expect(page.getByText(/km 역행/)).toHaveCount(0);

  // 구간 일괄 상태: 3~4번 행 선택(shift) → 공사 중
  await rows.nth(2).getByLabel('3번 행 선택').click();
  await rows
    .nth(3)
    .getByLabel('4번 행 선택')
    .click({ modifiers: ['Shift'] });
  await page.getByLabel('일괄 상태').selectOption('under_construction');
  await page.getByRole('button', { name: '선택 범위 상태 바꾸기' }).click();
  await expect(rows.nth(2).getByLabel('노선별 상태')).toHaveValue('under_construction');

  await page.getByRole('button', { name: '정거장 순서 저장' }).click();
  await expect(toast(page, '정거장 순서를 저장했습니다')).toBeVisible();

  await page.reload();
  await page.getByTestId('stops-mode-edit').click();
  await expect(names).toHaveText(['나', '가', '다', '라']);
  await expect(page.getByTestId('ls-row').nth(2).getByLabel('노선별 상태')).toHaveValue('under_construction');
  await expect(page.getByTestId('ls-row').nth(0).getByLabel('km')).toHaveValue('5');
});

test('역 상세 [노선별] 탭에 정거장 카드와 계산된 상태가 나온다', async ({ page }) => {
  await page.goto('/data/station/stn-fx-a?tab=line-stations');
  await expect(page.getByTestId('line-station-card')).toHaveCount(2);
  await expect(page.getByTestId('station-derived')).toContainText('운영 중');
});

test('노선 정거장 순서: 새 역 그룹을 만들어 고른 행 뒤에 넣고 저장한다(폐선 노선 등)', async ({ page }) => {
  const api = process.env.E2E_API_URL;
  await page.goto('/data/line/line-fx-two?tab=stations');
  await page.getByTestId('stops-mode-edit').click();
  const rows = page.getByTestId('ls-row');
  await expect(rows.first()).toBeVisible();
  const before = await page.getByTestId('ls-station-name').allInnerTexts();
  expect(before.length).toBeGreaterThan(1);
  await rows.nth(0).getByLabel('1번 행 선택').click();
  await expect(page.getByTestId('add-where')).toContainText('1번째 역 뒤에');
  await page.getByTestId('new-station-open').click();
  const dlg = page.getByTestId('new-station-dialog');
  await dlg.getByLabel('이름').fill('옛역');
  await dlg.getByLabel('역 그룹 id').fill('stn-e2e-old');
  await dlg.getByLabel('이 노선에서의 상태(정거장)').selectOption('closed');
  await page.getByTestId('new-station-create').click();
  await expect(toast(page, '역 그룹 옛역 를 만들었습니다')).toBeVisible();
  await expect(page.getByTestId('ls-station-name')).toHaveText([before[0]!, '옛역', ...before.slice(1)]);
  await page.getByRole('button', { name: '정거장 순서 저장' }).click();
  await expect(toast(page, '정거장 순서를 저장했습니다')).toBeVisible();
  const st = await (await page.request.get(`${api}/v1/admin/station/stn-e2e-old`)).json();
  expect(st.data.sources.length).toBeGreaterThan(0);
  const list = await (await page.request.get(`${api}/v1/admin/lines/line-fx-two/stations`)).json();
  const mine = list.items.find((i: { station_id: string }) => i.station_id === 'stn-e2e-old');
  expect(mine).toMatchObject({ seq: 2, status: 'closed' });
  // 정리
  await removeEntity(page, 'line-station', mine.id);
  await removeEntity(page, 'station', 'stn-e2e-old');
});
