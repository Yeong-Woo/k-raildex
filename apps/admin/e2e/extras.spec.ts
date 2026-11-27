import { expect, pickRef, removeEntity, test, toast } from './fixtures';

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

test('품질 X-station-split: [분리 유지]는 메모로 빠지고, [병합…]은 미리 보기 뒤 사유를 적어 합친다', async ({
  page,
}) => {
  const api = process.env.E2E_API_URL;
  const post = async (type: string, data: unknown) => {
    const r = await page.request.post(`${api}/v1/admin/${type}`, { data });
    expect(r.ok(), await r.text()).toBe(true);
  };
  for (const [id, seq] of [
    ['e2e-split', 10],
    ['e2e-split2', 11],
  ] as const) {
    await post('station', {
      id: `stn-${id}`,
      name_ko: '다(신설)',
      region_code: '41',
      merge_into_id: 'stn-fx-c',
      checked_at: '2026-01-01',
      sources: [{ source_id: 'src-fixture-notice' }],
    });
    await post('line-station', {
      id: `ls-fx-two--${id}`,
      line_id: 'line-fx-two',
      station_id: `stn-${id}`,
      seq,
      status: 'under_construction',
    });
  }
  await page.goto('/quality?rule=X-station-split');
  const rowOf = (id: string) => page.getByTestId('quality-items').locator('tr', { hasText: id });
  await expect(rowOf('stn-e2e-split2')).toContainText('→ 다(stn-fx-c)');

  page.once('dialog', (d) => void d.accept('환승 통로 미정'));
  await rowOf('stn-e2e-split2').getByTestId('keep-split').click();
  await expect(toast(page, '분리 유지로 표시했습니다')).toBeVisible();
  await expect(rowOf('stn-e2e-split2')).toHaveCount(0);

  await rowOf('stn-e2e-split').getByTestId('merge-open').click();
  const dlg = page.getByTestId('merge-dialog');
  await expect(dlg.getByTestId('merge-line-stations')).toContainText('대상 역 아래로 옮김');
  await expect(dlg).toContainText('원본의 "병합할 역"과 같음');
  await expect(page.getByTestId('merge-apply')).toBeDisabled();
  await dlg.getByLabel('병합 사유(필수)').fill('기본계획에 환승역으로 명시');
  await page.getByTestId('merge-apply').click();
  await expect(toast(page, '병합했습니다')).toBeVisible();
  await expect(rowOf('stn-e2e-split')).toHaveCount(0);
  expect((await page.request.get(`${api}/v1/admin/station/stn-e2e-split`)).status()).toBe(404);
  const ls = await (await page.request.get(`${api}/v1/admin/line-station/ls-fx-two--e2e-split`)).json();
  expect(ls.data.station_id).toBe('stn-fx-c');
  for (const id of ['ls-fx-two--e2e-split', 'ls-fx-two--e2e-split2']) await removeEntity(page, 'line-station', id);
});

test('역 상세: 중복 역을 [병합…]으로 합치고 [ID 변경…]으로 대표 id 를 바꾼다', async ({ page }) => {
  const api = process.env.E2E_API_URL;
  for (const [id, line, seq] of [
    ['e2e-dup-a', 'line-fx-one', 12],
    ['e2e-dup-b', 'line-fx-two', 12],
  ] as const) {
    const st = await page.request.post(`${api}/v1/admin/station`, {
      data: {
        id: `stn-${id}`,
        name_ko: '중복역',
        region_code: '41',
        checked_at: '2026-01-01',
        sources: [{ source_id: 'src-fixture-notice' }],
      },
    });
    expect(st.ok(), await st.text()).toBe(true);
    const ls = await page.request.post(`${api}/v1/admin/line-station`, {
      data: { id: `ls-${line.slice(5)}--${id}`, line_id: line, station_id: `stn-${id}`, seq, status: 'operating' },
    });
    expect(ls.ok(), await ls.text()).toBe(true);
  }
  // b → a 병합(역 상세에서 대상 역을 직접 고른다)
  await page.goto('/data/station/stn-e2e-dup-b');
  await page.getByTestId('merge-open').click();
  const dlg = page.getByTestId('merge-dialog');
  await pickRef(page, dlg, 'stn-e2e-dup-a', /중복역/);
  await expect(dlg).toContainText('stn-e2e-dup-a');
  await expect(dlg.getByTestId('merge-line-stations')).toContainText('대상 역 아래로 옮김');
  await dlg.getByLabel('병합 사유(필수)').fill('같은 역 중복');
  await page.getByTestId('merge-apply').click();
  await expect(toast(page, '병합했습니다')).toBeVisible();
  await expect(page).toHaveURL(/\/data\/station\/stn-e2e-dup-a/);

  // a → stn-e2e-dup 로 ID 변경
  await page.getByTestId('rename-open').click();
  const rd = page.getByTestId('rename-dialog');
  await rd.getByLabel(/새 id/).fill('stn-e2e-dup');
  await expect(page.getByTestId('rename-apply')).toBeDisabled();
  await page.getByTestId('rename-check').click();
  await expect(rd.getByTestId('rename-ok')).toBeVisible();
  await rd.getByLabel('변경 사유(필수)').fill('대표 id');
  await page.getByTestId('rename-apply').click();
  await expect(toast(page, 'ID 를 stn-e2e-dup 로 바꿨습니다')).toBeVisible();
  await expect(page).toHaveURL(/\/data\/station\/stn-e2e-dup$/);
  const r = await (await page.request.get(`${api}/v1/admin/line-station/ls-fx-two--e2e-dup-b`)).json();
  expect(r.data.station_id).toBe('stn-e2e-dup');
  // 옛 id(병합으로 휴지통에 간 id 포함)로는 다시 못 바꾼다
  await page.getByTestId('rename-open').click();
  await rd.getByLabel(/새 id/).fill('stn-e2e-dup-b');
  await page.getByTestId('rename-check').click();
  await expect(rd.getByTestId('rename-error')).toContainText(/이미 있음|예약된 옛 id/);
  for (const id of ['ls-fx-one--e2e-dup-a', 'ls-fx-two--e2e-dup-b']) await removeEntity(page, 'line-station', id);
});

test('계획 편집: 노선 없는 계획에 [새 노선 만들기]로 노선을 만들고 저장하면 이어진다(X-plan-no-line)', async ({
  page,
}) => {
  const api = process.env.E2E_API_URL;
  const r = await page.request.post(`${api}/v1/admin/plan`, {
    data: {
      id: 'plan-e2e-noline',
      name_ko: '이투이선',
      refs: [{ program_id: 'pp-fx-national-rail-4', class: 'new', source_id: 'src-fixture-notice' }],
      checked_at: '2026-01-01',
      sources: [{ source_id: 'src-fixture-notice' }],
    },
  });
  expect(r.ok(), await r.text()).toBe(true);
  await page.goto('/quality?rule=X-plan-no-line');
  const row = page.getByTestId('quality-items').locator('tr', { hasText: 'plan-e2e-noline' });
  await row.getByRole('link', { name: '노선 연결' }).click();
  await expect(page).toHaveURL(/\/data\/plan\/plan-e2e-noline/);

  const ed = page.getByTestId('plan-lines-editor');
  await expect(ed).toContainText('이어진 노선이 없습니다');
  await ed.getByTestId('new-line-open').click();
  const dlg = page.getByTestId('new-line-dialog');
  await expect(dlg.getByLabel('노선 id')).toHaveValue('line-e2e-noline');
  await expect(dlg.getByLabel('이름', { exact: true })).toHaveValue('이투이선');
  await dlg.getByLabel('노선 종류').selectOption('light_rail');
  await dlg.getByLabel('철도 구분').selectOption('urban');
  await expect(dlg).toContainText('src-fixture-notice');
  await page.getByTestId('new-line-create').click();
  await expect(toast(page, '계획을 저장하면 연결됩니다')).toBeVisible();
  await expect(ed).not.toContainText('이어진 노선이 없습니다');

  await page.getByRole('button', { name: /^저장/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: '저장', exact: true }).click();
  await expect(toast(page, '저장했습니다')).toBeVisible();
  const plan = await (await page.request.get(`${api}/v1/admin/plan/plan-e2e-noline`)).json();
  expect(plan.data.lines).toEqual([expect.objectContaining({ line_id: 'line-e2e-noline', role: 'new' })]);
  const line = await (await page.request.get(`${api}/v1/admin/line/line-e2e-noline`)).json();
  expect(line.data).toMatchObject({ status: 'planned', category: 'light_rail', rail_class: 'urban' });
  await page.goto('/quality?rule=X-plan-no-line');
  await expect(page.getByTestId('quality-items').locator('tr', { hasText: 'plan-e2e-noline' })).toHaveCount(0);
});

test('역 상세 [관리역]: 정거장 등급을 관리역으로 저장하고 소속 역을 넣고 뺀다', async ({ page }) => {
  const api = process.env.E2E_API_URL;
  for (const id of ['stn-e2e-mgr', 'stn-e2e-sub']) {
    const r = await page.request.post(`${api}/v1/admin/station`, {
      data: {
        id,
        name_ko: id === 'stn-e2e-mgr' ? '관리역시험' : '소속역시험',
        checked_at: '2026-11-27',
        sources: [{ source_id: 'src-fixture-notice' }],
      },
    });
    expect(r.ok(), await r.text()).toBe(true);
  }
  await page.goto('/data/station/stn-e2e-mgr');
  await page.getByLabel('정거장 등급(코레일)').selectOption('management');
  await page.getByLabel('관리역 등급(급)').fill('2');
  await page.getByRole('button', { name: /^저장/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: '저장', exact: true }).click();
  await expect(toast(page, '저장했습니다')).toBeVisible();

  await page.getByRole('tab', { name: '관리역' }).click();
  const box = page.getByTestId('managed-stations');
  await expect(box).toContainText('관리역 2급 · 소속 역 0곳');
  await pickRef(page, box, 'stn-e2e-sub', /소속역시험/);
  await box.getByTestId('managed-add').click();
  await expect(toast(page, '소속 역으로 넣었습니다')).toBeVisible();
  await expect(box.getByTestId('managed-list')).toContainText('소속역시험');
  await expect(box).toContainText('소속 역 1곳');
  const sub = await (await page.request.get(`${api}/v1/admin/station/stn-e2e-sub`)).json();
  expect(sub.data.managed_by_id).toBe('stn-e2e-mgr');

  // 소속 역에서는 관리역이 보인다
  await page.goto('/data/station/stn-e2e-sub?tab=managed');
  await expect(page.getByTestId('managed-stations')).toContainText('관리역: 관리역시험');

  await page.goto('/data/station/stn-e2e-mgr?tab=managed');
  await page.getByRole('button', { name: '소속역시험 소속에서 빼기' }).click();
  await expect(toast(page, '소속에서 뺐습니다')).toBeVisible();
  await expect(page.getByTestId('managed-stations')).toContainText('소속 역 0곳');
});
