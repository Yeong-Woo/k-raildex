import { expect, pickRef, test, toast } from './fixtures';

const ID = `stn-e2e-${Date.now().toString(36)}`;
const NAME = `이투이역${Date.now().toString(36).slice(-3)}`;

test.describe.serial('역 만들기 → 목록 → 삭제 → 휴지통 복구', () => {
  test('역을 만들면 목록에 나온다', async ({ page }) => {
    await page.goto('/data/station/new');
    await page.locator('#f-id').fill(ID);
    await page.locator('#f-name_ko').fill(NAME);
    const sources = page.locator('div:has(> label[for="f-sources"])');
    await sources.getByRole('button', { name: '항목 추가' }).click();
    await pickRef(page, sources, '시험', /시험용 고시/);
    await page.getByRole('button', { name: '만들기', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '저장', exact: true }).click();
    await expect(toast(page, '저장했습니다')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/data/station/${ID}`));

    await page.goto(`/data/station?q=${encodeURIComponent(NAME)}`);
    await expect(page.getByRole('link', { name: NAME })).toBeVisible();
  });

  test('참조 없는 역 삭제 → 휴지통 → 복구', async ({ page }) => {
    await page.goto(`/data/station/${ID}`);
    page.once('dialog', (d) => void d.accept('E2E 삭제'));
    await page
      .locator('button')
      .filter({ hasText: /^삭제$/ })
      .click();
    await expect(toast(page, '휴지통으로 옮겼습니다')).toBeVisible();
    await expect(page.getByText('휴지통', { exact: true }).first()).toBeVisible();

    await page.goto('/trash');
    const row = page.locator('tr').filter({ hasText: NAME });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '복구' }).click();
    await expect(toast(page, '복구했습니다')).toBeVisible();
    await expect(row).toHaveCount(0);

    await page.goto(`/data/station/${ID}`);
    await expect(page.locator('button').filter({ hasText: /^삭제$/ })).toBeVisible();
  });
});

test('참조가 있는 노선은 삭제가 거부되고 오류 토스트가 뜬다', async ({ page }) => {
  await page.goto('/data/line/line-fx-one');
  page.once('dialog', (d) => void d.accept('E2E 삭제 시도'));
  await page
    .locator('button')
    .filter({ hasText: /^삭제$/ })
    .click();
  await expect(toast(page, /참조/)).toBeVisible();
  await page.reload();
  await expect(page.locator('button').filter({ hasText: /^삭제$/ })).toBeVisible();
});
