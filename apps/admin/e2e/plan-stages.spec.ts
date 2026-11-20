import { expect, test, toast } from './fixtures';

test('계획 단계·기대 일정을 넣으면 계산된 현재 단계·개통 목표가 바뀌고 저장된다', async ({ page }) => {
  await page.goto('/data/plan/plan-fx-withdrawn');
  const editor = page.getByTestId('plan-stages-editor');
  await expect(editor).toBeVisible();
  const before = await page.getByTestId('computed-stage').textContent();

  await editor.getByRole('button', { name: '단계 추가' }).click();
  const ev = editor.getByTestId('stage-event-row').last();
  await ev.getByLabel('단계', { exact: true }).selectOption('basic_plan');
  await ev.getByLabel('날짜').fill('2026-03');
  await ev.getByLabel('날짜').blur();
  await expect(page.getByTestId('computed-stage')).toHaveText('기본계획');
  expect(before).not.toBe('기본계획');

  await editor.getByRole('button', { name: '기대 일정 추가' }).click();
  const ms = editor.getByTestId('milestone-row').last();
  await ms.getByLabel('예정 시기').fill('2034');
  await ms.getByLabel('발표 시점').fill('2026-03');
  await ms.getByLabel('발표 시점').blur();
  await expect(page.getByTestId('computed-target')).toHaveText('2034년');

  await page.getByRole('button', { name: /^저장/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: '저장', exact: true }).click();
  await expect(toast(page, '저장했습니다')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('computed-stage')).toHaveText('기본계획');
  await expect(page.getByTestId('computed-target')).toHaveText('2034년');
  // DB 뷰(파생 값)도 같은 결과
  await page.getByRole('tab', { name: '파생 값' }).click();
  await expect(page.locator('pre').first()).toContainText('basic_plan');
});
