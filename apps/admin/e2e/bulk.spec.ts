import { expect, test, toast } from './fixtures';

test('여러 건 입력: 표 붙여 넣기 → 열 대응·미리 보기(오류 행 제외) → 변경 묶음 → 승인', async ({ page }) => {
  await page.goto('/bulk');
  await expect(page.getByLabel('대상')).toHaveValue('line_station');
  await page
    .getByLabel('붙여 넣기')
    .fill(['노선\t역\t순서\t상태', 'line-fx-two\t나\t3\t계획', 'line-fx-two\t없는역\t4\t계획'].join('\n'));
  await page.getByRole('button', { name: '해석' }).click();

  const mapping = page.getByTestId('bulk-mapping');
  await expect(mapping.getByLabel('열 대응: 역')).toHaveValue('station_id');
  await expect(mapping.getByLabel('열 대응: 상태')).toHaveValue('status');

  const rows = page.getByTestId('bulk-preview').getByTestId('bulk-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('ls-fx-two--fx-b');
  await expect(rows.nth(1)).toContainText('없는역');
  // 오류 행은 처음부터 빠져 있다
  await expect(rows.nth(1).getByRole('checkbox')).not.toBeChecked();

  await page.getByRole('button', { name: '변경 묶음 만들기(1행)' }).click();
  await expect(page).toHaveURL(/\/changesets\/cs-/);
  await expect(page.getByText('여러 건 입력: 노선별 역')).toBeVisible();
  await page.getByRole('button', { name: '승인(반영)' }).click();
  await expect(toast(page, '승인(반영)했습니다')).toBeVisible();

  await page.goto('/data/line-station/ls-fx-two--fx-b');
  await expect(page.getByText('ls-fx-two--fx-b').first()).toBeVisible();
});
