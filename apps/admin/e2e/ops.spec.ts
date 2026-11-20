import { expect, test, toast } from './fixtures';

test('설정: API 토큰 발급(평문 한 번만) → 폐기', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'API 토큰' }).click();
  const form = page.getByTestId('token-form');
  await form.getByLabel('이름').fill('e2e-token');
  await form.getByRole('checkbox', { name: /proposal:write/ }).check();
  await form.getByRole('button', { name: '발급' }).click();
  const created = page.getByTestId('token-created');
  await expect(created).toBeVisible();
  const plain = (await page.getByTestId('token-plain').textContent()) ?? '';
  expect(plain).toMatch(/^krdx_[A-Za-z0-9_-]{20,}$/);
  const row = page.getByTestId('tokens-table').locator('tr[data-token="e2e-token"]');
  await expect(row).toContainText('proposal:write');
  await expect(row).toContainText('admin:read');
  await created.getByRole('button', { name: '닫기' }).click();
  await expect(created).toHaveCount(0);
  await page.reload();
  await page.getByRole('tab', { name: 'API 토큰' }).click();
  await expect(page.getByTestId('tokens-table')).toContainText('e2e-token');
  await expect(page.locator('body')).not.toContainText(plain);

  page.once('dialog', (d) => void d.accept());
  await page
    .getByTestId('tokens-table')
    .locator('tr[data-token="e2e-token"]')
    .getByRole('button', { name: '폐기' })
    .click();
  await expect(toast(page, '토큰을 폐기했습니다')).toBeVisible();
  await expect(page.getByTestId('tokens-table').locator('tr[data-token="e2e-token"]')).toContainText('폐기됨');
});

test('설정: 에이전트 예산 변경·사용액 막대', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('tab', { name: '에이전트 예산' }).click();
  const input = page.getByLabel('월 예산(USD)');
  await expect(input).toHaveValue('30');
  await input.fill('12.5');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(toast(page, '예산을 저장했습니다')).toBeVisible();
  await expect(page.getByTestId('budget-spend')).toContainText('$0.00 / $12.50');
  await page.reload();
  await page.getByRole('tab', { name: '에이전트 예산' }).click();
  await expect(page.getByLabel('월 예산(USD)')).toHaveValue('12.5');
  await expect(page.getByRole('progressbar', { name: '이번 달 사용률' })).toBeVisible();
});

test('설정: 참조 테이블·전체 검증(동기) → 결과와 품질 링크', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('tab', { name: '참조 테이블' }).click();
  await expect(page.getByTestId('reference-tables')).toContainText('시·도');
  await page.getByRole('tab', { name: '검증' }).click();
  await page.getByRole('button', { name: '지금 검증(동기)' }).click();
  await expect(toast(page, '전체 검증 완료 — Hard 위반 0건')).toBeVisible();
  const result = page.getByTestId('validation-result');
  await expect(result).toContainText('위반 없음');
  const soft = page.getByTestId('validation-soft');
  await expect(soft.getByRole('link').first()).toHaveAttribute('href', /\/quality\?rule=/);
});

test('작업: 실행 양식 → 목록(대기·자동 새로 고침) → 상세 서랍', async ({ page }) => {
  await page.goto('/jobs');
  const form = page.getByTestId('run-job');
  await form.getByLabel('작업').selectOption('cleanup-api-calls');
  await form.getByLabel('보관 일수(기본 7)').fill('3');
  await form.getByRole('button', { name: '실행' }).click();
  await expect(toast(page, /작업을 보냈습니다|이미 대기 중/)).toBeVisible();
  const table = page.getByTestId('jobs-table');
  const row = table.getByRole('row').filter({ hasText: 'cleanup-api-calls' }).first();
  await expect(row).toBeVisible();
  // worker 가 없는 E2E 에서는 대기 상태로 남고, 진행 중 작업이 있으니 3초 자동 새로 고침
  await expect(row.locator('[data-state]')).toHaveText('대기');
  await expect(page.getByTestId('jobs-live')).toBeVisible();

  await page.getByLabel('상태').selectOption('pending');
  await expect(table).toContainText('cleanup-api-calls');
  await page.getByLabel('상태').selectOption('failed');
  await expect(page.getByTestId('jobs-table')).toHaveCount(0);
  await page.getByLabel('상태').selectOption('');

  await page.getByTestId('jobs-table').getByRole('row').filter({ hasText: 'cleanup-api-calls' }).first().click();
  const drawer = page.getByTestId('job-drawer');
  await expect(drawer).toContainText('cleanup-api-calls');
  await expect(drawer).toContainText('"days": 3');
  await drawer.getByRole('button', { name: '닫기' }).click();
  await expect(drawer).toHaveCount(0);

  // 수집기 과제는 정적 목록에서
  await form.getByLabel('작업').selectOption('importer.run');
  await expect(form.getByLabel('과제')).toContainText('tago-timetable');
  await expect(form.getByLabel('과제')).toContainText('kric-train-ops');
});
