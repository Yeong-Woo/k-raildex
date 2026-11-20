import { expect, test, toast } from './fixtures';

test('노선 역 순서를 바꿔 저장하면 유지된다', async ({ page }) => {
  await page.goto('/data/line/line-fx-one?tab=stations');
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

  await page.getByRole('button', { name: '역 순서 저장' }).click();
  await expect(toast(page, '역 순서를 저장했습니다')).toBeVisible();

  await page.reload();
  await expect(names).toHaveText(['나', '가', '다', '라']);
  await expect(page.getByTestId('ls-row').nth(2).getByLabel('노선별 상태')).toHaveValue('under_construction');
  await expect(page.getByTestId('ls-row').nth(0).getByLabel('km')).toHaveValue('5');
});

test('역 상세 [노선별] 탭에 노선별 역 카드와 계산된 상태가 나온다', async ({ page }) => {
  await page.goto('/data/station/stn-fx-a?tab=line-stations');
  await expect(page.getByTestId('line-station-card')).toHaveCount(2);
  await expect(page.getByTestId('station-derived')).toContainText('운영 중');
});
