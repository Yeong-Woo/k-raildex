import { expect, test, toast } from './fixtures';

/** global-setup 이 API 에 준 가짜 키(실제 키 아님) */
const STUB_KEY = 'e2e-stub-not-a-real-key';

test('외부 API 탐색기: 가짜 외부 서버 호출 → 표·키 가림 → 다음 쪽 → DB 비교 → 기록', async ({ page }) => {
  const api = process.env.E2E_API_URL!;
  const mock = process.env.E2E_MOCK_URL!;
  // 가짜 외부 서버를 가리키는 엔드포인트(제공처 other → 공통 키 변수 없음, 서비스별 변수만)
  const created = await page.request.post(`${api}/v1/admin/external/endpoints`, {
    data: {
      id: 'e2e-stub',
      provider: 'other',
      name_ko: 'E2E 가짜 역 목록',
      base_url: `${mock}/SubwayInfo/List`,
      params: [
        { name: 'subwayStationName', label: '역 이름' },
        { name: 'numOfRows', label: '한 쪽 행 수', kind: 'int', default: '2' },
        { name: 'pageNo', label: '쪽 번호', kind: 'int', default: '1' },
      ],
      key_param: 'serviceKey',
      key_env: 'DATA_GO_KR_KEY_E2E_STUB',
      response_format: 'json',
      paging: { page_param: 'pageNo', size_param: 'numOfRows', total_path: 'response.body.totalCount' },
      compare: { code_field: 'subwayStationId', name_field: 'subwayStationName' },
      daily_limit: 50,
      external_system: 'tago_subway',
    },
  });
  expect(created.status()).toBe(201);
  // 비교용 외부 코드: 시험 1호선 가·나
  for (const [id, code] of [
    ['ls-fx-one--fx-a', 'MTR-A'],
    ['ls-fx-one--fx-b', 'MTR-B'],
  ]) {
    const cur = await (await page.request.get(`${api}/v1/admin/line-station/${id}`)).json();
    const r = await page.request.patch(`${api}/v1/admin/line-station/${id}`, {
      data: { external_refs: [{ system: 'tago_subway', code }] },
      headers: { 'if-match': String(cur.version) },
    });
    expect(r.status()).toBe(200);
  }

  await page.goto('/external');
  await page
    .getByTestId('external-catalog')
    .getByRole('button', { name: /E2E 가짜 역 목록/ })
    .click();
  await expect(page.getByTestId('external-keys')).toContainText('DATA_GO_KR_KEY_E2E_STUB');
  await page.getByRole('button', { name: '호출', exact: true }).click();

  const result = page.getByTestId('external-result');
  await expect(result.getByTestId('external-result-code')).toContainText('00');
  await expect(result.getByTestId('external-rows')).toContainText('MTR-A');
  await expect(result.getByTestId('external-url')).toContainText('serviceKey=***');
  await expect(result).not.toContainText(STUB_KEY);
  await result.getByRole('tab', { name: '원문' }).click();
  await result.locator('summary').filter({ hasText: '원문' }).click();
  await expect(result.getByTestId('external-raw')).toContainText('"echo":"***"');
  await expect(result.getByTestId('external-raw')).not.toContainText(STUB_KEY);
  await result.getByRole('tab', { name: '표' }).click();

  await result.getByRole('button', { name: '다음 쪽' }).click();
  await expect(result.getByTestId('external-rows')).toContainText('MTR-Z');
  await expect(page.getByLabel('쪽 번호')).toHaveValue('2');

  // 1쪽(가·나) 다시 받아 비교
  await page.getByLabel('쪽 번호').fill('1');
  await page.getByRole('button', { name: '호출', exact: true }).click();
  await expect(result.getByTestId('external-rows')).toContainText('MTR-B');
  await result.getByRole('button', { name: 'DB와 비교' }).click();
  const cmp = result.getByTestId('external-compare');
  await expect(cmp).toContainText('같음 1');
  await expect(cmp).toContainText('차이 1');
  await expect(cmp).toContainText('이름: 나다른이름 ≠ 나');
  await expect(cmp.getByRole('link', { name: /나/ })).toHaveAttribute('href', /\/data\/station\/stn-fx-b/);

  // 즐겨찾기 저장
  page.once('dialog', (d) => void d.accept('첫 쪽'));
  await page.getByRole('button', { name: '즐겨찾기로 저장' }).click();
  await expect(toast(page, '즐겨찾기에 저장했습니다')).toBeVisible();

  await page.getByRole('tab', { name: '기록' }).click();
  const history = page.getByTestId('external-history');
  await expect(history.getByRole('row')).toHaveCount(4); // 머리글 + 3회
  await expect(history).not.toContainText(STUB_KEY);
});
